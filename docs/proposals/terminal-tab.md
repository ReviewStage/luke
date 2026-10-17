# Proposal: a Terminal tab into the coding agent's sandbox

Status: decided by Dean on 2026-10-14. The architecture is
`docs/proposals/terminal-architecture.md`. Where the two differ, the
architecture's text stands.

## Decisions (Dean, 2026-10-14)

1. **One Terminal tab per coding agent's sandbox.** It reuses the agent tab's
   components: its look (`tabLook` AGENT, i.e. `AgentGlyph` and the agent's
   name), `AgentRef`, and the agent tab's hover card. "Terminal" is the
   tab's detail.
2. **Vercel's experimental `openInteractive` is the transport,** with the
   documented `runCommand` path kept as the fallback. Vercel is not asked
   first.
3. **Terminals connect on demand and disconnect when unused.** This
   replaces §3's "hold for 15 minutes after the last detach". The rule
   (architecture §3):
   - a terminal connects when its tab is opened or shown;
   - it disconnects when the tab closes, or after 5 minutes without typing
     (output doesn't count). Dean shortened this from 15 minutes on
     2026-10-14;
   - the sandbox then stops on its normal schedule: at the turn's end, or 2
     minutes after the last terminal disconnects when no turn runs;
   - there is no cap on terminals, shells, or held sandboxes per account.
     The idle rule is the whole bound: about 7 minutes held after the last
     keystroke.
4. **A stopped sandbox resumes only on a click** ("Resume and open a
   shell").
5. **GitHub access stays live while a terminal is connected.**
6. **The agent is not told** a human was in its sandbox. That is dropped
   from the plan.
7. **The two AGENTS.md lines are approved:** terminal output goes only to
   the tab that opened it, and the relay function is a runtime edge. They
   are added in the implementing PR.
8. **⌘J** opens the current or most recent agent's terminal, and ⌘K stays
   the palette inside it.

## New terminal: the rules (round 3, approved)

Dean approved round 3 on 2026-10-14 ("Terminal - looks good to me"). Desktop
PRs 5–9 build these rules and the states below exactly as the show draws
them.

A terminal belongs to **one coding agent's sandbox**, never to the plan. Two
commands open one:

- **⌘J ("show terminal")** goes to an existing Terminal tab.
- **New terminal** adds a shell. It is reached from ⌘K, from the panel's
  "+", and from a list's "+".

Each command first decides *which agent*:

| Where you are | ⌘J (show terminal) | New terminal (⌘K, "+") |
| --- | --- | --- |
| An agent's tab, its Changes tab, or its Terminal tab | That agent's Terminal tab | A new shell in that agent's sandbox |
| Anywhere else (plan, Board, Code, a file), one agent on the plan | That agent's Terminal tab | A new shell in that agent's sandbox |
| Anywhere else, several agents, one used before | The last-used agent's Terminal tab | The picker, last-used agent preselected |
| Anywhere else, several agents, none used yet | The picker | The picker |
| No agent on the plan | The picker's empty state: "Start a coding agent" | The same |

**The picker.** The command palette asks "New terminal in which agent's
sandbox?". Each row is the agent as `AgentRef` draws it (glyph and name),
with its state: "Working · sandbox running", "Idle · sandbox stopped". The
panel's "+" lists the same agents under "Terminal".

**The list's "+"** always adds a shell to *this* agent's sandbox. The list
never switches agent. To reach another agent, use "+", ⌘K, or that agent's
own "Terminal" chip, which always opens its own terminal.

**When the chosen sandbox isn't simply running:**

| The sandbox is | The tab shows |
| --- | --- |
| Running | A shell, connected |
| Stopped | The last scrollback, dimmed, under a slim bar: "Sandbox stopped. · ~5 s · **Resume sandbox ⏎**". It resumes only on that click or key |
| Still starting (the agent hasn't run its first command) | "Waiting for the agent to open its sandbox…", then it connects. That is the agent's own start, not a resume |
| Gone (agent archived or retired) | Not offered anywhere. An open tab closes, like its Changes tab |

**Ownership in the chrome.** The tab is labelled "Terminal", with the
agent's name as its detail and the agent's glyph as its icon (the working
mark while it works). The bar names the agent with `AgentRef`. The hover
card is the agent tab's card, plus "Terminal in this agent's sandbox ·
3 shells". The plan appears only as context.

**When the agent's run changes:**

- **The turn finishes, fails, or is cancelled.** If a terminal is
  connected, nothing changes and the shells keep running. Otherwise the
  sandbox stops as today, and the tab shows the stopped bar.
- **A new turn starts and eve resumes the sandbox.** A shown tab connects by
  itself, because the agent started the sandbox, not the terminal. Shells
  from before the stop are gone, so it opens a new one.
- **The agent is never told** a human was there.

**States, the way terminals say them.**

- A state that needs nothing from you is one dim inline line:
  - `[Disconnected after 5 min without typing. Press any key to reconnect.]`
  - `[Process exited with code 0. Press any key for a new shell …]`
- A state with an action is one slim mono bar with one text action and its
  key:
  - "Connection lost. Reconnecting… · **Retry now ⏎**"
  - "Sandbox stopped. · ~5 s · **Resume sandbox ⏎**"
  - "Resuming sandbox… restoring snapshot · 3 s"
- The scrollback stays, dimmed. There are no cards, icons, or pills.

## What Dean asked for

Dean first asked for "a terminal tab". He then dropped the local-shell
version, because a shell on the Mac would be cut off from the coding agent:
there is no file sync between the two. What he wants instead:

- A terminal **into the cloud sandbox**.
- It lives as a tab in the right (side) panel, and several such tabs can be
  open.
- Each tab has a **collapsible sidebar on its right**, like the file tree in
  the File tab, listing that tab's terminals. You can spawn more there, so
  one tab can hold several shells.

## Summary of the recommendation

- **One Terminal tab per coding agent.** It is attached to that agent's own
  sandbox, which holds the checkout the agent edits. It opens from the agent
  tab's chips (next to Changes), the panel's "+", the plan summary, ⌘K, and
  ⌘J.
- **The transport is a WebSocket relay on Luke's service,** built like the
  voice function. The relay calls `@vercel/sandbox`'s `openInteractive()`
  PTY under the deployment's own Vercel credentials, so nothing that opens
  the sandbox ever reaches the Mac.
- **Every shell is a tmux session inside the sandbox.** A dropped socket, the
  relay's 13-minute bound, a laptop sleeping, or a relaunch all reattach to
  the same running process.
- **A connected terminal holds the sandbox,** but only while it is used.
  While one is connected, the turn's-end stop is skipped. A terminal
  disconnects after 5 minutes without typing, and with no turn running the
  sweep stops the sandbox 2 minutes later. There is no cap.
- **Terminal bytes never land anywhere.** They are not stored and never reach
  a trace, an event, app state, or the voice window. GitHub reach is
  exactly the agent's, through the same firewall.

## 1. Which sandbox a tab attaches to

There are three candidates:

| Sandbox | What it holds | Fit |
| --- | --- | --- |
| **A coding agent's** (`WRITE_FULL_EAGER`) | The full clone the agent edits, its branch, its uncommitted work, 4 vCPU. It is stopped at each turn's end (`apps/web/server/hosted/agent-runtime/sandbox.ts:78-86`) and resumed from its snapshot. | **Recommended.** This is the "not disjoint from the coding agent" Dean asked for. The tab is the agent's, like its Changes tab. |
| The planner's (`READ_SHALLOW_LAZY`) | A shallow read clone opened by the first `run_in_repository`. eve's 30-minute default timeout stops it. | Later. It only reads, it is per plan rather than per agent, and holding it open would keep a voice call's sandbox running. |
| A picker | Either of the above | Not needed. The agent *is* the choice, and the tab is named after it. |

### The model

- **The tab kind.** Add `{ terminal: agentId }` as a new strip-tab kind
  (`renderer/planning/tab-strip-model.ts`). It is keyed and persisted exactly
  like `{ changes: agentId }`:
  - it gets its own guard, `sameTab`, and `tabKey` branch;
  - it is kept per plan under a new optional `terminals` field in
    `luke.sidePanel`;
  - it is drawn only while its agent belongs to the plan (the
    `drawsChanges` pattern, `use-side-panel.ts:867`).
- **The label.** "Terminal: Codex", in the shape of `changesLabelOf`
  (`changes-model.ts:85-90`), with the same hover card naming the agent
  (#2439).
- **Several tabs.** Several agents give several Terminal tabs.
- **Workers.** A worker subagent shares its parent's sandbox (`PARENT`), so
  it gets no tab of its own.

### How it opens

- **The agent tab:** a "Terminal" chip next to "Changes" at the composer's
  foot (`planning/agent-published.tsx:155`).
- **The panel's "+" and the plan summary:** a "Terminals" section with one
  row per agent and its sandbox state. This is built the way
  `changesOffers()` feeds `panelEntries()` (`desktop/side-panel.tsx:278,
  400-410`).
- **⌘K:** "Terminal: Codex" rows reuse those entries (the #2523 pattern),
  plus "New terminal in Codex's sandbox" and "Clear terminal". ⌘K stays the
  palette even when a terminal has focus.
- **⌘J, a new chord** (Conductor's chord for its terminal; ⌘J is free in
  `shared/shortcuts.ts`). It shows the terminal of the agent in focus, or
  the most recently used one. Pressed inside a terminal, it hides the
  panel.
- **⇧⌘T** reopens a closed Terminal tab. Its shells are still running in
  tmux unless the sandbox stopped in between.

## 2. The transport

### Option A (recommended): a WebSocket relay on Luke's service, over `openInteractive()`

```
desktop main (host)  ──wss, account bearer──▶  /api/terminal/sessions  (Vercel Function, WebSocket)
                                                   │ resolve: conversation → eve session → sandbox (tag sessionId:…)
                                                   │ Sandbox.get(name, resume) → openInteractive() → {url, token}
                                                   ▼
                                     sandbox-controller PTY  ──▶  tmux new-session -A -s luke-<terminalId>
```

**Is it supported?** `openInteractive()` is real and is what
`sandbox connect` uses. It is in the SDK eve bundles (3.3.0,
`eve/dist/src/compiled/@vercel/sandbox/sandbox.d.ts:803-815`) and in
`@vercel/sandbox` 3.8.0.

- It is a `POST /v2/sandboxes/sessions/{id}/interactive` that answers
  `{url, token}`.
- It resumes a stopped sandbox first (`withResume`).
- The PTY runs in Vercel's sandbox-controller, not inside the VM (vercel/sandbox
  PR #222).

**The wire protocol** comes from the CLI
([interactive-shell.ts](https://github.com/vercel/sandbox/blob/main/packages/sandbox/src/interactive-shell/interactive-shell.ts)):

1. `GET /health`.
2. `wss://…?token=`.
3. A JSON `start` frame: `{command, args, env, cwd, cols, rows}`.
4. Binary stdin and stdout frames.
5. A JSON `resize` frame, and an `exit {code}` frame from the server.

**Auth.**

- **Desktop to Luke's service:** the desktop opens the socket with the
  account's bearer, exactly as the voice socket does
  (`apps/web/server/voice/service.ts:259-261, 467`).
- **The relay's own checks:** the conversation must be a coding agent's, in
  the account's workspace. These are the same checks
  `GET /api/agents/:id/messages` makes.
- **Finding the sandbox:** the relay goes from the conversation's
  `runtime_session_id` to the sandbox tagged `sessionId:<id>`. This uses the
  REST lookup `session-sandboxes.ts:145-178` already uses, under the
  function's OIDC token.
- **Nothing reaches the Mac:** the interactive `{url, token}` and the OIDC
  token stay on the server. That keeps PRIVACY.md's "nothing on your Mac
  holds or is handed" a provider credential true (`PRIVACY.md:649-651`),
  and keeps AGENTS.md's "never a credential in a Gateway answer" true.

**Hosting.** Vercel Functions take WebSockets: they are in beta on all plans
([docs](https://vercel.com/docs/functions/websockets)), require Fluid compute,
and pin each connection to one instance. Luke already runs one: the voice
function, a standalone `http.Server` that Vercel upgrades, with
`maxDuration` 800 s (`function-durations.ts:9, 79`). The relay is a sibling
function built the same way.

**Limits, and how they are met.**

- **Duration.** "WebSocket connections close when a Vercel Function reaches
  its maximum duration." That is 800 s on Pro, or 1,800 s in beta
  ([limits](https://vercel.com/docs/functions/limitations)). The desktop
  reconnects on close with a `Schedule` backoff. Because the shell is a tmux
  session, the reconnect reattaches to the same process and screen.
- **Process lifetime.** Whether the controller kills the process when the
  socket closes is undocumented. tmux makes it not matter: the client dies,
  the session lives.
- **Concurrent PTYs per sandbox.** Unknown. Only the *shown* terminal of each
  open tab is attached; the others keep running in tmux, detached. That
  makes one PTY per open Terminal tab. If Vercel's limit turns out low, one
  PTY per tab can switch tmux sessions instead (`switch-client`).
- **Control-plane rate.** 10,000 requests per minute on Pro. It is spent per
  attach (one `openInteractive`), never per keystroke.

**Latency.** Sandboxes run in `iad1` today ([pricing](https://vercel.com/docs/vercel-sandbox/pricing) lists that region alone); the relay runs beside them. A keystroke's echo
costs the Mac-to-`iad1` round trip (about 70 ms from San Francisco), plus a
few milliseconds for the relay hop. That is the same as `sandbox connect` or
SSH to us-east, and fine for a shell. Typing ahead stays local in xterm.

**Cost.**

- **The function** is billed on Active CPU, so an idle socket costs almost
  nothing, but provisioned memory accrues while it is held.
- **The sandbox** is the real cost. A held 4-vCPU, 8 GB coder sandbox is
  about $0.17 per hour in memory, plus active CPU
  ([pricing](https://vercel.com/docs/vercel-sandbox/pricing)).

### Option B: hand the Mac `{url, token}` and connect directly

This would remove the hop and the 800 s bound, at the cost of two problems.
The token's scope and lifetime are undocumented, and the Mac would hold a
credential that opens a shell in the sandbox. That is a sandbox credential
on the device, so it is refused unless Dean rules otherwise.

### Option C: the documented `runCommand` with stdin and a PTY wrapper

`runCommand({ detached, stdin: true })` plus `writeStdin` arrived in
`@vercel/sandbox` 3.7.0 (2026-10-12), and it is documented. As a terminal it
is poor:

- **Every write is a request against the rate limit,** at roughly 50–200 ms
  each. A write "fails after 30 seconds if the process isn't reading".
- **It is a pipe, not a PTY.** It needs `script -qfc` or Python's `pty`
  module to fake one, and resize only works through an `stty` side channel.
- **Reconnecting to the log stream replays everything** from the start.

It stays as the **fallback behind the same relay protocol**: if Vercel
removes or breaks `openInteractive`, the desktop changes nothing and the
relay switches.

### What breaks if Vercel changes `openInteractive`

PR #222 calls the endpoint "as of now experimental", and it is not on the
SDK reference page.

**What could change:**

- the mint path, or its `{url, token}` answer;
- the frame protocol (start, resize, exit);
- the health route;
- the token's lifetime;
- its resume behavior.

**Blast radius:** every terminal fails to attach or to type. Nothing else
breaks: no agent turn, no file, no plan. The relay is the only code that
speaks Vercel's protocol, and the desktop speaks Luke's own, so a fix is one
web deploy and no desktop release.

**Mitigations:**

- **Use the SDK rather than hand-rolling.** Call `openInteractive()` through
  `@vercel/sandbox`, pinned exactly and bumped deliberately, as `effect` is.
- **Probe every preview deploy.** `apps/web/scripts/preview-probe.ts` already
  probes deploys; it gains one step that opens a PTY, echoes, and reads the
  `exit` frame.
- **Keep the fallback.** Option C sits behind the relay.

**Ask Vercel (recommended).** Ask, before PR 3 ships:

1. Is `openInteractive` supported for production use, and will it be
   documented?
2. What are the token's scope and lifetime, and can it be reused?
3. Does the shell survive a socket close?
4. How many concurrent PTYs can one sandbox hold?
5. Is a longer maximum duration coming for WebSocket functions?

## 3. Lifecycle

### Today

- The coder's store hook stops the sandbox on `turn.completed`, `failed`,
  or `cancelled` (`apps/web/coder/hooks/store.ts:115-141`; #2403
  `b70614d9`, "one sandbox lifecycle").
- Nothing else on the server stops a running sandbox. The sweep only deletes
  purged ones (`session-sandboxes.ts:55-59`), and an abandoned turn writes a
  failure but never stops anything.
- A stopped sandbox resumes from its snapshot with its files intact. Its
  processes are lost.

### Decision: a connected terminal holds the sandbox, disconnecting after 5 minutes without typing

This section is superseded by the architecture's §3; it is kept updated to
match.

**A lease.** A new table, `sandbox_terminal_lease`, holds
`(conversation_id PK, held_until)`.

- On input (typing, paste, or resize; output doesn't count), the relay
  renews the lease to now + 5 minutes, writing at most once a minute. When
  it lapses, the relay closes the terminal's socket.
- It also calls `extendTimeout` so the sandbox's own clock stays ahead. The
  coder already opens at the platform's 24-hour maximum per session.

**The turn's end.** The store hook skips its stop while `held_until > now`.
This is one new condition beside `stopsAtTurnEnd`. The agent's own Stop
cancels the turn as today and leaves the sandbox up while a terminal holds
it.

**The idle stop.** Each minute, the sweep stops the sandbox of every lapsed
lease whose agent has no running turn, 2 minutes after it lapsed, then
deletes the lease. This is one more step in `maintenance-sweep.ts`, beside
`sweepSandboxes`. A walk-away holds the sandbox about 7 minutes (5 idle plus
2 grace), about $0.03. There is no per-account cap.

**Opening a terminal on a stopped sandbox.** The tab says so, with a
button: "Codex's sandbox is stopped. Its files are as the agent left them.
[Resume and open a shell]". The resume is `Sandbox.get({ name, resume: true })`,
the same named sandbox eve resumes for the agent's next turn. So the agent's
next turn finds the sandbox running, with the human's changes in it.

- **Explicit, not automatic,** because a resume spends money and a few
  seconds. Snapshot restore is under 1 s at p75
  ([blog](https://vercel.com/blog/optimizing-vercel-sandbox-snapshots)); the
  full resume time is not published. The show draws the "resuming" state.
- **Reopening a tab** whose sandbox is still running attaches straight away.

### Concurrency with an agent turn

- **One filesystem.** The agent's tools and the human's shells see the same
  checkout and branch. An edit in the terminal is what the agent reads next,
  and `git` state is shared. That is the point, and also the risk: a
  `git checkout` mid-turn moves the agent's ground.
- **Separate processes.** eve's `sandbox.run` spawns its own processes, the
  human's live in tmux, and nothing pauses either.
- **No locking.** Locking a shell against an agent would make the feature
  useless during the turns it's most wanted for.
- **What the UI shows.** The sidebar's foot shows the agent's state, read
  from `CodingAgentSummary.status` (`agentStillWriting`,
  `coding-agent-model.ts:147`): "**Codex is working.** It shares these
  files; your shells don't pause it", with the working glyph. Idle, it reads
  "Disconnects 5 min after you last type. Shells run until the sandbox
  stops".
- **The agent is not told** that a human was in the sandbox (question 6).

## 4. Secrets

### The GitHub token at the firewall

- The coder's token is set by eve's `authenticateGitHub(…, { delivery:
  "firewall" })`. The policy is
  `{ allow: { "*": [], "github.com": [transform: authorization], "api.github.com": [same] } }`.
- The firewall terminates TLS for those two hosts alone and injects the
  header on egress. The token "never enters the sandbox's filesystem or
  environment" (`apps/web/coder/sandbox.ts:22-28`;
  [firewall](https://vercel.com/docs/sandbox/concepts/firewall)).

**What follows for the terminal:**

- **It cannot read the token any more than the agent can.** The shell's
  `curl` and `git` go through the same firewall, get the same header
  injected, and never see its bytes. There is no new egress path: the
  network policy is the sandbox's own, and the interactive PTY runs
  processes inside that same VM.
- **What it gains is agency, not access.** During a turn, a human in the
  shell can push or call GitHub's API as the agent can, as Luke's GitHub App
  installation, with contents and pull-request write on that repository.
- **Outside a turn, access lapses.** The token renews only on an agent's
  `step.started` once it is 50 minutes old (`store.ts:73-100`), so a
  terminal on an idle sandbox can push only until the last renewed token
  expires, within the hour. Question 5 asks whether the relay should renew
  it while a terminal is attached, for parity, or leave it to lapse.
- **The relay never handles the token,** and nor does the desktop.

### Terminal bytes

The bytes never enter traces, events, app state, or the voice window.

**On the service:**

- The relay function logs nothing of a frame, with the route logger off as
  `route-effect.ts` does. Spans carry ids, byte counts, and close codes
  only.
- It is not an eve tool, so nothing reaches the agent's transcript, eve's
  durable stream, the relay into the database, or the model.
- No PostHog event carries bytes.

**On the Mac:**

- The host's terminal client (`packages/host`, built like
  `voice/socket-over-ws.ts`) runs in main. It hands each terminal's bytes to
  **the requesting panel's `webContents` alone**, over a `MessagePort`.
- They never travel in `app:state`, which is broadcast to every window
  including the voice window (`packages/host/src/client/app-state-store.ts`'s `voiceWindowState`).
- They never travel in an act's payload or answer, a trace
  (`recordAgentTrace` is voice-only), a counted event, Sentry, or a console
  line.
- The voice window is never sent a port.

**Replay and storage:**

- The tab's root carries `ph-no-capture`, like the Code and File tabs.
  Canvas recording is already off (`session-replay.ts:243-257`).
- No scrollback is written on the Mac. tmux holds it in the sandbox until
  the sandbox stops.
- Fixtures use canned output only.

**Policy text that needs Dean's approval:**

- **AGENTS.md** "Never" forbids a credential in "a Gateway answer or event",
  and a terminal shows whatever the user prints, `.env` included. It needs
  a carve-out shaped like `run_on_mac`'s: "a Terminal tab's bytes may pass
  through the relay and the host to the panel that opened it; a trace, a
  counted event, a fixture, and the voice window never carry them."
  AGENTS.md changes need Dean's approval (question 7).
- **PRIVACY.md** gains:
  - that terminal bytes pass through Luke's service in transit and are
    never stored;
  - that shells and their scrollback live in the sandbox until it stops;
  - that the Terminal tab is left out of recordings whole.

## 5. The UI (see the show)

### The tab

The tab's body is the File tab's layout (`planning/file-view.tsx`): a bar,
then the terminal, then a collapsible list on the right.

- **The bar** (`file-view-bar`) names the sandbox and its state ("Codex's
  sandbox · running · 4 vCPU"). On the right it holds a ⋯ menu (Stop
  sandbox, Copy sandbox path) and the list toggle, the same
  `file-tree-toggle` with "Hide terminals" and "Show terminals".
- **The list** (`file-tree-pane`, 208 px). Its header reads "Terminals" with
  a "+" (New terminal). Each row has the terminal glyph, a name, and the
  foreground command in mono ("pnpm dev").
  - The shown terminal has the selected fill.
  - A blue dot marks a running foreground job.
  - Hovering a row shows a kill ×.
  - Right-click opens Rename, New terminal here, and Kill terminal (in red).
    Rename edits inline, as the sidebar's plan rename does.
  - The foot shows the agent's state.
- **The list's data** is tmux's: `tmux ls` with the session name,
  `@luke_title`, `pane_current_command`, and `pane_current_path`, read by a
  short JSON route. Kill is `tmux kill-session`, which asks first only while
  a job runs. Rename sets `@luke_title`.
- **Collapsing** works like the File tree's: one flag for the window's life.

### States

| State | What the tab shows |
| --- | --- |
| **Connecting** | The terminal with a "Connecting…" notice |
| **Reconnecting** | The last screen, dimmed, under "Reconnecting… your shells keep running in the sandbox". The notice clears when tmux reattaches |
| **Stopped** | The empty state with a "Resume and open a shell" button; the list reads "No shells while it's stopped" |
| **Resuming** | A spinner, and skeleton rows in the list |
| **Agent gone** | The tab is not drawn, as Changes isn't for an agent the plan no longer holds |

### The renderer

This carries over from the first draft:

- **xterm.js 6** with fit, search, web-links, unicode11, and webgl falling
  back to DOM rendering. It loads as a lazy `terminal.js` bundle of about
  145 KB gzipped, with one deliberate bundle-budget row.
- **The theme** comes from tokens: the `--desktop-well` ground,
  `--text-primary`, new `--terminal-*` ANSI tokens with light restatements,
  `--font-mono`, and `--find-*` for search.
- **Keys:** app chords pass through to the app, and Shift+Enter sends a
  newline for CLI agents.
- **⌘F** uses the exported find bar over the search addon.
- **tmux is invisible.** `status off`, `mouse off` so xterm's selection
  works, `escape-time 0`, `history-limit 50000`, and `smcup@:rmcup@` so its
  output scrolls into xterm's own scrollback.

**Links.** URLs open in the browser. Repository paths open a File tab only
once it can read the agent's branch, which is a later PR. A dev server's
`localhost:5173` lives inside the sandbox; making it reachable needs a
sandbox port, which is a later "Open preview" idea, not v1.

## 6. Stacked PR plan

Each PR is small, stacks on the previous one, and ships tests that fail
without it. Web PRs (1–3) run their store tests on a real Postgres
(`test:store`).

1. **`feat(web): an attached terminal holds its agent's sandbox: the turn's
   end skips its stop, and the sweep stops it 2 minutes after the lease
   lapses`.** Adds the `sandbox_terminal_lease` schema, migration, model
   with a sibling test, the store-hook condition, and the sweep step. No
   route uses it yet; its tests drive the lease directly.
2. **`feat(web): the sandbox image carries tmux, and an agent's terminals
   are listed, named, and killed by route`.** Adds tmux to `PREPARE_SCRIPT`,
   which rebuilds the snapshot by its digest, and adds
   `GET/POST/PATCH/DELETE /api/agents/:id/terminals` plus the sandbox's
   status. It also adds a pinned `@vercel/sandbox` dependency.
3. **`feat(web): a WebSocket relay attaches a terminal to its agent's sandbox
   under the account's session`.** It covers:
   - the function and its duration;
   - auth and ownership;
   - resolve, then resume, then `openInteractive`, then `tmux new -A`;
   - renewing the lease while attached;
   - a protocol of Luke's own (data, resize, and status frames);
   - no frame logging;
   - the preview-probe step;
   - the runtime-edge row, and the AGENTS.md line if approved.

   Tests use a fake upstream behind a `Context.Tag`.
4. **`feat(host): the desktop attaches, lists, and reconnects terminals,
   their bytes on a port to the panel that asked`.** Adds the host client
   with a `Schedule` reconnect, the acts `terminal.attach`, `detach`,
   `list`, `create`, `rename`, and `kill`, the `MessagePort` bridge entry,
   and the renderer guide's note about the port.
5. **`feat(desktop): a Terminal tab per coding agent in the side panel`.**
   Adds:
   - the `{terminal}` kind;
   - the xterm bundle, tokens, and keys;
   - the bar and its states (connecting, reconnecting, stopped, resuming);
   - `ph-no-capture`, PRIVACY.md, and the bundle-budget row.
6. **`feat(desktop): the terminals list beside a Terminal tab: spawn,
   rename, kill, and the agent's state`.**
7. **`feat(desktop): open an agent's terminal from its tab, the "+", the
   summary, ⌘K, and ⌘J; ⇧⌘T brings it back`.**
8. **`feat(desktop): ⌘F finds in a terminal's scrollback`.**

**Later, each only on Dean's say:**

- renewing the GitHub credential while a terminal is attached (if question 5
  says so);
- the planner's sandbox;
- links to the agent's branch;
- an "Open preview" for a sandbox port;
- "Send to Luke";
- the local-shell design (below).

**Parallel work.** PRs 1–3 (web) and the renderer half of 5 can proceed in
parallel. PRs 5–8 touch `side-panel.tsx`, `use-side-panel.ts`, and
`command-palette.tsx`, so they are one chain.

## 7. Kept as a later option: a shell on the Mac

The first draft's design still holds if a local shell is ever wanted for
things that aren't the agent's: Homebrew, the user's own checkouts, a CLI
agent on the Mac. That design is node-pty in an Electron `utilityProcess`,
with the same xterm renderer, port bridge, and secrets rules. It would be a
second "+" row ("Terminal on this Mac") beside the agents' terminals. It
brings the first native module into the desktop app (asar unpacking,
`spawn-helper` signing) and a login shell from the home folder. It is not
planned.

## Questions for Dean

1. **One Terminal tab per coding agent, attached to its sandbox.** Several
   agents give several tabs, opened from the agent's "Terminal" chip, "+",
   ⌘K, and ⌘J. The planner's sandbox would come later. Agreed?
2. **Is it OK to build on Vercel's `openInteractive` PTY?** It is
   experimental and undocumented. It would be relayed through Luke's
   service, so no sandbox credential reaches the Mac, with tmux keeping
   shells alive across reconnects and the documented `runCommand` path as
   the fallback. And **should we ask Vercel** for a stability commitment and
   the token, PTY, and duration facts first? Who holds the contact?
3. **Should an attached terminal keep the sandbox running?** The idle stop
   would come 15 minutes after the last terminal closes, at about $0.17 per
   hour per held 4-vCPU sandbox. Is 15 minutes right? (Answered: disconnect after 5 minutes without typing, no cap.)
4. **Should a stopped sandbox resume on a click** ("Resume and open a
   shell") rather than automatically when the tab opens?
5. **GitHub from the terminal outside a turn.** Should the relay renew the
   agent's write token while a terminal is attached, so `git push` and `gh`
   work, acting as Luke's GitHub App? Or let it lapse within the hour?
6. **Concurrency.** You can type while the agent works, on the same files,
   with no locking; the list's foot says "Codex is working". Should the
   agent be told, in its next turn, that you were in its sandbox?
7. **Approve two AGENTS.md lines.** One is the carve-out letting terminal
   bytes pass through the relay and the host to the panel that opened them
   (never a trace, a counted event, a fixture, or the voice window). The
   other names the relay function as a runtime edge.
8. **⌘J opens the focused or most recent agent's terminal,** and ⌘K stays
   the palette inside a terminal. Agreed?
