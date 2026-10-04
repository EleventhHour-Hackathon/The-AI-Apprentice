import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  defaultOverlayWidth,
  overlaySize,
  storedOverlayWidth,
  storeOverlayWidth,
} from "@/lib/clip-overlay";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * The enlarged clip: a 16:9 box over a dimmed window. Esc or a click outside closes it; the corner
 * handle (or the arrow keys on it) resizes it, and the size is kept for the next clip.
 */
export function ClipOverlay({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => storedOverlayWidth() ?? defaultOverlayWidth(viewport()));
  const [room, setRoom] = useState(viewport);
  const drag = useRef<{ x: number; y: number; width: number } | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const onResize = () => setRoom(viewport());
    // Capture, so Esc closes the overlay before anything under it (the Work Map) sees it.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const size = overlaySize(width, room);
  const resize = (next: number) => setWidth(overlaySize(next, room).width);

  const onDragStart = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, width: size.width };
  };
  // The box stays centred, so the corner moves half as far as the size changes.
  const onDragMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const grow = Math.max(e.clientX - d.x, ((e.clientY - d.y) * 16) / 9);
    resize(d.width + grow * 2);
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    storeOverlayWidth(size.width);
  };
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 160 : 40;
    const by = { ArrowRight: step, ArrowDown: step, ArrowLeft: -step, ArrowUp: -step }[e.key];
    if (by === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const next = overlaySize(size.width + by, room).width;
    setWidth(next);
    storeOverlayWidth(next);
  };

  return createPortal(
    <div
      className="clip-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="clip-overlay-box relative"
        style={{ width: size.width, height: size.height }}
      >
        {children}
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
          className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-md transition-colors hover:bg-black/75 hover:text-white"
        >
          <X size={15} />
        </button>
        <button
          type="button"
          title="Drag to resize (arrow keys too)"
          aria-label={`Resize, ${size.width} by ${size.height}`}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={onHandleKey}
          className="clip-overlay-handle absolute -bottom-5 -right-5 h-6 w-6 cursor-nwse-resize touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-voice-debrief"
        />
      </div>
    </div>,
    document.body,
  );
}
