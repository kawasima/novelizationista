import { useState } from "react";
import { useVolume } from "../hooks/useVolumeControl";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function SettingSlider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="volume-row">
      <span className="volume-label">{label}</span>
      <input
        type="range"
        className="volume-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="volume-value">{format(value)}</span>
    </label>
  );
}

const percent = (v: number) => String(Math.round(v * 100));
const times = (v: number) => `${v.toFixed(1)}x`;

export function VolumePanel() {
  const {
    bgmVolume, voiceVolume, voiceRate, textScale, linksEnabled,
    setBgmVolume, setVoiceVolume, setVoiceRate, setTextScale, setLinksEnabled,
  } = useVolume();
  const [open, setOpen] = useState(false);

  return (
    <div className="volume-panel">
      <button
        className="toolbar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="音量・表示設定"
      >
        {bgmVolume === 0 && voiceVolume === 0 ? "\u{1F507}" : "\u{1F509}"}
      </button>
      {open && (
        <>
          <div className="volume-panel-backdrop" onClick={() => setOpen(false)} />
          <div className="volume-panel-dropdown">
            <SettingSlider label="BGM" value={bgmVolume} min={0} max={1} step={0.01} format={percent} onChange={setBgmVolume} />
            <SettingSlider label="Voice" value={voiceVolume} min={0} max={1} step={0.01} format={percent} onChange={setVoiceVolume} />
            <SettingSlider label="速度" value={voiceRate} min={0.8} max={2} step={0.1} format={times} onChange={setVoiceRate} />
            <SettingSlider label="文字" value={textScale} min={0.8} max={1.5} step={0.1} format={times} onChange={setTextScale} />
            <label className="volume-row">
              <span className="volume-label">リンク</span>
              <input
                type="checkbox"
                className="volume-checkbox"
                checked={linksEnabled}
                onChange={(e) => setLinksEnabled(e.target.checked)}
              />
              <span className="volume-note">{linksEnabled ? "クリックで開く" : "開かない"}</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
