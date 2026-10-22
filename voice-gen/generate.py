import argparse
import hashlib
import json
import logging
import multiprocessing
import os
import subprocess
from pathlib import Path

from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

# --- パス定数（VOICEVOX Core の置き場所は環境変数 VOICEVOX_ROOT で指定する） ---
if "VOICEVOX_ROOT" not in os.environ:
    raise SystemExit("環境変数 VOICEVOX_ROOT に VOICEVOX Core のディレクトリを指定してください")
VOICEVOX_ROOT = Path(os.environ["VOICEVOX_ROOT"]).expanduser()
ONNXRUNTIME_PATH = str(
    VOICEVOX_ROOT / "onnxruntime" / "lib" / Onnxruntime.LIB_VERSIONED_FILENAME
)
DICT_DIR = str(VOICEVOX_ROOT / "dict" / "open_jtalk_dic_utf_8-1.11")
VVM_DIR = VOICEVOX_ROOT / "models" / "vvms"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="シナリオのセリフを VOICEVOX で音声化し、audio パスを書き戻す")
    parser.add_argument("--scenario", type=Path, default=Path("public/scenarios/episode1.json"),
                        help="シナリオ JSON（既定: public/scenarios/episode1.json）")
    parser.add_argument("--voices", type=Path, default=Path("voices.json"),
                        help="キャラクター ID → 音声設定の JSON（既定: voices.json）")
    parser.add_argument("--public-dir", type=Path, default=Path("public"),
                        help="音声を書き出す public ディレクトリ。<public-dir>/audio/ に出力（既定: public）")
    return parser.parse_args()


def audio_hash(char_id: str, text: str, voice: dict) -> str:
    """キャラID・テキスト・声の設定からファイル名用の短いハッシュを生成。
    声の設定を含めるので、voices.json を変えると該当キャラのセリフは作り直される"""
    voice_key = json.dumps(
        {k: voice[k] for k in ("vvm", "style_id", "speed", "intonation")}, sort_keys=True
    )
    return hashlib.sha256(f"{char_id}:{text}:{voice_key}".encode()).hexdigest()[:12]


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


def main() -> None:
    logging.basicConfig(format="[%(levelname)s] %(name)s: %(message)s")
    logger = logging.getLogger(__name__)
    logger.setLevel("INFO")

    args = parse_args()
    scenario_path: Path = args.scenario
    audio_dir: Path = args.public_dir / "audio"

    # 声の割り当て: {"<characterId>": {"name", "vvm", "style_id", "speed", "intonation"}}
    character_voice = json.loads(args.voices.read_text(encoding="utf-8"))

    # シナリオを読み込み
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

    # 出力ディレクトリ
    audio_dir.mkdir(parents=True, exist_ok=True)

    # スキップ判定: 生成が必要なセリフがあるか確認
    to_generate: list[tuple[int, int, str, str, str, Path]] = []  # (..., mp3_filename, mp3_path)
    for si, li, char_id, text in dialogues:
        h = audio_hash(char_id, text, character_voice[char_id])
        mp3_filename = f"{char_id}_{h}.mp3"
        mp3_path = audio_dir / mp3_filename
        episode["scenes"][si]["dialogue"][li]["audio"] = f"/audio/{mp3_filename}"
        if not mp3_path.exists():
            to_generate.append((si, li, char_id, text, mp3_filename, mp3_path))

    logger.info("生成が必要なセリフ数: %d / %d", len(to_generate), len(dialogues))

    if to_generate:
        # Synthesizer 初期化
        logger.info("ONNX Runtime をロード中...")
        onnxruntime = Onnxruntime.load_once(filename=ONNXRUNTIME_PATH)

        logger.info("Synthesizer を初期化中...")
        synthesizer = Synthesizer(
            onnxruntime,
            OpenJtalk(DICT_DIR),
            acceleration_mode="AUTO",
            cpu_num_threads=max(multiprocessing.cpu_count(), 2),
        )

        # 必要な VVM をロード（同じファイルは1回だけ）
        loaded_vvms: set[str] = set()
        for _, _, char_id, _, _, _ in to_generate:
            vvm_file = character_voice[char_id]["vvm"]
            if vvm_file not in loaded_vvms:
                vvm_path = VVM_DIR / vvm_file
                logger.info("VVM をロード中: %s", vvm_path)
                with VoiceModelFile.open(str(vvm_path)) as model:
                    synthesizer.load_voice_model(model)
                loaded_vvms.add(vvm_file)

        # 音声合成 → wav → mp3
        for si, li, char_id, text, mp3_filename, mp3_path in to_generate:
            conf = character_voice[char_id]
            name = conf["name"]
            style_id = conf["style_id"]
            wav_path = mp3_path.with_suffix(".wav")

            logger.info("[生成] %s: %s", name, text[:30] + ("..." if len(text) > 30 else ""))

            audio_query = synthesizer.create_audio_query(text, style_id)
            audio_query.speed_scale = conf["speed"]
            audio_query.intonation_scale = conf["intonation"]
            if text.endswith("？") or text.endswith("?"):
                raise_question_intonation(audio_query)
            wav = synthesizer.synthesis(audio_query, style_id)
            wav_path.write_bytes(wav)

            subprocess.run(
                ["ffmpeg", "-y", "-i", str(wav_path), "-q:a", "2", str(mp3_path)],
                capture_output=True,
                check=True,
            )
            wav_path.unlink()

    # シナリオを更新（audio パスを書き戻し）
    scenario_path.write_text(
        json.dumps(episode, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    logger.info("シナリオを更新: %s", scenario_path)

    logger.info("完了! 生成: %d, スキップ: %d", len(to_generate), len(dialogues) - len(to_generate))


if __name__ == "__main__":
    main()
