# S0: eve spike findings and runtime recommendation

Written 2026-09-10 for LUKE-109 (PR S0). Two-day spike, timeboxed to one session; nothing here
ships. The prototype lived in an untracked `tools/eve-spike` workspace member and is not committed.
Companion to `storage-plan.md` and `tickets.md`.

## What was stood up

eve is Vercel's open-source agent framework: npm `eve` 0.53.1 (published the same day as this
spike; 200 releases so far), Apache-2.0, `github.com/vercel/eve`, docs at `eve.dev/docs`. It
runs anywhere the Workflow SDK runs: locally under `eve dev` on the SDK's on-disk world
(`.eve/.workflow-data`), self-hosted under `eve start` with `@workflow/world-postgres`, or on
Vercel over Vercel Workflow. The spike ran locally in the Conductor sandbox against OpenAI
directly (`@ai-sdk/openai`, `gpt-5.4-mini`, `reasoning: "low"`,
`providerOptions.openai.reasoningSummary: "detailed"`), with no Vercel account. Nothing was
deployed to Vercel, so hosted cold start and Vercel Workflow billing are answered from the
documentation, not from a measurement.

The project shape the ticket asked for, and what each part proved:

| Part                              | What it did                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/instructions.md`           | A trimmed sidecar prompt (six lines) as the system-role instruction                                                                                       |
| `agent/agent.ts`                  | `defineAgent` with a direct `LanguageModel`, `reasoning`, `modelOptions`, `limits.sessionTimeoutMs`, and later `defaultTools: false`                      |
| `agent/channels/eve.ts`           | `eveChannel({ auth: [lukeAccount(), localDev()] })`: a custom `AuthFn` mapping an `x-luke-account` header to a `principalType: "user"` principal          |
| `agent/tools/list_sessions.ts`    | Reads a stored roster snapshot (one real Conductor observation pass, 19 sessions) and normalizes it with `@sidecar/session`'s `normalizeSession`          |
| `agent/tools/read_transcript.ts`  | Checks the identity against the stored roster, runs the Conductor plugin's own pass, then `dispatchRead(plugin, "transcript", id)`; a real tail came back |
| `agent/tools/announce.ts`         | Appends a `speech.offered` row carrying `ctx.session.id`, `ctx.session.turn.id`, `ctx.callId`, and the caller's `principalId`                            |
| `agent/tools/send_message.ts`     | Calls the real `admit()` from `@sidecar/actions` inside `execute` with a roster reader over the snapshot and a guard on `ctx.abortSignal`; performs nothing |
| `agent/tools/sleep_ms.ts`         | A cancellation-aware stand-in for slow work, used for the steer and queue experiments                                                                     |
| `scripts/writer.ts`               | 58 lines over `eve/client`: consumes the NDJSON stream from index 0, dedupes on `meta.id`, and writes `messages` / `events` / `turns` rows                |

The workspace packages imported cleanly into eve's authored-module bundle (bare `@sidecar/*`
specifiers and a relative import of `packages/providers/src/conductor/index.js`, the same path
`apps/web/server/hosted/cloud-adapters.ts` uses). eve 0.53.1 and this repository both pin
`ai@7.0.97`, so `UIMessage` types are the same on both sides.

## Question 1: session lifetime

**Finding: the 30-day default is configurable, including off; expiry is not deletion; but a
years-long conversation still needs re-seeding from our record, for a different reason.**

- `limits.sessionTimeoutMs` on `defineAgent` sets an absolute lifetime for every session,
  default 30 days from creation, surviving restarts and redeploys; `false` disables it. At the
  deadline eve lets the active turn settle, emits `session.completed`, and releases the
  continuation so the next message starts fresh. Stored session data is not deleted
  (`docs/agent-config.md`, "Runtime limits"; `docs/concepts/sessions-runs-and-streaming.md`,
  "Identity by surface"). The spike's `agent.ts` set it to seven days and the compiled agent
  accepted it.
- Each session is one long-lived Workflow run (`workflowEntry`, status `running` while parked)
  plus one completed `turnWorkflow` run per turn and one `sessionTimeoutWorkflow` run. Measured
  on the local world: the session run held 15 events after one turn, 23 after two, and 38 after
  three turns of which one was a steer cancellation, so roughly 8 to 12 events per turn
  accumulate on the run that never completes. Vercel caps a run at 25,000 events and 2 GB, and
  warns that replay slows past 2,000 events (`vercel.com/docs/workflows/pricing`). That bounds
  one eve session to roughly 2,500 turns and a comfortable 200 to 250. Luke's main conversation
  at a few dozen turns a day reaches the comfort bound in about a week; an observed chat's
  conversation reaches it in weeks.
- History lives inside eve. There is no import endpoint; the seams for seeding a fresh session
  are user-role instructions, static or `defineDynamic` at `session.started`, which are appended
  to durable history once (`docs/instructions.mdx`), and `clientContext` on a send, which is
  ephemeral for that turn. Vercel retains a completed run's data for 1 day (Hobby), 7 days
  (Pro), or 30 days (Enterprise); the parked session run is not completed, so its history stands
  while the session lives.

So whatever `sessionTimeoutMs` says, the eve session must rotate, and our `messages` table is
the record it rotates from: on `session.completed` (or on a rotation the host decides, for
example at a turn or event budget) create a new session, hand it the latest compaction summary
and the tail since as a `session.started` user-role instruction read from our rows, and update
`conversations.runtime_session_id`. The plan already carries that column for exactly this.

## Question 2: queued messages and steer

**Finding: `turnPolicy: "queue"` folds every message that is waiting when the turn settles into
one turn; the default `"steer"` cancels the running turn, keeps its completed steps, discards
the in-flight step whole, and starts a replacement turn.**

Queue, observed (session `wrun_01M26HQ1JT…`): a turn calling `sleep_ms(20000)` was under way;
two `POST /eve/v1/session/:id` sends with `"turnPolicy":"queue"` arrived 0.4 s apart. Both
returned `202` with their own `deliveryId`. The stream then showed one `turn_1` whose
`message.received` text was the two messages joined by a blank line, every event of that turn
carrying two `meta.deliveryIds`, and one reply answering both:

```json
{"type":"message.received","data":{"message":"Queued one: after you finish, also say the word apple.\n\nQueued two: and say the word banana.","turnId":"turn_1"},"meta":{"deliveryIds":["25567936-…","1f0e848a-…"]}}
{"type":"message.completed","data":{"message":"apple banana","finishReason":"stop","turnId":"turn_1"}}
```

Steer, observed (session `wrun_01M26HKNC2…`): a turn had requested `sleep_ms(25000)`
(`actions.requested`, no result yet) when a default-policy send arrived 9 s in. The stream showed
`turn.cancelled` then `session.waiting`, then `turn_1` with the new message. The cancelled tool
call never received an `action.result`; `ctx.abortSignal` fired inside the executor. A third
turn asked the model what it did in its first turn: it answered that it had called
`list_sessions` (turn 1's call) and that `sleep_ms` "was never made", so the unfinished step is
gone from the model's history as the docs say ("discards incomplete assistant output and
unfinished tool state"), while the cancelled turn's user message stays. With the default
`modelCallsPerStep: 1`, one model call plus its inline tool calls is the replay unit, so only
the in-flight cycle is lost on steer; earlier completed cycles of the same turn stand.

The HTTP route accepts `turnPolicy` per follow-up message; the channel sets the default. There
is no durable FIFO: queued deliveries wait in the session's command inbox and are folded when
the driver next checks (`docs/concepts/execution-model-and-durability.mdx`, "Message delivery
and steering").

This differs from the plan's fold-in steer, where the running turn reads the new ask at its next
model boundary and answers both. eve offers cancel-and-replace or wait-and-fold, not fold-in.
For Luke, developer asks on main should use `"queue"`: a second ask never destroys the first's
work, and the two are answered together, which is the plan's intent. `"steer"` is right only for
an explicit Stop. Observation turns never contend with asks once each conversation has its own
session (question 6).

## Question 3: event completeness for a UIMessage

**Finding: yes for the parts and their states, with three ordering and identity caveats; no
for the reasoning's opaque provider item and for response ids, which the stream never carries
and which eve keeps for itself.**

The writer built, from the stream alone, a user message from `message.received` and an
assistant message whose parts were `tool-read_transcript` (`input-available` on
`actions.requested`, then `output-available` or `output-error` on `action.result`, with the
full tool output and `data.error.message`), `reasoning` from `reasoning.completed`, and `text`
from `message.completed`; `validateUIMessages` accepted the result. Turn rows came from
`turn.started` / `turn.completed` / `turn.cancelled` with usage summed from `step.completed`
(`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and `costUsd` only when
routed through AI Gateway). Every event carries `meta.id`, a stable ULID minted once at write,
so `on conflict (id) do nothing` ingestion is safe across reconnects and rewinds; `meta.at` and
`meta.deliveryIds` are on every event too.

Caveats a B5 writer over eve's stream has to handle:

1. **Order within a step.** `reasoning.completed` is emitted at the end of the step, after that
   step's `actions.requested` and `action.result`, so a writer that appends parts in arrival
   order puts the tool call before the reasoning that produced it. Order parts by
   (`stepIndex`, reasoning, tool calls, text), or anchor the reasoning part at its first
   `reasoning.appended`.
2. **Several `message.completed` per turn, and a null one.** Interim assistant text before a
   tool call completes with `finishReason: "tool-calls"`; the terminal reply with `"stop"`. A
   turn that ends in `<eve-empty-delivery/>` (the spike's "nothing to announce" path) completes
   with `message: null`, observed in the first roster-diff run.
3. **A steered turn leaves parts unsettled.** The cancelled `sleep_ms` call has
   `actions.requested` and no `action.result`; the writer must settle the part as cancelled on
   `turn.cancelled` rather than leave it `input-available` forever.
4. **The opaque reasoning item is not exposed.** `reasoning.completed.data.reasoning` is the
   summary text only. eve owns replay of its own history, so the plan's "opaque item in
   providerMetadata for replay" has nothing to store and nothing to replay; the summary is what
   clients were going to receive anyway.
5. **No response ids.** `step.completed.providerMetadata.gateway.generationId` exists only via
   AI Gateway. `turns.response_ids` cannot be filled from eve's stream; the column becomes
   optional or goes.
6. **Retried steps re-emit under new ids** with the same `turnId`, `stepIndex`, and `sequence`,
   so a writer keyed on `meta.id` can see a step's events twice and must treat completed blocks
   as replaceable projections keyed by those coordinates.

Full event vocabulary and envelope: `docs/concepts/sessions-runs-and-streaming.md`.

## Question 4: caller principal in tool `ctx`

**Finding: yes. Route auth stamps the caller onto the session and every tool sees it on
`ctx.session.auth.current` and `.initiator`; per-user scoping and `admit()` inside `execute`
both work.**

A `whoami` tool returned, verbatim from `action.result`:

```json
{"current":{"authenticator":"luke","issuer":"https://luke.local","principalId":"acct_dean","principalType":"user","subject":"acct_dean","attributes":{"plan":"spike"}},"initiator":{…same…}}
```

`send_message` ran the real `admit({ kind: ACTION_KIND.MESSAGE, fields }, { origin, roster,
guard })` inside `execute`: a session the stored roster advertised `message` for came back
`admitted` (the spike performed nothing), and a made-up session id came back refused with
`ACTION_REFUSAL.NO_SESSION`. A session created with a different account header calling
`list_sessions` failed with `Caller acct_other does not own this roster.` as a failed
`action.result`, which the model then reported. `ctx` also carries `callId`, `toolName`, and
`abortSignal` (fires on steer cancellation), and `ctx.session.turn.id` / `.sequence`
(`docs/guides/session-context.md`).

Two rules stand on our side: eve does not enforce session ownership, so the `AuthFn` (bearer
from our own account session) and the host's ACL decide which session ids a caller may reach
(`docs/guides/auth-and-route-protection.md`, "What reaches `ctx.session.auth`"); and a
follow-up replaces `auth.current` while `auth.initiator` stays the creator. eve also fills
OpenAI's `safetyIdentifier` from a hash of the principal automatically.

## Question 5: latency and cost per turn

**Finding: warm local overhead is small; the model dominates; eve's default tool set costs
about 6,000 input tokens per step until turned off; Vercel Workflow adds well under a cent per
turn on paper. Hosted cold start is unmeasured.**

Measured (local `eve dev`, local Workflow world, `gpt-5.4-mini`, direct OpenAI):

| Measurement                                            | Value                                     |
| ------------------------------------------------------ | ----------------------------------------- |
| `POST /eve/v1/session` round trip                      | 47 to 112 ms                              |
| POST to `turn.started` on the stream                   | 120 to 480 ms                             |
| Roster-diff turn, 3 model steps, 2 tool calls          | 8.9 to 11.0 s wall clock, model-bound     |
| Trivial one-step turn (`"ready"`)                      | 0.75 s from `turn.started` to `step.completed` |
| Input tokens per step, eve defaults on                 | 6,377 to 7,183 (mostly cached after step 1) |
| Input tokens per step, `defaultTools: false`           | 384 (no tools) to 1,044 (three steps in)  |
| Roster-diff turn total, defaults on                    | 20,816 in (19,584 cached) / 333 out       |
| Roster-diff turn total, `defaultTools: false`          | 2,488 in / 278 out                        |
| Workflow events per turn (local world)                 | 17 to 25 on the turn run + 8 to 12 on the session run |
| Stream bytes written per turn (local world)            | about 80 KB                               |

Cost per roster-diff turn on `gpt-5.4-mini` at $0.75 / $0.075 / $4.50 per million
(input / cached / output): about $0.004 with defaults on, about $0.003 with them off; the
difference grows with turn length because the default prompt is paid every step. Vercel
Workflow at $0.02 per 1,000 events and $0.50 per GB written prices the same turn at roughly
$0.0006 in events and $0.00004 in stream data; Functions compute is on top, as for any route.
Default tools (`bash`, `read_file`, `write_file`, `todo`, and the sandbox announcements behind
them) are not wanted by Luke at all; `defaultTools: false` keeps our five authored tools and
nothing else, confirmed on `GET /eve/v1/info`.

Not measured: Vercel Functions cold start, Vercel Workflow dispatch latency between steps, and
AI Gateway overhead. The doc-level shape is that a turn is a Workflow run whose steps are
function invocations on Fluid Compute, so each step boundary is a queue hop; the local world
showed 30 to 50 ms between `step.completed` and the next `step.started`.

## Question 6: one eve session per account, or one per observed Conductor chat

**Finding: one per brain conversation, exactly as the plan's conversations table already has
it: main, one per observed chat, one per child.**

An eve session runs one turn at a time and answers a second message with steer or queue; it has
no notion of a priority lane. One session per account would put a roster-diff wake in the same
inbox as the developer's ask: under steer the wake cancels the ask, under queue the ask waits
for the wake. Separate sessions run independently: the spike's sessions overlapped in one
process without interference, and each carries its own history, cursor, compaction, and
`sessionTimeoutMs` clock. The plan's "one coalesced message per observation pass" is eve's
queue folding applied per observed session. Cross-conversation notices (an observed chat's
announcement reaching main's context) stay ours: eve's subagents are the model delegating, not
one session informing another. `conversations.runtime_session_id` holds the eve session id per
conversation and is rewritten on rotation (question 1).

## Recommendation

**Target eve now for lane C.** Every question came back workable within the session the ticket
budgeted, with a working turn end to end: real roster, real Conductor transcript read through
the plugin, `admit()` inside a tool, an event row written by `announce`, and a stream the
writer turned into validated UIMessages. The plan named eve as the intended long-term runtime
and marked the lease, drainer, resume, compaction owner, and context engine disposable; the
spike found nothing that argues for building those four twice.

Conditions the briefs should carry:

1. **`defaultTools: false`** in `agent.ts`; Luke's tools are the catalog, offered as
   `agent/tools/*.ts` modules or resolved per session with `defineDynamic` for the effective
   tool policy.
2. **One eve session per conversation**, id in `conversations.runtime_session_id`; developer
   asks and hold releases go to main's session, roster diffs to the observed chat's session,
   children to eve's subagents or their own sessions (A-lane call).
3. **Channel default `turnPolicy: "queue"`**, `"steer"` only for an explicit cancel. State in
   the plan that "steer" now means wait-and-fold rather than fold-in.
4. **Rotation, not just `sessionTimeoutMs`.** Set the timeout off or long, rotate on
   `session.completed` or at a host-chosen turn budget well under 2,000 session-run events, and
   seed the new session from our `messages` rows through a `session.started` user-role
   instruction. Our tables remain the record; eve's history is a cache we can rebuild.
5. **Writer rules** from question 3: order parts by step, settle unanswered tool parts on
   `turn.cancelled`, key on `meta.id` and dedupe completed blocks by (`turnId`, `stepIndex`,
   `sequence`), accept `message: null`, and drop `turns.response_ids` or make it optional.
6. **Auth.** Our own `AuthFn` on `eveChannel` mapping the account bearer to a `user` principal;
   the host owns the session-id ACL; tools scope on `ctx.session.auth.current.principalId`.
7. **Deployment first.** eve is its own Nitro service; with `vercel.json#services` it can sit in
   the existing Vercel project beside `apps/web` (`docs/guides/deployment/vercel.mdx`). C1's
   first commit should deploy the spike shape to a preview and measure cold start and per-step
   dispatch latency on Vercel Workflow, since this spike could not.

Risks accepted with this recommendation: eve is pre-1.0 and moving daily (stream version 25,
several `experimental.*` knobs, `task.delegated()` removed within this line), so lane C pins
the version and reads the changelog on each bump; the brain's context engine becomes eve's,
so `convertToModelMessages` over our rows is only for rotation seeding and for the view, not
for the live turn; and OpenAI response ids are not recoverable from eve.

### Consequences for the plan

| PR  | Change                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A6  | Compaction owner is eve's (`compaction.*` events; `POST .../compact`); A6 shrinks to writing the `compaction.completed` summary message from the stream    |
| A7  | Context is eve's for live turns; `convertToModelMessages` stays for the rotation seed and the view                                                          |
| B4  | The per-account lease is not needed for turn serialization; keep only if the roster observation cron still needs a per-account mutex                       |
| B5  | Writer consumes eve's NDJSON with the six caveats above; `turns.response_ids` optional                                                                     |
| C1  | Brain host is an eve project: instructions, `agent.ts`, `channels/eve.ts` auth, tools as modules; deploy to preview first                                  |
| C2  | Drainer and lease replaced by eve sessions and `turnPolicy`; ask route creates or continues the conversation's eve session; cancel is eve's `/cancel`       |
| C3  | Wake enqueues one queued send per observed conversation's session                                                                                          |

## What this spike did not get to

- No deployment to Vercel: hosted cold start, AI Gateway `costUsd`, Agent Runs, and Vercel
  Workflow retention were read from documentation only.
- The writer is a script over `eve/client`, not a hook; `agent/hooks/*.ts` observe the same
  events server-side and are the likelier home in C1, since a hook sees a retry as new events
  while a client re-read sees the same `meta.id`.
- Compaction was not triggered (turns were far below the window); `compaction.requested` /
  `compaction.completed` and the manual `/compact` route are documented but unobserved.
- Children (`subagent.*` events, `agent/subagents/*`) and the `defineWorkflowTool` durable-wait
  path were not exercised.
