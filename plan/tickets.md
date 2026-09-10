# Linear drafts for the storage decisions (not yet applied)

Each section is the text to put on the issue named. Companion to `storage-plan.md`.

---

## LUKE-95 — replace the "Decisions (settled)" section's Service and Clients bullets

**Service**

* Brain host runs request-scoped in Vercel Functions over a Postgres store. One stream per
  account: every trigger (typed ask, spoken ask, roster diff, hold release, child completion)
  is a queued `turns` row; one drainer under one per-account lease runs the queue in order,
  developer asks ahead of observation turns. Developer asks steer (fold-in at the next model
  boundary); system triggers queue, one coalesced message per observation pass. Run deadline
  ≈240 s inside the 300 s function window. eve on Vercel Workflows is the intended long-term
  runtime; the lease, resume, compaction owner, and context engine are disposable and carry
  no business rule. A two-day eve spike (PR 0) precedes the store rewrite.
* Storage is AI SDK `UIMessage` rows: `conversations`, `messages`, `events`, `turns`,
  `conversation_lease`, `prompts`, `tool_sets`, `voice_sessions`,
  `voice_transcript_segments`, `provider_cursors`. The model's context is derived from
  messages each turn (no checkpoint table); compaction is a summary message; reasoning is a
  part with summary text and the provider's opaque item for replay; tool calls and results are
  parts of the assistant message, written before execution and completed after (the journal).
  The store writer consumes a runtime event stream so eve's stream can replace our loop's.
* Content is stored unencrypted. Sealing remains for vault provider keys only. OpenAI `store`
  is left on and response ids are recorded; reasoning summaries are requested and stored.
* Clear is a soft delete (`deleted_at` on main, a new main opened), purged after 30 days.
  Account deletion cascades. No recovery archives, no OpenClaw store maintenance.
* One daily inference meter per user, unchanged. Cron observation at ~1 min, unchanged; the
  brain wakes only on a diff; each observed Conductor chat is its own brain conversation and
  reads new messages incrementally by the `after` cursor stored in `provider_cursors`.
* Identity workspace per user, unchanged. Devices table, unchanged.
* Briefing delivery is events on the announcement message (offered → claimed → spoken |
  pushed | expired, held while a device reports quiet); the claim is an insert under a unique
  partial index. No `briefings` table.
* Turn metadata (origin, status, model, effort, prompt hash, tool-set hash, response ids,
  usage split into input/output/cached/reasoning, timings, failure) lives on the `turns` row.
  Prompts and tool sets are content-addressed.

**Clients**

* Every device reads per-resource cursors (`messages?after=`, `events?after=`, turns,
  roster) and polls a change signal; no single feed. Each device keeps its cursors; all
  converge on the same rows.
* The Conversation view is a server-side selection in `packages/session`: main's messages plus
  announcements and action tool parts from observed conversations, grouped by turn. Clients
  receive tool parts (input + the action output envelope) and word rows themselves; wording
  sets stay aligned by the iOS parity check.
* Voice migrates to GPT-Live-1 in client-delegation mode (separate workstream): the delegation
  event replaces the ask tool, replies return as commentary appends, briefings as null-
  delegation appends. Transcripts are stored as timed segments; no audio.
* Presence, row presses, iPhone, and watch bullets: unchanged.

**Delivery** — see "PR plan v2" at the end of this file: seven lanes, each PR one logical
change with no consumer until the swap PR. PRs 1 (rename), 2 (schema v1), 3 (devices) are
done; PR 4 (cron observation) is in review; PR 2's tables are superseded by lane B. The
#882–#904 tool-rendering stack is closed unmerged; its requirements are captured in A2 and E1–E2.

---

## NEW — PR 0: eve spike (two days, throwaway)

Parent LUKE-95. Blocks PR 2b.

Stand up an eve project in a scratch directory with a trimmed `AGENTS.md` as
`instructions.md` and three `defineTool` tools: `list_sessions` over a stored roster snapshot,
`read_transcript` through the Conductor plugin, and `announce` writing an event row, with
`admit()` inside `execute`. Start a session, post a roster-diff message, post a second message
mid-turn, and consume the NDJSON stream with a ~50-line writer into our `messages` / `events` /
`turns` shape.

Questions to answer, each with a written finding:
* Session lifetime: is the 30-day default configurable, or must we re-seed from our record?
* Queued messages: batched into one turn or one turn each? How does eve's cancellation-backed
  steer behave against a half-finished plan?
* Are `message.completed`, `action.result`, `reasoning.completed` enough to build a complete
  UIMessage, reasoning summary included?
* Does tool `ctx` carry the caller's principal, so per-user scoping and `admit()` work?
* Cold-start latency and cost per turn.
* One eve session per account, or one per observed Conductor chat?

Outcome: a recommendation for PR 2b/5 to target eve now or our loop with the lease. Nothing
from the spike ships.

---

## NEW — PR 2b: replace the conversation schema with UIMessage storage

Parent LUKE-95. Blocked by PR 0. Supersedes LUKE-97's tables.

* Drop: `conversation_session`, `runtime_checkpoint`, `observation_cursor`,
  `observation_capture_cursor`, `observation_inbox_entry`, `conversation_run`,
  `action_receipt`, `conversation_line`, `transcript_event`, `compaction_boundary`,
  `briefings`, `conversation_line_rating`. No data migration (no users).
* Add, per `storage-plan.md`: `conversations` (uuid id, kind, provider columns for observed,
  parent/spawn/fork columns for children, `runtime_session_id`, `deleted_at`, two sequence
  counters), `messages` (UIMessage rows, unique `(conversation_id, client_id)`), `events`
  (unique partial index for `speech.claimed`), `turns`, `conversation_lease` (per account),
  `prompts`, `tool_sets`, `voice_sessions`, `voice_transcript_segments`, `provider_cursors`.
  Plain `jsonb`; nothing sealed.
* Store module in `apps/web/server/hosted/store`: message writer as a consumer of the runtime
  event stream; in-flight message updates by tool-part state; per-conversation sequence
  allocation under the account lease; soft delete + 30-day purge in the cron; `validateUIMessages`
  on read.
* The action output envelope type in `packages/actions` (status, target snapshot, control kind,
  created session id), validated on write.
* Tests: PGlite in `check.sh`; one CI job on real Postgres migrations. Acceptance: a turn's
  messages round-trip through `validateUIMessages` and `convertToModelMessages`; a killed
  writer mid-message leaves a resumable `input-available` part; Clear opens a new main and
  hides the old within one read.

---

## LUKE-100 (PR 5) — rewrite

Run Luke's brain in the service over the PR 2b store. Briefings recorded, not delivered (PR 6).

* Runtime per the PR 0 finding: eve, or our tool loop with the per-account lease and resume.
  Either way the host emits the runtime event stream the PR 2b writer consumes; no code path
  writes messages directly.
* Single stream: `POST /api/brain/ask` enqueues a `turns` row (origin typed | spoken, client
  id for idempotency) and returns the turn id; `GET /api/brain/turns/{id}?wait=` answers when
  it settles; `POST .../cancel`. The drainer runs queued turns in order, asks first; an ask
  arriving mid-turn is folded in at the next model boundary. Cron wake enqueues one
  coalesced roster-diff message per observed conversation with pending diffs.
* Context: `convertToModelMessages` over the conversation's messages since the latest
  compaction message; standing context (roster snapshot, facts, recent main lines for observed
  conversations) as today. Compaction writes a summary message. Reasoning summaries requested;
  `store` on; response ids and usage written to the turn.
* Tools as eve-shaped modules (description, Zod schema, `execute(input, ctx)`), `admit()`
  inside; the action tools return the output envelope. Offered: cloud actions, `list_sessions`,
  `read_transcript` (whole tail and `transcriptSince` over `provider_cursors`),
  `remember_fact` / `forget_fact`, workspace read/write, `announce` (writes the assistant's
  announce tool part and a `speech.offered` event on that message). Denied at the agent layer
  as before.
* Prompts and tool sets content-addressed; hashes on the turn.
* Acceptance: typed ask runs, actions written before effect and completed after; a killed
  function mid-run resumes with unanswered calls marked unknown and nothing re-performed; a
  diff opens a wake that can announce; two concurrent asks produce one drainer and two turns
  in order.

---

## LUKE-101 (PR 6) — rewrite: reads, view, delivery events, push

* Per-resource reads with cursors: `GET /api/conversation/messages?after=` (the view:
  main + selected observed-conversation messages, grouped by turn), `GET /api/conversation/
  events?after=`, `GET /api/brain/turns?after=`, roster as today; one change-signal poll that
  also refreshes presence (active-until, quiet-until) and last seen.
* The view function lives in `packages/session` and runs server-side.
* Delivery as events on the announcement message: `speech.offered` (by `announce`) →
  `speech.claimed` (insert under the unique partial index; the device recorded) →
  `speech.spoken` | `speech.pushed` | `speech.expired`; `speech.held` while quiet. Push rule
  and quiet rule unchanged; expiry in the cron writes `speech.expired`, and the view marks the
  announcement unspoken.
* Ratings (LUKE-108 step 2) are `rating` events on a message the caller owns.
* Acceptance unchanged, plus: two devices polling see identical ordered messages.

---

## LUKE-102 (PR 7), LUKE-105 (PR 10), LUKE-106 (PR 11) — notes to add

Replace "Conversation lines" with UIMessage rows read through the per-resource endpoints;
render tool parts from `input` + the output envelope with platform-owned wording; fold by
`turn_id`; draw read tools collapsed by the catalog flag; ratings write `rating` events.
The desktop's Conversation tab drops `ConversationEntry` in favour of the UIMessage view.

## LUKE-107 (PR 12) — additions

Delete the SQLite brain store (`packages/brain/src/store`), `ConversationEntry` and its
narration, the desktop's runtime-store worker, the recovery-archive and store-maintenance
ports, keyed mode. Rewrite CLAUDE.md's storage, journal, cursor, generation, and encryption
sections to `storage-plan.md`; PRIVACY.md to say content is stored unencrypted, readable by
operators, purged 30 days after Clear, and that OpenAI stores requests under `store`.

## LUKE-108 — step 2 amendment

A rating is an `events` row (`kind = rating`, payload rating/note, `device_id`) on a message
the caller owns and Luke authored. No column, no rating table. "Why was this rated down" joins
`events` → `messages` → `turns`.

---

## Coordination with the GPT-Live rollout (Charles, orchestration/gpt-live-rollout)

The rollout is already designed and PRs 1, 2, 5, 6 are open or merged, so the sibling issue
drafted earlier is withdrawn. Three points to carry to its PR 8 ("host live sideband and live
session service") and the iOS follow-up, as a message to the orchestrator session:

1. **The record.** The rollout's §6 writes grouped Luke utterances from the transcript ledger
   as Luke's Conversation lines and keeps the brain's text only in the run journal. Under the
   storage plan the brain's reply is the assistant `message` (what the model said and what
   its context replays), and Luke's spoken words are `voice_transcript_segments`. Grouped
   developer utterances still become user messages (`channel: voice`, with `voice_session_id`,
   `delegation_id`, and the `askContext` span). The commentary appends are derived from the
   brain's message; nothing spoken becomes a message.
2. **Where the live session service runs.** The rollout places `LiveSessionService`
   (delegation adapter, ledger, hold queue, ledger-to-Conversation) in `packages/host` on the
   desktop with in-process brain seams, and a hosted `apps/voice-service` that "keeps no
   conversation". After LUKE-95 PR 7 the desktop has no brain and the Conversation is in
   Postgres, so the adapter and the writer belong on the server: the voice service already
   holds the sideband and sees every event, so it posts delegations to `/api/brain/ask`,
   consumes the turn's event stream (PR 6's streamed reply, slow-step, and settled seams,
   exposed over HTTP), sends the appends, and writes `voice_sessions`, segments, and speech
   events. The desktop is a WebRTC peer with captions. The keyed source in PR 7 is not needed
   (keyed mode is removed).
3. **iOS and watch.** The rollout's follow-up puts the phone on Responses delegation with its
   own action tools. Under LUKE-95 the phone has the hosted brain, so it uses the same voice
   service and client delegation as the Mac; no second backend.

Also for the orchestrator: PR 6's run event stream emits nothing for observation turns; the
storage writer needs those too (PR 2b extends it).

---

## WITHDRAWN — GPT-Live-1 migration sibling issue

Superseded by the coordination note above; the rollout owns the migration.


---

# PR plan v2 — small, contained PRs

Rules used to split: a table lands before anything writes it; a writer lands before anything
reads it; a pure function lands before its consumer; the renderer learns a new shape from
fixtures before its data source moves; deletions come after the swap. Every PR passes
`check.sh`; UI PRs run `verify.sh`. Sizes: S ≈ under 300 lines, M ≈ under 800, L = split further
if it grows.

## Lane S — spike (no PR)

| id | title | after | size |
|---|---|---|---|
| S0 | eve spike: one Luke turn on eve, six questions answered in writing | — | 2 days |

Blocks B5 and lane C. If eve is chosen, C2's drainer and lease and A6's compaction owner are
replaced by eve's; the rest of the plan is unchanged.

## Lane A — shared vocabulary and brain seams (packages, no service change)

| id | title | after | size | from |
|---|---|---|---|---|
| A1 | `feat(session): UIMessage storage vocabulary` — metadata schema (author, channel, voice span, compaction), part-state helpers, `validateUIMessages` wrapper, fixtures | — | S | new |
| A2 | `feat(actions): one output envelope for every action tool` — status, target snapshot, control kind, created session id; validated on write; performer returns it | — | S | #882–#904 |
| A3 | `feat(brain): run events for every turn kind` — extend #910's stream to observation and child turns; add tool-call started/settled, reasoning completed, compaction completed, message completed | — | S | LUKE-100 |
| A4a | `refactor(brain): action tools as modules` — description, Zod schema, `execute(input, ctx)`, `admit()` inside | A2 | M | new |
| A4b | `refactor(brain): read, workspace, memory, announce, and delegation tools as modules` | A4a | M | new |
| A5 | `feat(brain): reasoning summaries, response ids, and usage on the run` — request `reasoning.summary`, keep the summary beside the opaque item, `store` on, usage split four ways | — | S | new |
| A6 | `feat(brain): compaction as a summary message` — model-written summary, first-kept marker; provider compaction item retired | A1 | M | new |
| A7 | `feat(brain): context derived from UIMessages` — `convertToModelMessages` over messages since the latest compaction; checkpoint engine kept behind a flag until C1 swaps | A1, A6 | M | new |
| A8 | `feat(memory): the notebook as a provider` — `recall`, `capture`, `tools`; flush is a capture | — | S | new |

## Lane B — Postgres schema and store (additive; nothing reads until lane C/D)

| id | title | after | size | from |
|---|---|---|---|---|
| B1 | `feat(web): conversations, messages, and turns tables` — v2 tables beside v1, `runtime_session_id`, `deleted_at`, per-conversation sequences; migration only | A1 | S | LUKE-97 |
| B2 | `feat(web): events, prompts, tool_sets, provider_cursors tables` — with the `speech.claimed` unique partial index | B1 | S | LUKE-97 |
| B3 | `feat(web): voice_sessions and voice_transcript_segments tables` | B1 | S | new |
| B4 | `feat(web): per-account conversation lease` — #898's lease reshaped to one row per account | B1 | S | LUKE-100 |
| B5 | `feat(web): the store writer` — consumes the A3 event stream into messages (in-flight part states), turns, events; PGlite tests; a killed writer leaves a resumable part | A3, B2 | M | LUKE-97 |
| B6 | `feat(web): message reads and soft delete` — `listMessages(after)`, `validateUIMessages` on read, Clear as `deleted_at` + new main, 30-day purge in the cron | B5 | S | LUKE-97 |
| B7 | `feat(web): voice writer` — sessions, segments, speech events from a Live event stream (consumed by the voice service later) | B3, B5 | S | new |

## Lane C — brain host in the service (rework of LUKE-100 / #898)

| id | title | after | size | from |
|---|---|---|---|---|
| C1 | `feat(web): brain host composed over the v2 store` — BrainAgent + A7 context + B5 writer, in-process test runs a turn; no routes | S0, A7, B5 | M | LUKE-100 |
| C2 | `feat(web): turns queue, drainer, and ask routes` — `POST /api/brain/ask` enqueues, `GET turns/{id}?wait=`, cancel; one drainer under B4's lease; asks ahead of observation turns; steer fold-in | C1, B4 | M | LUKE-100 |
| C3 | `feat(web): wake cron enqueues coalesced roster-diff turns` — one message per observed conversation per pass; `provider_cursors` advanced with the observation message | C2 | S | LUKE-100 |
| C4 | `feat(web): prompts and tool sets content-addressed on the turn` | C1 | S | new |
| C5 | `feat(web): announce writes speech.offered; delivery state as events` — offered → claimed (unique insert) → spoken / pushed / expired / held; expiry in the cron | C1, B2 | M | LUKE-101 |
| C6 | `feat(web): ratings as events` — `PUT .../messages/{id}/rating` writes a `rating` event on a message the caller owns | B6 | S | LUKE-108 |
| C7 | `feat(web): the turn event stream over HTTP` — `GET /api/brain/turns/{id}/events` (SSE or long-poll) so the voice service can append commentary from a running turn | C2 | S | new (Live PR 8) |
| C8 | `feat(voice-service): host the live session service` — lift the rollout's LiveSessionService (delegation adapter, hold queue, record writer) from `packages/host` into `apps/voice-service` behind its brain interface, now over C2 and C7; B7 writes the record | C7, B7, Live PR 9 landed | M | new (owned by us, not the rollout) |

## Lane D — reads, view, and push

| id | title | after | size | from |
|---|---|---|---|---|
| D1 | `feat(session): the Conversation view selection` — pure function: main's messages plus announce calls and action parts from observed conversations, grouped by turn; fixtures | A1, A2 | S | new |
| D2 | `feat(web): per-resource read routes` — `messages?after=`, `events?after=`, `turns?after=`, change signal; the view applied server-side; a poll refreshes presence and last seen | B6, D1 | M | LUKE-101 |
| D3 | `feat(web): APNs push for an unclaimed briefing` — no active device → push at once; active but unclaimed past grace → push; quiet-until respected; hold release wakes the brain | C5, D2 | S | LUKE-101 |

## Lane E — desktop

| id | title | after | size | from |
|---|---|---|---|---|
| E1 | `feat(desktop): render UIMessage tool parts and the action envelope` — rows composed from `input` + envelope, chips from the roster snapshot; driven by the dev harness (#650) before any data source moves; `verify.sh` | A1, A2, D1 | M | #882–#904 |
| E2 | `feat(desktop): fold turns, collapse read tools, mark own judgment` — by `turn_id` and `turns.origin`; `verify.sh` | E1 | S | #897 |
| E3 | `feat(desktop): rows draw the stored roster snapshot` — local observation loop no longer started | PR 4 | S | LUKE-102 |
| E4 | `feat(desktop): Conversation from the service` — D2 reads into the E1 renderer; local Conversation store no longer read | D2, E2 | M | LUKE-102 |
| E5 | `feat(desktop): asks to the service` — composer and talk key submit to C2; local BrainAgent no longer wired | C2, E4, C8 | M | LUKE-102 |
| E6 | `feat(desktop): presence reporting` — active-until from `powerMonitor`, quiet-until from the calendar hold, on every poll | D2 | S | LUKE-103 |
| E7 | `feat(desktop): vault key entry and the fixture service client` — introduction timing belongs to the Live rollout's PR 10 | E5 | S | LUKE-104 |
| E8 | `feat(desktop): rating control on Luke's messages` | C6, E4 | S | LUKE-108 |

Briefing speech on the Mac is the Live rollout's PR 8/9 (commentary appends from the voice
service), so LUKE-103's "claim and speak" half is withdrawn here.

## Lane F — iOS and watch

| id | title | after | size | from |
|---|---|---|---|---|
| F1 | `feat(ios): Conversation screen over messages` — UIMessage decoding in LukeKit with shared JSON fixtures, tool parts and envelope rendered, masked from replay | D2 | M | LUKE-105 |
| F2 | `feat(ios): asks to the service` — typed ask to C2; voice waits for the Live follow-up | F1 | S | LUKE-105 |
| F3 | `feat(ios): push opens the Conversation` | D3, F1 | S | LUKE-105 |
| F4 | `feat(ios): rating control` | C6, F1 | S | LUKE-108 |
| F5 | `feat(watch): Conversation list over messages` — read-only, ratings shown | F1 | S | LUKE-106 |

## Lane G — removal (after E5 and F2)

| id | title | after | size | from |
|---|---|---|---|---|
| G1 | `refactor(desktop): delete the SQLite brain store and runtime-store worker` | E5 | M | LUKE-107 |
| G2 | `refactor: delete ConversationEntry, narration, recovery archives, store maintenance` | G1, E4 | M | LUKE-107 |
| G3 | `refactor(providers): delete local providers, hooks, spool watcher, Superset, Linear` | E3 | L → split by provider if over 800 lines | LUKE-107 |
| G4 | `chore(web): drop the v1 conversation tables and the briefings table` | C5, D2, E4, F1 | S | LUKE-97 |
| G5 | `docs: rewrite CLAUDE.md, PRIVACY.md, README for the hosted brain` | G1–G4 | M | LUKE-107 |

## Sequencing against the GPT-Live rollout

The rollout lands first, through its PR 9 (desktop cutover) and 11, against the desktop's local
brain and SQLite Conversation as they stand. Our lanes A–D never touch the voice path, so they
run in parallel without touching his tree. The one ordering constraint is ours: E5 (asks to the
service) removes the local brain the rollout's LiveSessionService depends on, so C8 lifts that
service into the voice service first, and E5 depends on C8. We own the lift; the rollout is
asked only for the interface seam, and for the iOS follow-up not to start on Responses
delegation.

## Critical path and parallelism

S0 → A7 → C1 → C2 → E5 (asks on the service) → G1. Lanes A and B run in parallel from day one
(A1 first; B1 needs only A1's metadata shape). D1 and E1/E2 run in parallel with lane C, since
they consume fixtures. F starts once D2 lands. Existing issues to rework: LUKE-100 → C1–C3,
LUKE-101 → C5, D2, D3, LUKE-102 → E3–E5, LUKE-103 → E6, LUKE-104 → E7, LUKE-105 → F1–F3,
LUKE-106 → F5, LUKE-107 → G1–G5, LUKE-108 → C6, E8, F4. New sub-issues: S0, A1–A8, B1–B7, C4,
C7, D1, E1, E2. Thirty-eight PRs in total, none over M by intent.
