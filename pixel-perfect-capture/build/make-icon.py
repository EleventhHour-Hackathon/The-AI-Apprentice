"""Draw the Tacit app icon: the dark voice pill with the listening wave, in the app's colours.

    python3 build/make-icon.py      (needs Pillow; writes icon.png, icon.icns and icon.ico here)
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
SIZE = 1024
SCALE = 4  # draw large, then scale down for smooth edges

TILE = (20, 21, 24)  # --pill
RIM = (44, 46, 52)  # --pill-border
WAVE = (79, 209, 165)  # --voice-listening
BARS = [0.34, 0.62, 1.0, 0.62, 0.34]  # bar heights, as in the pill's VoiceWave


def draw() -> Image.Image:
    s = SIZE * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # The macOS icon grid: an 824 px rounded tile centred on the 1024 px canvas.
    inset = 100 * SCALE
    d.rounded_rectangle(
        (inset, inset, s - inset, s - inset), radius=185 * SCALE, fill=TILE, outline=RIM, width=6 * SCALE
    )
    bar_w, gap, tallest = 64 * SCALE, 52 * SCALE, 380 * SCALE
    total = len(BARS) * bar_w + (len(BARS) - 1) * gap
    x = (s - total) // 2
    for h in BARS:
        height = int(tallest * h)
        top = (s - height) // 2
        d.rounded_rectangle((x, top, x + bar_w, top + height), radius=bar_w // 2, fill=WAVE)
        x += bar_w + gap
    return img.resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    icon = draw()
    icon.save(HERE / "icon.png")
    icon.save(HERE / "icon.icns")
    icon.save(HERE / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote icon.png, icon.icns, icon.ico")
