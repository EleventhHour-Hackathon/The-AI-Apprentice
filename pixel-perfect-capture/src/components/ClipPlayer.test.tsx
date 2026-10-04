import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClipPlayer } from "./ClipPlayer";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

describe("ClipPlayer", () => {
  it("enlarges into an in-app overlay instead of full screen, and Esc closes it", () => {
    const fullscreen = vi.fn();
    HTMLElement.prototype.requestFullscreen = fullscreen;
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    render(<ClipPlayer src="clip.webm" label="Approving the invoice" />);

    fireEvent.click(screen.getByRole("button", { name: "Enlarge (F)" }));
    const dialog = screen.getByRole("dialog", { name: "Approving the invoice" });
    expect(dialog).toBeInTheDocument();
    expect(fullscreen).not.toHaveBeenCalled();
    // 80% of jsdom's 1024x768 window.
    expect(dialog.style.width).toBe("819px");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // The overlay took the Esc; the page under it never saw it.
    expect(onKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onKey);
  });

  it("resizes from the corner handle by keyboard and remembers the size", () => {
    render(<ClipPlayer src="clip.webm" label="Clip" />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge (F)" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Resize/ }), { key: "ArrowLeft" });
    expect(screen.getByRole("dialog").style.width).toBe("779px");
    expect(localStorage.getItem("tacit:clip-overlay-width")).toBe("779");

    fireEvent.click(screen.getByRole("button", { name: "Shrink (F)" }));
    fireEvent.click(screen.getByRole("button", { name: "Enlarge (F)" }));
    expect(screen.getByRole("dialog").style.width).toBe("779px");
  });

  it("closes on a click outside the clip", () => {
    render(<ClipPlayer src="clip.webm" label="Clip" />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge (F)" }));
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
