# The renderer

The panel itself, with its state and act channels, its motion, confirms,
settings rows, and experiments, is `@luke/panel` (`packages/panel/AGENTS.md`).
What lives here is the desktop's shell around it: the window's entry and
root, the desktop's answer to the panel's platform door
(`desktop-platform.ts`), and session replay.

`repository-checks.sh` already fails the build on a `#main/` or `node:` import
here. What it cannot see is the same trap arriving through a package barrel:
importing a package for one string constant resolves its whole export graph,
`node:http` included. **Import the vocabulary door, not the barrel.**

## The entry and its startup

The window's document, `index.html`, loads the panel's entry
(`src/renderer/index.tsx`, `App`). What it runs before it draws (tracing, the
root, the first read of its document) is `window-root.tsx`. **The panel
records**: `App` asks the platform to apply session replay, which the desktop
answers with `session-replay.ts`, and the recording carries no words
(`session-replay.ts`).

## The Electron window

`docs/DESIGN.md` states how the window's panes move; the panel keeps to it
(`packages/panel/AGENTS.md`'s "Panel motion"). What it does not cover is the
Electron window under the panel:

- **The window never animates its own frame.** Main sets its bounds once, at
  creation, and moves it no further; a pane makes its room inside the window,
  because an animated `setBounds` re-lays out the whole renderer every frame.
