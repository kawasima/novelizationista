import { useMemo } from "react";
import type { CSSProperties } from "react";
import { ScenarioPlayer } from "./components/ScenarioPlayer";
import { useNovelData, resolveScenarioPaths, resolveCreditsPaths } from "./hooks/useNovelData";
import { VolumeContext, useVolumeProvider } from "./hooks/useVolumeControl";
import { LanguageContext, messagesFor, useLanguageProvider } from "./i18n";
import { assetPath } from "./utils/assetPath";
import { applyTranslation } from "./utils/translate";
import type { NovelConfig } from "./types/sprite";
import "./index.css";
import "./App.css";

interface Props {
  config: NovelConfig;
}

export function NovelApp({ config }: Props) {
  const source = config.language ?? "ja";
  const data = useNovelData(config);
  const volume = useVolumeProvider();

  // 選べる言語は設定から決める（翻訳を読めなかった言語は原文で表示する）
  const languages = useMemo(
    () => [source, ...Object.keys(config.translations ?? {})],
    [source, config.translations],
  );
  const lang = useLanguageProvider(languages, source);
  const translation = lang.language === source ? undefined : data?.translations[lang.language];

  const scenario = useMemo(() => {
    if (!data) return null;
    const merged = translation ? applyTranslation(data.scenario, translation.scenario) : data.scenario;
    return resolveScenarioPaths(merged);
  }, [data, translation]);

  const credits = useMemo(() => {
    const c = translation?.credits ?? data?.credits;
    return c ? resolveCreditsPaths(c) : null;
  }, [data, translation]);

  if (!scenario) {
    return <div className="app">{messagesFor(lang.language).loading}</div>;
  }

  return (
    <LanguageContext.Provider value={lang}>
      <VolumeContext.Provider value={volume}>
        <div
          className="app"
          style={{ "--nv-text-scale": volume.textScale } as CSSProperties}
        >
          <ScenarioPlayer
            scenario={scenario}
            credits={credits}
            opening={{
              title: translation?.scenario.title || config.opening.title,
              background: assetPath(config.opening.background),
              bgm: config.opening.bgm ? assetPath(config.opening.bgm) : null,
            }}
          />
        </div>
      </VolumeContext.Provider>
    </LanguageContext.Provider>
  );
}
