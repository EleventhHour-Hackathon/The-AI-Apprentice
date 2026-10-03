# Seamless recording and voice debrief

## Look and feel
- Replace the branded pill with a compact, unbranded control inspired by Wispr Flow: dark surface, balanced spacing, restrained icons, and smooth transitions.
- Keep a readable status label in every state: Idle, Listening, Noticed, Raised, Off the record, and Debrief.
- Add a small waveform during microphone capture, responding to actual microphone activity rather than implying that a silent microphone is receiving speech.
- Keep the end-session control inside the pill. Preserve keyboard controls and put shortcut hints in tooltips.

## Recording → debrief
- Ending the work session freezes its timer and stops that recording. Show a distinct Debrief label and the completed session duration, without the recording dot or running timer.
- Start debrief begins a real spoken exchange: the AI asks a question and the user can answer naturally or interrupt.
- Show Asking while the AI speaks, Listening when accepting an answer, and live transcription as input arrives.
- Once an answer has been captured, show a clear checkmark and “Answer captured.” Only show this after confirmed capture, never on a timer alone.
- Keep the current question, progress, and captured response readable; allow revisiting answers with Back, skipping a question, or ending the debrief.
- Back / Skip / End remain keyboard-accessible with ← / → / Esc. End immediately silences audio and stops microphone capture.
- Handle microphone permission failures, connection problems, and interrupted calls visibly, with explicit retry rather than automatic paid reconnections.

## Demo
- Retain a separate, clearly labeled simulated demo so the raised hand, question, transcription, capture checkmark, and debrief can be previewed without a microphone or AI charges.
- Fix the full-demo sequencing so intermediate transitions do not cancel the rest of the demonstration.
- Real voice mode must never present scripted example text as the user's actual response.

## Technical details
- Use Lovable's live voice integration with server-held credentials and its supplied connection, cancellation, and cleanup lifecycle.
- Use the assigned Live model for spoken conversation and the assigned text model for any delegated AI work; no login or saved conversation history is added.
- Keep captured answers in the current session only. Persistent storage and recordings saved for later are outside this change.
- Remove “Sia” from visible controls and page metadata; preserve the invoice workspace.
- Check desktop and narrow layouts, keyboard navigation, simulated flow, microphone input feedback, and real voice connection where available. Report any audible-conversation verification that cannot be completed.

**Permissions and usage:** Real voice asks for microphone access and uses workspace AI credits. The simulated demo does neither.
