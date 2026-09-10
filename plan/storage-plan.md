# Luke conversation storage: the plan

Settled 2026-09-10 in a grilling session over the LUKE-95 hosted build-out. This is the
record of every decision, the schema, the seams, and how the plan reaches eve, GPT-Live-1,
and the tool rendering the #882–#904 stack was reaching for. Nothing here is code.

## Decisions

Product and posture
- Cloud only. Keyed mode is removed. Accounts are the only way in. (LUKE-95, reaffirmed.)
- One long Conversation per account from the user's perspective. `thread` stays a kind in the
  schema; no chat UI now. Adding chats later is inserting rows and building UI, no migration.
- Content is stored unencrypted in Postgres. Sealing stays only for provider API keys in the
  vault. PRIVACY.md is rewritten to say operators can read stored conversations for support
  and debugging.
- Clear is a soft delete: stamp `deleted_at` on the main conversation and open a new main row.
  Purge after 30 days. Account deletion hard-deletes everything through the cascade.
- Start clean: no data migration from either existing schema; the desktop's `agent.sqlite`
  conversation tables are retired.
- OpenAI `store` is left on (no `store: false`); response ids are recorded on the turn.
  Reasoning summaries are requested (`reasoning: { summary: "detailed" }`) and stored.
  Audio is never stored (`store` off on Live sessions).

Storage shape
- UIMessage (AI SDK) is the stored message format: one row per message, parts as jsonb.
  `validateUIMessages` reads rows back; `convertToModelMessages` builds the model context every
  turn. No checkpoint table.
- Messages and events are two tables, each with its own per-conversation sequence.
- A message in flight is mutable until `finished_at` is set: tool parts are written in state
  `input-available` before execution and updated to `output-available` / `output-error` after.
  That row is the write-ahead record ("journal") a resume reads. Immutable once finished.
- Compaction is an assistant message whose text is a model-written summary, with metadata
  naming the first kept message and tokens folded. The context is every message from the
  latest compaction onward. No provider-side compaction item.
- Reasoning is a `reasoning` part on the assistant message: summary text plus the provider's
  opaque item (encrypted_content) in providerMetadata for replay. Replay keeps reasoning
  items in sequence beside the calls they preceded, whole or dropped whole; a provider or
  model change drops them cleanly. Clients receive the summary, not the opaque item.
- A `turns` table (LUKE-95's run row) holds the run's mutable state and metadata: origin,
  status, model, reasoning effort, prompt hash, tool-set hash, response ids, usage split into
  input/output/cached/reasoning, timings, failure, cancel requested. Messages carry `turn_id`.
- `prompts` and `tool_sets` are content-addressed by hash and referenced from the turn.
- Voice is stored like a call platform stores a call: `voice_sessions` and
  `voice_transcript_segments` (role, text, start_ms, end_ms). Not in `events`.
- `events` holds low-volume facts about messages: speech offered / claimed / spoken / pushed /
  expired, ratings (LUKE-108), call-level delivery facts. The atomic briefing claim is an
  insert under a unique partial index on `(message_id, kind = 'speech.claimed')`; no
  `briefings` table.
- `provider_cursors` holds Conductor's `after` cursor per observed session. Messages never
  reference it. An observation turn reads the cursor, writes the observation as a user
  message, and advances the cursor in one transaction.
- `conversation_lease` stays as #898 has it, one per account (single stream, below).
- Observed conversations stay separate brain conversations (one per Conductor session), keyed
  by `provider_id` + `provider_session_id` columns, not by an encoded string key. Only
  announcements and actions cross into the developer's view, by projection, never by a
  mirrored row. No `source_turn_id` / `source_tool_call_id`.
- Children are conversations of kind `child` with `parent_conversation_id`,
  `spawned_by_message_id`, and a fork pointer (`fork_of_seq`) rather than a copied prefix.
  Completion lands in the parent as an assistant message with `author: child`, unique on the
  completion id. Deleting a parent cascades to descendants.
- `once_published` is gone; idempotency is the standard unique `(conversation_id, client_id)`.

Execution
- Single stream per account: every trigger (typed ask, spoken ask, roster diff, hold release,
  child completion) is a queued row in `turns`; one drainer under one per-account lease runs
  them in order. Developer asks drain ahead of observation turns.
- Turn policy is per trigger: developer asks steer (Luke's fold-in form: the running turn reads
  the ask at its next model boundary and answers both); roster diffs, hold releases, and child
  completions queue, one coalesced message per observation pass.
- The store writer is a consumer of a runtime event stream (turn started, message completed,
  tool call started/settled, reasoning completed, compaction completed). Our loop emits it now;
  eve's NDJSON stream feeds the same consumer later.
- Tools are eve-shaped modules: description, Zod input schema, output type,
  `execute(input, ctx)`; `admit()` runs inside `execute`. The catalog decides which tools a
  turn is offered. Memory is a provider: `recall`, `capture`, `tools`.
- Lease, resume, compaction owner, and context engine are marked disposable (eve replaces
  them); no business rule may live inside them.
- `conversations.runtime_session_id` carries our id now and eve's session id later.

Sync and clients
- Per-resource reads with cursors (`messages?after=`, `events?after=`, turns, roster) and one
  change signal; polling first. No single `/api/feed`. Each device keeps its own cursors
  client-side; all devices converge on the same rows in the same order.
- The Conversation view is a server-side selection in `packages/session`: main's messages in
  full plus, from observed conversations, `announce` calls and action tool parts with their
  turns. Clients receive tool parts (input + output envelope) and word rows themselves; the
  wording sets stay aligned by the iOS parity check. Server-rendered rows are a later option.
- Every action tool returns one output envelope (defined in the actions package): status,
  the resolved target snapshot (provider id, provider session id, title, agent id, control
  kind), and a created session identifier when there is one. Rows compose from input +
  envelope; the roster snapshot supplies current names at render.
- A refused action is a tool part in `output-error`, drawn only inside the expanded turn.
- Read tools (read_transcript, list_sessions, memory_search, workspace reads) draw collapsed
  inside the turn, keyed off the catalog's act / read / write flag.
- Folding, the open-while-running behaviour, and the own-judgment mark come from `turn_id`
  joined to `turns` (status, origin). Wakes get turn rows too.

Voice (GPT-Live-1)
- Client delegation. `/api/brain/ask` is the backend; a delegation event replaces the
  `ask_brain` tool; replies return via `session.commentary.append` (chunked at 500 tokens);
  briefings are injected with a null delegation id. The brain works with or without a call.
- Transcripts are timed streams with no item ids and no turn-completed event; the app cuts
  spoken asks. A spoken ask's user message records `voice_session_id`, `delegation_id`, and
  the millisecond span it was cut from. Output transcripts are paraphrases of the brain's
  text, so both are stored: the brain's message and the voice's segments.
- Session lifecycle (`session.started`, `session.closed` + reason, `session.usage.updated`)
  lands on `voice_sessions`.

Order of work
- Spike first (two days): one Luke turn on eve with `admit()` inside the tools and our writer
  consuming its stream. Settles session TTL, queued-message batching, event completeness,
  caller identity in `ctx`, latency and cost. Then PR 2b and PR 5 are rewritten against
  whichever runtime it favours.

## Schema

```sql
conversations
  id uuid pk, user_id, kind (main|observed|child|thread),
  provider_id, provider_session_id,                    -- observed; unique per user
  parent_conversation_id, spawned_by_message_id, fork_of_seq,   -- child
  runtime_session_id, created_at, last_activity_at, deleted_at,
  next_message_seq, next_event_seq

messages
  id uuid pk, user_id, conversation_id, seq, turn_id, client_id,
  role (user|assistant|system), parts jsonb, metadata jsonb,
  created_at, finished_at
  -- metadata (user): author developer|brain|voice_model, channel typed|voice,
  --   voice_session_id, delegation_id, from_ms, to_ms, source hook|roster_look
  -- metadata (assistant): author brain|voice_model|child, compaction {first_kept_message_id, tokens_before}
  unique (conversation_id, client_id)

events
  id, user_id, conversation_id, seq, message_id, kind, device_id, payload jsonb, created_at
  -- kinds: speech.offered, speech.claimed, speech.spoken, speech.pushed, speech.expired,
  --        speech.held, rating
  unique partial (message_id) where kind = 'speech.claimed'

turns
  id uuid pk, user_id, conversation_id, origin (typed|spoken|roster_diff|hold_release|child),
  status (queued|running|settled|cancelled|failed), model, reasoning_effort,
  prompt_hash, tool_set_hash, response_ids text[], usage jsonb,
  queued_at, started_at, settled_at, failure, cancel_requested_at

conversation_lease
  user_id pk, owner, acquired_at, heartbeat_at, expires_at         -- one per account

prompts   hash pk, text, created_at
tool_sets hash pk, schemas jsonb, created_at

voice_sessions
  id uuid pk, user_id, device_id, live_session_id, delegation_mode,
  started_at, closed_at, close_reason, usage jsonb

voice_transcript_segments
  voice_session_id, seq, role (user|assistant), text, start_ms, end_ms

provider_cursors
  user_id, provider_id, provider_session_id, cursor, updated_at
```

Existing and unchanged: roster_snapshot, roster_diff, observation_pass, workspace files,
facts / notebook provenance, devices, quota, auth, vault.

Removed: conversation_session (generation), runtime_checkpoint, observation_cursor,
observation_capture_cursor, observation_inbox_entry, conversation_run (→ turns),
action_receipt (→ tool parts), conversation_line (→ messages), transcript_event (→ messages),
compaction_boundary (→ compaction message), briefings (→ events), conversation_line_rating
(→ events), and the desktop's SQLite equivalents.

## The #882–#904 stack

Not merged; superseded. Every field it added to `ConversationEntry` is a field of a
UIMessage tool part or the action output envelope:

| stack | plan |
|---|---|
| `action.kind` | tool part `toolName`; catalog flag act/read/write |
| `text`, `label`, `applicationId`, `agent`, `name` | tool part `input` |
| `identity` | in `input` (admission requires it) |
| `title`, `agentId`, `controlKind` | output envelope target snapshot |
| `createdSession` (#904) | output envelope created session id |
| record after effect (#890) | part state `output-available` / `output-error` |
| `runId`, fold (#897) | `turn_id` + `turns.status` |
| own judgment vs at request (#882) | `turns.origin` |
| live rename (#892), provider display name (#889) | roster snapshot join at render |
| departed chat address (#904) | roster snapshot history |
| narrated `words` | dropped; model reads tool parts, rows compose from record |

## What eve replaces later

lease and resume → one active turn per session, `turnPolicy`; compaction → eve's;
context engine → eve's; `turns` → written from `turn.*` events or replaced by Agent Runs;
cron → `schedules/`; children → `subagents/`; tools → `tools/*.ts`; workspace files →
`instructions.md` + skills + a memory provider. Our messages / events / voice tables remain:
eve exposes no history endpoint, so they are written from its stream.

## Coordination with the GPT-Live rollout

Charles's rollout (`orchestration/gpt-live-rollout`, PRs 1–17) already chose client delegation,
`store: false`, a transcript ledger grouped by gap, seeding `input` from the Conversation, and
the brain as backend. It agrees with this plan on every table. Three placements differ and are
carried to its PR 8 and iOS follow-up (see `linear-drafts.md`): Luke's spoken words are
segments, not messages; the delegation adapter and record writer run in the voice service,
not the desktop host, consuming the brain's turn event stream over HTTP; iOS uses client
delegation through the same service.

## Open items carried, not decided here

- Whether observed conversations map to one eve session or one per Conductor chat (spike).
- eve session TTL (30-day default) versus a years-long conversation (spike).
