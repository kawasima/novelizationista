import { useState, useCallback, useRef, useEffect } from "react";
import { TalkingCharacter } from "./TalkingCharacter";
import type { TalkingCharacterHandle } from "./TalkingCharacter";
import { TransitionNarration } from "./TransitionNarration";
import type { TransitionNarrationHandle } from "./TransitionNarration";
import { EndingRoll } from "./EndingRoll";
import { VolumePanel } from "./VolumePanel";
import { TermsContext } from "./RichText";
import { useVolume } from "../hooks/useVolumeControl";
import type { Scenario, Scene, Credits, OpeningScreen } from "../types/sprite";

function isTransition(scene: Scene): boolean {
  return scene.type === "transition";
}

type Phase = "opening" | "playing" | "ending";

interface Props {
  scenario: Scenario;
  credits?: Credits | null;
  opening: OpeningScreen;
}

export function ScenarioPlayer({ scenario, credits, opening }: Props) {
  const [phase, setPhase] = useState<Phase>("opening");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState<string | null>(null);

  const currentScene = phase === "playing" ? scenario.scenes[sceneIndex] : null;
  const hasSlide = currentSlide !== null;

  // --- 子コンポーネントのref ---
  const talkingRef = useRef<TalkingCharacterHandle>(null);
  const transitionRef = useRef<TransitionNarrationHandle>(null);

  // --- BGM ---
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const bgmSrcRef = useRef<string | null>(null);
  const { bgmVolume } = useVolume();
  const bgmVolumeRef = useRef(bgmVolume);
  bgmVolumeRef.current = bgmVolume;

  // BGM音量をリアルタイムに反映
  useEffect(() => {
    if (bgmRef.current) bgmRef.current.volume = bgmVolume;
  }, [bgmVolume]);

  const playBgm = useCallback((src: string | null) => {
    // 同じ曲が既にセットされていれば何もしない（paused でも再作成しない）
    if (src === bgmSrcRef.current && bgmRef.current) return;
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current = null;
    }
    bgmSrcRef.current = src;
    if (!src) return;
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = bgmVolumeRef.current;
    bgmRef.current = audio;
    audio.play().catch(() => {});
  }, []);

  // シーン切り替え時に BGM を更新
  useEffect(() => {
    if (!currentScene) return;
    if (currentScene.bgm !== undefined) {
      playBgm(currentScene.bgm);
    }
  }, [sceneIndex, currentScene, playBgm]);

  // エンドロール開始時に BGM を切り替え
  useEffect(() => {
    if (phase === "ending" && credits?.bgm !== undefined) {
      playBgm(credits.bgm);
    }
  }, [phase, credits, playBgm]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current = null;
      }
    };
  }, []);

  // --- キーボード操作 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (phase !== "playing") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const handle = talkingRef.current ?? transitionRef.current;
        handle?.advance();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const handle = talkingRef.current ?? transitionRef.current;
        handle?.goBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase]);

  const handleOpeningClick = useCallback(() => {
    playBgm(opening.bgm ?? null);
    setSceneIndex(0);
    setPhase("playing");
  }, [playBgm, opening.bgm]);

  const handleDialogueEnd = useCallback(() => {
    if (sceneIndex < scenario.scenes.length - 1) {
      setSceneIndex((i) => i + 1);
    } else if (credits) {
      setPhase("ending");
    }
  }, [sceneIndex, scenario.scenes.length, credits]);

  const handleSceneBack = useCallback(() => {
    if (sceneIndex > 0) {
      setSceneIndex((i) => i - 1);
    }
  }, [sceneIndex]);

  const handleEndingEnd = useCallback(() => {
    playBgm(null);
    setSceneIndex(0);
    setPhase("opening");
  }, [playBgm]);

  const handleSceneJump = useCallback(
    (index: number) => {
      setSceneIndex(index);
      setPhase("playing");
      setMenuOpen(false);
    },
    [],
  );

  // オープニング画面
  if (phase === "opening") {
    return (
      <div
        className="scenario-player opening-screen"
        style={{ backgroundImage: `url(${opening.background})` }}
        onClick={handleOpeningClick}
      >
        {opening.title && <h1 className="opening-title">{opening.title}</h1>}
        <div className="opening-prompt">Click to Start</div>
      </div>
    );
  }

  // エンドロール
  if (phase === "ending" && credits) {
    return (
      <div className="scenario-player" style={{ backgroundColor: "#000" }}>
        <EndingRoll credits={credits} onEnd={handleEndingEnd} />
      </div>
    );
  }

  return (
    <TermsContext.Provider value={scenario.terms ?? {}}>
    <div
      className="scenario-player"
      style={{
        backgroundImage: currentScene!.background ? `url(${currentScene!.background})` : "none",
        backgroundColor: currentScene!.background ? undefined : "#000",
      }}
    >
      <div className="toolbar">
        <VolumePanel />
        <div className="scene-menu">
          <button
            className="toolbar-btn scene-menu-toggle"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="シーン選択"
          >
            <span className="scene-menu-icon" />
            <span className="scene-menu-icon" />
            <span className="scene-menu-icon" />
          </button>
          {menuOpen && (
            <>
              <div className="scene-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <ul className="scene-menu-list">
                {scenario.scenes.map((scene, i) =>
                  isTransition(scene) ? null : (
                    <li
                      key={i}
                      className={`scene-menu-item${i === sceneIndex ? " scene-menu-item--active" : ""}`}
                      onClick={() => handleSceneJump(i)}
                    >
                      {scene.title ?? `シーン${i + 1}`}
                    </li>
                  )
                )}
              </ul>
            </>
          )}
        </div>
      </div>
      {isTransition(currentScene!) ? (
        <TransitionNarration
          ref={transitionRef}
          key={sceneIndex}
          dialogue={currentScene!.dialogue}
          onEnd={handleDialogueEnd}
          onBack={handleSceneBack}
        />
      ) : (
        <>
          {hasSlide && (
            <div className="slide-display">
              <img src={currentSlide!} alt="" className="slide-image" />
            </div>
          )}
          <TalkingCharacter
            ref={talkingRef}
            key={sceneIndex}
            characters={scenario.characters}
            dialogue={currentScene!.dialogue}
            onDialogueEnd={handleDialogueEnd}
            onBack={handleSceneBack}
            onSlideChange={setCurrentSlide}
            compact={hasSlide}
          />
        </>
      )}
    </div>
    </TermsContext.Provider>
  );
}
