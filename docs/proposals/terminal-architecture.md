# Terminal tab: system architecture

Status: design for review, 2026-10-14. It follows Dean's answers to the
proposal's questions (`docs/proposals/terminal-tab.md`). No code yet.

## Decisions this design builds on (Dean, 2026-10-14)

1. **One Terminal tab per coding agent's sandbox.**
   - The tab reuses the agent tab's own components rather than a new style:
     its look (`tabLook` AGENT, i.e. `AgentGlyph` plus the agent's name),
     `AgentRef`, and the agent tab's hover card (`AgentTabCard` on
     `HoverCard`).
   - "Terminal" stands as the tab's detail.
2. **Transport: Vercel's experimental interactive shell (`openInteractive`).**
   The documented `runCommand` path stays in the design as the fallback.
   Vercel is not asked first.
3. **Terminals connect on demand and disconnect when unused.** An open
   terminal never keeps a sandbox alive on its own (§3).
4. **A stopped sandbox resumes on a click,** "Resume and open a shell",
   never automatically.
5. **GitHub access stays live while a terminal is connected.**
6. **The agent is not told** a human was in its sandbox.
7. **Two AGENTS.md lines are approved,** added in the implementing PR (§7).
8. **⌘J** opens the current or most recent agent's terminal. **⌘K** stays the
   palette inside a terminal.

## 1. Components

| # | Component | Where | What it does |
| --- | --- | --- | --- |
| 1 | **Terminal tab** | `apps/desktop/src/renderer/planning/terminal-tab.tsx` (new) and a `{ terminal: agentId }` strip kind in `tab-strip-model.ts` | See below |
| 2 | **xterm surface** | the lazy bundle `renderer/terminal.js` | `@xterm/xterm` 6 with the fit, search, web-links, unicode11 and webgl addons (DOM rendering as the fallback). Themed from tokens; the `--terminal-*` ANSI tokens are new. App chords pass through to the window, and Shift+Enter sends a newline. |
| 3 | **Bridge** | `shared/messages/acts.ts`, `shared/bridge.ts`, preload | The acts `terminal.attach`, `detach`, `resume`, `list`, `create`, `rename` and `kill`, which carry ids, sizes and names, never bytes. One port entry kind: main posts a `MessagePort` to the panel that asked. |
| 4 | **Host terminal client** | `packages/host/src/terminal/` (new), run by desktop main | See below |
| 5 | **Terminal relay** | `apps/web/server/terminal/function.ts` (new Vercel Function, WebSocket) | See below |
| 6 | **Terminal routes** | `apps/web/server/routes/agents/terminals.ts`, `…/sandbox.ts` | Short JSON routes that list (`tmux ls -F`), create, rename (`@luke_title`), kill (`kill-session`) and resume (`Sandbox.get({ resume: true })`). |
| 7 | **Sandbox resolver** | `apps/web/server/hosted/session-sandboxes.ts` (grown) | Goes from conversation to `runtime_session_id` to the sandbox tagged `sessionId:<id>`, under the function's OIDC token. This is the REST lookup the sweep already makes. |
| 8 | **Vercel sandbox shell API** | `@vercel/sandbox`, pinned exactly | Session-level `openInteractive()` mints `{url, token}` for the controller's PTY WebSocket and does **not** resume. Behind one `InteractiveShell` `Context.Tag`; the fallback layer is `runCommand({ stdin: true, detached: true })` plus `writeStdin` plus `logs()` under `script -qfc`. |
| 9 | **tmux in the image** | `PREPARE_SCRIPT` in `agent-runtime/sandbox.ts` | One tmux session per terminal, which outlives any socket. |
| 10 | **Lease** | `packages/database/src/schemas/` + `models/sandbox-terminal-lease.ts` (new) | A row per agent conversation: `held_until`, `credential_at`. Written by the relay; read by the store hook and the sweep. |
| 11 | **Lifecycle hooks** | `apps/web/coder/hooks/store.ts`, `hosted/maintenance-sweep.ts` | The turn's-end stop skips a held sandbox, and the sweep stops a lapsed one (§3). |
| 12 | **GitHub credential refresher** | in the relay, through `coder-host` | While a terminal is connected, it renews the firewall token once it is 50 minutes old, using the same rule and policy shape as the store hook's `renewCredential`. |

More on the three components with the most moving parts:

- **The Terminal tab (1).**
  - *Strip:* it wears the agent tab's look: `AgentGlyph`, which shows the
    working mark while the turn runs, the agent's name, and the detail
    "Terminal". Its hover card is the agent tab's card plus a rule and a
    terminal line ("Connected · 3 shells").
  - *Bar:* `AgentRef`, the sandbox, and a connection pill.
  - *Body:* xterm.
  - *Right side:* the collapsible terminals list (spawn, rename, kill, a
    running dot), with the agent's state in the list's foot.
- **The host terminal client (4).**
  - *Connection:* one `ws` client per attached terminal, to
    `wss://tryluke.dev/api/terminal/sessions`, with the account bearer, as
    the voice socket does.
  - *Reconnect:* on a `Schedule`, and on `powerMonitor` resume.
  - *Flow control:* xterm write acks pause the socket.
  - *Delivery:* bytes go to the requesting `webContents` alone.
- **The terminal relay (5).**
  - *Auth:* the bearer, then that the agent belongs to the account's
    workspace.
  - *Attach:* resolve the sandbox, check its status, call `openInteractive()`
    and attach `tmux new -A`.
  - *Relay:* pipes frames both ways and logs none.
  - *Idle:* closes the socket when the lease lapses, and renews the lease on
    input.
  - *Duration:* `maxDuration` 800 s (1,800 s once that is out of beta).

Not in the design: anything on the planner's sandbox, any eve tool or hook
the terminal speaks through (it is not an agent tool), and anything that
tells the agent.

## 2. Diagram

```
 Mac ────────────────────────────────────────┐   tryluke.dev (Vercel Functions) ─────────────┐   Vercel Sandbox ──────────────────────────────┐
 │ renderer (panel window)                   │   │                                            │   │                                              │
 │  Terminal tab (agent look, AgentRef,      │   │  /api/terminal/sessions  (WebSocket relay)  │   │  Sandbox API  POST …/sessions/{id}/interactive│
 │  hover card) · xterm · terminals list     │   │   bearer → workspace check                  │──▶│        └─▶ {url, token}  (never leaves server)│
 │        ▲ MessagePort (bytes, resize, acks)│   │   resolve sandbox (tag sessionId:…, OIDC)   │   │  sandbox-controller PTY  ◀── wss (server-side) │
 │        │  acts (ids, sizes, names)        │   │   status (no resume) → openInteractive      │◀─▶│        └─▶ VM: tmux luke-<id> in ~/luke       │
 │ main · host terminal client ──────wss────────▶│   pipe frames · idle close · lease renew    │   │             processes · checkout · history off │
 │   bearer · Schedule reconnect · powerMonitor│   │   GitHub credential renew (≥50 min)         │──▶│  firewall: github.com ← Authorization injected │
 └───────────────────────────────────────────┘   │  /api/agents/:id/terminals · /sandbox/resume│   └──────────────────────────────────────────────┘
                                                 │  Postgres: sandbox_terminal_lease           │
                                                 │  coder store hook (turn end) · minute sweep │
                                                 └────────────────────────────────────────────┘
```

The show draws the same diagram, at https://stage-w2158.conductor.show/, §7.

## 3. Connection and idle rule, checked against the sandbox lifecycle

### The rule in plain words

> A terminal connects when you open its tab or switch to it. It disconnects
> when you close the tab, quit Luke, or go **5 minutes without typing**
> in that sandbox's terminals. Output doesn't count, so a chatty dev server
> can't hold it.
>
> Disconnecting doesn't end your shells. They keep running in the sandbox
> until the sandbox stops, and switching back or pressing a key reconnects
> to them.
>
> The sandbox stops on its normal schedule: at the end of the agent's turn,
> as today, but not while a terminal is connected. If no turn is running,
> it stops 2 minutes after the last terminal disconnects.

### Why N = 5 minutes (Dean, 2026-10-14)

- **Long enough** to glance at the plan or a test run and come back to the
  same connection.
- **Cheap to get wrong.** A longer read costs only a key press: the shells
  are still running in tmux, and reconnecting takes under a second.
- **Short enough** that a walk-away costs at most about 7 minutes of a held
  sandbox: 5 minutes idle plus the 2-minute grace, about $0.03 for the
  coder's 4 vCPU (§9).
- **No cap.** There is no limit on terminals, shells, or held sandboxes per
  account (Dean). The idle rule is the whole bound.
- **"Typing" means** any input frame: keys, paste, or a resize from the
  user's own window. Output, focus and showing the tab do not count. A tab
  left on screen overnight therefore disconnects after 5 minutes, as Dean
  asked.

### How it is enforced

The server enforces it, so a desktop bug or a crashed Mac cannot hold a
sandbox:

- **On input,** the relay sets `held_until = now + 5 min` in the lease
  row, writing at most once a minute.
- **The relay closes every socket of that sandbox** when `held_until`
  passes, with close code `4000 idle`. The desktop then shows
  "Disconnected after 5 minutes without typing" and does not reconnect
  until the user acts.
- **The lease lives in Postgres, not in the function,** so the 800 s
  function bound, a reconnect after sleep, or a second window all read one
  clock.

### The lifecycle, every stop path

| Situation | Today | With terminals |
| --- | --- | --- |
| Agent turn ends (completed, failed, cancelled, or the Stop button) | Store hook stops the sandbox | Stops it **unless** `held_until > now`. If held, the sweep stops it after the lease lapses |
| No turn running, terminal connected | (n/a) | Sandbox stays up while you type. 5 minutes after the last keystroke the socket closes; 2 minutes later the sweep stops it, if still no turn runs |
| Turn running, terminal idle-closes | Sandbox runs for the turn | Unchanged. The turn's end stops it, the lease having lapsed |
| Sandbox stopped, user opens the tab | (n/a) | "Resume and open a shell". Nothing resumes until the click (decision 4). The relay checks status first and mints with the **session-level** `openInteractive`, which never resumes |
| User clicks Resume | (n/a) | `Sandbox.get({ name, resume: true })` resumes the same named sandbox eve resumes for a turn; it gets the configured timeout. Then attach. Old tmux sessions are gone (processes do not survive a stop) |
| Agent's next turn while a terminal is connected | eve resumes if stopped | Sandbox already running. eve uses it, and the human's edits are in the files |
| Vercel's own timeout (24 h per session for the coder) | Stops it | Unchanged. The relay never extends past the lease |
| Sweep races a turn starting | (n/a) | The sweep checks the agent's turn status before stopping. If a turn started in between, eve's next tool call resumes the sandbox (`withResume`) |

## 4. Data flows

All bytes travel on `MessagePort` (renderer to main), then the WebSocket
(main to relay), then the WebSocket (relay to the controller PTY).
Everything else is an act or a JSON route.

**Connect** (tab opened or shown, never otherwise):

1. The renderer runs `terminal.attach { agentId, terminalId, cols, rows }`.
2. The host opens `wss://…/api/terminal/sessions?agent=…&terminal=…&cols=…&rows=…`
   with `Authorization: Bearer`.
3. The relay checks the bearer and that the agent belongs to the account's
   workspace (the checks `GET /api/agents/:id/messages` makes).
4. It resolves the sandbox name by tag and reads its status.
5. If the sandbox is stopped, it sends `{ state: "stopped" }` and closes.
6. Otherwise:
   1. `session.openInteractive()` returns `{url, token}`.
   2. `GET /health`.
   3. Upstream `wss`.
   4. A `start` frame: `tmux new-session -A -s luke-<terminalId> -c <checkout>`,
      with env `TERM=xterm-256color`, `COLORTERM=truecolor`, `HISTFILE=/dev/null`
      and `LANG`.
   5. `{ state: "attached" }`.
7. The host posts a `MessagePort` to the requesting panel, and xterm writes.

**Type:**

1. xterm `onData` goes over the port to the host, as a binary WebSocket
   frame to the relay, then as a binary frame to the PTY.
2. The relay stamps the input time, which renews the lease at most once a
   minute.
3. If a terminal is connected and the firewall token is 50 minutes old, the
   relay renews it (decision 5).

**Output:** the reverse path. Backpressure works at both ends:

- **In the relay,** it pauses reading upstream above 1 MB buffered
  (`bufferedAmount`).
- **On the Mac,** the host acks every 5,000 characters xterm has written and
  pauses the socket above 100,000 unacked characters. These are VS Code's
  constants.

**Resize:** fit computes `cols` and `rows`, debounced to 100 ms. The resize
goes over the port to the relay as `{ type: "resize" }`, then to the PTY's
`resize` frame. tmux uses `window-size latest`, so the newest client's size
wins.

**Disconnect:**

- **Tab closed:** `terminal.detach`, then the socket closes with 1000, the
  relay closes upstream, and the tmux session lives on.
- **Idle:** the relay closes with 4000. The renderer shows the disconnected
  card. A key or "Reconnect" runs **Connect** again.
- **Quit:** every socket closes. The lease lapses on its own.

**Resume** (stopped sandbox, user click):

1. `terminal.resume { agentId }` calls `POST /api/agents/:id/sandbox/resume`.
2. That runs `Sandbox.get({ name, resume: true })` and waits for `running`.
3. The tab shows "Resuming the sandbox from its snapshot…".
4. Then **Connect** runs, which starts a new shell.

**Reconnect after sleep, network loss, or the 800 s bound:**

1. The socket closes with 1006, 1001 or 1012.
2. If the tab is still open and the close was not `4000 idle`, the host
   reconnects on a `Schedule`: exponential from 0.5 s to 10 s, with jitter.
3. A `powerMonitor` `resume` triggers an immediate attempt.
4. **Connect** runs with the same `terminalId`, and `tmux new -A` reattaches
   to the same process and redraws the screen.
5. The tab shows "Reconnecting…" only after 1 s, so an 800 s rollover is
   usually invisible.
6. If the sandbox stopped meanwhile (lease lapsed during a long sleep),
   **Connect** answers `stopped` and the tab offers Resume.

## 5. Session replay masking

The recording already masks every text node (`maskTextSelector: "*"`),
asterisks the attributes that carry words, and records no canvas
(`captureCanvas: { recordCanvas: false }`, `renderer/session-replay.ts:243-257`).
On top of that, terminal text is left out whole:

- **The tab's root carries `ph-no-capture`,** like the Code and File tabs.
  That covers xterm's canvas, its DOM-renderer fallback, its accessibility
  rows and hidden textarea, the terminals list (names and commands), and
  the bar.
- **The hover card** already stands in `tooltip tooltip-card ph-no-capture`
  (`tooltip.tsx:276`).
- **A test pins it,** through the replay's public block selector: a
  terminal tab's root is blocked. This is the rule AGENTS.md names, "a new
  way of drawing words is what would change that".
- **PRIVACY.md's list** of parts left out whole gains the Terminal tab.

## 6. Where terminal output may and may not go

| May | Never |
| --- | --- |
| The xterm of the panel window that opened the terminal | A trace: the desktop devtrace, server spans (which carry only ids, byte counts and close codes), eve traces |
| The relay function's memory, in transit | A counted event or anything sent to PostHog |
| The desktop main process's memory, in transit to that panel | A fixture (the evidence fixture types canned output) |
| The sandbox: its processes, tmux's in-memory scrollback until the sandbox stops, and files the user writes there | `app:state` (broadcast to every window), an act's payload or answer, the voice window |
| The Mac clipboard, when the user copies | Sentry, `console.*`, the server's logs (the route logger is off; nothing logs a frame) |
| | The database (the lease holds times only), session replay, the agent's transcript or eve's stream (the terminal is not an eve tool) |

**The caveat stated plainly:** the agent can read the sandbox's files. So a
secret the user writes into a file there, or a command's output the user
saves, can reach the model on the agent's next read. That is the agent's
normal reach into its own sandbox, and PRIVACY.md will say so. Shell
history is turned off (`HISTFILE=/dev/null`), so what is typed does not
land in a file on its own, and tmux's scrollback is in memory only.

## 7. The two approved AGENTS.md lines

Both are added in PR 3, worded to the file's style.

- **"Never", beside the `run_on_mac` carve-out:** "A Terminal tab's bytes go
  only to the tab that opened them: through the terminal relay and the host
  to that panel's window, never into a trace, a counted event, a fixture,
  app state, or the voice window."
- **"Where an Effect may run":** `apps/web/server/terminal/function.ts`, the
  terminal relay, stood for a function instance's life as the voice service
  is. It also goes into `tools/oxlint/anti-slop/effect-edges.json`'s
  `runtimeEdges`.

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **Vercel changes or removes `openInteractive`** (the mint path, frames, token, health) | Medium. PR #222 calls it "experimental" and it is undocumented | High for the feature: no terminal attaches. None elsewhere: turns, files and plans are untouched | Only the relay speaks it; the desktop speaks Luke's own protocol, so a fix is one web deploy. The SDK is pinned and bumped deliberately. A preview-probe step opens a PTY and reads `exit` on every preview. The `runCommand` fallback layer sits behind the same `InteractiveShell` tag |
| **The relay's function limits:** 800 s close, WebSocket beta, instance pinning, cold start | Certain for the 800 s close; low for the rest | Low: a sub-second redraw | tmux reattaches. Reconnect on a `Schedule`, and the notice shows only after 1 s. Move to 1,800 s when it leaves beta |
| **Cost runaway:** forgotten tabs, chatty output, a crashed Mac | Low | Medium | Input-only 5-minute idle, enforced server-side by the relay's lease; the sweep stops a lapsed sandbox 2 minutes later. There is no cap (Dean); the idle rule bounds every terminal to about 7 minutes past its last keystroke. A daily count of held sandbox-hours per workspace goes to the server log (ids and durations only), so drift is visible |
| **Secrets typed into or printed in the terminal** | High: people paste tokens and `cat .env` | Medium | Bytes never reach a trace, event, fixture, app state, the voice window, replay or the database. History off; scrollback in memory only. PRIVACY.md states the agent reads sandbox files. The firewall still keeps the GitHub token's bytes out |
| **The terminal acts with the agent's GitHub write token** (decision 5) | Certain, by design | Medium: pushes are attributed to Luke's GitHub App | It is scoped to the agent's repository. Renewal happens only while connected, and the token lapses within 60 minutes after |
| **Multiple windows or devices on one sandbox** | Medium | Low | Each window attaches its own PTY to the same tmux session (multi-client); `window-size latest`; typing in any window renews the shared lease. The list refreshes on focus and every 5 s while shown. The PTY limit is unknown, so only the shown terminal of each tab attaches |
| **The agent and the human edit at once** | Medium | Medium: `.git/index.lock` collisions, the agent committing a half-done edit, a `git checkout` moving the agent's ground | The list's foot shows "Working…". No locking, and no telling the agent (decision 6). PRIVACY.md and the tab's empty state say the files are shared |
| **The sweep stops a sandbox as a turn starts** | Low | Low | The sweep checks turn status, and eve's `withResume` resumes on the next tool call |
| **A new word path escapes session replay** | Low | High | `ph-no-capture` on the root, a test on it, and canvas recording already off |
| **A reconnect storm after a network blip** (many windows) | Low | Low | Jittered backoff. One mint per attach is well under the 10,000-per-minute control-plane limit |

## 9. Costs

Rates are Pro in `iad1`, per Vercel's pricing pages as of 2026-10-14:
[sandbox](https://vercel.com/docs/sandbox/pricing),
[functions](https://vercel.com/docs/functions/usage-and-pricing),
[WebSockets](https://vercel.com/docs/functions/websockets),
[iad1](https://vercel.com/docs/pricing/regional-pricing/iad1).

### Unit rates

| Item | Rate | Per connected hour |
| --- | --- | --- |
| Coder sandbox memory (4 vCPU at 2 GB/vCPU = 8 GB, provisioned the whole time it runs) | $0.0212 / GB-h | **$0.170** |
| Coder sandbox active CPU, assuming 0.6 vCPU busy on average while a human works (idle shells cost nothing; a full 4-vCPU build costs $0.51/h) | $0.128 / vCPU-h | **$0.077** |
| Relay memory, worst case of one 2 GB instance per socket (Fluid shares an instance across sockets, so it is usually less) | $0.0106 / GB-h | $0.021 |
| Relay active CPU (piping frames, about 1% of a vCPU) | $0.128 / h | $0.001 |
| Relay invocations (one per connect plus one per 800 s rollover, about 5/h) | $0.60 / M | ≈ $0 |
| Transfer: 2–20 MB/h of terminal I/O | Fast Origin Transfer $0.06/GB; Fast Data Transfer and sandbox transfer are in Pro's 1 TB Flat Rate CDN, $0.15/GB beyond | ≤ $0.004 |

**Only extra sandbox hours count.** During an agent's turn the sandbox runs
anyway. The terminal costs only the time it holds a sandbox that would
otherwise be stopped. Relay hours count whenever a socket is open.

- **Held sandbox, extra hour:** about **$0.25/h**.
- **Relay:** about **$0.025/h** per connected terminal.
- **A walk-away tail** (5 min idle plus 2 min grace): about 7 minutes held, about **$0.03**.

### Worked monthly estimates (22 working days)

| Profile | Assumptions | Sandbox (extra) | Relay | Total |
| --- | --- | --- | --- | --- |
| **One heavy user** | In use 5 h/day, 3 h of it outside agent turns; 6 walk-aways a day, each held 7 min | (3 h + 6 × 7 min) × 22 ≈ 81 h × $0.25 = **$20.35** | (5 h + 6 × 5 min) × 22 = 121 h × $0.025 = **$3.03** | **≈ $23 / month**, or ≈ $35 if two agents' terminals are often connected at once |
| **A team of 5** | 1 heavy user as above, plus 4 regular users in use 1.5 h/day, 1 h of it outside turns, 3 walk-aways a day | $20.35 + 4 × ((1 h + 3 × 7 min) × 22 ≈ 29.7 h × $0.25 = $7.43) = **$50.07** | $3.03 + 4 × ((1.5 h + 3 × 5 min) × 22 = 38.5 h × $0.025 = $0.96) = **$6.88** | **≈ $57 / month**, ≈ $75 with parallel agents |

This model counts each walk-away's idle tail explicitly. At the earlier 15
minutes, the same model gives about $29 for the heavy user and $75 for the
team, so the 5-minute rule saves about a fifth.

**The bound.** There is no cap. Each connected terminal can hold its
sandbox at most 7 minutes past the last keystroke, so an account's held
sandboxes are only those someone typed into in the last 5 minutes, plus the
2-minute grace. Pro's $20 monthly credit covers most of the heavy user.

## 10. PR breakdown

Sizes are lines changed, tests included: S < 250, M 250–600, L 600–1,000.
PRs stack in this order. 1–3 are web, 4 is host, and 5–9 are desktop and
one chain, since they touch `side-panel.tsx`, `use-side-panel.ts` and
`command-palette.tsx`.

| # | PR | Size | Tests |
| --- | --- | --- | --- |
| 1 | **`feat(web): a terminal's lease holds its agent's sandbox: the turn's end skips its stop, and the sweep stops it once the lease lapses`.** Schema, migration, model and its sibling test; the store-hook condition; the sweep step with the 2-minute grace and the turn check | M (~450) | `test:store` on Postgres: lease renew and lapse; the hook skips a held sandbox; the sweep stops a lapsed one and leaves a running turn's alone; one account cannot read another's lease |
| 2 | **`feat(web): the sandbox image carries tmux, and an agent's terminals are listed, named, killed, and its sandbox resumed by route`.** `PREPARE_SCRIPT` and its digest; the resolver; `@vercel/sandbox` pinned; the routes | M (~550) | Routes against a fake `SandboxShell` layer: ownership, the stopped status, and resume only on its route |
| 3 | **`feat(web): a WebSocket relay attaches a terminal to its agent's sandbox, closes it after 5 idle minutes, and keeps the GitHub token fresh while it is used`.** Function, duration, protocol, session-level mint (never resume), `tmux new -A`, lease writes, idle close, credential renewal, no frame logging, the probe step, **the two AGENTS.md lines**, and the edge row | L (~850) | A fake upstream PTY behind `InteractiveShell`; `TestClock` for idle close and renewal; a stopped sandbox answers `stopped` |
| 4 | **`feat(host): the desktop attaches, reconnects, and detaches terminals, their bytes on a port to the panel that asked`.** The `ws` client, `Schedule` reconnect, `powerMonitor`, flow control, acts, the port bridge entry, and the renderer guide's note | M (~550) | The client against a fake relay: reconnect after drop and wake, no reconnect after `4000 idle`, bytes only to the asking window |
| 5 | **`feat(desktop): the xterm surface, themed from the window's tokens, in a lazy bundle`.** The `terminal.js` bundle, the `--terminal-*` tokens with light restatements, key handling, and the bundle-budget row | M (~400) | The key handler through its public seam: app chords pass through, Shift+Enter, ⌥ characters |
| 6 | **`feat(desktop): a Terminal tab per coding agent, in the agent tab's look and card, with its connection states`.** The `{terminal}` kind; `tabLook` and the card; the bar with `AgentRef`; connecting, disconnected, stopped (Resume), resuming and reconnecting; `ph-no-capture`; PRIVACY.md | L (~800) | Model and tab-look tests; state rendering per connection state; the replay block on the root |
| 7 | **`feat(desktop): the terminals list beside a Terminal tab: spawn, rename, kill, the running mark, the agent's state, fold`** | M (~450) | Rename and kill through the acts; the running dot from `pane_current_command` |
| 8 | **`feat(desktop): open an agent's terminal from its tab's chip, the "+", the summary, ⌘K, and ⌘J; ⇧⌘T brings it back`** | M (~350) | Entries per agent; ⌘J picks the current, then the most recent; reopen |
| 9 | **`feat(desktop): ⌘F finds in a terminal's scrollback`.** The exported find bar with a pluggable source, over the search addon | S (~200) | Find and tally through the bar's public seam |
| (later) | **`feat(web): the runCommand fallback behind the relay`.** Only if `openInteractive` breaks | M (~450) | The same relay tests against the fallback layer |

**Totals:** about 4,600 lines over 9 PRs. Dropping the per-account cap removes its check and tests from PR 3, about 50 lines.

**Parallel work:**
- Chain A is 1 → 2 → 3, on the web.
- Chain B is 5 → 6 → 7 → 8 → 9, on the desktop. It can start with 5 at
  once.
- PR 4 joins them; 6 needs it for real data and stubs the act types until
  then.

## 11. The host contract (PR 4), fixed for the desktop PRs

The renderer reaches terminals through acts, which carry ids, sizes and
names, never bytes, and through one `MessagePort` per attached shell, which
carries only bytes and connection state. Field names follow the service's
wire (`@sidecar/hosted/terminal-wire`): a shell is `id` and `title`.

### Vocabulary (`@sidecar/hosted/terminal-wire`)

- `SANDBOX_STATE`: `running` | `stopped` | `starting`.
  - `starting` covers an agent that hasn't opened its sandbox yet (its
    first command opens it) and a sandbox still coming up.
- `TerminalSummary`: `{ id, title, command, cwd, running }`.
  - `title` is the developer's name for the shell, or its foreground command
    when it has none.
  - `running` is true when something other than the shell at its prompt is
    in the foreground.
- `TerminalsAnswer`: `{ sandbox: SandboxState, terminals: TerminalSummary[] }`,
  oldest first. It is always empty unless the sandbox is `running`.

### Acts (renderer → main, `ACT_KIND.TERMINAL_*`)

| Act | Payload | Answer |
| --- | --- | --- |
| `terminal.list` | `{ agentId }` | `TerminalsAnswer`. Never wakes a stopped sandbox |
| `terminal.create` | `{ agentId, title? }` | `{ terminal: TerminalSummary }` |
| `terminal.rename` | `{ agentId, terminalId, title }` | `TerminalsAnswer` after the change |
| `terminal.kill` | `{ agentId, terminalId }` | `TerminalsAnswer` after the change |
| `terminal.resume` | `{ agentId }` | `{ sandbox: SandboxState }`. The only path that wakes a stopped sandbox, sent on the developer's click |
| `terminal.attach` | `{ agentId, terminalId, cols, rows }` | `{}` straight away, before the connection opens. Main then posts the port (below). Attaching again from the same window replaces that window's port, and the old one closes |
| `terminal.detach` | `{ agentId, terminalId }` | `{}`. Closing the port does the same |

**Refusals.** A refusal the tab acts on comes back as an answer,
`{ refused }`, with `refused` one of these (`TERMINAL_REFUSAL`):

- `sandbox-stopped`: `create` in a stopped sandbox.
- `agent-not-ready`: `create` before the agent opened its sandbox.
- `not-found`: no such agent or shell, or another workspace's.
- `gone`: an archived agent.

So `list`, `rename` and `kill` answer `TerminalsAnswer | { refused }`,
`create` answers `{ terminal } | { refused }`, and `resume` answers
`{ sandbox } | { refused }`. An outage (the service or Vercel could not be
reached, so the caller may retry) is the act's own refusal sentence instead.

### The port (`terminal:port`)

After `terminal.attach`, main posts **one `MessagePort`** to the asking
panel's `webContents` alone, with `{ agentId, terminalId }`, through the
preload's port entry. Every message on it is an object.

| Direction | Message |
| --- | --- |
| main → renderer | `{ type: "output", data: Uint8Array }`: PTY output, to `xterm.write(data, ack)` |
| main → renderer | `{ type: "state", state, code? }`: the connection state, below |
| renderer → main | `{ type: "input", data: string }`: xterm's `onData` |
| renderer → main | `{ type: "resize", cols, rows }`: the fit addon, debounced to 100 ms |
| renderer → main | `{ type: "ack", chars }`: sent every 5,000 characters xterm has written. Main pauses the socket above 100,000 unacked |

**Connection states** (`TERMINAL_CONNECTION`, the `state` message). The
first message on a new port is `connecting`.

| `state` | Meaning | Host reconnects? | What the renderer does |
| --- | --- | --- | --- |
| `connecting` | The socket is opening | (n/a) | Nothing visible for 1 s |
| `attached` | Connected, and tmux reattached to the shell | (n/a) | Clears any bar or line |
| `reconnecting` | The socket dropped: sleep, a network change, or the 800 s bound | **Yes**, on a `Schedule`, and at once on `powerMonitor` resume | The slim "Connection lost. Reconnecting…" bar after 1 s |
| `idle` | Closed after 5 minutes without typing (close 4000) | No | The inline `[Disconnected after 5 min without typing …]` line. A key press sends `terminal.attach` again |
| `stopped` | The sandbox is stopped | No | The "Sandbox stopped · Resume sandbox ⏎" bar. The click sends `terminal.resume`, then `terminal.attach` |
| `starting` | The agent hasn't opened its sandbox yet | **Yes**: the host re-asks every 5 s while the port is open, and posts `attached` once it exists | The "Waiting for the agent to open its sandbox…" bar |
| `exited` | The shell ended (`code` carries its exit status). The tmux session is gone | No | The inline `[Process exited with code N …]` line. A key press sends `terminal.create`, then `terminal.attach` |
| `gone` | The agent was archived, or the shell was killed elsewhere | No | Drops the shell (or closes the tab, for an archived agent) |

"Resuming" is the renderer's own state, between sending `terminal.resume`
and its answer. No port carries it.

### What the renderer reads for the picker and the tab chrome

- **Sandbox state per agent:** `terminal.list { agentId }` → `sandbox`.
  The answer is `starting` for an agent with no sandbox yet.
- **Whether the agent is working:** the `CodingAgentSummary.status` the
  renderer already holds (`agentStillWriting`).
- **Picker rows:** "Working · sandbox running" and "Idle · sandbox stopped"
  are those two put together.
- **Refreshing the list:** the renderer re-reads it while the tab is shown,
  on focus and every 5 s, and after every `rename`, `kill` and `create`
  answer.
