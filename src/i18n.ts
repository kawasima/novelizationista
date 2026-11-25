import { createContext, useContext, useEffect, useState } from "react";

/** エンジンの画面に出る固定の文言 */
const MESSAGES = {
  ja: {
    loading: "読み込み中…",
    start: "Click to Start",
    settings: "音量・表示設定",
    sceneMenu: "シーン選択",
    scene: (n: number) => `シーン${n}`,
    speed: "速度",
    textSize: "文字",
    links: "リンク",
    linksOn: "クリックで開く",
    linksOff: "開かない",
    language: "言語",
    fin: "Fin.",
  },
  en: {
    loading: "Loading…",
    start: "Click to Start",
    settings: "Volume and display",
    sceneMenu: "Scenes",
    scene: (n: number) => `Scene ${n}`,
    speed: "Speed",
    textSize: "Text",
    links: "Links",
    linksOn: "Open on click",
    linksOff: "Disabled",
    language: "Lang",
    fin: "Fin.",
  },
};

export type Messages = (typeof MESSAGES)["ja"];

/** 言語の表示名。設定パネルの切り替えに出す */
const LANGUAGE_NAMES: Record<string, string> = { ja: "日本語", en: "English" };

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/** 用意のない言語の文言は英語で出す */
export function messagesFor(language: string): Messages {
  return MESSAGES[language as keyof typeof MESSAGES] ?? MESSAGES.en;
}

export interface LanguageState {
  language: string;
  languages: string[];
  setLanguage: (language: string) => void;
  t: Messages;
}

export const LanguageContext = createContext<LanguageState>({
  language: "ja",
  languages: ["ja"],
  setLanguage: () => {},
  t: MESSAGES.ja,
});

/**
 * 表示する言語を決める。URL の ?lang=、ブラウザの言語設定の順に見て、
 * 用意のある言語が見つからなければ原文の言語にする。
 * 設定パネルでの切り替えは保存しない。開き直すとブラウザの言語に戻る。
 */
function initialLanguage(languages: string[], source: string): string {
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl && languages.includes(fromUrl)) return fromUrl;
  for (const pref of navigator.languages ?? [navigator.language]) {
    const code = pref.toLowerCase().split("-")[0];
    if (languages.includes(code)) return code;
  }
  return source;
}

export function useLanguageProvider(languages: string[], source: string): LanguageState {
  const [language, setLanguage] = useState(() => initialLanguage(languages, source));

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return { language, languages, setLanguage, t: messagesFor(language) };
}

export function useLanguage() {
  return useContext(LanguageContext);
}
