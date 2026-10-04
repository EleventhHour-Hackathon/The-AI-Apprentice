import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2, Pause, Play, RotateCcw } from "lucide-react";
import { mmss } from "@/lib/work-maps";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 1, 1.5, 2] as const;
// Some recordings report an Infinity duration until they have been read through.
const finite = (n: number) => (Number.isFinite(n) ? n : 0);

type Props = {
  src: string;
  poster?: string | null | undefined;
  label: string;
  autoPlay?: boolean;
  /** Called when the clip can't load, so the caller can fall back to the still. */
  onError?: () => void;
  className?: string;
};

/**
 * A screen-recording clip with Tacit's own controls: play, scrub, speed and full screen.
 * The clips have no sound, so there is no volume control.
 */
export function ClipPlayer({ src, poster, label, autoPlay = false, onError, className }: Props) {
  const shell = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [scrubbing, setScrubbing] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [ended, setEnded] = useState(false);

  // timeupdate fires only a few times a second; follow the frames while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      if (video.current) setTime(video.current.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };

  const seek = (seconds: number) => {
    const v = video.current;
    if (!v || !duration) return;
    v.currentTime = Math.min(Math.max(seconds, 0), duration);
    setTime(v.currentTime);
    setEnded(false);
  };

  const ratioAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    return box ? Math.min(Math.max((clientX - box.left) / box.width, 0), 1) : 0;
  };

  const onScrubStart = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seek(ratioAt(e.clientX) * duration);
  };
  const onScrubMove = (e: PointerEvent<HTMLDivElement>) => {
    const ratio = ratioAt(e.clientX);
    setHover(ratio);
    if (scrubbing) seek(ratio * duration);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (video.current) video.current.playbackRate = next;
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen().catch(() => undefined);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "k") toggle();
    else if (e.key === "ArrowLeft") seek(time - 2);
    else if (e.key === "ArrowRight") seek(time + 2);
    else if (e.key === "f") toggleFull();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const progress = duration ? (time / duration) * 100 : 0;
  const showControls = !playing || scrubbing;

  return (
    <div
      ref={shell}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={onKey}
      className={cn(
        "clip-player group/clip relative overflow-hidden rounded-lg border border-pill-border bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-voice-debrief",
        full && "flex items-center rounded-none border-0",
        className,
      )}
    >
      <video
        ref={video}
        src={src}
        poster={poster ?? undefined}
        autoPlay={autoPlay}
        muted
        playsInline
        // Autoplaying clips loop quietly, like a GIF; the others stop on the replay button.
        loop={autoPlay}
        preload="metadata"
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
        }}
        onLoadedMetadata={(e) => setDuration(finite(e.currentTarget.duration))}
        onDurationChange={(e) => setDuration(finite(e.currentTarget.duration))}
        onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
        onError={onError}
        className="block w-full cursor-pointer"
      />

      {/* Big centre button while paused. */}
      {!playing && !scrubbing && (
        <button
          type="button"
          onClick={toggle}
          aria-label={ended ? "Replay" : "Play"}
          className="sia-fade absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md transition-transform hover:scale-105"
          style={{ boxShadow: "0 0 0 1px oklch(1 0 0 / 14%), 0 6px 20px oklch(0 0 0 / 40%)" }}
        >
          {ended ? (
            <RotateCcw size={17} />
          ) : (
            <Play size={17} fill="currentColor" className="ml-0.5" />
          )}
        </button>
      )}

      {/* Bottom bar: shown while paused, on hover and while scrubbing. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pb-2 pt-6 transition-opacity duration-200",
          showControls
            ? "opacity-100"
            : "opacity-0 group-hover/clip:opacity-100 group-focus-visible/clip:opacity-100",
        )}
      >
        <div
          ref={track}
          role="slider"
          tabIndex={-1}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={mmss(time)}
          onPointerDown={onScrubStart}
          onPointerMove={onScrubMove}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
          onPointerLeave={() => setHover(null)}
          className="group/track relative flex h-3.5 cursor-pointer items-center"
        >
          <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/track:h-[5px]">
            {hover !== null && (
              <div
                className="absolute inset-y-0 left-0 bg-white/25"
                style={{ width: `${hover * 100}%` }}
              />
            )}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-voice-listening"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span
            className={cn(
              "pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow transition-transform",
              scrubbing ? "scale-100" : "scale-0 group-hover/track:scale-100",
            )}
            style={{ left: `${progress}%` }}
          />
          {hover !== null && duration > 0 && (
            <span
              className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px]"
              style={{ left: `${hover * 100}%` }}
            >
              {mmss(hover * duration)}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1 text-[11px]">
          <ControlButton label={playing ? "Pause (Space)" : "Play (Space)"} onClick={toggle}>
            {playing ? (
              <Pause size={13} fill="currentColor" />
            ) : (
              <Play size={13} fill="currentColor" />
            )}
          </ControlButton>
          <span className="font-mono tabular-nums text-white/80">
            {mmss(time)}
            <span className="text-white/40"> / {mmss(duration)}</span>
          </span>
          <button
            type="button"
            onClick={cycleSpeed}
            title="Playback speed"
            className="ml-auto h-6 rounded-full px-2 font-mono text-[10.5px] text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            {speed}×
          </button>
          <ControlButton
            label={full ? "Exit full screen (F)" : "Full screen (F)"}
            onClick={toggleFull}
          >
            {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </ControlButton>
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white"
    >
      {children}
    </button>
  );
}
