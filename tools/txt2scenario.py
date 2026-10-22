"""テキスト原稿からシナリオ JSON を生成する。

原稿の書式:
    ## シーン名            シーンの区切り。最初の ## より前の行は1つ目のシーンに入る
    @background <パス>     直後のシーンの背景（省略時は前のシーンを引き継ぐ）
    @bgm <パス>|none       直後のシーンの BGM（none で停止、省略時は前のシーンを維持）
    @transition            直後のシーンを暗転ナレーションにする
    @slide <パス>|none      次の行からスライド画像を表示する（none で消す）。
                           none を書くかシーンが変わるまで表示し続ける
    名前「セリフ」          config の characters[].name に一致する名前ならセリフ
    それ以外の行            ナレーション

行の中の記法（表示用テキストからは記号を外し、位置を spans に書く）:
    [語]                   config の terms にある語。リンクや説明を付ける
    [表示|キー]            表示する文字と terms のキーが違うとき
    [語](URL)              その場限りのリンク
    **語**                 強調
    `語`                   コード表示
    \[ \* \`              記号そのもの

terms の項目に "auto": "first" を書くと、各シーンで最初に出てきた箇所に
記法なしでも印を付ける。照合する表記は "match"（省略時はキー）で変えられる。

config の readings に一致する語は読み上げ用テキスト（reading）で置き換える。
maxLineLength を超える行は、括弧の外の文末（。？！）で複数行に分ける。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SPEECH = re.compile(r"^(?P<name>[^「」\s]+)「(?P<text>.*)」$")
OPEN_BRACKETS = "「『（(【["
CLOSE_BRACKETS = "」』）)】]"
MARKUP = re.compile(
    r"\\(?P<esc>.)"
    r"|\[(?P<label>[^\]|]+)(?:\|(?P<key>[^\]]+))?\](?:\((?P<href>[^)\s]+)\))?"
    r"|\*\*(?P<em>.+?)\*\*"
    r"|`(?P<code>[^`]+)`"
)
TERM_FIELDS = ("href", "help", "style")
SENTENCE_END = "。？！?!"


def split_sentences(text: str) -> list[str]:
    """括弧の外にある文末で文に分ける"""
    sentences: list[str] = []
    depth = 0
    start = 0
    for i, ch in enumerate(text):
        if ch in OPEN_BRACKETS:
            depth += 1
        elif ch in CLOSE_BRACKETS:
            depth = max(depth - 1, 0)
        elif ch in SENTENCE_END and depth == 0:
            # 「？　」のような全角スペースは次の文の頭に残さない
            end = i + 1
            sentences.append(text[start:end])
            start = end
            while start < len(text) and text[start] in "　 ":
                start += 1
    if start < len(text):
        sentences.append(text[start:])
    return sentences


def wrap(text: str, max_len: int) -> list[str]:
    """max_len を超えるテキストを文単位で詰め直す"""
    if len(text) <= max_len:
        return [text]
    chunks: list[str] = []
    current = ""
    for sentence in split_sentences(text):
        if current and len(current) + len(sentence) > max_len:
            chunks.append(current)
            current = sentence
        else:
            current = current + ("　" if current and current[-1] in "？！?!" else "") + sentence
    if current:
        chunks.append(current)
    return chunks


def parse_markup(text: str, terms: dict[str, dict], where: str) -> tuple[str, list[dict]]:
    """記法を外した表示用テキストと、印を付けた区間を返す"""
    out: list[str] = []
    spans: list[dict] = []
    length = 0
    pos = 0
    for m in MARKUP.finditer(text):
        out.append(text[pos:m.start()])
        length += m.start() - pos
        pos = m.end()
        if m.group("esc") is not None:
            out.append(m.group("esc"))
            length += 1
            continue
        if m.group("label") is not None:
            label = m.group("label")
            span: dict = {}
            if m.group("href"):
                span["href"] = m.group("href")
            else:
                key = m.group("key") or label
                if key not in terms:
                    raise SystemExit(f"{where}: terms にない語 [{key}]")
                span["term"] = key
        elif m.group("em") is not None:
            label, span = m.group("em"), {"style": "em"}
        else:
            label, span = m.group("code"), {"style": "code"}
        spans.append({"start": length, "end": length + len(label), **span})
        out.append(label)
        length += len(label)
    out.append(text[pos:])
    return "".join(out), spans


def mark_first_occurrences(scene: dict, terms: dict[str, dict]) -> None:
    """auto: first の語に、シーン内で最初に出てきた箇所だけ印を付ける"""
    for key, term in terms.items():
        if term.get("auto") != "first":
            continue
        patterns = term.get("match", [key])
        for line in scene["dialogue"]:
            spans = line.setdefault("spans", [])
            if any(s.get("term") == key for s in spans):
                break
            hit = None
            for pattern in patterns:
                i = line["text"].find(pattern)
                while i >= 0 and any(s["start"] < i + len(pattern) and i < s["end"] for s in spans):
                    i = line["text"].find(pattern, i + 1)
                if i >= 0 and (hit is None or i < hit[0]):
                    hit = (i, i + len(pattern))
            if hit:
                spans.append({"start": hit[0], "end": hit[1], "term": key})
                spans.sort(key=lambda s: s["start"])
                break
        for line in scene["dialogue"]:
            if not line.get("spans"):
                line.pop("spans", None)


def make_line(character_id: str | None, text: str, readings: dict[str, str],
              terms: dict[str, dict], where: str) -> dict:
    display, spans = parse_markup(text, terms, where)
    line: dict = {"characterId": character_id, "text": display}
    reading = display
    for word, yomi in readings.items():
        reading = reading.replace(word, yomi)
    if character_id is not None and reading != display:
        line["reading"] = reading
    if spans:
        line["spans"] = spans
    return line


def parse(source: str, config: dict) -> list[dict]:
    name_to_id = {c["name"]: c["id"] for c in config["characters"]}
    readings: dict[str, str] = config.get("readings", {})
    terms: dict[str, dict] = config.get("terms", {})
    max_len: int = config.get("maxLineLength", 100)

    scenes: list[dict] = []
    pending: dict = {}
    pending_slide: dict = {}  # {"slide": パス or None}。次の行に付ける
    background = config.get("defaultBackground", "")

    def current_scene() -> dict:
        if not scenes:
            open_scene(None)
        return scenes[-1]

    def open_scene(title: str | None) -> None:
        nonlocal background, pending
        scene: dict = {}
        if pending.pop("transition", False):
            scene["type"] = "transition"
        if title:
            scene["title"] = title
        background = pending.pop("background", background)
        if scene.get("type") != "transition":
            scene["background"] = background
        if "bgm" in pending:
            scene["bgm"] = pending.pop("bgm")
        scene["dialogue"] = []
        scenes.append(scene)
        pending = {}

    for lineno, raw in enumerate(source.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("## "):
            open_scene(line[3:].strip())
            continue
        if line.startswith("@"):
            key, _, value = line[1:].partition(" ")
            value = value.strip()
            if key == "background":
                pending["background"] = value
            elif key == "bgm":
                pending["bgm"] = None if value == "none" else value
            elif key == "transition":
                pending["transition"] = True
            elif key == "slide":
                pending_slide["slide"] = None if value == "none" else value
            else:
                raise SystemExit(f"{lineno}行目: 不明な指示 @{key}")
            continue

        m = SPEECH.match(line)
        if m and m.group("name") in name_to_id:
            character_id: str | None = name_to_id[m.group("name")]
            text = m.group("text")
        else:
            character_id = None
            text = line
        for chunk in wrap(text, max_len):
            entry = make_line(character_id, chunk, readings, terms, f"{lineno}行目")
            if "slide" in pending_slide:
                entry["slide"] = pending_slide.pop("slide")
            current_scene()["dialogue"].append(entry)

    for scene in scenes:
        mark_first_occurrences(scene, terms)
    return scenes


def main() -> None:
    parser = argparse.ArgumentParser(description="テキスト原稿からシナリオ JSON を生成する")
    parser.add_argument("source", type=Path, help="原稿テキスト")
    parser.add_argument("--config", type=Path, required=True,
                        help="title / characters / readings / terms / maxLineLength / defaultBackground を書いた JSON")
    parser.add_argument("-o", "--output", type=Path, required=True, help="出力するシナリオ JSON")
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    scenario = {
        "title": config.get("title", ""),
        "characters": config["characters"],
        "scenes": parse(args.source.read_text(encoding="utf-8"), config),
    }
    terms = {
        key: {f: term[f] for f in TERM_FIELDS if f in term}
        for key, term in config.get("terms", {}).items()
    }
    if terms:
        scenario["terms"] = terms
    args.output.write_text(json.dumps(scenario, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = sum(len(s["dialogue"]) for s in scenario["scenes"])
    print(f"{args.output}: シーン {len(scenario['scenes'])}、行 {lines}")


if __name__ == "__main__":
    main()
