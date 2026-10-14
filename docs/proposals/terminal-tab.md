# Proposal: a Terminal tab

Status: proposed, waiting on Dean's decisions ("Questions for Dean" at the end).
No product code is written until he answers.

Dean's ask: "I want to add a terminal tab. Can you work on planning this out?"

The short answer is:

- **Where it runs:** a local login shell on Dean's Mac, through node-pty in a
  pty host process of its own.
- **Where it shows:** as a side-panel tab, many per plan, beside Board, Code,
  Call, Files and Changes.
- **How it draws:** xterm.js themed from the window's tokens, loaded as a
  lazy bundle.
- **How the bytes travel:** over a `MessagePort` that bypasses `app:state`,
  the act router, traces, the voice window and session replay. Opening and
  closing a terminal remain ordinary acts.
- **What waits:** a shell in an agent's sandbox and agents using the terminal
  come later, if at all.

## 1. Where does the shell run?

### a) A local shell on the Mac (recommended for v1)

A local shell is where Dean's checkouts, toolchains, `gh` login, SSH keys and
dotfiles already live. A terminal tab is useful for exactly the things a
plan needs checked against the real machine: running a repository's checks,
`git log`, starting a dev server, or running a CLI agent.

- **The stream never leaves the Mac.** No server path exists for it, so the
  "never let a credential enter a Gateway answer or event, … a trace" rule
  (AGENTS.md, "Never") holds by construction rather than by scrubbing.
- **It costs nothing per minute and works offline.** It also adds no latency
  beyond IPC.
- **There is a precedent for spawning on the Mac, and only part of it fits.**
  `run_on_mac` (#2359–#2388) spawns `$SHELL -l -c <command>` from `$HOME`
  with Effect's `ChildProcess` over pipes (`packages/host/src/mac-command-runner.ts:92-98`).
  The tab reuses the login shell, the home folder default, and
  `PAGER`-free habits. It cannot reuse the pipes: a terminal needs a PTY,
  because pipes give no job control, no `isatty`, no colors, no `vim`, and no
  CLI agents.
- **It does not share `run_on_mac`'s permission.** That switch, "Let agents
  run commands on this Mac" (`packages/settings/src/schema.ts:93-104`, Settings
  › This Mac, on by default, no approval UI), brakes what *agents* run without
  asking. A Terminal tab is Dean typing into his own shell, the same as
  opening Terminal.app. Gating it on the agent switch would turn the user's
  shell off whenever he turns agent commands off, so v1 adds no setting (see
  question 7).

### b) A shell in a coding agent's sandbox (not for v1)

It is technically possible. `@vercel/sandbox` (3.8.0) has an undocumented PTY:
`sandbox.openInteractive()` returns `{ url, token }` for a WebSocket. Its
protocol is a JSON `start` frame (command, env, cwd, cols, rows), binary
stdin and stdout frames, and `resize` and `exit` frames
([sandbox.ts](https://github.com/vercel/sandbox/blob/main/packages/vercel-sandbox/src/sandbox.ts),
[the CLI's interactive-shell.ts](https://github.com/vercel/sandbox/blob/main/packages/sandbox/src/interactive-shell/interactive-shell.ts)).
`sandbox connect` is built on it. `runCommand`, the documented API, is pipes
only: "The process reads from a pipe, not a terminal"
([SDK reference](https://vercel.com/docs/vercel-sandbox/sdk-reference)).

Each reason below is a v1 blocker:

- **The API is undocumented.** It sits in the SDK source but not on the
  reference page.
- **The sandbox is stopped at each turn's end.** A coding agent's sandbox is
  stopped the moment its turn ends
  (`apps/web/server/hosted/agent-runtime/sandbox.ts:70-86`,
  `stopsAtTurnEnd: true`). A shell would resume it and hold it open at about
  $0.085/h idle for 2 vCPU/4 GB
  ([pricing](https://vercel.com/docs/vercel-sandbox/pricing)). It would
  also be fighting the agent's own lifecycle.
- **The user's shell would hold the agent's GitHub write token.** The
  agent's token is set at the sandbox firewall for `github.com`
  (`apps/web/coder/sandbox.ts`, `authenticateGitHub(…, { delivery: "firewall" })`),
  so anything typed there pushes with the agent's identity.
- **Every path to it carries a credential.** Either the desktop holds the
  interactive token, a credential crossing to the device and into a
  renderer, or Luke's service proxies a long-lived WebSocket, which a Vercel
  function is not built to hold. Both are new trust surfaces.
- **The user and the agent would edit one checkout concurrently.**

It is a reasonable v3 for "look inside what the agent built", for example an
"Open a shell in this agent's sandbox" item on an agent tab after its turn.
It should be designed on its own.

### c) Both, picked per tab

A picker doubles the surface area (two transports, two lifecycles, two
privacy stories) before either is proven. If (b) ever ships, it can join as
a second "+" row then.

**Recommendation: (a) for v1.**

## 2. The tab model

### A side-panel tab, many per plan

The side panel holds the plan's tools (Board, Code, Call, File tabs, Changes,
Pages); the column holds the plan and its conversations (Plan, agents,
Inbox). A terminal is a tool, and the point of the feature is running
something *while* reading the plan, so it belongs beside the document rather
than in its place. The panel's full-screen toggle already gives a big
terminal when one is wanted. The show compares the two placements side by
side.

**Model.** A new strip-tab kind `{ terminal: TerminalId }`
(`apps/desktop/src/renderer/planning/tab-strip-model.ts:62`) gets a guard, a
`sameTab` branch and a `tabKey` branch, following how `{changes}` and
`{file}` were added. It joins `SidePanelTab` (`use-side-panel.ts:162`) and is
**not** added to the fixed `SIDE_PANEL_TAB` set (`:136`), because a plan holds
any number of terminals. The id is a random UUID minted in the renderer.

**Strip.**
- The tab shows lucide's `TerminalIcon`, which #2322 freed for "a shell
  command alone".
- The label is "Terminal", or "Terminal 2", "Terminal 3" past the first. The
  `tab-detail` is the foreground process (`zsh`, `vitest`, `pnpm`), read from
  node-pty's `process` as output arrives.
- It closes like any tab and gets the `TabDoors` context menu: Close, Close
  others, Rename, plus Clear and Kill.

**Lifetime.**
- A shell starts when its tab is first drawn.
- It keeps running while Dean looks at another tab or another plan, the way
  an agent tab keeps its run.
- Closing the tab ends the shell: SIGHUP, then SIGKILL after a grace. If a
  foreground process other than the shell is running, it asks first through
  `ConfirmDialog` ("`pnpm dev` is still running. Close the terminal and end
  it?"). It does not ask at a bare prompt, as Ghostty and iTerm2 don't.
- Archiving or deleting the plan ends its shells.
- If a shell exits on its own, the tab stays with "[Shell exited] Press
  Return to start a new shell, or ⌘W to close" (the "exited" scene in the
  show).

### How it opens

- **"+" menu.** A "New terminal" row after the fixed kinds in `panelEntries()`
  (`desktop/side-panel.tsx:349`), with the ⌘J hint. ⌘T on a focused panel
  already opens this menu.
- **⌘K.** Through `actionRows` (`desktop/command-palette.tsx:439`), a new
  `APP_COMMAND` with a live offer appears with no palette code. That gives
  "New terminal", plus "Show terminal" rows for the plan's open terminals,
  following #2523's reuse of the "+" entries, and "Clear terminal" while one
  is focused.
- **⌘J, a new chord.** It shows the plan's most recent terminal, opening the
  panel and a first terminal if needed, and focuses it. Pressed while a
  terminal has focus, it hides the panel. This is Conductor's chord for its
  terminal ([shortcuts](https://www.conductor.build/docs/reference/keyboard-shortcuts)).
  ⌘J is free in `shared/shortcuts.ts`. VS Code's and Zed's ⌃\` cannot be
  expressed: the shortcut model requires ⌘ on every chord but ⌃⌘F, and ⌘\`
  is the system's window cycling (`main/app-menu.ts:306`). It also gets a
  View-menu item, so the chord shows in the menu bar and on the shortcuts
  page.

### ⇧⌘T, persistence, restore

- **⇧⌘T.** A closed terminal is recorded in `closed-tabs.ts` like any side
  tab, and `drawsAgain` (`use-plans-tab.ts:1274`) always answers yes for it.
  Reopening brings the tab back where it stood, with a **fresh shell** in the
  folder the old one was last in. The old process is gone; nothing pretends
  otherwise.
- **Relaunch.** Each plan's terminals (id, title, last folder) are saved in
  `luke.sidePanel`'s `planTabs`, under a new optional `terminals` field.
  They live in their own field, not in `opened`, because a saved value that
  names a kind the schema does not know fails the whole decode and drops
  every saved choice (`use-side-panel.ts:352`, the fallback at `:387`). On
  launch the tabs come back in place, and each starts a fresh shell in its
  last folder when first drawn, under one dim line: "Restored. New shell in
  ~/code/luke".
- **No scrollback is saved to disk in v1.** Terminal output is where
  credentials show up (`env`, `cat .env`, a token a CLI prints), and Luke
  writes nothing of it anywhere today. VS Code does revive scrollback
  (`terminal.integrated.persistentSessionScrollback`,
  [advanced](https://code.visualstudio.com/docs/terminal/advanced)) through
  `@xterm/headless` and the serialize addon in its pty host. That is a clean
  later addition if Dean wants it (question 6).
- **Processes do not survive Quit.** Quitting with a foreground job running
  asks first, the way a live call already asks before Quit (#2160).

### Where a new shell starts

Today Luke knows a plan's repository only as GitHub's `owner/name`
(`planning-model.ts:388`). There is no local checkout path on `main`; the
local-folder plan work (#1777) is not merged. So:

- **v1:** the home folder, which is what `run_on_mac` does.
- **A later PR (8):** each terminal reports its folder (OSC 7 from shell
  integration, or `lsof -a -d cwd -p <pid>` on demand). When a terminal of a
  plan in `owner/name` closes inside a git checkout whose `origin` is
  `owner/name`, Luke remembers that folder for the repository on this Mac.
  The next terminal of any plan in that repository opens there. It is a
  per-device local preference, never sent anywhere.

## 3. The renderer

### xterm.js 6

`@xterm/xterm` 6.0.0 is VS Code's and most Electron terminals' emulator
([npm](https://www.npmjs.com/package/@xterm/xterm)). The alternatives are not
ready:

- **ghostty-web 0.4** is about 121 KB gzipped of WASM plus 665 KB of JS, and
  pre-1.0 ([repo](https://github.com/coder/ghostty-web)).
- **wterm 0.5** is a DOM renderer with native find, but six months old
  ([repo](https://github.com/vercel-labs/wterm)).
- **libghostty-vt** is alpha.

Revisit wterm when it matures. Its DOM rendering would make ⌘F and screen
readers free.

**Addons.** fit, search, web-links, unicode11, and webgl with a fallback to
the DOM renderer on context loss. Not v1: ligatures (reads system font
files), image, serialize, clipboard (⌘C/⌘V work through the browser's
copy/paste events).

**Bundle budget.** These are measured ESM sizes, gzipped. The core is about
85 KB, webgl about 34, search about 12, unicode11 about 11, and web-links and
fit about 2 together: roughly **145 KB gzipped**. It ships as a lazy IIFE
bundle `renderer/terminal.js`, loaded through `bundle-loader.ts` the way
`file-tree.js` and `plan-editor.js` are (`scripts/build.mjs:210-280`). That
leaves `renderer/renderer.js` within slack and adds one deliberate row to
`apps/desktop/bundle-budget.json`, which AGENTS.md allows for "a deliberate
library adoption".

### Theme

`ITheme` is read from the window's tokens with `getComputedStyle` and
re-applied on a `prefers-color-scheme` change, which is how Luke's Theme
setting reaches every window (`base.css:162-168`):

| xterm theme field | Token |
| --- | --- |
| background | `--desktop-well` (the panel's own ground) |
| foreground, cursor | `--text-primary` |
| selection | `--code-pointed` |
| 16 ANSI colors | sixteen new `--terminal-*` tokens in `base.css`, dark in `:root` and restated for light, tuned to WCAG AA on the well, starting from the `--file-icon-*` hues |
| search match, current match | `--find-match`, `--find-current` |
| font | `--font-mono` at 12 px |

DESIGN.md allows color literals only in a `:root` block with a light
restatement, which is why the ANSI colors become tokens rather than a table
in TypeScript.

### Keys

- **App chords reach the app.** `attachCustomKeyEventHandler` hands every
  chord in `APP_SHORTCUTS` back to the window's keymap: ⌘W, ⌘T, ⇧⌘T, ⌘J,
  ⌘F, ⌘K, ⌘N, ⌘1…9.
- **The shell gets the rest, including ⌃C, ⌃D, ⌃R and ⌃L.**
- **Line-editing chords become what a shell expects.** ⌘← and ⌘→ become
  ⌃A and ⌃E; ⌥← and ⌥→ become word jumps; ⌘⌫ becomes ⌃U.
- **⌥ types characters by default** (`macOptionIsMeta: false`), matching
  Terminal.app.
- **Shift+Enter inserts a newline in CLI agents.** Claude Code and Codex
  expect this, and it is what Claude Code's `/terminal-setup` configures VS
  Code and Cursor to send
  ([docs](https://code.claude.com/docs/en/terminal-config)), so nobody needs
  to run it for Luke.
- **⌘K stays the command palette inside a terminal.** macOS terminals and VS
  Code bind ⌘K to clear, but in Luke ⌘K is the one door to everything, and
  the sidebar's Search row advertises it. Clear is in ⌘K, in the tab's
  context menu, and ⌃L in the shell. This is question 3.

### ⌘F

`FindScope` (`renderer/find-in-tab.tsx:275`) searches the DOM, and xterm
draws on a canvas, the same reason the Board is excluded from the side
panel's scope (`desktop/side-panel.tsx:1581`). The plan:

1. Export the find bar, today the private `FindBar` at `find-in-tab.tsx:182`,
   with a small pluggable source: `find(query, step)` returns a tally.
2. Implement that source over the search addon: `findNext` and
   `findPrevious` with decorations in the find tokens, and
   `onDidChangeResults` for "1 of 3".
3. Exclude terminal tabs from the panel's DOM scope, as the Board is.

The bar looks and keys exactly like every other tab's (the "find" scene in
the show).

### Links

- **URLs.** The web-links addon opens them with ⌘-click through the existing
  open-external path.
- **File paths.** A link provider matches paths with an optional `:line:col`,
  as vitest, tsc, eslint and stack traces print them. A ⌘-click asks main
  for the shell's folder (`lsof` on demand, so it needs no shell
  integration). If that folder is inside a checkout of the plan's
  repository, the path becomes repository-relative and opens a File tab
  through `onBrowseFile(path, path, true)` (`use-side-panel.ts:479`), which
  is the call ⌘K uses.
- **The File tab shows GitHub's copy, not the local file.** It reads from
  GitHub through the service (`ACT_KIND.PLANNING_FILE`), so a local edit not
  yet pushed will differ. Question 5 asks whether a path should open the
  local file in Dean's editor instead, or as well.

## 4. The bridge

### Processes

```
renderer (panel)  ──act: terminal.open/close/kill──▶  main (TerminalService)
      ▲                                                     │ utilityProcess.fork, once
      │  MessagePort (bytes, resize, acks)                  ▼
      └────────────────────────────────────────▶  pty host (node-pty)
```

- **The pty host is an Electron `utilityProcess`,** forked lazily by main
  when the first terminal opens. It owns node-pty, and this is VS Code's
  ptyHost design
  ([electronPtyHostStarter.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/electron-main/electronPtyHostStarter.ts)).
  A native crash in node-pty then ends the terminals, not the window or a
  live call, and the byte stream never runs on main's event loop. If the
  host dies, its PTY masters close, so the shells get SIGHUP and nothing is
  orphaned.
- **Main runs a `TerminalService`,** an `EffectDesktopService` in
  `compose-desktop.ts`. The utility process is acquired into its `Scope`, so
  stopping the service ends every shell. It has three act rows:
  `terminal.open { terminalId, planId, cwd?, cols, rows }`,
  `terminal.close { terminalId }` and `terminal.kill { terminalId }`. Act
  payloads and results carry ids, sizes and folders, never terminal bytes.
- **The bytes travel over a dedicated port.** For each open, main creates a
  `MessageChannelMain`, posts one end to the pty host, and posts the other to
  **the requesting panel's `webContents` alone** with
  `webContents.postMessage("terminal:port", { terminalId }, [port])`. The
  preload forwards the port into the page. The bridge manifest
  (`shared/bridge.ts`) gains one port entry kind. Output, input, resize and
  flow-control acks all travel on that port. They never touch `app:state`,
  which is broadcast to every window including the voice window
  (`main/app-state.ts:114-133`), never touch the act router, and never touch
  a trace.
- **Flow control** follows the xterm.js guide
  ([flow control](https://xtermjs.org/docs/guides/flowcontrol/)) with VS
  Code's constants: the renderer acks every 5,000 characters written through
  `write(data, cb)`. The host pauses the PTY above 100,000 unacked
  characters and resumes it below 5,000. This is tested with `yes` and ⌃C.

### The shell's environment

The spawn is `$SHELL -l` in the chosen folder, the same login shell
`run_on_mac` uses, with:

- `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Luke` and
  `TERM_PROGRAM_VERSION`;
- `LANG` defaulted to `en_US.UTF-8` when a Finder launch left it unset;
- the app's own variables removed: `ELECTRON_*`, `LUKE_*` and `SENTRY_*`,
  so a dev build's environment never leaks into the shell.

### AGENTS.md and the renderer guide

- **Runtime edge.** The pty host is a new process, so it is a new runtime
  edge. It goes on `runtimeEdges` in `tools/oxlint/anti-slop/effect-edges.json`,
  and AGENTS.md's "Where an Effect may run" names every edge, so one line
  must be added there. **AGENTS.md changes need Dean's explicit approval**
  (question 8).
- **No new raw async.** Nothing on `rawAsyncPrimitives` is needed: node-pty
  and `MessagePort` are event callbacks, wrapped in `Stream`s and `Scope`s.
- **A second channel in.** `apps/desktop/src/renderer/CLAUDE.md` says
  "Effects leave on `app:act` alone… There is no second write path." The
  port is a second channel. It carries a process's stdin bytes, not
  commands, and every lifecycle change is still an act. PR 2 states this
  exception in that guide (question 8).

### Secrets, telemetry, replay

- **Traces and counted events.** The terminal stream never enters a trace or
  a counted event. Acts are not traced automatically, and `recordAgentTrace`
  is voice-only. No product event is added in v1. If one is wanted later, it
  is a bare "terminal opened" count with no values.
- **Sentry.** No `console.*` or `report()` of terminal bytes, since Sentry
  breadcrumbs collect console messages. The pty host does not initialize
  Sentry.
- **Session replay.** The terminal's root carries `ph-no-capture`, like the
  Code and File tabs (`code-pane.tsx:351`, `file-tab.tsx:348`). Canvas
  recording is already off and all text is masked
  (`renderer/session-replay.ts:243-257`). The `ph-no-capture` root is what
  covers xterm's DOM fallback and its accessibility rows.
- **PRIVACY.md.** Line 579 promises recordings show "never your … terminal".
  It gains Luke's own Terminal tab in the list of parts left out whole, and
  a sentence saying the terminal's words stay on the Mac.
- **The voice window** never mounts a terminal and is never sent a port.
- **Fixtures.** The `verify.sh` evidence fixture types canned output, never
  a real shell's.

## 5. Agent integration (v2, optional)

**Reading.** Cursor syncs terminal output to files for its agent
([blog](https://cursor.com/blog/dynamic-context-discovery)), and Conductor
has `GetTerminalOutput`. Letting Luke's agents read the terminal at will
would be a new path for credentials into the model. The only carve-outs
today are `run_on_mac`'s output and MCP tool results (AGENTS.md, "Never").
The recommendation is **user-initiated only**: "Send to Luke" on a
selection, or on the last command's output once shell integration marks
commands. It attaches to the plan's conversation or an agent's composer as
a message would. That needs no AGENTS.md carve-out, because Dean chose what
went.

**Writing.** Agents never type into Dean's terminal. CONTRIBUTING.md:12-13
holds that Luke "never injects terminal input", and `run_on_mac` already
gives agents their own non-interactive way to run things.

**`run_on_mac` in a terminal tab.** It is not a PTY session: its output is
buffered and posted once at the end (`packages/host/src/compose-mac-commands.ts`),
and it already reads in the transcript's "On your Mac" row. Mirroring it into
a tab would need a streaming path for little gain. A cheap, user-initiated
alternative is "Run in terminal" on such a row: a new terminal with the
command typed but not run.

## 6. Prior art

| Product | What it does well | What Luke takes |
| --- | --- | --- |
| VS Code ([basics](https://code.visualstudio.com/docs/terminal/basics), [shell integration](https://code.visualstudio.com/docs/terminal/shell-integration)) | A ptyHost process; panel or editor-area terminals; injected shell integration (OSC 633/133) for exit-code gutter marks, ⌘↑/⌘↓ between commands and sticky scroll; `path:line:col` links; ⌘K clear; revive on restart | The pty host, links, flow control, marks (PR 9) |
| Cursor ([⌘K in terminal](https://docs.cursor.com/cmdk/terminal-cmdk)) | ⌘K in the terminal generates a command; the agent reads terminal output | Nothing for v1; "Send to Luke" is the consent-first version |
| Warp ([blocks](https://docs.warp.dev/terminal/blocks)) | Each command and its output is a block to copy, share or re-run | Command marks are the light version of blocks |
| Zed ([terminal](https://zed.dev/docs/terminal)) | Dock panel or center tab; ⌘-click on `path:42:10` and tracebacks | The placement comparison; links |
| Conductor ([shortcuts](https://www.conductor.build/docs/reference/keyboard-shortcuts), [big terminal](https://www.conductor.build/docs/reference/big-terminal-mode)) | ⌘J terminal panel; tabs per workspace; sessions survive restart; run scripts end with SIGTERM to the process group, then SIGKILL | ⌘J; per-plan terminals; the close grace |
| Ghostty, iTerm2 ([Ghostty](https://ghostty.org/docs/features/shell-integration), [iTerm2](https://iterm2.com/documentation-escape-codes.html)) | Automatic shell integration for bash/zsh/fish; jump to prompt; no close confirmation at a bare prompt; new terminals inherit the folder; OSC 7, 8 and 133 | Confirm only when a job runs; OSC 7 and 133 |
| Claude Code `/terminal-setup` ([docs](https://code.claude.com/docs/en/terminal-config)) | Writes the Shift+Enter newline binding for VS Code, Cursor and Zed | Shift+Enter built in |

What makes a terminal tab feel great in an IDE-like app, from the above:

- it opens instantly, in the right folder, from one chord;
- the app's chords still work inside it;
- it looks native to the app in both appearances;
- find works;
- paths and URLs are clickable;
- closing it never silently kills a running job;
- relaunching brings the layout back.

Shell integration (command marks, jump between commands, the folder
tracked) is what moves it from good to great. VS Code and Ghostty both
inject it automatically, so it is worth a PR of its own once the basics
land.

## 7. Risks

- **The first native node module in the app.** Today's `dependencies` are
  only `@sentry/electron` and `electron-updater`, and the builder config has
  `files: ["dist/**/*", …]`, `asar: true` and `npmRebuild: false`
  (`scripts/electron-builder-config.mjs:72-74`). node-pty must be kept out of
  the esbuild bundle, copied in, unpacked from asar (`asarUnpack`), and its
  `spawn-helper` signed through `mac.binaries`. node-pty is N-API, with
  darwin-arm64 prebuilds in the npm tarball, so `@electron/rebuild` is not
  needed. Two known traps:
  - 1.1.0 ships `spawn-helper` as mode 644, which breaks under pnpm with
    "posix_spawnp failed" ([#850](https://github.com/microsoft/node-pty/issues/850)).
    Pin 1.2.0-beta, or chmod in packaging.
  - A caller inside `app.asar.unpacked` makes node-pty's path rewrite double
    up ([#923](https://github.com/microsoft/node-pty/issues/923)).

  PR 1 does only this, with a packaging check that fails without it.
- **pnpm build scripts.** pnpm must be allowed to run node-pty's install
  script (`pnpm-workspace.yaml`'s built-dependency lists).
- **Linux CI.** Linux CI installs the dependency but never spawns a PTY. The
  host's protocol and flow control are tested against a fake PTY behind a
  `Context.Tag`. A real spawn is `verify.sh` evidence on a Mac (LUKE-159).
- **Hardened runtime.** The `.node` and `spawn-helper` must be signed with
  the app's Team ID; no `disable-library-validation` entitlement is added.
  An old report measured about 300 ms per spawn under hardened runtime
  ([#476](https://github.com/microsoft/node-pty/issues/476)). This is
  measured in PR 2.
- **Key handling.** IME composition, dead keys, ⌥ characters, and app chords
  versus shell chords. Each gets a test through the custom key handler's
  public seam.
- **Memory.** About 1–3 MB per terminal at 5,000 lines of scrollback. The
  scrollback is bounded; the count of shells is not.
- **WebGL context loss** when many windows or terminals are open. The
  fallback to the DOM renderer is automatic.

## 8. Stacked PR plan

Each PR is small, ships its own tests, and stacks on the one before. PRs 1–7
are v1. PRs 8–10 are v1.1 and v2, each only on Dean's say. Every UI PR's
body says CI could not verify the Mac UI and carries `verify.sh` evidence
from a Mac.

1. **`build(desktop): node-pty ships in the packaged app, unpacked and
   signed`.** The dependency (pinned), esbuild externals, `asarUnpack`,
   `mac.binaries`, pnpm build allowance, and a `verify-package` assertion
   that `pty.node` and an executable, signed `spawn-helper` sit in
   `app.asar.unpacked`. No behavior.
2. **`feat(desktop): a pty host process runs login shells, opened and
   closed by act, its bytes on a port of their own`.**
   - The `utilityProcess` entry and `TerminalService` in `compose-desktop.ts`.
   - Acts: `terminal.open`, `terminal.close` and `terminal.kill`.
   - The port entry in the preload bridge.
   - The environment scrub and flow control.
   - Tests: a fake PTY behind a `Context.Tag`, protocol and flow control,
     and the scrubbed environment as the shell would see it.
   - The edge line in `effect-edges.json`, and AGENTS.md if approved.
   - The renderer guide's port exception.
3. **`feat(desktop): a Terminal tab in the side panel, opened from the "+"`.**
   - The `{terminal}` kind (model, state, strip, content).
   - The lazy `terminal.js` bundle with fit, unicode11, and webgl with
     fallback.
   - The `--terminal-*` tokens, the theme, and key handling.
   - Close with confirmation, the exited state, `ph-no-capture`,
     PRIVACY.md, and the bundle-budget row.
4. **`feat(desktop): ⌘J shows the plan's terminal, and ⌘K opens, shows,
   and clears terminals`.** The `APP_COMMAND`, the View-menu item, the
   shortcuts page, palette rows, and the ⇧⌘T `drawsAgain` branch.
5. **`feat(desktop): ⌘F finds in a terminal's scrollback`.** The exported
   find bar with a pluggable source, and the search addon behind it.
6. **`feat(desktop): ⌘-click a URL or a repository path in a terminal`.**
   Web links, the path link provider, the folder read by `lsof`, and File
   tabs.
7. **`feat(desktop): a plan's terminals come back after relaunch, each a
   fresh shell in its last folder; Quit asks while a job runs`.**
8. *(v1.1)* **`feat(desktop): a new terminal opens in the folder its
   repository was last worked in on this Mac`.**
9. *(v1.1)* **`feat(desktop): shell integration marks each command`.**
   Injected for zsh and bash, the way VS Code and Ghostty do it: exit-code
   gutter marks, ⌘↑/⌘↓ between commands, and OSC 7 folder tracking.
10. *(v2)* **`feat(desktop): send a terminal selection or the last command's
    output to Luke`.**

PRs 3–7 touch `side-panel.tsx`, `use-side-panel.ts` and `command-palette.tsx`,
so they are one chain in one workspace. PR 1 and PR 2 can start in parallel
with the renderer work stubbed behind the act types.

## Questions for Dean

1. **Local shell only for v1** (no shell in an agent's sandbox)?
2. **A side-panel tab, many per plan**, rather than a column tab beside Plan
   and the agents?
3. **⌘J toggles the terminal** (Conductor's chord), and **⌘K stays the
   command palette** inside a terminal, with no ⌘K-to-clear?
4. **A new shell starts in the home folder** for v1, like `run_on_mac`,
   with "remember the repository's folder on this Mac" as PR 8?
5. **⌘-click on a repository path** opens a File tab, which shows GitHub's
   copy at the default branch. Should it instead open the local file in
   your editor, or offer both?
6. **Relaunch restores the tabs with fresh shells and no saved
   scrollback.** Or do you want VS Code-style scrollback revival, which
   writes terminal output to disk?
7. **No setting gates the Terminal tab.** It is your own shell, so the
   agents' `run_on_mac` switch doesn't govern it. Agreed?
8. **Approve one AGENTS.md line** naming the pty host as a runtime edge, and
   the renderer guide's exception for terminal bytes on a `MessagePort`?
9. **In v2, agents only see what you send them** ("Send to Luke"), and never
   type into your terminal. Agreed?
