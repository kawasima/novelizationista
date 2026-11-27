import { useEffect, useRef, useState } from "react";

const VIDEO = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

/** 動画のパスなら true。拡張子で見分ける。 */
export function isVideoSlide(src: string): boolean {
  return VIDEO.test(src);
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * スライドを表示する。画像はそのまま、動画は音を消して繰り返し再生し、下に再生位置のスライダーを付ける。
 * スライダーを触ったあとはフォーカスを外す。矢印キーは台詞を進める・戻すのに使うため。
 */
export function SlideMedia({ src }: { src: string }) {
  if (!isVideoSlide(src)) return <img src={src} alt="" className="slide-image" />;
  return <SlideVideo key={src} src={src} />;
}

function SlideVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [width, setWidth] = useState<number>();
  const seeking = useRef(false);
  const resume = useRef(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (!seeking.current) setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // スライダーの幅を、表示されている動画の幅に合わせる。
    const ro = new ResizeObserver(() => setWidth(v.clientWidth));
    ro.observe(v);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  };

  const startSeek = () => {
    const v = ref.current;
    if (!v) return;
    seeking.current = true;
    resume.current = !v.paused;
    v.pause();
  };

  const endSeek = (e: React.PointerEvent<HTMLInputElement>) => {
    const v = ref.current;
    seeking.current = false;
    if (v && resume.current) void v.play();
    e.currentTarget.blur();
  };

  return (
    <div className="slide-video">
      <video
        ref={ref}
        src={src}
        className="slide-image slide-video__media"
        autoPlay
        muted
        loop
        playsInline
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onClick={toggle}
      />
      <div className="slide-video__bar" style={width ? { width } : undefined}>
        <button
          type="button"
          className="slide-video__toggle"
          aria-label={paused ? "play" : "pause"}
          tabIndex={-1}
          onClick={(e) => { toggle(); e.currentTarget.blur(); }}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <input
          type="range"
          className="slide-video__seek"
          min={0}
          max={duration || 0}
          step={0.05}
          value={time}
          tabIndex={-1}
          style={{ "--nv-progress": `${duration ? (time / duration) * 100 : 0}%` } as React.CSSProperties}
          onPointerDown={startSeek}
          onPointerUp={endSeek}
          onChange={(e) => {
            const t = Number(e.currentTarget.value);
            setTime(t);
            if (ref.current) ref.current.currentTime = t;
          }}
        />
        <span className="slide-video__time">{clock(time)} / {clock(duration)}</span>
      </div>
    </div>
  );
}
