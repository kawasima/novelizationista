import type { CSSProperties } from "react";
import { ScenarioPlayer } from "./components/ScenarioPlayer";
import { useScenario } from "./hooks/useScenario";
import { useCredits } from "./hooks/useCredits";
import { VolumeContext, useVolumeProvider } from "./hooks/useVolumeControl";
import { assetPath } from "./utils/assetPath";
import type { NovelConfig } from "./types/sprite";
import "./index.css";
import "./App.css";

interface Props {
  config: NovelConfig;
}

export function NovelApp({ config }: Props) {
  const scenario = useScenario(assetPath(config.scenario));
  const credits = useCredits(config.credits ? assetPath(config.credits) : null);
  const volume = useVolumeProvider();

  if (!scenario) {
    return <div className="app">Loading...</div>;
  }

  return (
    <VolumeContext.Provider value={volume}>
      <div
        className="app"
        style={{ "--nv-text-scale": volume.textScale } as CSSProperties}
      >
        <ScenarioPlayer
          scenario={scenario}
          credits={credits}
          opening={{
            title: config.opening.title,
            background: assetPath(config.opening.background),
            bgm: config.opening.bgm ? assetPath(config.opening.bgm) : null,
          }}
        />
      </div>
    </VolumeContext.Provider>
  );
}
