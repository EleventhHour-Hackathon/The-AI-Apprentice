import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Eye, EyeOff, Mic, PictureInPicture2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sia } from "@/components/Sia";
import { Tutor } from "@/components/Tutor";
import { desktop } from "@/lib/desktop";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Apprentice" },
      {
        name: "description",
        content:
          "An apprentice that watches you work, asks why at the right moments, and writes down what it learned.",
      },
      { property: "og:title", content: "AI Apprentice" },
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
    setLesson(new URLSearchParams(window.location.search).get("lesson"));
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
  const comingSoon = (what: string) => setNotice(`${what} is not built yet.`);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex h-12 items-center border-b bg-card px-5 text-sm font-semibold">
        AI Apprentice
        {shell === "desktop" && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={switchToPill}>
            <PictureInPicture2 size={14} />
            Switch to pill
          </Button>
        )}
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-32">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Work as you normally would.</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Start a session and the apprentice watches your screen quietly, asks why at natural
            pauses, then debriefs with you by voice and writes up a Work Map.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button onClick={start}>
              <Mic size={14} />
              Start session
            </Button>
            <Button variant="outline" disabled={shell !== "desktop"} onClick={togglePill}>
              {pillShown ? <EyeOff size={14} /> : <Eye size={14} />}
              {pillShown ? "Hide pill" : "Show pill"}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/work-maps">
                <BookOpen size={14} />
                Work Maps
              </Link>
            </Button>
            <Button variant="outline" onClick={() => comingSoon("Settings")}>
              <Settings size={14} />
              Settings
            </Button>
          </div>
          {notice && <p className="mt-4 text-xs text-muted-foreground">{notice}</p>}
        </div>
      </div>
      {shell === "web" &&
        (lesson ? <Tutor workMapId={lesson} onClose={endLesson} /> : <Sia onLesson={setLesson} />)}
    </main>
  );
}
