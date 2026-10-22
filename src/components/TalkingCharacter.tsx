import { useState, useRef, useCallback, useMemo, useEffect, useImperativeHandle, forwardRef } from "react";
import { CharacterCanvas } from "./CharacterCanvas";
import { DialogueBox } from "./DialogueBox";
import { useAnimationLoop } from "../hooks/useAnimationLoop";
import { useBlinkAnimation } from "../hooks/useBlinkAnimation";
import { useBodySway } from "../hooks/useBodySway";
import { useMouthAnimation, FRAME_MS } from "../hooks/useMouthAnimation";
import { useTextReveal, CHAR_SPEED_MS } from "../hooks/useTextReveal";
import { useCharacterSprite } from "../hooks/useCharacterSprite";
import { useVolume } from "../hooks/useVolumeControl";
import type { DialogueLine, CharacterDef, FrameMeta } from "../types/sprite";

export interface TalkingCharacterHandle {
  advance: () => void;
  goBack: () => void;
}

const PLACEHOLDER_FRAME: FrameMeta = {
  index: 0,
  name: "",
  role: "idle",
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

interface Props {
  characters: CharacterDef[];
  dialogue: DialogueLine[];
  onDialogueEnd?: () => void;
  onBack?: () => void;
  onSlideChange?: (slide: string | null) => void;
  compact?: boolean;
}

export const TalkingCharacter = forwardRef<TalkingCharacterHandle, Props>(function TalkingCharacter({ characters, dialogue, onDialogueEnd, onBack, onSlideChange, compact }, ref) {
  const [lineIndex, setLineIndex] = useState(0);
  const currentLine = dialogue[lineIndex] ?? { characterId: null, text: "" };
  const isNarration = currentLine.characterId === null;

  // --- スライド状態を算出して親に通知 ---
  useEffect(() => {
    let slide: string | null = null;
    for (let i = 0; i <= lineIndex; i++) {
      if (dialogue[i]?.slide !== undefined) slide = dialogue[i].slide!;
    }
    onSlideChange?.(slide);
  }, [lineIndex, dialogue, onSlideChange]);

  const activeCharDef = useMemo(
    () =>
      isNarration
        ? null
        : characters.find((c) => c.id === currentLine.characterId) ?? null,
    [characters, currentLine.characterId, isNarration],
  );

  const sprite = useCharacterSprite(
    characters,
    isNarration ? null : currentLine.characterId,
  );

  const { voiceVolume, voiceRate } = useVolume();

  const { displayedText, isTalking, isComplete, skip } = useTextReveal(
    currentLine.text,
    CHAR_SPEED_MS / voiceRate,
  );

  // --- 音声再生 ---
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const voiceVolumeRef = useRef(voiceVolume);
  voiceVolumeRef.current = voiceVolume;
  const voiceRateRef = useRef(voiceRate);
  voiceRateRef.current = voiceRate;

  // Voice音量・速度をリアルタイムに反映
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = voiceVolume;
  }, [voiceVolume]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = voiceRate;
  }, [voiceRate]);

  useEffect(() => {
    // 前の音声を停止
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsAudioPlaying(false);
    // 新しい音声を再生
    if (currentLine.audio) {
      const audio = new Audio(currentLine.audio);
      audio.volume = voiceVolumeRef.current;
      // 音程は変えずに速さだけ変える（preservesPitch はブラウザ既定で true）
      audio.playbackRate = voiceRateRef.current;
      audioRef.current = audio;
      setIsAudioPlaying(true);
      audio.addEventListener("ended", () => setIsAudioPlaying(false));
      audio.play().catch(() => setIsAudioPlaying(false));
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsAudioPlaying(false);
    };
  }, [lineIndex, currentLine.audio]);

  const tickBlink = useBlinkAnimation();
  const tickSway = useBodySway();

  const talkFrames = sprite?.roles.talk ?? [];
  const idleFrame = sprite?.defaultIdleFrame ?? PLACEHOLDER_FRAME;
  const tickMouth = useMouthAnimation(talkFrames, idleFrame, FRAME_MS / voiceRate);

  const animRef = useRef<{ frame: FrameMeta; bodyOffsetY: number }>({
    frame: idleFrame,
    bodyOffsetY: 0,
  });

  const [, forceRender] = useState(0);

  const isTalkingRef = useRef(isTalking || isAudioPlaying);
  isTalkingRef.current = isTalking || isAudioPlaying;

  const spriteRef = useRef(sprite);
  spriteRef.current = sprite;

  useAnimationLoop(
    useCallback(
      (timestamp: number) => {
        const sp = spriteRef.current;
        if (!sp) return;

        const anim = animRef.current;
        const isBlinking = tickBlink(timestamp);
        anim.bodyOffsetY = tickSway(timestamp);

        if (isBlinking) {
          anim.frame = sp.blinkFrame;
        } else {
          anim.frame = tickMouth(timestamp, isTalkingRef.current);
        }

        forceRender((n) => n + 1);
      },
      [tickBlink, tickSway, tickMouth],
    ),
  );

  // テキスト表示も音声再生も終わったら「完了」
  const isLineComplete = isComplete && !isAudioPlaying;

  const handleAdvance = useCallback(() => {
    // 進むときに音声を停止
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsAudioPlaying(false);
    }
    if (!isComplete) {
      skip();
    } else if (lineIndex < dialogue.length - 1) {
      setLineIndex((i) => i + 1);
    } else {
      onDialogueEnd?.();
    }
  }, [isComplete, skip, lineIndex, dialogue.length, onDialogueEnd]);

  const handleGoBack = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsAudioPlaying(false);
    }
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

  const className = compact
    ? "talking-character talking-character--compact"
    : "talking-character";

  // ナレーション行: キャラクター非表示、テキストのみ
  if (isNarration) {
    return (
      <div className={className}>
        {currentLine.text && (
          <DialogueBox
            text={currentLine.text}
            spans={currentLine.spans}
            visible={displayedText.length}
            isComplete={isLineComplete}
            onAdvance={handleAdvance}
          />
        )}
      </div>
    );
  }

  const anim = animRef.current;

  // スプライト未ロード（読み込み中・失敗）でもセリフは表示し、先へ進めるようにする
  return (
    <div className={className}>
      {sprite && (
        <div className="character-stage">
          <CharacterCanvas
            sprite={sprite}
            currentFrame={anim.frame}
            bodyOffsetY={anim.bodyOffsetY}
          />
        </div>
      )}
      {currentLine.text && (
        <DialogueBox
          speaker={activeCharDef?.name}
          text={currentLine.text}
          spans={currentLine.spans}
          visible={displayedText.length}
          isComplete={isLineComplete}
          onAdvance={handleAdvance}
        />
      )}
    </div>
  );
});
