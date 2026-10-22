import { createContext, useContext, useState, useCallback } from "react";

const BGM_DEFAULT = 0.05;
const VOICE_DEFAULT = 0.8;
const VOICE_RATE_DEFAULT = 1;
const TEXT_SCALE_DEFAULT = 1;

const STORAGE_KEY_BGM = "vol:bgm";
const STORAGE_KEY_VOICE = "vol:voice";
const STORAGE_KEY_VOICE_RATE = "voice:rate";
const STORAGE_KEY_TEXT_SCALE = "text:scale";
const STORAGE_KEY_LINKS = "text:links";

function loadVolume(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return Number(v);
  } catch { /* ignore */ }
  return fallback;
}

function saveVolume(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch { /* ignore */ }
}

/**
 * 音量と表示の設定。voiceRate はセリフ（音声・文字送り・口パク）だけに効き、BGM には効かない。
 * linksEnabled を切ると、セリフ中のリンクはクリックしても開かない（上映中の誤操作よけ）
 */
export interface VolumeState {
  bgmVolume: number;
  voiceVolume: number;
  voiceRate: number;
  textScale: number;
  linksEnabled: boolean;
  setBgmVolume: (v: number) => void;
  setVoiceVolume: (v: number) => void;
  setVoiceRate: (v: number) => void;
  setTextScale: (v: number) => void;
  setLinksEnabled: (v: boolean) => void;
}

export const VolumeContext = createContext<VolumeState>({
  bgmVolume: BGM_DEFAULT,
  voiceVolume: VOICE_DEFAULT,
  voiceRate: VOICE_RATE_DEFAULT,
  textScale: TEXT_SCALE_DEFAULT,
  linksEnabled: true,
  setBgmVolume: () => {},
  setVoiceVolume: () => {},
  setVoiceRate: () => {},
  setTextScale: () => {},
  setLinksEnabled: () => {},
});

function usePersistedNumber(key: string, fallback: number): [number, (v: number) => void] {
  const [value, setValue] = useState(() => loadVolume(key, fallback));
  const set = useCallback((v: number) => {
    setValue(v);
    saveVolume(key, v);
  }, [key]);
  return [value, set];
}

export function useVolumeProvider(): VolumeState {
  const [bgmVolume, setBgmVolume] = usePersistedNumber(STORAGE_KEY_BGM, BGM_DEFAULT);
  const [voiceVolume, setVoiceVolume] = usePersistedNumber(STORAGE_KEY_VOICE, VOICE_DEFAULT);
  const [voiceRate, setVoiceRate] = usePersistedNumber(STORAGE_KEY_VOICE_RATE, VOICE_RATE_DEFAULT);
  const [textScale, setTextScale] = usePersistedNumber(STORAGE_KEY_TEXT_SCALE, TEXT_SCALE_DEFAULT);
  const [links, setLinks] = usePersistedNumber(STORAGE_KEY_LINKS, 1);
  const setLinksEnabled = useCallback((v: boolean) => setLinks(v ? 1 : 0), [setLinks]);

  return {
    bgmVolume, voiceVolume, voiceRate, textScale, linksEnabled: links !== 0,
    setBgmVolume, setVoiceVolume, setVoiceRate, setTextScale, setLinksEnabled,
  };
}

export function useVolume() {
  return useContext(VolumeContext);
}
