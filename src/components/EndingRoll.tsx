import { useState, useCallback } from "react";
import type { Credits } from "../types/sprite";

interface Props {
  credits: Credits;
  onEnd: () => void;
}

export function EndingRoll({ credits, onEnd }: Props) {
  const [showFin, setShowFin] = useState(false);

  const handleScrollEnd = useCallback(() => {
    setShowFin(true);
  }, []);

  if (showFin) {
    return (
      <div className="ending-roll" onClick={onEnd}>
        <div className="ending-fin">Fin.</div>
      </div>
    );
  }

  return (
    <div className="ending-roll">
      <div className="ending-roll-content" onAnimationEnd={handleScrollEnd}>
        {credits.lines.map((line, i) => {
          const { text, href } = typeof line === "string" ? { text: line, href: undefined } : line;
          return (
            <div key={i} className={text === "" ? "ending-roll-blank" : "ending-roll-line"}>
              {href ? (
                <a className="ending-roll-link" href={href} target="_blank" rel="noopener noreferrer">
                  {text}
                </a>
              ) : (
                text
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
