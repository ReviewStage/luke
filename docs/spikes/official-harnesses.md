# Spike: coding agents on official harnesses (do not merge)

Dean asked: "How hard would it be to use anthropic sdk and openai sdk for
coding agents? I think people would not trust our agents as much if they are
not using official harnesses." This spike tests whether a Luke coding agent can
run on the Claude Code and Codex agent loops themselves. The route is the AI
SDK's `HarnessAgent` (`@ai-sdk/harness` with the `harness-claude-code` and
`harness-codex` adapters, plus `@ai-sdk/sandbox-vercel`). The spike keeps
Luke's store, transcript, tab, and PR publishing unchanged. The branch is a
draft and will never be merged.

**Short answer.** The plumbing is not the hard part: one adapter class lets the
harness drive our existing routes, relay, and tab. The work is in five other
places:

1. **Credentials.** Anthropic's terms bar us from paying for Claude Code on our
   users' behalf, so Claude Code needs each user's own Anthropic credential.
2. **Durability.** We would need a durable driver to replace what eve gives us
   for free.
3. **Key safety.** We must never let a key into the sandbox.
4. **Maturity.** The packages are experimental and release about 1.3 times a
   day.
5. **Cost.** Each new Claude Code session costs about $0.16 more at our default
   model.

**Recommendation:** keep eve's coder as the default. Revisit when either of
these lands:
- per-account provider credentials ("bring your own key"), or
- eve's own harness support (vercel/eve#3651, currently a draft).

Then offer "Run on Claude Code" and "Run on Codex" as an opt-in runtime behind
the bridge this spike built.

Each finding is tagged with how it was established:
- **[live]** seen in the live local Claude Code run on 2026-10-11.
- **[mock]** shown by the hermetic PGlite tests in this branch.
- **[source]** read in the installed package sources, with file and line.
- **[docs]** taken from published docs or terms.

## What was built

All of it is behind `LUKE_CODER_HARNESS`, which no environment sets, so eve
runs everywhere.

| File | What it is |
| --- | --- |
| `apps/web/server/hosted/coder-host/harness/runtime-flag.ts` | `eve` (default), `claude-code`, or `codex` |
| `…/harness/stream-events.ts` | Turns each AI SDK `fullStream` part into the eve `MessageStreamEvent` of the same moment, so the **existing** `StreamRelay` writes the turn, journal, status, and usage. Parts are read through an Effect Schema at the boundary. |
| `…/harness/tool-vocabulary.ts` | Maps harness tool calls onto the agent's vocabulary (`bash`, `read_file`, `write_file`, `apply_patch`, `glob`, `grep`, `web_fetch`, `web_search`, `edit_plan`), so `tool-call-model.ts` draws them unchanged |
| `…/harness/harness-sessions.ts` | An `EveSessions` implementation (`open`, `send`, `cancel`): the one interface the Start, message, and Stop routes use to reach a coding agent. No route changes shape. |
| `…/harness/harness-production.ts` | Vercel Sandbox per agent, checkout via the existing `checkOutAgentRepository`, adapter on Luke's own key with `auth` set explicitly, `permissionMode: "allow-all"`, `edit_plan` as a host tool. Typechecked, never run: no Vercel credentials here. |
| `…/harness/compose.ts`, `coding-agents-app.ts`, route files | The flag's wiring: a `harness` seam beside `eve` |
| `apps/web/scripts/harness-spike-live.ts` | The live local run: a process sandbox that records every harness part, with the key scrubbed |
| `apps/web/tests/coder-harness.test.ts` | Hermetic tests on PGlite: real `HarnessAgent` over a scripted adapter, plus the **live recording replayed** |

## Demo (from the live run, replayed through the store)

The task was: "The test fails: run it, fix the bug, commit, push the branch." It
ran on `claude-haiku-5-5` at effort `low`, with `@ai-sdk/harness-claude-code`
1.0.152, in a local process sandbox seeded with a two-file repository whose
`sum()` subtracts. The recorded adapter parts were replayed through the real
`HarnessAgent`, `harness-sessions.ts`, and `StreamRelay` into PGlite. This is
the transcript the agent tab reads (`tests/fixtures/harness/claude-code-live.json`):

```
## user
  The test fails: run it, fix the bug, commit, push the branch.
## assistant   status: completed · 157,177 in (124,365 cached) · 1,394 out
  reasoning  I notice the working directory differs from where AGENTS.md lives…
  Ran        node test.mjs; echo "exit=$?"; git status --short; …   → Cannot find module '…/claude-code-spike-session/test.mjs'
  reasoning  I don't see test.mjs in this repo directory…
  Ran        ls -la /tmp/harness-live/work/; …
  "The test file isn't in this repo. The AGENTS.md is at `/tmp/harness-live/work`, so I'll look there."
  Ran        cd /tmp/harness-live/work && node test.mjs; … cat sum.mjs   → -1 !== 5
  Edited     /tmp/harness-live/work/sum.mjs   (-  return a - b; / +  return a + b;)
  Ran        node test.mjs && git checkout -b luke/fix-sum && git commit … && git push -u origin luke/fix-sum
  "Fixed and pushed `luke/fix-sum`. Bug: sum() returned a - b … Test: node test.mjs prints ok …"
```

The follow-up ran on a **fresh** `HarnessAgent` resumed from the parked state,
as a new function would. The prompt was "What did you change in the last turn?"
and the answer was "I changed `sum()` in `sum.mjs` from `a - b` to `a + b`,
committed it as `35f9383` on a new `luke/fix-sum` branch, and pushed that
branch to `origin`." The branch was on the bare origin afterwards. **[live]**

Measured on this VM **[live]**:

| Step | Time |
| --- | --- |
| Bridge bootstrap (pinned `claude-code` 2.1.290 and `claude-agent-sdk` 0.3.290 installed into the sandbox's HOME) | 3.3 s (a Vercel cold sandbox will be slower; the adapter's template snapshot amortizes it) |
| `createSession` | 0.30 s |
| Park (`session.stop()` between turns) | 0.01 s |
| Resume on a fresh agent | 0.29 s |
| Task turn (5 tool calls) | 9.9 s |
| Follow-up turn | 2.1 s |

## Findings

### 1. Our own provider keys (no AI Gateway): yes, but set `auth` explicitly
- Both adapters take `auth: 'auto' | 'ai-gateway' | 'direct' | {ENV}`
  (`harness/src/v1/harness-authentication.ts:12-21`). **[source]**
- `'auto'` picks the Gateway whenever `VERCEL_OIDC_TOKEN` or
  `AI_GATEWAY_API_KEY` is set (`harness-claude-code/src/claude-code-auth.ts:114-119`,
  `harness-codex/src/codex-auth.ts:57-74`). **[source]** `VERCEL_OIDC_TOKEN` is
  always set on Vercel, so we must pass `{ ANTHROPIC_API_KEY }` or
  `{ OPENAI_API_KEY }`, as `harness-production.ts` does.
- The live run used `auth: { ANTHROPIC_API_KEY }` straight to api.anthropic.com.
  **[live]**
- **Terms (decisive for Claude Code)** **[docs]**: Anthropic's
  [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
  page, under "Can customers offer Claude Code in their products?", says that
  running Claude Code "in hosted sandboxes or other agent infrastructure"
  requires that "Customers may not pay for, resell, or intermediate Claude usage
  on their end users' behalf. Each end user must authenticate with their own
  Anthropic API key, Claude subscription plan credentials, or 3P inference
  provider credential."
  - So the Claude Code harness on **Luke's** key, or the Gateway, is out unless
    Anthropic agrees otherwise.
  - Claude Code on the user's own key is in. So is the user signing in to the
    unmodified binary with their own subscription, which must complete through
    Anthropic's own flow; we may not collect or store those tokens.
  - The binary must also be unmodified, and we may not disable its built-in
    auth methods.
  - eve's coder today calls the Messages API on Luke's key, which the
    Commercial Terms allow.
  - Codex: no equivalent clause was found. OpenAI's docs recommend API keys for
    automation. **[docs]**

### 2. Long runs vs. Vercel function limits: the loop moves into the sandbox, but someone still has to hold it
- The Claude Code or Codex loop runs **inside the sandbox**, in the adapter's
  bridge process. The host is a WebSocket client that translates events and
  runs host tools (`harness/src/agent/internal/run-prompt.ts:97-108`,
  `harness/src/bridge/index.ts`). **[source]**
- **If the host dies, the turn keeps running:** a dropped socket never aborts
  it, and events go to an on-disk log (`bridge/index.ts:1023-1031`, `:437-478`).
  **[source]**
- **Reattaching needs state saved before the host died.** Only `detach()`,
  `stop()`, or `suspendTurn()` produce the lifecycle state, which holds the
  bridge port and token, the event cursor, and `claudeSessionId` or `threadId`.
  - A function killed mid-turn without one of those leaves nothing to attach
    with. Rebuilding the state by hand is unsupported. **[source]**
- **The supported pattern** is `@ai-sdk/workflow-harness`. It suspends the turn
  every 750 s (configurable) and continues it in the next Workflow step with
  `continueFrom`, reattaching the sandbox with
  `resumeVercelNetworkSandboxSession`. **[docs]**
- **Limits** **[docs]**:
  - Functions: 300 s by default, 800 s on Pro and Enterprise (1800 s in beta).
  - Sandboxes: up to 24 h per session on Pro; the filesystem is snapshotted on
    stop and restored on resume, but processes are not.
- **eve already gives us all of this:** its workflow runs a turn durably across
  functions, which is why the coder has no durability code of its own. On the
  harness path we would rebuild it:
  - a durable driver;
  - a table holding each conversation's sealed lifecycle state, plus the
    relay's and translator's per-turn state;
  - **cross-instance Stop.** The spike's Stop interrupts the turn's fiber in
    the same instance. A real build must carry it through the turn row's
    `cancelRequestedAt` stamp, or reattach and send `abort`.
- **Resume** **[live]**: parking between turns (`session.stop()`) returned
  `{ data: { claudeSessionId } }`. A brand-new agent resumed from it kept the
  conversation. A mid-turn restart is **not** verified live.

### 3. Does `stop()` really stop?
- **`session.stop()` on a running turn is a suspend, not an abort.**
  - [source] The bridge keeps running and the call returns `continueFrom`
    state (`harness/src/agent/harness-agent-session.ts:535-571`).
  - [live] `stop()` mid-turn ended our stream with `finishReason: "other"` and
    no usage, and returned `{type, harnessId, specificationVersion, data,
    continueFrom}`.
  - [live] The command, `sleep 20 && echo SECOND > second.txt`, did not
    complete in the following 25 s. Claude Code's Bash tool also refuses a
    leading long `sleep` (see below), so this does not show whether the bridge
    went on.
- **Only the per-turn `abortSignal` aborts.** **[source]**
  - Claude Code: the bridge calls the SDK's graceful `interrupt()`, then a hard
    abort after 5 s that kills the `claude` process
    (`harness-claude-code/src/bridge/index.ts:365-389, 577-588`).
  - Codex: `turn/interrupt`, then SIGTERM and SIGKILL of app-server after 5 s
    (`harness-codex/src/bridge/codex-app-server-driver.ts:190-206, 353-378`).
  - [mock] The spike's Stop goes through the abort signal, and the store
    records the turn as `cancelled`.
  - **Abort was not verified live.** Claude Code's own Bash tool refused the
    test command (`sleep 45 && …`, "doesn't allow a leading sleep"), so the
    turn ended before the abort fired, and no further live calls were made.
- **In-flight tools are abandoned, not cancelled.** A host tool the bridge
  awaits has no timeout (`harness/src/bridge/index.ts:522-548`). **[source]**

### 4. Mapping onto our transcript rows: what is lossy
`stream-events.ts` and `tool-vocabulary.ts` cover the following; mapping is
**[mock]**, and every row is confirmed against the live recording **[live]**
where Claude Code produced it.

| Harness | Ours | Loss |
| --- | --- | --- |
| reasoning start/delta/end | `reasoning.completed` | None. Claude Code thinks adaptive and summarized by default. Codex sends reasoning *summaries* only. |
| text | `message.appended`/`completed` | None |
| `bash` (Claude `Bash`, Codex `shell`) | `bash` `{command}` | Claude Code reports a failure flag, not the exit code (0 or 1), and interleaves stderr into `stdout` (`create-emit-stream-event.ts:714-742`) **[source]**. Codex's `output` maps to `stdout`. |
| `read` / `write` | `read_file` / `write_file` | None. Paths are absolute: the adapter's work-dir strip didn't apply because the session ran in a subdirectory, see risks. |
| Claude `edit` (exact replace) | `apply_patch` with a synthesized one-hunk patch | The real result also carries `structuredPatch` with line numbers, which we drop. `replace_all` is lost. |
| Codex `apply_patch` (string input) | `apply_patch` `{patchText}` | None. Codex's `file-change` parts carry path only, no diff; kept as a separate `file_change` row. |
| `glob`, `grep`, `webSearch`, `WebFetch` | `glob`, `grep`, `web_search`, `web_fetch` | Grep's many flags dropped from the input |
| `TodoWrite`, `Agent` (subagent), `NotebookEdit`, `view_image`, compaction | Spike-only names (`todo_list`, `subagent`, …); the tab draws "Used …" with JSON | **Subagents:** Claude Code's `Agent` runs inside the CLI and its inner steps arrive only as `raw` parts, so **our worker tabs, delegations, and per-model child turns do not exist** on this path. **Codex drops plan/todo content entirely.** |
| `finish-step` usage | `step.completed` usage | **Codex reports usage only on `finish`.** The translator attributes the remainder to the last step so the turn total is right. |
| `finish.harnessMetadata.costUsd` | not used | Claude Code's `costUsd` is cumulative and **was priced at Opus 5.5 rates for a Haiku 5.5 run** **[live]**. See cost. Price from tokens with the catalog, as today. |
| — | `edit_plan` host tool | Works: bridged as an MCP tool (Claude) or a dynamic tool (Codex) **[mock]** |
| — | `delegate` | Not ported. Claude Code has its own subagents. |
| `readHistory` | — | **Not implemented by either adapter.** Rebuilding a transcript relies entirely on our stream relay. **[source]** |

The store's writer holds every tool part to a registered tool, so a production
build registers the extra names in `CODER_TOOL_SET` and gives the renderer
views for them.

### 5. Cost and latency vs. eve's coder
- **Measured [live]:**
  - Claude Code's prefix (system prompt plus tools) is about **30–33k tokens**,
    cache-written on every new session: 30,132 on the first step, 32,802 read
    back on the follow-up.
  - The 5-step task used 157,177 input tokens (124,365 cache reads, 32,802
    cache writes, 10 uncached) and 1,394 output tokens.
- **The adapter's `costUsd` said $0.2178 for the task, and is suspect.** That is
  exactly Opus 5.5's rates applied to the usage. At Haiku 5.5's Gateway list
  price the same usage is **about $0.006**. Either Claude Code's price table
  falls back to Opus for `claude-haiku-5-5`, or the requested model wasn't
  used; the recording carries no response model id to tell which. The
  changelog has fixed `costUsd` over-reporting before. The Anthropic Console is
  the ground truth. The spike's total live spend was between about $0.007 and
  $0.25.
- **Estimate at our default, `anthropic/claude-opus-5.5` at effort `high`.**
  Prices are Gateway list prices: $4 in, $5 cache write, $0.20 cache read, $20
  out, per million tokens. eve's prefix (instructions 4.5k characters, about
  1.1k tokens, plus 10 tool schemas) is estimated at 6k tokens, not measured.
  eve caches on the direct Anthropic path too (`eve/dist/src/harness/prompt-cache.js`).

| | Claude Code harness | eve coder |
| --- | --- | --- |
| Prefix written per new session, or after more than 5 min idle | 32.8k → **$0.164** | ~6k → $0.030 |
| Prefix re-read per step | **$0.0066** | $0.0012 |
| The demo task (5 steps) | **$0.22** (matches the adapter's Opus-rate figure) | ~$0.08 (estimate) |
| A long run: 40 steps, ~100k conversation, 20k output | ~$1.73 | ~$1.38 |

So: about 2.5–3× on short tasks, about +25% on long ones, and about +$0.13 on
every follow-up after idle. Claude Code's own extra calls and auto-compaction
are not counted. On BYO-key the cost moves to the user.

- **Latency:**
  - The bridge install happens once per adapter version, through the template
    snapshot.
  - Opening a session takes 0.3 s on top of the sandbox.
  - Steps run as fast as the model. eve's per-step model call is from the
    function rather than the sandbox, which is no meaningful difference.

### 6. Permission mode for unattended runs
- **`allow-all` is the default.** **[source]**
  - Claude Code maps it to `bypassPermissions` plus
    `allowDangerouslySkipPermissions` (`harness-claude-code/src/bridge/index.ts:170-199`).
  - Codex runs `approval_policy="never"` in `sandbox_mode="danger-full-access"`
    and refuses any other mode (`harness-codex/src/codex-harness.ts:230-244`).
- **The Vercel Sandbox is the only boundary**, as it is for eve's coder today.
- Even under `allow-all`, Claude Code's own Bash tool still refused a leading
  `sleep 45`. **[live]**
- Claude Code supports approvals in other modes. Codex supports none for
  built-ins. **[source]**

### 7. Package maturity
- **Labelled experimental.** **[docs]**
- About 180 versions each since 2026-06-04: 1.0.0 shipped on 2026-06-25, then
  ~38 releases in the last 30 days. All four release together, about 1.3 a day.
- **Breaking changes ship as patches** (examples: state dir moved,
  `detach`→`stop`, `shutdown`→`destroy`, auth options removed). **Pin exact
  versions.** **[docs]**
- **Open issues in vercel/ai:** `ai/harness` 12, `harness/claude-code` 19,
  `harness/codex` 1. Notable:
  - #18939: the conversation dies with its sandbox.
  - #22549: Claude approvals restart the turn after resume.
  - #22940: concurrent sandbox creates break.
  - #21700, #22550: no built-in approvals.
- **`@ai-sdk/harness` pins `ai@7.0.137` exactly** while eve 0.74 pins
  `7.0.135`. The lockfile now carries two copies of `ai`. Harmless here, since
  no `ai` object crosses between them, but a bump to watch.
- **eve:** vercel/eve#3651 is an open draft proof of concept. It is Vercel
  Sandbox only, with static harness selection, no compaction, no approvals, and
  `/clear` not reaching the harness. No eve release through 0.76.3 depends on
  `@ai-sdk/harness`. **[docs]**

### 8. The Claude Agent SDK directly (the fallback)
- The fallback exists, but HarnessAgent was not blocked, so it was not built.
- `@anthropic-ai/claude-agent-sdk` 0.3.296 has everything the adapter uses:
  `permissionMode`, `resume`, `interrupt()`, hooks, `canUseTool`,
  `includePartialMessages`, `total_cost_usd`, and `maxBudgetUsd`. **[source]**
- It spawns the same Claude Code binary, so **the same terms apply**. We would
  write and maintain the bridge, the WebSocket, and the replay log the adapter
  already ships.
- `@openai/codex-sdk` 0.162.1 is likewise a CLI wrapper, with thread resume and
  no approval callback. **[source]**
- **Verdict:** more code for the same constraints. Only worth it if the AI SDK
  adapters stall.

### 9. PR publishing
- Unchanged: the agent pushes with `git` and `gh`, and the turn's end records
  the checkout's branch on the agent's row. `published.ts` then reads the PR
  from GitHub. **[mock]** The branch lands on the row.
- **Live:** Claude Code cut, committed, and pushed a branch to the origin.
- **Not verified live:** opening a real PR, since there was no GitHub App or
  test repository.
- **Claude Code adds its own `Co-Authored-By: Claude Code …` trailer** to
  commits. **[live]** This conflicts with Luke's commit identity, which the
  checkout sets and the model never chooses. A production build must turn off
  Claude Code's attribution setting.

## Architecture options

| | Option | Durability | Trust story | Cost to build | Notes |
| --- | --- | --- | --- | --- | --- |
| A | **Keep eve's coder** (status quo) | eve's workflow | "Luke's agent on the official Anthropic/OpenAI APIs" | 0 | Can be worded honestly today. Keeps workers, delegation, and our tab exactly. |
| B | **HarnessAgent behind `EveSessions`** (this spike) | Our own: `@ai-sdk/workflow-harness` plus a state table | "Runs Claude Code / Codex, unmodified" | L (see plan) | We own durability, cross-instance Stop, credential brokering, and the vocabulary. Claude Code needs BYO credential. |
| C | **eve-native harness** (vercel/eve#3651) | eve's workflow | Same as B | S–M once it ships | Keeps our hooks, relay, and store with no durability work. Blocked on eve: draft, no approvals or compaction yet. |
| D | **Agent SDK / Codex SDK in our own sandbox bridge** | Our own | Same as B | XL | Rebuilds what the adapters ship. Same terms. |

**Recommendation: A now. Then C if eve#3651 lands; otherwise B,** behind a
per-agent runtime choice. Claude Code ships only on the user's own Anthropic
credential; Codex can go on either key. The bridge here (`stream-events.ts`,
`tool-vocabulary.ts`) is the reusable part under either C or B: it turns
harness parts into eve's own events.

## Migration plan (if B; sizes S < 1 day, M 1–3 days, L about a week)

1. **Per-account provider credentials** (L): encrypted per-account
   Anthropic/OpenAI keys, Settings "Connect" rows ("connected" only, never the
   key), and quota and billing changes. This is the prerequisite for Claude
   Code under Anthropic's terms.
2. **Harness session state** (M): a migration for `coding_agents.runtime` plus a
   `coding_agent_harness_sessions` table holding sealed lifecycle state, sandbox
   name, event cursor, and relay and translator state. Lifecycle state holds a
   bridge bearer token and must stay out of traces and events.
3. **Durable driver** (L): `@ai-sdk/workflow-harness` on Vercel Workflow, or
   eve's workflow. Suspend and continue each ≤750 s step, with reattach by
   cursor.
4. **Credential brokering, provably** (M): model keys and the GitHub token only
   as firewall request transformations. A hermetic test plus a `verify` step
   proves no key is ever written into the sandbox: grep the sandbox's HOME and
   env after a turn.
5. **Bridge to production** (M): the translator and tool vocabulary from this
   spike, with goldens recorded from live runs (`LUKE_UPDATE_FIXTURES=1`). Add
   the harness-only tools to `CODER_TOOL_SET` and renderer views (todo list,
   subagent, file change). Use the `structuredPatch` diff for edits.
6. **Stop across instances** (S–M): the driver watches the turn row's
   `cancelRequestedAt` and aborts through the turn's signal.
7. **Steering** (S): `experimental_steerTurn` (Claude) and `turn/steer` (Codex)
   behind the channel's existing steer policy. The spike answers `not_ready`
   instead.
8. **Workdir, attribution, sandbox image** (S): set `sandboxConfig.workDir` to
   the checkout, turn off Claude Code's co-author trailer, and use a template
   snapshot built on the coder's prepare script.
9. **Desktop runtime picker** (M): runtime in the agent composer (eve / Claude
   Code / Codex), with the model list constrained per runtime and the runtime
   on the agent's row and tab header.
10. **Usage** (S): price from tokens and the catalog; never trust adapter
    `costUsd`.
11. **Evidence** (S): `verify.sh` on a Mac (LUKE-159) plus one preview
    deployment run end to end.

## Risks

1. **A key in the sandbox (top risk).** [live] Without firewall brokering, the
   bridge writes the real API key to disk in the sandbox, at
   `~/.ai-sdk-harness/.agent-runs/<session>/bridge/start-config.json` (and
   `rerun-start-config.json`). That is readable by every command the agent
   runs, so a prompt-injected agent can read and exfiltrate it. It also lands
   in the Codex app-server's environment (`codex-app-server-driver.ts:125`).
   - The adapter only `console.warn`s and carries on when the sandbox has no
     request transformations
     (`harness-claude-code/src/claude-code-harness.ts:928-940`).
   - **A production design must broker every credential outside the sandbox.**
     That means model keys and the GitHub token only as Vercel Sandbox request
     transformations keyed on a placeholder, which `@ai-sdk/sandbox-vercel`
     supports.
   - It must **refuse to start** when brokering is unavailable rather than fall
     back.
   - It must assert after each turn that no key exists anywhere in the sandbox.
   - The spike's local run had no firewall. The sandbox directory was deleted
     after the run, and the key is in no artifact, fixture, or commit.
2. **Terms.** Claude Code in hosted sandboxes cannot run on Luke's key. Shipping
   it requires BYO credentials or an agreement with Anthropic. Anthropic sales
   and legal should confirm before any build.
3. **Experimental packages and daily releases**, with breaking changes as
   patches. Pin exact versions; expect upkeep.
4. **Durability gap.** A function killed mid-turn with no saved state loses the
   ability to reattach, and the turn finishes unobserved; replay is
   at-least-once for host tools.
5. **Feature loss vs. eve's coder:**
   - workers and delegation tabs;
   - per-step model switching (the row's model is read at every step today;
     the harness fixes it per turn, and Codex restarts its thread when
     instructions or tools change);
   - `readHistory`;
   - Codex todo content.
6. **Lifecycle state is a secret:** it holds the bridge token for a publicly
   routed port. It must never enter a trace, counted event, or fixture.
7. **Cost:** a 30–33k prefix per session, plus a mispriced `costUsd`.
8. **Workdir:** the adapter runs Claude in a per-session subdirectory unless
   `workDir` is set. In the live run it wasted two steps finding the
   repository. [live]

## Open questions

- Will Anthropic permit a Claude Code harness on the operator's key for a
  product like Luke? Or is BYO the only route, and do we want BYO anyway for
  trust?
- Does Dean's trust goal need the *binary* (Claude Code or Codex), or would
  "official SDKs and APIs, with our prompt shown" do? eve's coder already calls
  the providers' own APIs on official AI SDK providers.
- Where should durability live: eve#3651, or `@ai-sdk/workflow-harness` beside
  eve?
- Do we keep Luke's workers and delegation on a harness agent, or accept Claude
  Code's built-in subagents (visible only as raw events)?
- Which model actually served the "Haiku 5.5" live run? The Console shows it;
  `costUsd` says Opus rates.

## What was not verified

- **Not run at all:** Vercel Sandbox (no credentials), and the Codex adapter.
  Codex is mapped from source and tested with mocks only.
- **Not exercised:** a real GitHub PR, cross-instance Stop, and a mid-turn
  function restart.
- **Not verified live:** abort mid-command.
- **CI cannot verify this.** `verify.sh` was not run (Linux VM; the spike
  changes no Mac UI).
