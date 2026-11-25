import type { Scenario, ScenarioTranslation } from "../types/sprite";

/** 原文のシナリオに翻訳を重ねる。訳のない行や項目は原文のまま残す */
export function applyTranslation(base: Scenario, tr: ScenarioTranslation): Scenario {
  const terms = { ...base.terms };
  for (const [key, term] of Object.entries(tr.terms ?? {})) {
    terms[key] = { ...terms[key], ...term };
  }
  return {
    ...base,
    title: tr.title || base.title,
    terms,
    characters: base.characters.map((c) => ({ ...c, name: tr.characters?.[c.id] || c.name })),
    scenes: base.scenes.map((scene) => ({
      ...scene,
      title: (scene.title && tr.scenes?.[scene.title]) || scene.title,
      dialogue: scene.dialogue.map((line) => {
        const slide = line.slide && tr.slides?.[line.slide] ? tr.slides[line.slide] : line.slide;
        const translated = line.id ? tr.lines[line.id] : undefined;
        if (!translated?.text) return { ...line, slide };
        return { ...line, slide, text: translated.text, spans: translated.spans, translated: true };
      }),
    }) as typeof scene),
  };
}

