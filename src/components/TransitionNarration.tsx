import { useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { useTextReveal, CHAR_SPEED_MS } from "../hooks/useTextReveal";
import { useVolume } from "../hooks/useVolumeControl";
import { RichText } from "./RichText";
import type { DialogueLine } from "../types/sprite";

export interface TransitionNarrationHandle {
  advance: () => void;
  goBack: () => void;
}

interface Props {
  dialogue: DialogueLine[];
  onEnd?: () => void;
  onBack?: () => void;
}

export const TransitionNarration = forwardRef<TransitionNarrationHandle, Props>(function TransitionNarration({ dialogue, onEnd, onBack }, ref) {
  const [lineIndex, setLineIndex] = useState(0);
  const currentLine: Pick<DialogueLine, "text" | "spans"> = dialogue[lineIndex] ?? { text: "" };
  const { voiceRate } = useVolume();
  const { displayedText, isComplete, skip } = useTextReveal(currentLine.text, CHAR_SPEED_MS / voiceRate);

  const handleAdvance = useCallback(() => {
    if (!isComplete) {
      skip();
    } else if (lineIndex < dialogue.length - 1) {
      setLineIndex((i) => i + 1);
    } else {
      onEnd?.();
    }
  }, [isComplete, skip, lineIndex, dialogue.length, onEnd]);

  const handleGoBack = useCallback(() => {
    if (lineIndex > 0) {
      setLineIndex((i) => i - 1);
    } else {
      onBack?.();
    }
  }, [lineIndex, onBack]);

  useImperativeHandle(ref, () => ({
    advance: handleAdvance,
    goBack: handleGoBack,
  }), [handleAdvance, handleGoBack]);

  return (
    <>
      <div className="transition-overlay" />
      <div className="transition-narration" onClick={handleAdvance}>
        <div className="transition-text">
          <RichText
            text={currentLine.text}
            spans={currentLine.spans}
            visible={displayedText.length}
            interactive={isComplete}
          />
          {isComplete && <span className="transition-cursor">&#9660;</span>}
        </div>
      </div>
    </>
  );
});
