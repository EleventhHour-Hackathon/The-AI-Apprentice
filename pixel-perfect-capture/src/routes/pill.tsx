import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Sia } from "@/components/Sia";
import { Tutor } from "@/components/Tutor";
import { desktop } from "@/lib/desktop";

const PILL = 'section[aria-label="Voice assistant"]';
/** Room around the pill: its bottom offset plus space for the shadow above it. */
const MARGIN = 48;
/** Controls inside the pill; pressing them clicks, everywhere else drags. */
const CONTROLS =
  "button, a, input, textarea, select, video, .clip-player, [role=button], [role=slider], [contenteditable=true]";
/** How far the cursor moves before a press becomes a drag, so clicks stay clicks. */
const DRAG_THRESHOLD = 4;

/** The pill on its own, for the floating, transparent desktop window. */
export const Route = createFileRoute("/pill")({
  head: () => ({ meta: [{ title: "Tacit" }] }),
  component: Pill,
});

function Pill() {
  // A Work Map id while a new hire is being taught; otherwise the pill is the apprentice.
  const [lesson, setLesson] = useState<string | null>(null);

  useEffect(() => {
    const bridge = desktop();
    const section = document.querySelector<HTMLElement>(PILL);
    if (!bridge || !section) return;

    // Size the window to the pill's full content, not its (window-capped) box.
    let height = 0;
    const report = () => {
      // scrollHeight leaves out the border; without it the bottom edge gets clipped.
      const border = section.offsetHeight - section.clientHeight;
      const next = section.scrollHeight + border + MARGIN;
      if (next !== height) bridge.resizePill((height = next));
    };
    const resize = new ResizeObserver(report);
    resize.observe(section);
    const mutations = new MutationObserver(report);
    mutations.observe(section, { childList: true, subtree: true, characterData: true });
    report();

    // Only the pill takes clicks; the transparent rest of the window passes them through.
    let interactive = false;
    const setInteractive = (next: boolean) => {
      if (next !== interactive) bridge.setPillInteractive((interactive = next));
    };
    // Drag the pill by any part that isn't a control. The window moves under the cursor,
    // so track screen coordinates, not client ones.
    let press: { x: number; y: number; id: number; dragging: boolean } | null = null;
    const drag = bridge.dragPill;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!drag || e.button !== 0 || target.closest(CONTROLS)) return;
      press = { x: e.screenX, y: e.screenY, id: e.pointerId, dragging: false };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id || !drag) return;
      const dx = e.screenX - press.x;
      const dy = e.screenY - press.y;
      if (!press.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        press.dragging = true;
        section.setPointerCapture(e.pointerId);
        document.documentElement.classList.add("pill-dragging");
        drag.start();
      }
      drag.move(dx, dy);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      if (press.dragging) {
        drag?.end();
        document.documentElement.classList.remove("pill-dragging");
        if (section.hasPointerCapture(e.pointerId)) section.releasePointerCapture(e.pointerId);
      }
      press = null;
    };
    // Double-click an empty part of the pill to send it back to the bottom centre.
    const onDoubleClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest(CONTROLS)) drag?.reset();
    };
    section.addEventListener("pointerdown", onPointerDown);
    section.addEventListener("pointermove", onPointerMove);
    section.addEventListener("pointerup", onPointerUp);
    section.addEventListener("pointercancel", onPointerUp);
    section.addEventListener("dblclick", onDoubleClick);

    const onMove = (e: MouseEvent) =>
      setInteractive(Boolean(press?.dragging || (e.target as Element | null)?.closest?.(PILL)));
    const onLeave = () => {
      if (!press?.dragging) setInteractive(false);
    };
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      section.removeEventListener("pointerdown", onPointerDown);
      section.removeEventListener("pointermove", onPointerMove);
      section.removeEventListener("pointerup", onPointerUp);
      section.removeEventListener("pointercancel", onPointerUp);
      section.removeEventListener("dblclick", onDoubleClick);
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.classList.remove("pill-dragging");
    };
    // The apprentice and the tutor render their own pill; watch whichever is showing.
  }, [lesson]);

  return (
    <>
      <style>
        {`html, body { background: transparent !important; overflow: hidden; }
${PILL} { cursor: grab; user-select: none; }
${PILL} :where(${CONTROLS}) { cursor: pointer; }
${PILL} :where(input, textarea, [contenteditable=true]) { cursor: text; user-select: text; }
.pill-dragging, .pill-dragging * { cursor: grabbing !important; }`}
      </style>
      {lesson ? (
        <Tutor
          workMapId={lesson}
          onClose={() => setLesson(null)}
          onOpenApp={() => desktop()?.pill("app")}
        />
      ) : (
        <Sia onOpenApp={() => desktop()?.pill("app")} onLesson={setLesson} />
      )}
    </>
  );
}
