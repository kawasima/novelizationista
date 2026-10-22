import { RichText } from "./RichText";
import type { TextSpan } from "../types/sprite";

interface Props {
  speaker?: string;
  text: string;
  spans?: TextSpan[];
  /** 文字送りで表示済みの文字数 */
  visible: number;
  isComplete: boolean;
  onAdvance: () => void;
}

export function DialogueBox({
  speaker,
  text,
  spans,
  visible,
  isComplete,
  onAdvance,
}: Props) {
  return (
    <div className="dialogue-box" onClick={onAdvance}>
      {speaker && <div className="dialogue-speaker">{speaker}</div>}
      <div className="dialogue-text">
        <RichText text={text} spans={spans} visible={visible} interactive={visible >= text.length} />
        {isComplete && <span className="dialogue-cursor">&#9660;</span>}
      </div>
    </div>
  );
}
