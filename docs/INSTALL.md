# Installing Tacit

Welcome! This guide gets you from download to your first session in about ten minutes.

## What Tacit is

Tacit is an AI apprentice. It watches an expert do a job on screen, asks why at the right
moments, and turns the answers into a Work Map: every step, the decision behind it, and the
expert's reasons in their own words. A tutor then uses that map to teach the next person, and
steps in before they save a wrong decision.

Tacit is a desktop app. It holds no API keys and stores nothing of yours on your computer: it
talks to your team's Tacit server over HTTPS.

## What you need

- **Nothing to set up.** Tacit already knows your team's server and connects on its own. Keep
  the access key from the message you got with this guide, just in case Tacit ever asks for it.
- **A microphone.** You talk with the apprentice by voice.
- **Permission to share your screen.** Tacit asks for it the first time you start a session.
- **A computer** running macOS (Apple silicon or Intel), Windows 10 or 11 (64-bit), or Linux
  (x86_64), with an internet connection.

## Download

Pick the file for your computer. These links always point at the newest version.

| Computer | File |
|---|---|
| Mac with Apple silicon (M1 and later) | [Tacit-mac-arm64.dmg](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-mac-arm64.dmg) |
| Mac with an Intel processor | [Tacit-mac-x64.dmg](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-mac-x64.dmg) |
| Windows 10 or 11 | [Tacit-win-x64.exe](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-win-x64.exe) |
| Linux | [Tacit-linux-x86_64.AppImage](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-linux-x86_64.AppImage) |

Not sure which Mac you have? Open the Apple menu, then About This Mac. "Chip: Apple M..." means
Apple silicon; "Processor: Intel..." means Intel.

You can also download from the website: <https://gsnmithra.github.io/tacit-app/>.

## Install and open it the first time

Tacit isn't signed with a certificate yet, so your computer asks you to confirm once. This is
expected; after the first time it opens normally.

### macOS

1. Open the downloaded `.dmg` and drag **Tacit** into **Applications**.
2. In Applications, **right-click** (or Control-click) Tacit and choose **Open**, then **Open**
   again in the dialog.
3. If you only see "Move to Trash" and no Open button: open **System Settings**, go to
   **Privacy & Security**, scroll down to the message about Tacit and click **Open Anyway**.
   Confirm with your password, then open Tacit again.
4. When asked, allow **Microphone** access. The first time you share your screen, macOS asks
   for **Screen Recording** permission: allow it in System Settings, Privacy & Security,
   Screen & System Audio Recording, then quit and reopen Tacit.

### Windows

1. Run `Tacit-win-x64.exe`.
2. If SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**.
3. Follow the installer. Tacit appears in the Start menu.
4. If Windows asks whether Tacit may use your microphone, choose **Allow**.

### Linux

1. Make the AppImage executable, either in a terminal:

   ```
   chmod +x Tacit-linux-x86_64.AppImage
   ./Tacit-linux-x86_64.AppImage
   ```

   or in your file manager: right-click the file, Properties, Permissions, tick **Allow
   executing file as program**, then double-click it.
2. If it doesn't start, your system may need FUSE to run AppImages (on Ubuntu:
   `sudo apt install libfuse2`).

## Connect to your team's server

Tacit connects to your team's server by itself the first time it opens: there's nothing to type.

If the server was asleep it can take up to a minute to wake, and Tacit may show **Connect to
Tacit** with everything already filled in. Click **Connect** and wait a moment. If it ever asks
for an access key, paste the one from the message you got with this guide.

You can change the address or the key later in **Settings**, under **Connection**.

## Your first session (about 5 minutes)

Tacit comes with a practice ERP called **Ledgerly**, with fake supplier invoices, so you can try
everything without touching real systems.

1. In the Studio window, click **Open the practice ERP**. In Ledgerly pick **Expert's session**
   and press **Reset**.
2. Put Ledgerly on the screen you will share. The small dark **pill** floats above it.
3. Press **Start session** (or the **S** key) and share that screen. Tell the apprentice what you
   are doing, for example "Supplier invoices before month-end close".
4. Work one or two invoices and talk while you work. For example, open invoice **4471**, change
   the cost center to **0400 Fixed assets**, type an asset number and post it. Say why: "Equipment
   over five thousand euros is always capex."
5. The apprentice stays quiet while you type or talk, and asks at a pause. Answer in a sentence.
   The pill shows how many questions it has asked.
6. Press **End** (S). The apprentice asks a few more questions in a short debrief, then explains
   the process back to you. Correct anything it gets wrong. When it's right, say "Yes, that's how
   it works." It saves your Work Map.
7. Click **Go to Work Maps** to see it: each step with its screen moment, the decision and your
   reasons in your words.

Want to see the tutor? On the Work Map click **Teach a new hire**, switch Ledgerly to **New
hire's practice**, and work an invoice the wrong way. The tutor steps in before it is saved.

Handy keys while a session runs: **S** start or end, **O** off the record.

## Privacy

- **Privacy shield.** Before a screen frame leaves your computer, Tacit finds emails, IBANs,
  card and phone numbers and labelled fields such as Contact or Name, and paints over them. If
  the shield can't start, screen sharing doesn't start either.
- **Off the record.** Press **O** and nothing is seen, heard, transcribed or recorded until you
  press it again.
- **Redaction on the server.** Transcripts, events and quotes are redacted for emails, IBANs,
  cards and phone numbers. Names are redacted too: the hosted backend
  has name detection on by default.
- **The pill stays out of recordings.** It hides itself from the screen capture.
- **You can delete.** Delete any Work Map and its videos from Work Maps. Sessions nobody
  confirmed are marked for deletion after 30 days.
- **No keys on your computer.** The AI services are called by your team's server, never by the
  app. Your access key only lets the app talk to that server.

## Troubleshooting

**"Missing or wrong access key"**
The key was mistyped or has changed. Copy it again from the message you received (no spaces
before or after), then paste it in Settings, Connection. If it still fails, ask your admin
whether the key was changed.

**The app can't reach the server, or nothing loads**
- Check your internet connection.
- The server may be waking up after a quiet period. Wait 30 to 60 seconds and try again.
- Check the address in Settings, Connection. It should start with `https://`.
- On a company network, a firewall or VPN may block it. Ask your IT team to allow the address.

**The apprentice can't hear me**
- macOS: System Settings, Privacy & Security, Microphone: turn on Tacit.
- Windows: Settings, Privacy & security, Microphone: allow desktop apps to use the microphone.
- Check that the right microphone is selected as your system's input device.

**Screen sharing doesn't start or shows a black screen**
- macOS: System Settings, Privacy & Security, Screen & System Audio Recording: turn on Tacit,
  then quit and reopen it.
- Linux on Wayland: pick the screen in the system's sharing dialog when it appears.
- If the privacy shield couldn't start, Tacit doesn't share the screen on purpose. Restart the
  app and try again.

**macOS says Tacit "is damaged and can't be opened"**
This can happen with unsigned apps downloaded from the internet. Open Terminal and run
`xattr -cr /Applications/Tacit.app`, then open Tacit again.

Still stuck? Reply to the person who sent you Tacit with what you see (a screenshot helps).
