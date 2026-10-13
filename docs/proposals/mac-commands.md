# Proposal: Luke runs a command on the developer's Mac

Status: proposed, awaiting Dean's decisions (§9). Nothing is built.

Dean's ask: "Let's give Luke a tool to run commands on the local mac, just like
the tool you have." That tool takes one shell command, with a short
description and a reason the user reads. The user approves each call. It
times out after 60 s by default, which the model can extend by saying why.
Its working directory defaults to home, and it returns the command's output.

This reverses two standing lines. `docs/PLANNING.md:894` says "The planning
model reads the plan's repository, never a folder on the Mac". #1726 deleted
the last machine-reaching brain tools because "the hosted brain cannot reach a
machine". `PRIVACY.md:10-12` says "Nothing in Luke reads … command output from
your Mac's disk". The PR that turns this on amends all three.

## 1. What exists today

- **One brain, run only during a call.** Every brain turn is a spoken ask
  (`brain-host/channel.ts:83-92`; `voice/live-brain.ts:749,768`). The Work tab
  is a read-only view of that same conversation's turns, not a second brain.
  The brain's tools are `PLANNING_TOOLS` (`brain-host/planning.ts:429-487`).
  The closest one is `run_in_repository`
  (`server/hosted/repository-shell.ts`), which already has most of the
  vocabulary this tool needs:
  - a `command` and a `description` (#2222)
  - a 60 s kill
  - 20,000 characters per stream
  - a `ran` / `not-run` result whose reason the model can act on
- **eve can park a call durably.** eve 0.74 has workflow tools
  (`defineWorkflowTool`, `"use workflow"`). A call can await a Workflow hook
  or a `sleep` without holding compute (`eve/docs/tools/workflows.mdx`). The
  coder's `delegate` tool is the precedent (`apps/web/coder/tools/delegate.ts`).
  eve's own `approval` is not needed here (§3).
- **No path from the service to a Mac, except the call's own socket.** The
  voice WebSocket (`/api/voice/sessions`) is the only thing the service pushes
  to the desktop, and it exists only during a call.
  - It sends `plan.draft`, `plan.work`, `plan.code`, `plan.activity` and
    `plan.call_ending` (`packages/hosted/src/live-contract.ts`).
  - Its inbound vocabulary is closed. Anything other than activity, stop or
    hang-up closes the socket (`voice/relay.ts:312-331`).
  - The voice session record says whether a device is attached (`attachId`,
    `detachedAt`), with a 60 s re-attach grace (`voice/orphan-sweep.ts:46`).
  - On the Mac, the socket is opened by `packages/voice`, which runs in the
    main process, not the voice window.
- **No local folder.** A plan names a GitHub `owner/name`
  (`packages/database/src/schemas/plan.ts:49-54`). Nothing on the Mac or the
  service maps a plan to a checkout on disk.
- **The Mac spawns almost nothing.** The only production `spawn` is the
  native helper (`main/native/native-helper.ts`). `effect/unstable/process`'s
  `ChildProcess` (with `detached`, `killSignal`, `forceKillAfter`, a replaced
  `env`, and stdin control) and `@effect/platform-node`'s spawner are installed
  but unused.

## 2. Who gets it (recommend: the planning brain alone)

| Option | For | Against |
| --- | --- | --- |
| **A. Planning brain only** (recommended) | It always runs during a live call, so the developer is present to approve. One round trip on a socket that already exists. | None for v1 |
| B. Coding agents | — | They run unattended for long stretches, often after the call. They already have a full sandbox with the checkout, so a Mac shell would be an unattended remote shell into the developer's machine. No call means no presence and no channel. |
| C. Both | — | All of B's costs |

What the brain can't see in its sandbox, and the Mac can: uncommitted work
and local branches (`git status`, `git diff`, `git log` in the developer's
checkout), what is installed (`node -v`, `xcodebuild -version`, `brew list`),
whether the local dev server answers, and the result of running the project's
tests against local changes. The instructions say to use `run_in_repository`
for reading code, and `run_on_mac` only for what exists only on the Mac or
when the developer asks.

The worker subagent does not get it (`WORKER_TOOL_NAMES` is unchanged). A
worker runs as a delegated task the developer never sees asked for.

## 3. Path

```
brain model ─ run_on_mac(call) ─▶ workflow tool (eve, apps/web/eve/tools/run_on_mac.ts)
   │ step: admit, check the call's Mac is attached, insert mac_command row (pending)
   │ await hook(token)  ∥  sleep(deadline)            ◀── durable, holds no compute
   ▼
voice service (live-brain, already re-reads the turn every 250 ms)
   │ pending rows for this call ─▶ frame `mac.commands` {requests:[…]} (whole set, every change)
   ▼
Mac main process (packages/host)
   │ screen → rule match? ─ no ─▶ panel app-state slice ─▶ approval card ─▶ act `macCommand.decide`
   │ run (ChildProcess, login shell, caps, kill) → redact
   │ POST /api/plans/{planId}/mac-commands/{callId}  (account token)
   ▼
route: account owns plan · row pending · re-cap · re-redact → resumeHook(token, result) → call settles
```

- **The tool** is a static workflow tool file, as `delegate.ts` is. It
  carries `"use workflow"` with its side effects in `"use step"`s. It joins
  `planningToolSet()` so the writer accepts its rows.
  - The step admits the session, then refuses at once, as `not-run` with a
    reason, when any of these holds:
    - the call's voice session has no attached device: "Luke's Mac is not
      connected"
    - the Mac said at `session.create` that commands are off or that it
      cannot run them (below)
    - the input fails screening (§5)
  - Otherwise it inserts a `mac_command` row: account, plan, conversation,
    call id, a random hook token, requested and settled times, and outcome.
    The row holds no command text, because the journaled call already holds
    the input.
  - The body then awaits `createHook({ token })` raced against
    `sleep(answer window + timeout + 30 s)`. A deadline settles the call as
    `not-run: no answer from the Mac`.
- **Delivery** rides the call's socket, since every brain turn has a call.
  - The voice service pushes one frame, `mac.commands`, holding every pending
    request for the call: call id, command, description, reason, cwd, timeout
    and timeout reason. It is re-sent on every change and on re-attach.
  - The Mac reconciles against it: a new id prompts, and a missing id
    withdraws the card or kills the running command. This makes a dropped
    socket, a re-attach and a cancelled turn the same case.
- **The answer** goes over HTTPS on the account token, not the socket.
  - The socket's inbound vocabulary stays closed, and 20 kB of output stays
    off the voice relay.
  - The route refuses unless the account owns the plan and the row is
    pending, then resumes the hook. An answer for a settled row is refused.
- **When the call ends,** the voice service settles every pending row as
  `not-run: the call ended`. If the brain's turn is cancelled or steered, eve
  aborts the call's signal, the row is settled as cancelled, and the next
  frame withdraws it. The workflow deadline is the backstop.
- **Capability and setting at create.** `session.create` gains
  `macCommands: "ask" | "off"`. An older Mac sends neither value, which reads
  as cannot. The tool can then refuse without waiting out a deadline on a Mac
  that will never answer. The tool stays declared for every session, so the
  tool set and its prompt-cache prefix never vary per Mac.
- **No Gateway node capability.** `NodeRegistry` exists for native-only acts
  (`os.openExternal`). Routing output through it would put command output in
  a Gateway answer. The runner is a host service. It posts its redacted result
  to the service directly, and output never reaches the renderer from the Mac
  side: the Work tab draws the service's stored copy, as it does for
  `run_in_repository`.

## 4. Approval

- **One card per request, docked above the call bar** on the plan the call is
  about. It is drawn inside the panel's own tree with `ph-no-capture`, never
  portaled to `document.body`. The Work tab's row reads "Waiting for
  approval" until the developer answers. If the window isn't focused, a macOS
  notification says "Luke wants to run a command on your Mac", without the
  command, and clicking it focuses the card. The voice is told a command is
  waiting, so Luke can say "approve it in the app". The card shows:
  - the description as its heading
  - the full command in monospace
  - the working directory
  - the reason ("Why: …")
  - the timeout, only when it isn't the default, with its reason
- **Buttons: Deny (Esc) · Always allow… · Run (⏎, primary).**
  - *Always allow…* opens a choice in the card itself: this exact command, or
    a whole-word prefix of it. The prefix is pre-filled with the program and
    its subcommand, for example `git log`.
  - Denying tells the model "the developer declined". Nothing else is said.
  - Answering by voice is out of scope. A spoken "yes" is easy to mishear, and
    a click is the gate.
- **Rules.**
  - A rule never matches a command that holds a shell control character:
    `; & | < > $( \`` or a newline. `git log; rm -rf ~` always prompts, even
    under `git log`.
  - Screened commands (§5) are refused before any rule or card.
  - Requests run one at a time per Mac. Later ones wait behind the first in
    the card stack.
- **Remembered per Mac, never across accounts.**
  - Rules live in `mac-command-rules.json` (mode 0600) under the state root,
    keyed by account id: `{ accounts: { [accountId]: { rules: [...] } } }`.
    A different account signed in on the same Mac sees none of them.
  - Requests reach only the panel of the account whose socket carried them.
  - The route checks the account again before it settles anything.
- **Settings:** a "Commands on this Mac" card in Settings › General.
  - **Let Luke run commands on this Mac (asks every time)**, a machine-local
    `toggleSetting`.
  - The always-allowed rules, each with Remove. The list is `ph-no-capture`,
    since rules are command text.
- **Recommended default: on, with prompts.** Nothing runs without a click
  unless the developer wrote a rule. The developer is on a live call when the
  card appears. If the default were off, the feature would be invisible and
  every call would end in a refusal. The first card is the opt-in, and its
  text says the setting exists. If Dean prefers off, the card can instead
  read "Luke wants to run a command. Turn on commands in Settings."

## 5. Sandboxing, limits, secrets

### Limits

| | |
| --- | --- |
| Working directory | `cwd` from the model, absolute or `~/…`. It must exist and be a directory, or the call is `not-run`. Default: home. A per-Mac "this repository is checked out at …" mapping is a later follow-up, not v1. |
| Timeout | Default 60 s. The model may ask for 1–600 s, and anything over 60 needs `timeout_reason`, which the card shows. |
| Kill | Spawned `detached`, so the command leads its own process group. Timeout, Stop on the row, a withdrawn request, sign-out, or quit sends `SIGTERM` to the group, then `SIGKILL` 3 s later (`forceKillAfter`). The group is also killed when the command exits, so `npm run dev &` leaves nothing running. |
| Output | stdout and stderr up to 20,000 characters each (the head, like `run_in_repository`), with ANSI stripped. At most 1 MB of each is read, the rest is drained, and the result is flagged truncated. Exit code and duration are kept. |
| Input | stdin is `/dev/null`. No TTY: `TERM=dumb`, `NO_COLOR=1`, `PAGER=cat`, `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`. Anything that asks for input reads EOF and fails. |
| Shell | The user's login shell (`os.userInfo().shell`, else `/bin/zsh`) as `-l -c <command>`, with the command passed as an argument and never spliced into shell text. |
| Environment | The app's own environment minus `LUKE_*`, `ELECTRON_*` and Sentry variables. `PATH` is resolved once per launch the way VS Code does it (`$SHELL -i -l -c 'printf %s "$PATH"'`, 10 s cap, falling back to the login `PATH`), so Homebrew, nvm and pyenv binaries resolve. The rc files don't run on every command, and no rc-exported variable is inherited. |
| Root | `sudo` and `su` are refused (`not-run: Luke does not run commands as root`). |
| Concurrency | One command per Mac at a time. |

### Secrets

AGENTS.md's hardest rule is that no credential may enter a Gateway answer or
event, the voice window, a counted event, a trace, or a fixture. Command
output can carry the developer's own secrets. **Recommendation: both screening
and redaction, applied on the Mac and again on the service.** One shared
module in `@sidecar/hosted` does both.

1. **Screen the command before it is shown or run.** These are refused as
   `not-run`, with a reason telling the model not to try again:
   - a command that already carries a credential-shaped string
   - an obvious secret dump:
     - `security find-*-password` / `dump-keychain`
     - `printenv`, or bare `env` / `export -p` / `set`
     - reads of `.env*` files
     - `~/.ssh/id_*` without `.pub`
     - `~/.aws/credentials`, `~/.netrc`, `~/.npmrc`, `~/.docker/config.json`,
       `~/.config/gh/hosts.yml`
     - `gh auth token`, `op read` / `op item get`,
       `gcloud auth print-access-token`, `vercel env pull`
     - shell history files
2. **Redact output at capture,** in the runner, before the result exists as a
   value anywhere else. The service runs the same pass again before it stores
   anything. Matches become `[redacted]`, and the model is told how many there
   were. The patterns:
   - known token shapes: GitHub (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`,
     `github_pat_`), OpenAI and Anthropic (`sk-…`, `sk-ant-…`), AWS
     (`AKIA…` / `ASIA…` and secret-key assignments), Slack (`xox?-`), Stripe
     (`sk_live_`, `rk_live_`), Google (`AIza…`), npm (`npm_`)
   - JWTs
   - PEM private-key blocks
   - `Authorization:` / `Bearer` values
   - URL userinfo (`https://user:pass@`, `postgres://u:p@`)
   - the value of any `NAME=value` / `NAME: value` whose name matches
     `SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL`

**Where the output goes:**

| Destination | What reaches it |
| --- | --- |
| Gateway | Never routed through it (§3). |
| Renderer | Only the redacted stored copy, through the existing Work frame and read, inside the already `ph-no-capture` Work tab. |
| Voice window | Never: the frame lands in main, and the card is drawn in the panel. |
| Session replay | The card and the Settings rule list are `ph-no-capture` and not portaled. |
| Counted events | One optional event with an enumerated decision (`allowed_once`, `always`, `denied`, `auto`, `refused`, `timed_out`) and no text. |
| Traces | Devtrace records live voice events in development only. The `mac.commands` frame carries already-screened commands, never output. |
| Sentry | Runner failures map to fixed sentences, never a stream's text. |
| Fixtures | Test tokens are assembled at run time (`"ghp_" + "x".repeat(36)`), so no credential-shaped literal is committed. |

**The transcript.** Approved, redacted output is stored with the planning
conversation and sent to OpenAI, on the same terms as `run_in_repository`'s
output. I recommend accepting that. The developer saw the exact command and
chose to run it, and the brain can't use output it can't read. PRIVACY.md
must say so (§7).

**Residual risk, plainly:**

- Redaction catches known shapes only. A password in an arbitrary config
  file, a token in an unknown format, personal data, and proprietary code will
  pass through to OpenAI and to the stored conversation. That conversation is
  kept for the plan's life, readable by our operators, and removed thirty days
  after the plan is deleted.
- Screening is a guard against the model's mistakes, not against an
  adversary: `base64 < .env` or `python -c` gets past it. The developer's
  click is the real control.
- A prompt-injected brain (from a web page or repository text it read) can
  propose a harmful command. It must still pass the card. An always-allowed
  prefix like `npm test` runs whatever the repository's scripts say today.
- A command can reach the network itself (`curl`). Approval is the only gate
  on that.

## 6. Where it shows

- **The row.** A new `PLAN_WORK_TOOL.MAC` (`planning-view.ts`) and
  `CALL_KIND.MAC_COMMAND` (`turn-rows.ts`), with a laptop icon instead of the
  sandbox's terminal icon.
  - The title is the model's description (#2222's `callLine`), and the
    command is the subject.
  - An **"On your Mac"** label sits in the header of every such row, so
    nothing that touched the Mac reads like a sandbox command.
- **The body** shows the command, the cwd, the output (`commandOutput`: stdout,
  stderr, `exit N`, truncated) and the redaction count. Non-run outcomes read
  as one line: declined, refused (with the reason), timed out after N s,
  cancelled, or Mac not connected.
- **State marks.** The stored row keeps only the four states the writer allows
  (`tool-parts.ts`): it stays `input-available` while pending. The Mac knows
  from its own pending set whether a pending row is waiting for approval or
  running, and draws "Waiting for approval" or the working mark.
- **Copy** carries "Ran on your Mac".

## 7. Docs and PRIVACY.md

- **PRIVACY.md**
  - "On your Mac" (`:10-20`): Luke runs a shell command on your Mac only when
    the planning model asks during a call and you approve it, or it matches a
    rule you made.
  - A new section, "Commands Luke runs on your Mac", saying:
    - what is shown before a command runs
    - the shell and environment it runs in
    - the timeout and caps
    - that the command, its description and reason, and up to 20,000
      characters of each stream (after redaction) are stored with the planning
      conversation and sent to OpenAI
    - that redaction is best-effort
    - the always-allow rules: kept on this Mac per account, never on our
      service
    - the setting
  - "Screen recordings": add the approval card and the Settings rule list to
    the parts left out whole.
- **`docs/PLANNING.md:894`** gets a "How the planning model runs a command on
  the Mac" subsection.
- **AGENTS.md** is untouched. The design keeps its rule as written.

## 8. PRs and tests

The brain is offered the tool only in the last PR, so no Mac is asked anything
it can't answer.

1. **`feat(hosted): the Mac command vocabulary, screening, and redaction`**
   (`packages/hosted/src/mac-command.ts`).
   - Adds the tool input, result and `mac.commands` frame schemas, with their
     goldens.
   - Tests through the public export: each token shape is redacted; a
     near-miss isn't; every screened form is refused, and a harmless neighbour
     of each (`cat README.md`, `env FOO=1 node x`) isn't; control characters
     defeat rule matching.
2. **`feat(host): run a command on this Mac`**
   (`packages/host/src/mac-commands/`): the runner, the rule store and the
   pending-request reconciler.
   - The runner sits over `ChildProcessSpawner`, with a scripted spawner layer
     in `packages/host/src/testing/`. With `it.effect` and `TestClock`:
     - the timeout sends `SIGTERM` to the group, then `SIGKILL`
     - caps and the truncated flag
     - a missing cwd is `not-run`
     - stdin is closed and the environment is stripped
     - a withdrawn request kills the command
     - output is redacted before the result exists
   - The rule store, in a `temporaryDirectory`: rules are scoped to the
     account; a second account reads none; the file is 0600; exact and prefix
     matching work.
   - One real `/bin/sh` test that a backgrounded child dies with its group,
     in the child-process layer.
3. **`feat(web): the mac_command row, the answer route, and the frame`**
   - Schema, migration, and a sibling model test that one account can't read
     or settle another's row.
   - `POST /api/plans/{id}/mac-commands/{callId}`, with tests for: wrong
     account, already settled, oversize, and output redacted again on the
     server.
   - Live-brain pushes `mac.commands` and settles pending rows on call end.
   - `session.create` carries `macCommands`.
   - Nothing declares the tool yet.
4. **`feat(desktop): approve a command Luke asks to run on this Mac`**
   - The card, the Settings card, the Work-tab row and label, and the
     notification.
   - jsdom tests: Run, Deny and Always allow each send their decision; a
     withdrawn request removes the card; the card and the rule list sit under
     `ph-no-capture`; the row reads "On your Mac" with its outcome lines.
5. **`feat(brain): run_on_mac`**
   - The workflow tool, its `planningToolSet` row, instructions and golden.
   - Updates PRIVACY.md and PLANNING.md.
   - Tests through the brain host's test layer: not attached, off, and too old
     each refuse at once; an answer settles the call; a deadline does too; a
     cancelled turn settles as cancelled.
   - The offline brain eval gains one scripted Mac answer.

PRs 1 and 2 can run in parallel. 3 needs 1, 4 needs 2 and 3, and 5 goes last.
Every PR body says CI couldn't verify the Mac and that `verify.sh` was not run
(LUKE-159).

## 9. Decisions Dean needs to make

1. Reverse PLANNING.md's "never a folder on the Mac" and #1726's "cannot reach
   a machine" for this one tool? (Recommended: yes.)
2. Scope: the planning brain only, not coding agents and not the worker?
   (Recommended: yes.)
3. Default: on with prompts, or off? (Recommended: on with prompts.)
4. Store approved, redacted output in the conversation and send it to OpenAI,
   as `run_in_repository`'s output is? (Recommended: yes, stated in
   PRIVACY.md.)
5. Secrets: screening plus redaction on both sides, with the residual risk
   above accepted? (Recommended: yes.)
6. Working directory: home by default, with a per-Mac repository-to-folder
   mapping as a later follow-up? (Recommended: yes.)

### To verify while building (not blockers)

- eve runs a `defineWorkflowTool` beside the brain's dynamic tools, and the
  relay records its pending call as `input-available`.
- Workflow's `sleep` races a hook in a workflow body.
- What a spoken ask arriving mid-wait does to the parked call: steer, which
  cancels it, or queue.
