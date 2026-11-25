"""シナリオのセリフを VOICEVOX で音声化し、mp3 のパスをシナリオに書き戻す。

生成済みの mp3 は、ファイル名に含まれるハッシュが一致すれば作り直さない。ハッシュは
「その mp3 の中身を決める入力のすべて」から計算する（generation_key）。

- line_spec: 1 行分の合成条件。synthesize はこの dict からしか値を読まない
- エンコード設定: encode_mp3 に渡す ffmpeg の引数そのもの
- エンジン: VOICEVOX Core・ONNX Runtime・辞書のバージョン
- 生成処理のソースコード（pipeline_digest）

合成に使う値を増やすときは line_spec に足す。synthesize が line_spec 以外から値を読むと、
その値はハッシュに入らず、変えても既存の mp3 が使い回される。
"""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import logging
import multiprocessing
import os
import re
import subprocess
import tempfile
from pathlib import Path

DICT_NAME = "open_jtalk_dic_utf_8-1.11"
DEFAULT_VBR_QUALITY = 8

# voices.json の 1 キャラクター分に書けるキーと型。name は表示用で音声には影響しない
VOICE_FIELDS: dict[str, type | tuple[type, ...]] = {
    "name": str,
    "vvm": str,
    "style_id": int,
    "speed": (int, float),
    "intonation": (int, float),
}


# --- コマンドライン ---------------------------------------------------------

def parse_bitrate(value: str) -> str:
    if not re.fullmatch(r"[1-9][0-9]*k", value):
        raise argparse.ArgumentTypeError("ビットレートは 32k のように、正の整数に k を付けて指定してください")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="シナリオのセリフを VOICEVOX で音声化し、audio パスを書き戻す")
    parser.add_argument("--scenario", type=Path, default=Path("public/scenarios/episode1.json"),
                        help="シナリオ JSON（既定: public/scenarios/episode1.json）")
    parser.add_argument("--voices", type=Path, default=Path("voices.json"),
                        help="キャラクター ID → 音声設定の JSON（既定: voices.json）")
    parser.add_argument("--public-dir", type=Path, default=Path("public"),
                        help="音声を書き出す public ディレクトリ。<public-dir>/audio/ に出力（既定: public）")
    encoding = parser.add_mutually_exclusive_group()
    # default を None にして既定値は mp3_encoding_args で補う。Python 3.9 の argparse は、値が default と
    # 同一オブジェクトだと未指定とみなすので、default=8 だと --vbr-quality 8 --bitrate 32k が排他エラーにならない
    encoding.add_argument("--vbr-quality", type=int, choices=range(10), metavar="0-9",
                          help=f"mp3 の VBR 品質。0 が最高品質で、数字が大きいほど小さくなる（既定: {DEFAULT_VBR_QUALITY}）")
    encoding.add_argument("--bitrate", type=parse_bitrate,
                          help="mp3 を固定ビットレートで書き出す（例: 32k）。指定すると --vbr-quality は使わない")
    return parser


def mp3_encoding_args(args: argparse.Namespace) -> list[str]:
    """ffmpeg に渡す mp3 のエンコード設定"""
    if args.bitrate is not None:
        return ["-b:a", args.bitrate]
    quality = DEFAULT_VBR_QUALITY if args.vbr_quality is None else args.vbr_quality
    return ["-q:a", str(quality)]


def load_voices(path: Path) -> dict[str, dict]:
    """voices.json を読み、書けるキーと型を検査する。
    未知のキーを黙って無視すると、書いた設定が音声に反映されないことに気づけないので止める"""
    voices = json.loads(path.read_text(encoding="utf-8"))
    for char_id, voice in voices.items():
        unknown = voice.keys() - VOICE_FIELDS.keys()
        if unknown:
            raise SystemExit(f"{path}: {char_id} に未対応のキーがあります: {', '.join(sorted(unknown))}")
        missing = VOICE_FIELDS.keys() - voice.keys()
        if missing:
            raise SystemExit(f"{path}: {char_id} に必要なキーがありません: {', '.join(sorted(missing))}")
        for key, typ in VOICE_FIELDS.items():
            if not isinstance(voice[key], typ) or isinstance(voice[key], bool):
                raise SystemExit(f"{path}: {char_id} の {key} の型が正しくありません: {voice[key]!r}")
    return voices


# --- 生成条件とハッシュ -------------------------------------------------------

def line_spec(text: str, voice: dict, model_sha256: str) -> dict:
    """1 行分の合成条件。synthesize が読む値はすべてここに入れる"""
    return {
        "text": text,
        "model": model_sha256,
        "style_id": voice["style_id"],
        "speed": voice["speed"],
        "intonation": voice["intonation"],
    }


def generation_key(spec: dict, encoding_args: list[str], engine: dict, pipeline: str) -> dict:
    return {"line": spec, "encoding": encoding_args, "engine": engine, "pipeline": pipeline}


def audio_hash(key: dict) -> str:
    data = json.dumps(key, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()[:12]


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --- 音声を作る処理（ソースコードが pipeline_digest に入る） ---------------------

def raise_question_intonation(audio_query, semitones: float = 2.0) -> None:
    """文末が疑問形のとき、最後のアクセント句の末尾モーラのピッチを上げる"""
    phrases = audio_query.accent_phrases
    if not phrases:
        return
    for phrase in reversed(phrases):
        if phrase.moras:
            last = phrase.moras[-1]
            if last.pitch > 0:
                last.pitch += semitones * 0.05
            return


def synthesize(synthesizer, spec: dict) -> bytes:
    """spec の条件で WAV を合成する。spec 以外の値を使わないこと"""
    audio_query = synthesizer.create_audio_query(spec["text"], spec["style_id"])
    audio_query.speed_scale = spec["speed"]
    audio_query.intonation_scale = spec["intonation"]
    if spec["text"].endswith("？") or spec["text"].endswith("?"):
        raise_question_intonation(audio_query)
    return synthesizer.synthesis(audio_query, spec["style_id"])


def encode_mp3(wav: bytes, mp3_path: Path, encoding_args: list[str]) -> None:
    """WAV を mp3 に変換し、成功したときだけ mp3_path に置く。
    失敗しても mp3_path は作られないので、次の実行で作り直される"""
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "line.wav"
        wav_path.write_bytes(wav)
        tmp_mp3 = temp_file_beside(mp3_path)
        try:
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(wav_path), *encoding_args, "-f", "mp3", str(tmp_mp3)],
                check=True,
            )
            os.replace(tmp_mp3, mp3_path)
        except BaseException:
            tmp_mp3.unlink(missing_ok=True)
            raise


PIPELINE_FUNCTIONS = (raise_question_intonation, synthesize, encode_mp3)


def pipeline_digest() -> str:
    """音声を作る関数のソースコードのハッシュ。処理を変えると全セリフが作り直される"""
    source = "".join(inspect.getsource(f) for f in PIPELINE_FUNCTIONS)
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


# --- ファイル書き込み ---------------------------------------------------------

def temp_file_beside(path: Path) -> Path:
    """path と同じディレクトリに一時ファイルを作る。os.replace で置き換えられるよう同じファイルシステムに置き、
    パーミッションは通常のファイル作成と同じ（umask を反映）にする"""
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    os.close(fd)
    umask = os.umask(0)
    os.umask(umask)
    os.chmod(name, 0o666 & ~umask)
    return Path(name)


def write_text_atomic(path: Path, text: str) -> None:
    tmp = temp_file_beside(path)
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


# --- 実行 -------------------------------------------------------------------

def main() -> None:
    logging.basicConfig(format="[%(levelname)s] %(name)s: %(message)s")
    logger = logging.getLogger(__name__)
    logger.setLevel("INFO")

    args = build_parser().parse_args()
    encoding_args = mp3_encoding_args(args)

    # VOICEVOX Core の置き場所は環境変数 VOICEVOX_ROOT で指定する
    if "VOICEVOX_ROOT" not in os.environ:
        raise SystemExit("環境変数 VOICEVOX_ROOT に VOICEVOX Core のディレクトリを指定してください")
    voicevox_root = Path(os.environ["VOICEVOX_ROOT"]).expanduser()
    vvm_dir = voicevox_root / "models" / "vvms"

    from voicevox_core import __version__ as core_version
    from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

    engine = {
        "voicevox_core": core_version,
        "onnxruntime": Onnxruntime.LIB_VERSIONED_FILENAME,
        "dictionary": DICT_NAME,
    }
    pipeline = pipeline_digest()

    scenario_path: Path = args.scenario
    audio_dir: Path = args.public_dir / "audio"

    # 声の割り当て: {"<characterId>": {"name", "vvm", "style_id", "speed", "intonation"}}
    character_voice = load_voices(args.voices)

    episode = json.loads(scenario_path.read_text(encoding="utf-8"))
    logger.info("シナリオを読み込み: %s", scenario_path)

    # セリフ行を収集（characterId が null でないもの）
    dialogues: list[tuple[int, int, str, str]] = []  # (scene_idx, line_idx, char_id, reading_text)
    for si, scene in enumerate(episode["scenes"]):
        for li, line in enumerate(scene["dialogue"]):
            if line.get("characterId") is not None:
                reading = line.get("reading") or line["text"]
                dialogues.append((si, li, line["characterId"], reading))

    logger.info("音声合成対象のセリフ数: %d", len(dialogues))
    if not dialogues:
        logger.warning("セリフが見つかりませんでした")
        return

    # 未定義のキャラクターがあれば合成前に止める
    missing = sorted({c for _, _, c, _ in dialogues} - character_voice.keys())
    if missing:
        raise SystemExit(f"{args.voices} に声が定義されていないキャラクター: {', '.join(missing)}")

    # 使う音声モデルの中身のハッシュ（同じファイルは 1 回だけ読む）
    model_sha256: dict[str, str] = {}
    for vvm_file in sorted({character_voice[c]["vvm"] for _, _, c, _ in dialogues}):
        vvm_path = vvm_dir / vvm_file
        if not vvm_path.is_file():
            raise SystemExit(f"音声モデルが見つかりません: {vvm_path}")
        model_sha256[vvm_file] = file_sha256(vvm_path)

    audio_dir.mkdir(parents=True, exist_ok=True)

    # 生成条件のハッシュがファイル名。同じ名前のファイルがあれば作り直さない
    to_generate: list[tuple[str, dict, Path]] = []  # (char_id, spec, mp3_path)
    for si, li, char_id, text in dialogues:
        voice = character_voice[char_id]
        spec = line_spec(text, voice, model_sha256[voice["vvm"]])
        h = audio_hash(generation_key(spec, encoding_args, engine, pipeline))
        mp3_filename = f"{char_id}_{h}.mp3"
        mp3_path = audio_dir / mp3_filename
        episode["scenes"][si]["dialogue"][li]["audio"] = f"/audio/{mp3_filename}"
        if not mp3_path.exists():
            to_generate.append((char_id, spec, mp3_path))

    logger.info("生成が必要なセリフ数: %d / %d", len(to_generate), len(dialogues))

    if to_generate:
        logger.info("ONNX Runtime をロード中...")
        onnxruntime = Onnxruntime.load_once(
            filename=str(voicevox_root / "onnxruntime" / "lib" / Onnxruntime.LIB_VERSIONED_FILENAME)
        )

        logger.info("Synthesizer を初期化中...")
        synthesizer = Synthesizer(
            onnxruntime,
            OpenJtalk(str(voicevox_root / "dict" / DICT_NAME)),
            acceleration_mode="AUTO",
            cpu_num_threads=max(multiprocessing.cpu_count(), 2),
        )

        # 必要な VVM をロード（同じファイルは1回だけ）
        loaded_vvms: set[str] = set()
        for char_id, _, _ in to_generate:
            vvm_file = character_voice[char_id]["vvm"]
            if vvm_file not in loaded_vvms:
                vvm_path = vvm_dir / vvm_file
                logger.info("VVM をロード中: %s", vvm_path)
                with VoiceModelFile.open(str(vvm_path)) as model:
                    synthesizer.load_voice_model(model)
                loaded_vvms.add(vvm_file)

        for char_id, spec, mp3_path in to_generate:
            text = spec["text"]
            logger.info("[生成] %s: %s", character_voice[char_id]["name"],
                        text[:30] + ("..." if len(text) > 30 else ""))
            encode_mp3(synthesize(synthesizer, spec), mp3_path, encoding_args)

    write_text_atomic(scenario_path, json.dumps(episode, ensure_ascii=False, indent=2) + "\n")
    logger.info("シナリオを更新: %s", scenario_path)

    logger.info("完了! 生成: %d, スキップ: %d", len(to_generate), len(dialogues) - len(to_generate))


if __name__ == "__main__":
    main()
