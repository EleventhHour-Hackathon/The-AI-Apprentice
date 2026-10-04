import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Sia } from "@/components/Sia";
import { Tutor } from "@/components/Tutor";
import { desktop } from "@/lib/desktop";

const PILL = 'section[aria-label="Voice assistant"]';
/** Room around the pill: its bottom offset plus space for the shadow above it. */
const MARGIN = 48;

/** The pill on its own, for the floating, transparent desktop window. */
export const Route = createFileRoute("/pill")({
  head: () => ({ meta: [{ title: "AI Apprentice pill" }] }),
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
    const onMove = (e: MouseEvent) =>
      setInteractive(Boolean((e.target as Element | null)?.closest?.(PILL)));
    const onLeave = () => setInteractive(false);
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
    // The apprentice and the tutor render their own pill; watch whichever is showing.
  }, [lesson]);

  return (
    <>
      <style>{"html, body { background: transparent !important; overflow: hidden; }"}</style>
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
