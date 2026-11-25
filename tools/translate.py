"""シナリオの翻訳を管理する。

翻訳者が編集する原稿（--source）と、エンジンが読む翻訳 JSON（-o）の2つを扱う。

1. 原稿を原文のシナリオに合わせて更新する。新しい行やシーン名、キャラクター、
   用語、スライドの欄を空で足し、原文が変わって使われなくなった訳は stale に移す。
2. 原稿の訳文の記法（[語] **強調** `コード` など。txt2scenario.py と同じ）を外し、
   エンジンが読む翻訳 JSON を出力する。訳のない行は出力せず、画面では原文が出る。
3. 未訳の数と stale の数を表示する。

原稿の形:
    {
      "language": "en",
      "title": "",
      "characters": {"<id>": "<名前の訳>"},
      "scenes": {"<原文のシーン名>": "<訳>"},
      "terms": {"<キー>": {"help": "<説明の訳>", "match": ["<訳文での表記>"]}},
      "slides": {"<原文のスライドのパス>": "<訳文用のパス>"},
      "lines": [{"id": "...", "source": "<原文>", "text": "<訳文>"}],
      "stale": [{"id": "...", "source": "<古い原文>", "text": "<古い訳文>"}]
    }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from txt2scenario import mark_first_occurrences, parse_markup, write_text_atomic  # noqa: E402

TERM_FIELDS = ("href", "help", "style")


def load_json(path: Path, default: dict) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def write_json(path: Path, data: dict) -> None:
    # 原稿は翻訳者が編集するファイルなので、途中で止まっても元の内容が残るよう置き換えで書く
    write_text_atomic(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def sync_source(scenario: dict, config: dict, source: dict, language: str) -> dict:
    """原稿を原文のシナリオに合わせる。既存の訳は消さない"""
    old_lines = {e["id"]: e for e in source.get("lines", []) + source.get("stale", [])}
    lines: list[dict] = []
    seen: set[str] = set()
    for scene in scenario["scenes"]:
        for line in scene["dialogue"]:
            lid = line["id"]
            if lid in seen:
                continue
            seen.add(lid)
            text = old_lines.get(lid, {}).get("text", "")
            lines.append({"id": lid, "source": line["text"], "text": text})
    stale = [e for e in old_lines.values() if e["id"] not in seen and e.get("text")]

    def fill(old: dict, keys: list[str], empty) -> dict:
        return {k: old.get(k, empty() if callable(empty) else empty) for k in keys}

    scene_titles = [s["title"] for s in scenario["scenes"] if s.get("title")]
    slides = sorted({l["slide"] for s in scenario["scenes"] for l in s["dialogue"] if l.get("slide")})
    terms = {}
    for key in config.get("terms", {}):
        old = source.get("terms", {}).get(key, {})
        terms[key] = {"help": old.get("help", ""), **{k: v for k, v in old.items() if k != "help"}}

    return {
        "language": language,
        "title": source.get("title", ""),
        "characters": fill(source.get("characters", {}), [c["id"] for c in scenario["characters"]], ""),
        "scenes": fill(source.get("scenes", {}), scene_titles, ""),
        "terms": terms,
        "slides": fill(source.get("slides", {}), slides, ""),
        "lines": lines,
        "stale": stale,
    }


def compile_translation(scenario: dict, config: dict, source: dict) -> dict:
    """原稿から、エンジンが読む翻訳 JSON を作る"""
    # 訳文の記法は、原文の用語集に訳の上書き（match など）を重ねたもので解決する
    terms: dict[str, dict] = {}
    for key, term in config.get("terms", {}).items():
        terms[key] = {**term, **{k: v for k, v in source.get("terms", {}).get(key, {}).items() if v}}

    texts = {e["id"]: e["text"] for e in source["lines"] if e.get("text")}
    lines: dict[str, dict] = {}
    for scene in scenario["scenes"]:
        translated_scene = {"dialogue": []}
        for line in scene["dialogue"]:
            lid = line["id"]
            if lid not in texts or lid in lines:
                continue
            text, spans = parse_markup(texts[lid], terms, f"訳文 {lid}")
            entry = {"id": lid, "text": text}
            if spans:
                entry["spans"] = spans
            translated_scene["dialogue"].append(entry)
        mark_first_occurrences(translated_scene, terms)
        for entry in translated_scene["dialogue"]:
            lid = entry.pop("id")
            lines[lid] = entry

    out: dict = {"language": source["language"]}
    if source.get("title"):
        out["title"] = source["title"]
    for field in ("characters", "scenes", "slides"):
        filled = {k: v for k, v in source.get(field, {}).items() if v}
        if filled:
            out[field] = filled
    out_terms = {}
    for key, term in source.get("terms", {}).items():
        fields = {f: term[f] for f in TERM_FIELDS if term.get(f)}
        if fields:
            out_terms[key] = fields
    if out_terms:
        out["terms"] = out_terms
    out["lines"] = lines
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="シナリオの翻訳原稿を更新し、エンジンが読む翻訳 JSON を出力する")
    parser.add_argument("--scenario", type=Path, required=True, help="原文のシナリオ JSON（txt2scenario.py の出力）")
    parser.add_argument("--config", type=Path, required=True, help="txt2scenario.py に渡した変換設定（用語集を使う）")
    parser.add_argument("--source", type=Path, required=True, help="翻訳の原稿。なければ作る")
    parser.add_argument("--language", required=True, help="訳す言語のコード（en など）")
    parser.add_argument("-o", "--output", type=Path, required=True, help="出力する翻訳 JSON")
    args = parser.parse_args()

    scenario = json.loads(args.scenario.read_text(encoding="utf-8"))
    if any("id" not in l for s in scenario["scenes"] for l in s["dialogue"]):
        raise SystemExit(f"{args.scenario}: 行に id がない。txt2scenario.py で作り直してください")
    config = json.loads(args.config.read_text(encoding="utf-8"))

    source = sync_source(scenario, config, load_json(args.source, {}), args.language)
    write_json(args.source, source)
    write_json(args.output, compile_translation(scenario, config, source))

    untranslated = [e for e in source["lines"] if not e["text"]]
    blanks = [f"{field}.{k}" for field in ("characters", "scenes", "slides")
              for k, v in source[field].items() if not v]
    blanks += [f"terms.{k}" for k, v in source["terms"].items() if not v.get("help")]
    if not source["title"]:
        blanks.insert(0, "title")
    print(f"{args.output}: 行 {len(source['lines']) - len(untranslated)}/{len(source['lines'])} 訳済み")
    if untranslated:
        print(f"  未訳の行: {len(untranslated)}（画面では原文を出す）")
    if blanks:
        print(f"  空欄: {', '.join(blanks)}")
    if source["stale"]:
        print(f"  原文が変わって使われなくなった訳: {len(source['stale'])}（stale に残した。不要なら消す）")


if __name__ == "__main__":
    main()
