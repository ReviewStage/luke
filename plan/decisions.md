# Decision record

Every decision that amends `storage-plan.md` or `tickets.md`, in the order it was made. The
orchestrator appends here the same hour it decides anything that touches a schema column, a
wire value set, a contract, or a trust rule, and every brief points at this file. Where this
file disagrees with `storage-plan.md`, this file wins.

## 2026-09-10 21:07 — Lane C targets eve (orchestrator, from S0)

eve 0.53.1, one session per brain conversation, `defaultTools: false`, `limits.sessionTimeoutMs:
false`, rotation seeded from our `messages` rows. The per-account lease and drainer are not
built; `conversation_lease` has no writer. `turns.response_ids` and the opaque reasoning item
cannot be filled from eve's stream. Details in `spike-findings.md`.

## 2026-09-11 (Dean, after the progress audit)

1. **Turn policy.** eve `turnPolicy: "queue"` for every trigger. Fold-in steer is not built.
   Explicit Stop uses eve's cancel. Revisit only if the voice feel demands it after C8.
2. **Compaction on the hosted path: none.** eve compacts its own context; our `messages` table
   is the record, not the model's context; rotation seeds from the last N rows; the view draws
   no compaction divider. The `compaction` assistant metadata stays in the vocabulary for the
   desktop's remaining loop until G1 deletes it. C1 writes no compaction rows.
3. **Turn origin.** Add `child_completion` to the wire `TURN_ORIGIN`; observation stays
   `roster_diff` (cloud-only has no hooks). The writer maps nothing else. One small PR.
4. **Reasoning to clients.** Strip `providerMetadata.openai` (the opaque item and item id) on
   every read route before F1 merges; devices receive the summary text only.
5. **Step-start.** One follow-up writes `step-start` parts in the brain's message builder and
   the store writer, and adds the end-to-end test (builder → writer → `readStoredUIMessages`
   → `convertToModelMessages`) over a multi-step turn. Lands before C2 starts.
6. **C1 (#957).** Fix the prompt-and-seed race on `session.started` before merge. The
   ownership fail-open for an unrecorded session id moves to C2 with a named test. Merge C1
   once green; do not split a finished PR.
7. **C2 is three PRs.** (a) deploy shape: `vercel.json#services` and whatever makes the eve
   service deployable; (b) ask routes over eve sessions; (c) ownership hardening and the C1
   residual. The ~0.3 s per step-boundary measurement is an input to (b).
8. **Size bound is enforced from here.** A remaining PR over ~800 changed lines (generated
   files excluded) is split before it opens, not after. Every brief says so.
9. **E4 (#977) merges now** with LUKE-151 already landed; the typed-ask window until E5 is
   accepted and recorded in E5's brief.
10. **`verify.sh`.** Accepted unrun until the release gate. New ticket: one manual
    verification pass on a Mac over E1–E4 and F1 before the first release, owned by Dean.
11. **B4 is cancelled.** `conversation_lease` is dropped in G4.
12. **Escalation threshold unchanged**, with one addition: every schema, wire value-set,
    contract, or trust-rule decision is appended to this file the same hour it is made.
13. **`turns.model` and `reasoning_effort`** are set on `TURN_STARTED` by C1 from eve's
    resolved model; `prompt_hash` and `tool_set_hash` stay C4's.
14. **Deployment gate.** Since #992, every route needs a committed `api/` stub
    (`pnpm --filter @luke/web functions:stubs`); the build refuses drift. E4 and C1 rebase and
    regenerate before enqueueing.

## 2026-09-11 — The lane-C record in full (orchestrator; cited by #957's body)

The 21:07 entry above is the decision; this is the record behind it, written out here because
#957 cites it and because the consequences were carried into briefs one at a time as they were
discovered rather than settled in advance.

**The choice.** S0 (LUKE-109) ran one real Luke turn end to end on eve 0.53.1 locally — a real
Conductor roster, `read_transcript` through the plugin, `admit()` inside a tool's `execute`,
`announce` writing an event row, and a 58-line writer turning eve's NDJSON into
`validateUIMessages`-clean rows. C1 then measured it hosted on a throwaway Vercel project
(`plan/spike-findings.md`, hosted addendum). **eve stands.**

**Consequences, as they were briefed:**

| What | Decided |
|---|---|
| Turn policy | `queue` for every trigger; fold-in is not built; Stop is eve's cancel. eve's `steer` cancels the running turn and discards the in-flight step whole, which is a kill, not a fold-in. |
| Drainer and lease | Not built. One eve session per brain conversation serializes it. B4 cancelled; `conversation_lease` dropped in G4. |
| Compaction | **None on the hosted path.** eve compacts its own context; `messages` is the record, not the model's context; rotation seeds from the last N rows; the view draws no divider. The `compaction` metadata stays in the vocabulary for the desktop loop until G1. |
| Context engine | A7's `convertToModelMessages` derivation narrows to the rotation seed and the view; eve owns a live turn's context. |
| `turns.response_ids` | Optional — OpenAI response ids are not on eve's stream. |
| The opaque reasoning item | Not on eve's stream; eve owns replay. Clients receive the summary only (D2d strips it at the route). |
| `defaultTools` | **`false`, and this is a trust rule rather than a cost saving.** eve ships `bash`, `read_file`, `write_file`; CLAUDE.md makes the workspace tools the one place the brain writes a file at all. Asserted in a test. |
| Session ownership | **eve does not enforce it; the host must.** C1 moved the check to the door — refused before eve accepts the request — rather than inside the tools. The fail-open on an unrecorded id is C2c's, with a named test. |
| One session per conversation | Admission requires the recorded session; a start claims the record forward-only by compare-and-set on eve's sortable ids. |
| Rotation | An eve session is one long Workflow run against Vercel's 25,000-event cap (replay slows past 2,000), so it rotates every couple of hundred turns, seeded from our `messages` rows. Our tables are the record; eve is not. |
| `turns.model`, `reasoning_effort` | Set on `TURN_STARTED` by C1 from eve's resolved model. `prompt_hash` and `tool_set_hash` stay C4's. |
| Writer caveats (S0 Q3) | `reasoning.completed` arrives **after** the step's `action.result` — order by `stepIndex`, not arrival; `message.completed` fires per interim text and is null for `<eve-empty-delivery/>`; cancelled tool parts settle on `turn.cancelled`; retried steps re-emit under new `meta.id`s, so dedupe by `turnId`/`stepIndex`/`sequence`. |
| Measured cost | ~0.3 s per **step** boundary (300 ms typical, 425 ms worst, against 30–50 ms local); ~1.1 s warm `POST` → `turn.started`; ~$0.0006 per turn from measured event counts. **Budget scheduling per step, not per turn.** Nothing near the 240 s deadline. |

**Orchestrator decisions taken under this record, each because the design already assumed the
property and only a structure could keep it true:** `unique (conversation_id, seq)` on messages
and events (ordering); `unique (live_session_id)` on voice sessions (re-attach idempotence);
the partial unique index making one standing main per account structural; `timestamptz` on every
v2 instant; `tokens_before` optional so an uncounted compaction is absent rather than zero; and
`unknown` routed to `output-available` carrying the envelope so an unknown action is never drawn
or read as a refusal.

## 2026-09-11 04:0x — Two records from the audit's execution (orchestrator)

**Item 6's residual did not move: C1 closed it.** `decisions.md` item 6 said the ownership
fail-open for an unrecorded session id "moves to C2 with a named test". C1 (#957) closed it
instead — `ownedAuth` refuses a session route with no recorded owner — and says so in its PR
body. C2c (LUKE-158) is narrowed accordingly: the concurrency test (two concurrent starts on
one conversation leave exactly one session), door hardening, and a named test for the
unrecorded id anyway so the guarantee is asserted rather than inferred. Recorded because a
reader of item 6 would otherwise look for this in C2c and find it already done.

**Item 4's strip is compiler-kept, not remembered.** D2d (#1001) was asked whether making the
strip structural was cheap; it was. `ClientUIMessage` is a branded type behind a module-private
unique symbol in `@sidecar/session/ui-messages`, minted **only** by `clientUIMessage` (the
strip), and the messages route's answer type names it — so a stored row cannot reach a response
unstripped, and a future route that types its answer the same way cannot forget the call. Cost
was one type on the route's answer plus one cast inside the strip.

Three properties of that fix worth keeping if anyone revisits it:

- **It strips `providerMetadata.openai` only**, keeping other providers' metadata. Over-stripping
  would have been the easy mistake.
- **It never mutates the stored row.** The opaque item stays in the database, because A7's engine
  replays it under `ReplayTarget { provider, model }`.
- **The brain's `REASONING_PROVIDER_KEY` is held equal to the session's `REPLAY_PROVIDER_KEY`
  by a test**, so the key the brain writes and the key the stripper looks for cannot drift apart
  silently.

The route test asserts on the **parsed response body** against a row that genuinely carries
`itemId` and `reasoningEncryptedContent`, and confirms the database row still has both. It was
**mutation-checked**: with the strip replaced by a cast the test fails. A test that has been
shown to fail without the fix is worth more than one that merely passes with it.

**Scope of the leak it closed, stated precisely:** `handleConversationMessages` serialized each
row exactly as `readStoredUIMessages` returned it, so any stored reasoning part carrying
`providerMetadata.openai` left the service to every client. On the eve path that is at most the
item id, since eve's stream carries no opaque item; a Responses-path row carries the full
encrypted item. Only the Conversation messages read could carry a message — the turns and events
routes carry no parts.
