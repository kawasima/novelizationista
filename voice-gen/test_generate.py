"""generate.py の回帰テスト。VOICEVOX は使わない（ffmpeg を使うテストは ffmpeg がなければスキップ）。

    python3 -m unittest discover -s voice-gen
"""

import contextlib
import io
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

import generate

VOICE = {"name": "葵", "vvm": "0.vvm", "style_id": 6, "speed": 1.2, "intonation": 1.1}
ENGINE = {"voicevox_core": "0.16.4", "onnxruntime": "libvoicevox_onnxruntime.1.17.3.dylib",
          "dictionary": "open_jtalk_dic_utf_8-1.11"}


def parse(*argv: str):
    return generate.build_parser().parse_args(list(argv))


def rejects(*argv: str) -> bool:
    with contextlib.redirect_stderr(io.StringIO()):
        try:
            parse(*argv)
        except SystemExit:
            return True
    return False


def key_hash(encoding_args, text="こんにちは", voice=VOICE, model="m0", engine=ENGINE, pipeline="p0"):
    spec = generate.line_spec(text, voice, model)
    return generate.audio_hash(generate.generation_key(spec, encoding_args, engine, pipeline))


def silent_wav(seconds: float = 0.2, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


def current_umask_mode() -> int:
    umask = os.umask(0)
    os.umask(umask)
    return 0o666 & ~umask


class CommandLineTest(unittest.TestCase):
    def test_default_is_vbr_quality_8(self):
        self.assertEqual(generate.mp3_encoding_args(parse()), ["-q:a", "8"])

    def test_vbr_quality_accepts_0_to_9(self):
        for q in range(10):
            self.assertEqual(generate.mp3_encoding_args(parse("--vbr-quality", str(q))), ["-q:a", str(q)])

    def test_vbr_quality_rejects_out_of_range(self):
        for q in ("-1", "10"):
            self.assertTrue(rejects("--vbr-quality", q), q)

    def test_bitrate_uses_cbr_only(self):
        self.assertEqual(generate.mp3_encoding_args(parse("--bitrate", "32k")), ["-b:a", "32k"])

    def test_vbr_and_cbr_are_exclusive(self):
        self.assertTrue(rejects("--vbr-quality", "8", "--bitrate", "32k"))

    def test_bitrate_rejects_malformed_values(self):
        for value in ("", "0k", "32", "32K", "-32k", "032k", "nonsense"):
            self.assertTrue(rejects("--bitrate", value), repr(value))


class GenerationKeyTest(unittest.TestCase):
    def test_same_conditions_give_same_hash(self):
        self.assertEqual(key_hash(["-q:a", "8"]), key_hash(["-q:a", "8"]))

    def test_vbr_quality_changes_hash(self):
        self.assertNotEqual(key_hash(["-q:a", "8"]), key_hash(["-q:a", "2"]))

    def test_vbr_to_cbr_changes_hash(self):
        self.assertNotEqual(key_hash(["-q:a", "8"]), key_hash(["-b:a", "32k"]))

    def test_cbr_bitrate_changes_hash(self):
        self.assertNotEqual(key_hash(["-b:a", "32k"]), key_hash(["-b:a", "48k"]))

    def test_reverting_encoding_restores_hash(self):
        before = key_hash(["-q:a", "8"])
        key_hash(["-b:a", "32k"])
        self.assertEqual(before, key_hash(["-q:a", "8"]))

    def test_every_synthesis_input_changes_hash(self):
        base = key_hash(["-q:a", "8"])
        variants = {
            "text": key_hash(["-q:a", "8"], text="さようなら"),
            "style_id": key_hash(["-q:a", "8"], voice={**VOICE, "style_id": 7}),
            "speed": key_hash(["-q:a", "8"], voice={**VOICE, "speed": 1.0}),
            "intonation": key_hash(["-q:a", "8"], voice={**VOICE, "intonation": 1.0}),
            "model": key_hash(["-q:a", "8"], model="m1"),
            "engine": key_hash(["-q:a", "8"], engine={**ENGINE, "voicevox_core": "0.17.0"}),
            "pipeline": key_hash(["-q:a", "8"], pipeline="p1"),
        }
        for name, h in variants.items():
            self.assertNotEqual(base, h, name)

    def test_display_name_does_not_change_hash(self):
        self.assertEqual(key_hash(["-q:a", "8"]), key_hash(["-q:a", "8"], voice={**VOICE, "name": "別名"}))

    def test_synthesize_reads_only_the_spec(self):
        """synthesize が spec 以外の値を読むと、その値がハッシュから漏れる。引数が (synthesizer, spec) であることを固定する"""
        import inspect
        self.assertEqual(list(inspect.signature(generate.synthesize).parameters), ["synthesizer", "spec"])

    def test_pipeline_digest_covers_synthesis_and_encoding(self):
        self.assertIn(generate.synthesize, generate.PIPELINE_FUNCTIONS)
        self.assertIn(generate.encode_mp3, generate.PIPELINE_FUNCTIONS)
        self.assertIn(generate.raise_question_intonation, generate.PIPELINE_FUNCTIONS)


class LoadVoicesTest(unittest.TestCase):
    def load(self, voices: dict):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "voices.json"
            path.write_text(json.dumps(voices), encoding="utf-8")
            return generate.load_voices(path)

    def test_accepts_valid_voices(self):
        self.assertEqual(self.load({"aoi": VOICE}), {"aoi": VOICE})

    def test_rejects_unknown_key(self):
        with self.assertRaises(SystemExit):
            self.load({"aoi": {**VOICE, "pitch": 0.1}})

    def test_rejects_missing_key(self):
        voice = dict(VOICE)
        del voice["speed"]
        with self.assertRaises(SystemExit):
            self.load({"aoi": voice})

    def test_rejects_wrong_type(self):
        with self.assertRaises(SystemExit):
            self.load({"aoi": {**VOICE, "speed": "fast"}})


class AtomicWriteTest(unittest.TestCase):
    def test_write_text_atomic_writes_with_normal_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "episode1.json"
            path.write_text("old", encoding="utf-8")
            generate.write_text_atomic(path, "new")
            self.assertEqual(path.read_text(encoding="utf-8"), "new")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), current_umask_mode())
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["episode1.json"])


class AudioDirTest(unittest.TestCase):
    def test_each_scenario_has_its_own_directory(self):
        self.assertEqual(generate.scenario_audio_name(Path("public/scenarios/episode1.json")), "episode1")
        self.assertNotEqual(generate.scenario_audio_name(Path("public/scenarios/episode1.json")),
                            generate.scenario_audio_name(Path("public/scenarios/episode2.json")))

    def test_prune_removes_everything_not_referenced(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            for name in ("aoi_keep.mp3", "aoi_old.mp3", ".aoi_new.mp3.abc.tmp", "aoi_old.wav"):
                (d / name).write_bytes(b"x")
            removed = generate.prune_audio_dir(d, {"aoi_keep.mp3"})
            self.assertEqual(sorted(removed), [".aoi_new.mp3.abc.tmp", "aoi_old.mp3", "aoi_old.wav"])
            self.assertEqual([p.name for p in d.iterdir()], ["aoi_keep.mp3"])

    def test_prune_with_no_references_empties_the_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / "aoi_old.mp3").write_bytes(b"x")
            generate.prune_audio_dir(d, set())
            self.assertEqual(list(d.iterdir()), [])

    def test_prune_stops_without_deleting_when_a_subdirectory_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / "aoi_old.mp3").write_bytes(b"x")
            (d / "unexpected").mkdir()
            with self.assertRaises(SystemExit):
                generate.prune_audio_dir(d, set())
            self.assertTrue((d / "aoi_old.mp3").exists())


class ClaimAudioDirTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.audio = self.root / "public" / "audio" / "episode1"
        self.audio.mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def scenario(self, folder: str) -> Path:
        path = self.root / folder / "episode1.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")
        return path

    def test_same_scenario_can_reuse_its_directory(self):
        s = self.scenario("public/scenarios")
        generate.claim_audio_dir(self.audio, s)
        generate.claim_audio_dir(self.audio, s)

    def test_another_scenario_with_the_same_name_is_rejected(self):
        generate.claim_audio_dir(self.audio, self.scenario("public/scenarios"))
        with self.assertRaises(SystemExit):
            generate.claim_audio_dir(self.audio, self.scenario("public/scenarios/other"))

    def test_owner_is_recorded_as_a_relative_path(self):
        generate.claim_audio_dir(self.audio, self.scenario("public/scenarios"))
        recorded = (self.audio / generate.OWNER_FILE).read_text(encoding="utf-8").strip()
        self.assertEqual(recorded, "../../scenarios/episode1.json")

    def test_prune_keeps_the_owner_file(self):
        generate.claim_audio_dir(self.audio, self.scenario("public/scenarios"))
        generate.prune_audio_dir(self.audio, set())
        self.assertTrue((self.audio / generate.OWNER_FILE).exists())


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg が必要")
class EncodeMp3Test(unittest.TestCase):
    def test_success_publishes_only_the_mp3(self):
        with tempfile.TemporaryDirectory() as tmp:
            mp3 = Path(tmp) / "aoi_000000000000.mp3"
            generate.encode_mp3(silent_wav(), mp3, ["-q:a", "8"])
            self.assertGreater(mp3.stat().st_size, 0)
            self.assertEqual(stat.S_IMODE(mp3.stat().st_mode), current_umask_mode())
            self.assertEqual([p.name for p in Path(tmp).iterdir()], [mp3.name])

    def test_failure_leaves_no_mp3_and_no_temp_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            mp3 = Path(tmp) / "aoi_000000000000.mp3"
            with open(os.devnull, "w") as devnull, contextlib.redirect_stderr(devnull):
                with self.assertRaises(subprocess.CalledProcessError):
                    generate.encode_mp3(silent_wav(), mp3, ["-b:a", "nonsense"])
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_retry_after_failure_generates_the_mp3(self):
        with tempfile.TemporaryDirectory() as tmp:
            mp3 = Path(tmp) / "aoi_000000000000.mp3"
            with self.assertRaises(subprocess.CalledProcessError):
                generate.encode_mp3(silent_wav(), mp3, ["-b:a", "nonsense"])
            self.assertFalse(mp3.exists())  # main はこれを見て作り直す対象に入れる
            generate.encode_mp3(silent_wav(), mp3, ["-q:a", "8"])
            self.assertTrue(mp3.exists())


if __name__ == "__main__":
    unittest.main()
