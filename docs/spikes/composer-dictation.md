# Spike: dictation in the agent composer

Status: spike, draft PR, not to merge. Asked by Dean: "I want to enable
dictation input for composer — start a spike for this and see if there is
some standard solution." Written 2026-10-12 against `main` at `ff606e6f`
(Electron 43.3.0, Chromium 150.0.7871.212).

## Recommendation

1. **Ship macOS system dictation, made easy to find (PR 1, small).** This is the
   standard answer, and it already works: macOS dictation (🌐/Fn pressed twice,
   or Edit ▸ Start Dictation…) types into any Chromium text field, the
   composer's textarea included. The work left is a microphone button in the
   composer that starts dictation at the caret, plus one Escape fix. It costs
   nothing, Luke never handles the audio, there is no new permission, and
   PRIVACY.md does not change. On Apple silicon the speech is recognised on
   the Mac. The branch has this prototype behind a flag.
2. **For the ChatGPT/Claude-desktop mic (a live waveform in the box and
   better accuracy on code words), add hosted transcription as PR 2.** The
   flow is record, then transcribe, then insert: the panel records the
   microphone, Luke's service sends the clip to OpenAI's transcription
   model with the plan's own vocabulary as a prompt, and the text lands at
   the caret. It runs on every macOS Luke supports and costs about
   $0.003–0.006 per minute, but PRIVACY.md and the microphone wording
   have to change. Whether to build it is Dean's call; nothing in PR 1
   depends on it.
3. **Ruled out:** the Web Speech API (it does not work in Electron, and one of its
   calls crashes the renderer; evidence below), and bundling Whisper on the
   Mac (hundreds of MB, a native build, GPU spikes) while 1 and 2 exist.
   Apple's SpeechAnalyzer (macOS 26+) is the one on-device option worth
   keeping in view, as a later free and private path behind the PR 2 UI.

## The options

| | System dictation | Web Speech API | Hosted transcription | On-device model |
| --- | --- | --- | --- | --- |
| Works in Luke today | Yes, by shortcut | **No** (`network` error) | Needs PR 2 | Needs native work |
| Cost | Free | n/a | ~$0.003–0.006/min on Luke's key | Free to run; bundle or download |
| Audio leaves the Mac | Apple silicon: no (supported languages) | n/a (it would go to Google) | Yes: Luke's service, then OpenAI | No |
| Code words ("pnpm", "useEffect") | Middling, no custom vocabulary | n/a | Best: prompt with repo/plan words | Whisper: good; SpeechAnalyzer: unknown |
| In-app waveform / live text | No (macOS draws its own mic by the caret) | n/a | Waveform; text after Stop | Yes (volatile results) |
| New permission | None for Luke | n/a | Microphone (Luke already asks) | Microphone (+ speech, Apple) |
| Effort | S | — | M (desktop + web + privacy) | L |

### 1. macOS system dictation

- **Already works.** Chromium's view implements `NSTextInputClient`, so the
  system's dictation types into the focused `<textarea>` like any Cocoa
  field. AppKit adds **Start Dictation…** and **Emoji & Symbols** to any menu
  shaped like Edit, and Luke's is Electron's `role: "editMenu"`
  (`apps/desktop/src/main/app-menu.ts`). So the menu item and the shortcut both
  exist today and Luke ships no code for them. *To confirm on a Mac.*
- **A button that starts it.** Electron has no dictation role. `startSpeaking`
  is text-to-speech, not dictation. What the Edit item sends is the
  `startDictation:` selector along the responder chain, and Electron exposes
  exactly that: `Menu.sendActionToFirstResponder("startDictation:")`. The
  prototype adds one panel-only act, `ACT_KIND.WINDOW_START_DICTATION`,
  whose main-process row makes that call. The button's `mousedown` is
  prevented, so the caret stays in the box, and the press focuses the
  field before it asks, because dictation types into whatever holds the
  caret. *To confirm on a Mac: whether the selector reaches the handler
  from Electron's responder chain. Third-party AppKit wrappers expose
  exactly this call on `NSApplication`.*
- **Keys.** Enter already ignores a composing input method
  (`ai-elements/prompt-input.tsx`). Escape did not: the composer blurred the
  box on every Escape. While dictation (or any IME) is still composing,
  the prototype leaves Escape to the input method, so dictation's own
  Escape cancels the dictation without also throwing the caret out. *To
  confirm on a Mac: whether modern dictation marks its interim text as
  composition in Chromium. If it does not, Escape still blurs, which also
  ends dictation, so the worst case is the behaviour we have today.*
- **Limits.** No public API reports whether dictation is listening, so the
  button starts dictation and does not toggle it. The developer stops it
  with the shortcut, Escape, or by clicking away, and macOS's own
  floating mic shows its state. Dictation has to be enabled in System
  Settings ▸ Keyboard ▸ Dictation, and macOS offers to enable it on first
  use. *To confirm on a Mac.* Accuracy on identifiers is ordinary dictation
  accuracy, with no vocabulary hints.
- **Privacy.** Luke never sees audio. It receives the typed text, as it would
  from a keyboard. On Apple silicon, recognition for supported languages
  is on device; anything else is Apple's to process under Apple's terms,
  not Luke's.

### 2. Web Speech API (`webkitSpeechRecognition`): ruled out, with evidence

I probed Electron 43.3.0 (the repo's pin, Chromium 150) under Xvfb with a
fake microphone. The probe script is reproduced at the end.

- `SpeechRecognition` and `webkitSpeechRecognition` both exist as
  constructors. That is the trap: feature detection says yes.
- Server recognition starts, opens the audio (`start`, `audiostart`), then
  fails with **`error: network`**. Chromium's recognizer posts audio to
  Google with Chrome's own API key, which Electron does not ship. Even if
  it worked, the audio would go to Google, which PRIVACY.md does not allow.
- On-device recognition (`processLocally`, `SpeechRecognition.available()`)
  is worse. Calling `available()` **kills the renderer**: `Terminating render
  process for bad Mojo message: No binder found for interface
  media.mojom.OnDeviceSpeechRecognition`. Electron registers no on-device
  speech service. **Nothing in the renderer may ever call it**, not even to
  feature-detect.

### 3. Hosted transcription (OpenAI)

What Luke already has, and what it does not:

- The **panel may already open the microphone**. The permission handler
  grants audio-only media to panels and the voice window
  (`main/services/window-service.ts`). The panel's CSP admits `media-src
  mediastream:`, and the macOS grant flow is `microphone-access.ts`. The
  panel's `connect-src` is PostHog alone, so a clip leaves through main
  (one act) to Luke's service, never from the renderer to OpenAI.
- The **voice call is the wrong engine.** It is GPT Live (`gpt-live-1`
  over `/v1/live/sessions`, WebRTC from the voice window, SDP accepted
  from the voice window alone in `main/ipc/voice-runtime.ts`). It is a
  conversational model that answers back. It is billed and counted as a
  voice session, and its lines are written to the account's Conversation
  (PRIVACY.md). Its live session configures no transcription model; the
  captions are the live model's own input transcript. Reuse its
  microphone code (`voice/microphone-choice.ts`'s constraints and
  built-in-mic preference), not its session.
- **Proposed shape (record, then transcribe):**
  - The mic button starts a `MediaRecorder` (Opus/WebM, about 4 KB/s) in
    the panel.
  - The card shows a live waveform from an `AnalyserNode`, a timer, ✕
    (Esc) to cancel and ✓ (Enter or the button) to finish, as ChatGPT
    does.
  - On finish, one act (`CODING_AGENT_TRANSCRIBE`) carries the clip to
    main, and main carries it to a new hosted route.
  - That route authenticates the account, bounds the clip (for example
    2 minutes or 1 MB), and calls OpenAI's transcription endpoint with
    `gpt-4o-mini-transcribe` (or `gpt-4o-transcribe`). Its `prompt` carries
    the plan's vocabulary: repository name, plan title, and file paths
    named in the plan. This is what fixes "pnpm" and "useEffect".
  - The route keeps nothing and returns the text, which is inserted at
    the caret.
- **Latency:** about 1–2 s after Stop for a 15–30 s clip. Live interim text
  would need a streaming transcription session over a second WebRTC peer
  from the panel, which is more moving parts and about 3× the price.
  It is not worth it for a message box.
- **Cost:** third-party price tables put it at about $0.003/min (mini) and
  $0.006/min (full). Confirm on OpenAI's pricing page before quoting.
  At those prices a heavy dictator costs cents a day.
  - It runs on Luke's key, metered per account beside the voice seconds
    (`hosted/quota.ts`).
  - BYOK (#2079) covers coding agents on the account's own provider key.
    Dictation on the account's OpenAI key is a later option, not a
    requirement.
- **Privacy work this needs:**
  - PRIVACY.md's "Who we send it to" gains dictated audio (sent through our
    service to OpenAI, not kept, the text returned to the box only).
  - `microphone-access.ts` stops saying the microphone has "exactly one use".
  - The microphone ask is no longer gated on voice being available.
  - Session replay is unaffected: the box is already `ph-no-capture` and
    masked.

### 4. On-device models

- **whisper.cpp (Metal) / WebGPU Whisper**, ruled out for now:
  - Models run about 75 MB (tiny) to 1.5 GB (large-v3); the useful ones
    for code words are about 500 MB.
  - whisper.cpp needs a native build in the release pipeline, plus a
    first-run download.
  - WebGPU Whisper needs ONNX Runtime's wasm, `wasm-unsafe-eval` in the
    panel CSP, and a lazy bundle outside `renderer.js`'s budget.
  - Either way it means GPU or CPU spikes while the developer is
    compiling. It costs more than both options above and buys only
    offline use, which system dictation already gives.
- **Apple SpeechAnalyzer / SpeechTranscriber (macOS 26+)** is worth keeping
  in view:
  - It is on device, free, and streams volatile (interim) results.
  - It would be a Swift helper beside `native/macos/TalkKey.swift`,
    speaking lines over the existing `NativeHelper`.
  - It needs macOS 26 (Electron 43 supports older), so a fallback is
    still required.
  - It needs a speech-asset download (AssetInventory) and a usage string.
  - Its accuracy on identifiers is unknown, and the sources found disagree
    on whether it takes vocabulary hints.
  - It could later sit behind the same PR 2 UI as a free engine.

## The UX (both PRs)

- A microphone icon button sits at the card's foot, just left of "+"
  (#2085) and Send/Stop. Its tooltip is "Dictate". It is disabled while
  the box is held (sending, or the agent is closed).
- **PR 1:** the press puts the caret in the box and starts system
  dictation. macOS draws its own listening mic by the caret, and words
  land at the caret as they are recognised. Esc, the shortcut, or a click
  away ends it. Edit ▸ Start Dictation… stays where AppKit puts it.
- **PR 2:** the press turns the box into a recording strip: a live
  waveform, a timer, ✕ (Esc) to cancel, ✓/Enter to finish. A short
  "Transcribing…" follows, then the text is inserted at the caret (never
  replacing the draft) and the box is focused again. A failure says why
  under the card, in the composer's note, with the clip discarded.

## PR plan

1. **feat(desktop): a Dictate button in the agent composer starts macOS
   dictation** (S). This is the prototype in this branch, minus the flag
   and the `SPIKE` comments.
   - It covers `ACT_KIND.WINDOW_START_DICTATION`, its window-surface row
     (refused outside a panel, with a row test), the composer button and
     the Escape guard (`agent-composer.test.ts`), and the New Plan
     composer too if Dean wants it there.
   - Its body states the Mac checks below. Evidence comes from
     `verify.sh` on a Mac, since CI builds nothing for the Mac.
2. **Decision for Dean:** stop at PR 1, or add hosted transcription. If yes:
   - **2a feat(web): POST a dictated clip, answered with its words**: the
     hosted route, bounds, the vocabulary prompt, metering, and tests on a
     scripted OpenAI layer.
   - **2b feat(desktop): record-then-transcribe in the composer**: the
     recorder and waveform, the act, the insert at the caret, Esc cancel,
     PRIVACY.md, and the microphone wording.
   - In 2b the Dictate button becomes the in-app recorder, and system
     dictation keeps working by its shortcut.
3. Later, if macOS 26 adoption makes it worth it: a SpeechAnalyzer engine
   behind 2b's UI, free and on device, with hosted as the fallback.

## Checks that need a real Mac (LUKE-159 style)

1. With dictation enabled, press 🌐/Fn twice in the composer: words land in
   the box, Enter is not sent mid-dictation, and Escape ends dictation.
2. Edit ▸ Start Dictation… is in Luke's Edit menu and starts dictation in
   the box.
3. With the spike flag on (`localStorage.setItem("luke.spike.composerDictation",
   "on")` in the panel's devtools, then reopen the tab), the mic button
   starts dictation with the caret where it was. This is the one unproven
   link: `Menu.sendActionToFirstResponder("startDictation:")`.
4. With dictation off in System Settings, the button shows macOS's offer to
   turn it on (or nothing; the PR 1 answer would then add a hint).
5. Escape while dictating: dictation ends, and the caret stays (composition
   seen) or leaves (not seen).

## The prototype in this branch

- `ACT_KIND.WINDOW_START_DICTATION` (`shared/messages/acts.ts`) is a panel's
  own act. Its row is in `main/ipc/window-surface.ts`, and the
  `Menu.sendActionToFirstResponder("startDictation:")` call (darwin only)
  is in `main/ipc/register-desktop-ipc.ts`.
- `planning/agent-composer.tsx` adds the Dictate button behind
  `localStorage["luke.spike.composerDictation"] === "on"`, plus the Escape
  guard for a composing input method, with the test at the end of
  `agent-composer.test.ts` (it fails without the guard).
- `.agent-composer-actions` groups the presses at the foot's right. It uses
  the class #2085 introduces, so the two merge cleanly.

### Probe script (Web Speech in Electron)

Run as `DISPLAY=:99 electron --no-sandbox main.js` with Xvfb on `:99`.

```js
const { app, BrowserWindow, session } = require("electron");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(true));
  const w = new BrowserWindow({ show: false });
  await w.loadFile("page.html"); // any page: a secure context for getUserMedia
  console.log(await w.webContents.executeJavaScript(`new Promise(async (done) => {
    // Calling SpeechRecognition.available(...) here instead kills the renderer.
    const s = new webkitSpeechRecognition(), events = [];
    const track = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];
    s.onstart = () => events.push("start");
    s.onaudiostart = () => events.push("audiostart");
    s.onerror = (e) => events.push("error:" + e.error);
    s.onend = () => done(events);
    s.start(track);
  })`)); // => [ "start", "audiostart", "error:network" ]
  app.quit();
});
```
