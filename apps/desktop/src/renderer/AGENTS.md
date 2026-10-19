# The renderer

The panel itself, with its state and act channels, its motion, confirms,
settings rows, and experiments, is `@luke/panel` (`packages/panel/AGENTS.md`).
What lives here is the desktop's shell around it: each window's entry and
root, the desktop's answer to the panel's platform and bundle doors
(`desktop-platform.ts`, `desktop-bundles.ts`), session replay, the voice and
call windows, the avatar, and the Factory's scenes and worlds.

`repository-checks.sh` already fails the build on a `#main/` or `node:` import
here. What it cannot see is the same trap arriving through a package barrel:
importing a package for one string constant resolves its whole export graph,
`node:http` included. **Import the vocabulary door, not the barrel.**

## One entry per window, one shared startup

Each window's document loads its own entry: `index.html` the panel's
(`src/renderer/index.tsx`, `App`), `voice.html` the voice window's
(`voice/index.tsx`, `VoiceHost`), and `call.html` the call window's
(`call/index.tsx`, `CallWindowCard`). What every window runs before it draws
(tracing, the root, the first read of its document) is `window-root.tsx`, and
the code the entries share lands in shared chunks. **The panel is the one
surface that records**: `App` asks the platform to apply session replay, which
the desktop answers with `session-replay.ts`, and no other entry mounts it;
`voice.html` is `connect-src 'none'`; and the recording carries no words in any
case (`session-replay.ts`).

No credential reaches the voice window, nothing there appends to the model, and it
writes no Conversation line. The policy — whether a session stands, what the keys
do — is `LiveVoiceOrchestrator` in `@luke/voice`. Two constraints are this
bundle's own and are easy to undo:

- The audio line carries a track at every moment of the session's life. GPT Live
  paces output against the input timeline, so a sender left with no track stalls
  it — a reply appended while the talk key was up was held until the next press,
  then unloaded whole. A muted session, or one whose microphone the system
  refused, carries synthesized silence that the next press swaps a device onto.
- The peer is acquired into a `Scope`, not closed by hand, and every bound is an
  `Effect.sleep` forked into that same scope — so nothing is left armed behind an
  ended session, and a test drives them with `TestClock`.

## The Electron window

`docs/DESIGN.md` states how the window's panes move; the panel keeps to it
(`packages/panel/AGENTS.md`'s "Panel motion"). What it does not cover is the
Electron window under the panel:

- **The window never animates its own frame.** Main sets its bounds once, at
  creation, and moves it no further; a pane makes its room inside the window,
  because an animated `setBounds` re-lays out the whole renderer every frame.
