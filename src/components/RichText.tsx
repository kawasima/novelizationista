import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useVolume } from "../hooks/useVolumeControl";
import type { Term, TextSpan } from "../types/sprite";

/** シナリオの用語集。ScenarioPlayer が配る */
export const TermsContext = createContext<Record<string, Term>>({});

interface Props {
  text: string;
  spans?: TextSpan[];
  /** 表示する文字数（文字送り）。省略時は全文 */
  visible?: number;
  /** false の間は見た目だけで、クリックは親（文字送りのスキップ）に渡す */
  interactive?: boolean;
}

interface Tip {
  index: number;
  help: string;
  x: number;
  y: number;
}

/**
 * spans の区間に印を付けてテキストを描く。
 * 説明（help）はマウスを重ねると出る。タッチ端末では1回目のタップで説明を出し、
 * 2回目のタップは親に渡して次の行へ進める。
 */
export function RichText({ text, spans, visible = text.length, interactive = true }: Props) {
  const terms = useContext(TermsContext);
  const { linksEnabled } = useVolume();
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTip(null), [text, interactive]);

  // 説明は語の真上に寄せつつ、画面の左右からはみ出さないように置き直す
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const margin = 16;
    const left = Math.min(Math.max(tip.x - el.offsetWidth / 2, margin), window.innerWidth - el.offsetWidth - margin);
    el.style.left = `${left}px`;
  }, [tip]);

  if (!spans?.length) return <>{text.slice(0, visible)}</>;

  // 説明はセリフを隠さないよう、ウィンドウ（あればネームプレート）の上に出す
  const showTip = (index: number, help: string, el: Element) => {
    const r = el.getBoundingClientRect();
    const box = el.closest(".dialogue-box");
    const top = box?.querySelector(".dialogue-speaker") ?? box ?? el;
    setTip({ index, help, x: r.left + r.width / 2, y: top.getBoundingClientRect().top });
  };

  const nodes: ReactNode[] = [];
  let pos = 0;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  sorted.forEach((span, index) => {
    if (span.start < pos || span.start >= visible) return;
    nodes.push(text.slice(pos, span.start));
    const label = text.slice(span.start, Math.min(span.end, visible));
    pos = Math.min(span.end, visible);

    const { href, help, style } = { ...(span.term ? terms[span.term] : {}), ...span };
    const link = interactive && linksEnabled && href ? href : undefined;
    const classes = ["rt"];
    if (style) classes.push(`rt-${style}`);
    if (help || href) classes.push("rt-term");
    if (link) classes.push("rt-link");

    const handlers = interactive && help
      ? {
          onMouseEnter: (e: MouseEvent) => showTip(index, help, e.currentTarget),
          onMouseLeave: () => setTip(null),
          onClick: (e: MouseEvent) => {
            if (link) {
              e.stopPropagation();
            } else if (tip?.index !== index) {
              e.stopPropagation();
              showTip(index, help, e.currentTarget);
            }
          },
        }
      : link
        ? { onClick: (e: MouseEvent) => e.stopPropagation() }
        : {};

    nodes.push(
      link ? (
        <a key={index} className={classes.join(" ")} href={link} target="_blank" rel="noopener noreferrer" tabIndex={-1} {...handlers}>
          {label}
        </a>
      ) : (
        <span key={index} className={classes.join(" ")} {...handlers}>
          {label}
        </span>
      ),
    );
  });
  nodes.push(text.slice(pos, visible));

  return (
    <>
      {nodes}
      {tip &&
        createPortal(
          <div ref={tipRef} className="rt-tip" style={{ top: tip.y }}>
            {tip.help}
          </div>,
          document.body,
        )}
    </>
  );
}
