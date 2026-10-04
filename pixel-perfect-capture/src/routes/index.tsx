import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Eye, EyeOff, Mic, PictureInPicture2, Settings } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Sia } from "@/components/Sia";
import { Tutor } from "@/components/Tutor";
import { desktop } from "@/lib/desktop";
import { lessonRef, parseLessonRef } from "@/lib/languages";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Studio · Tacit" },
      {
        name: "description",
        content:
          "An apprentice that watches you work, asks why at the right moments, and writes down what it learned.",
      },
      { property: "og:title", content: "Tacit" },
      {
        property: "og:description",
        content: "Learns a job by watching an expert do it, then debriefs by voice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// Placeholder app window. The real work happens in whatever is on screen; the pill floats above it.
function Index() {
  const [shell, setShell] = useState<"unknown" | "desktop" | "web">("unknown");
  const [pillShown, setPillShown] = useState(true);
  const [notice, setNotice] = useState("");
  // In a browser the tutor runs on this page: /?lesson=<work map id>.
  const [lesson, setLesson] = useState<string | null>(null);
  useEffect(() => {
    setShell(desktop() ? "desktop" : "web");
    const params = new URLSearchParams(window.location.search);
    const id = params.get("lesson");
    setLesson(id && lessonRef(id, parseLessonRef(`@${params.get("lang") ?? "en"}`).language));
  }, []);
  const endLesson = () => {
    setLesson(null);
    window.history.replaceState(null, "", "/");
  };

  const start = () => {
    if (shell === "desktop") desktop()?.pill("start");
    else setNotice("Use the pill at the bottom of the page.");
  };
  const togglePill = () => {
    desktop()?.pill(pillShown ? "hide" : "show");
    setPillShown(!pillShown);
  };
  const switchToPill = () => {
    desktop()?.pill("pill-only");
    setPillShown(true);
  };

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <AppHeader>
        {shell === "desktop" && (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={switchToPill}>
            <PictureInPicture2 size={14} />
            Switch to pill
          </Button>
        )}
      </AppHeader>
      <div className="flex flex-1 items-center justify-center px-6 pb-32">
        <div className="max-w-lg text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Studio
          </p>
          <h1 className="mt-3 font-display text-5xl leading-[1.05] tracking-tight">
            Work as you <em>normally</em> would.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Start a session and Tacit watches your screen quietly, asks why at natural pauses, then
            debriefs with you by voice and writes up a Work Map.
          </p>
          <div className="mx-auto mt-8 grid max-w-md grid-cols-2 gap-2">
            <Button size="lg" className="col-span-2 rounded-full" onClick={start}>
              <Mic size={14} />
              Start session
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={shell !== "desktop"}
              onClick={togglePill}
            >
              {pillShown ? <EyeOff size={14} /> : <Eye size={14} />}
              {pillShown ? "Hide pill" : "Show pill"}
            </Button>
            <Button variant="outline" className="rounded-full" asChild>
              <Link to="/work-maps">
                <BookOpen size={14} />
                Work Maps
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full" asChild>
              <Link to="/settings">
                <Settings size={14} />
                Settings
              </Link>
            </Button>
          </div>
          {notice && <p className="mt-4 text-xs text-muted-foreground">{notice}</p>}
          <p className="mt-6 text-xs text-muted-foreground">
            No workflow of your own?{" "}
            <button
              className="underline underline-offset-2 hover:text-foreground"
              title="A practice ERP with the challenge's invoices; share its window"
              onClick={() => window.open("/sandbox", "ledgerly", "width=1280,height=860")}
            >
              Open the practice ERP
            </button>{" "}
            (expert set) or{" "}
            <button
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() =>
                window.open("/sandbox?set=newhire", "ledgerly", "width=1280,height=860")
              }
            >
              the new hire’s case
            </button>
            .
          </p>
        </div>
      </div>
      {shell === "web" &&
        (lesson ? (
          <Tutor {...parseLessonRef(lesson)} onClose={endLesson} />
        ) : (
          <Sia onLesson={setLesson} />
        ))}
    </main>
  );
}
