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
   **Done: LUKE-154, #998 (`58c92d3c`)** — the wire value set, the Swift `TurnOrigin` mirror in
   `ConversationReads.swift` and `UIMessage.swift`, and the writer's
   `BRAIN_TURN_ORIGIN.CHILD_COMPLETION` map. Nothing else was added to the set.
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
| Context engine | A7's `convertToModelMessages` derivation narrows to the rotation seed and the desktop's own loop until G1; `packages/brain/src/ui-message-context.ts` is its only caller anywhere. eve owns a live turn's context. **The Conversation view converts nothing:** `selectConversationView` selects `UIMessage` rows and the read routes answer them as rows, so no read path on the service depends on that derivation. |
| `turns.response_ids` | Optional — OpenAI response ids are not on eve's stream. |
| The opaque reasoning item | Not on eve's stream; eve owns replay. Clients receive the summary only (D2d strips it at the route). |
| `defaultTools` | **`false`, and this is a trust rule rather than a cost saving.** eve ships `bash`, `read_file`, `write_file`; CLAUDE.md makes the workspace tools the one place the brain writes a file at all. Asserted in a test. |
| Session ownership | **eve does not enforce it; the host must.** C1 moved the check to the door — refused before eve accepts the request — rather than inside the tools. The fail-open on an unrecorded id is C2c's, with a named test. |
| One session per conversation | Admission requires the recorded session; a start claims the record forward-only by compare-and-set on eve's sortable ids. |
| Rotation | An eve session is one long Workflow run against Vercel's 25,000-event cap (replay slows past 2,000), so it rotates every couple of hundred turns, seeded from our `messages` rows. Our tables are the record; eve is not. |
| `turns.model`, `reasoning_effort` | Set on `TURN_STARTED` by C1 from eve's resolved model. `prompt_hash` and `tool_set_hash` stay C4's. |
| Writer caveats (S0 Q3) | `reasoning.completed` arrives **after** the step's `action.result` — order by `stepIndex`, not arrival; `message.completed` fires per interim text and is null for `<eve-empty-delivery/>`; cancelled tool parts settle on `turn.cancelled`; retried steps re-emit under new `meta.id`s, so an adapter must carry a **call id** and a **reasoning item id** through a retry unchanged — the writer dedupes on those and never reads an event's `sequence`. See the writer-identity entry below for what it actually keys on. |
| Measured cost | ~0.3 s per **step** boundary (300 ms typical, 425 ms worst, against 30–50 ms local); ~1.1 s warm `POST` → `turn.started`; ~$0.0006 per turn from measured event counts. **Budget scheduling per step, not per turn.** Nothing near the 240 s deadline. |

**Orchestrator decisions taken under this record, each because the design already assumed the
property and only a structure could keep it true:** `unique (conversation_id, seq)` on messages
and events (ordering); `unique (live_session_id)` on voice sessions (re-attach idempotence);
the partial unique index making one standing main per account structural; `timestamptz` on every
v2 instant (narrowed and then extended by the ruling below: `devices`' three instants become
`timestamptz` too, in LUKE-160); `tokens_before` optional so an uncounted compaction is absent rather than zero; and
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

## 2026-09-11 04:2x — C1's door refuses an unnamed conversation before eve dispatches (orchestrator, from #957's Security Agent)

A MEDIUM finding worth recording as a trust rule rather than a bug fix, because it names a
property the door must keep rather than a line that was wrong.

**`POST /eve/v1/session` with a missing or malformed conversation header passed the door**, and
**eve dispatched a durable, unmetered, unrecorded run** before the host refused it with
`NO_CONVERSATION`. The refusal was correct and too late: by the time it happened, a Workflow run
existed that nobody had paid for, nobody had recorded, and no conversation owned.

**The door now refuses the open route unless it names a well-formed conversation of the
caller's.** So the ordering is the rule: *identify and admit before dispatch, never after*.

This generalises past the one route, and C2a/C2b/C2c should hold to it: **anything that can
cause eve to start durable work must be admitted before it starts, not validated after.** eve
does not enforce session ownership (S0's spike), the host is the only thing standing there
(C1's earlier finding), and a check that runs after dispatch protects the record but not the
spend.

Recorded alongside C1's other two ownership properties: a session or conversation that is not
the caller's is refused before eve accepts the request, and a conversation runs in one eve
session at a time, claimed forward-only by compare-and-set on eve's sortable ids.

## 2026-09-11 04:2x — Gates that did not exist when the graph started (orchestrator)

Recorded because five of them appeared in one night on a repository three workstreams are
changing at once, and each cost real time before someone proved what it actually did:

1. **`apps/web` moved to vitest** with no `testTimeout`, so database-backed tests timed out at
   the 5 s default under load. Fixed (#987, suite-wide 30 s).
2. **No `LukeKit` target in CI.** Swift compile and logic errors land green. Standing rule: if
   your PR edits Swift, run the Swift tests; recipe in the orchestrator's addendum.
3. **No watch target in CI either** — `DisclosureGroup` is unavailable on watchOS and F5's use
   of it merged green, breaking the watch build on main.
4. **Push-on-main does not run lint**, so main went red on an unused-suppression error (#992)
   without anyone seeing it, blocking every merge group. Fixed (#999).
5. **A `CLEAN` PR check does not mean a PR can merge.** The PR check runs on the merge base; the
   merge group runs on current main and lints the whole tree.
6. **JSON Schema goldens** (#994) mean any PR widening a recorded schema fails
   `hosted-wire-schemas` after a rebase until the fixture is re-recorded with
   `LUKE_UPDATE_FIXTURES=1`.

The common shape: **every one was a gate that did not say what it appeared to say.** A missing
gate is worse than a failing one, because nobody knows to look.

## 2026-09-11 — Voice-only on the desktop, and what it does and does not touch (orchestrator, from the GPT-Live rollout)

**PENDING, NOT LANDED — this describes PR 20, which is not on main.** `CONVERSATION_ENTRY_KIND.TYPED_ASK` and `SPOKEN_ASK` still exist, and `followTypedAsk` is still in `packages/host`'s `compose-host.ts` and `compose-live.ts`. Read every sentence below as future tense until the rollout says PR 20 has merged; C8 in particular must not go looking for a seam that is still there.

Charles's PR 20 (`live/20-voice-only`) will make Luke **voice only on the desktop**: the typed
composer goes, with `BRAIN_SUBMIT_ASK`, `BRAIN_REQUEST_ORIGIN.TYPED`, and the typed thinking
mirror; `CONVERSATION_ENTRY_KIND.TYPED_ASK` is deleted outright and `SPOKEN_ASK` becomes `ASK`.
It touches no `apps/web/server`, no drizzle, no iOS.

Recorded here because three of my tickets change and one wire value set was at risk:

- **`TURN_ORIGIN` keeps `typed`.** Confirmed with the rollout: `BRAIN_REQUEST_ORIGIN` is the
  desktop brain's enum, not the storage wire's. The phone still types, so `typed` is
  load-bearing and C2b's ask route still takes `typed | spoken`.
- **F2 (LUKE-140) stands as written.** Charles has ruled on the desktop composer only and has
  **not** ruled on the phone; the rollout reads that as "not yet" and will say when it changes.
- **E5 (LUKE-138) shrinks to the talk key alone.** Its scope was "composer and talk key submit
  to the service"; there is no composer to move.
- **C8 (LUKE-132) gets simpler, not bigger.** I earlier recorded that `LiveSessionService` had
  grown to own typed-ask replies via `LiveComposer.followTypedAsk`, making C8 a larger lift.
  **PR 20 deletes `followTypedAsk` and the adapter's `followCurrent`**, so when C8 opens there is
  no typed seam on that service at all — only the delegation path (`submitAsk` origin `SPOKEN`
  plus `onRunEvent`). One path to repoint rather than two. **Do not reintroduce a typed path in
  the lift.**

Also settled, and not a defect in this lane: the two-Luke-bubbles-per-reply the rollout saw was
the desktop tab drawing the local brain store's lines (`publication.ts`'s reply line and
live-record's transcript line). The desktop tab does not render E4's service-backed view on main
yet. The Postgres split is unchanged — the assistant message is the brain's reply, the spoken
words are `voice_transcript_segments`, and nothing spoken becomes a message.


## 2026-09-11 — Corrections from an audit of this file against main (orchestrator)

A worker read this file end to end against main at `15ea0016` and checked every claim in the
tree. Most verified. Four things needed fixing, and they are fixed here.

**1. The voice-only entry was written in the present tense and is not on main.** Corrected above
with a PENDING banner. My error: I recorded a rollout's plan as though it were a merge.

**2. "`timestamptz` on every v2 instant" is true of the v2 TABLES and not of every instant this
rework added.** E6's `active_until` and `last_seen_at` and D2b's `quiet_until` sit on the v1
`devices` table as plain `timestamp`, following that table's style.

**Ruling: those three columns should become `timestamptz`, and before C5 or D3 build on them.**
When I set the v2 rule I told B1 that "v1's bigint and `devices`' naive timestamp stay as they
are because nothing in this rework touches them." That rationale is no longer true — this rework
added two of those three columns. And the hazard is not hypothetical for `quiet_until`
specifically: it is an instant compared against *now* to decide whether Luke speaks during a
meeting, which is exactly the naive-vs-aware footgun I cited when setting the rule. A wrong
comparison means Luke speaks into a meeting or stays silent after one. C5 reads it to hold
speech and D3 to decide a push; fixing it before they are built is far cheaper than after.
Filed as its own ticket.

**3. A stale header comment** in `apps/web/server/db/storage-schema.ts` (~line 34) says "nothing
reads or writes these yet", which D2, E4, and F1 falsified. Sweep-in for whichever PR next
touches that file (C1 or C2a); not worth a PR of its own.

**4. `latestMessageRating` (`hosted/store/message-reads.ts`, exposed as `store.ratings.latest`)
has no production caller** — only its own test. D2c's fold made it permanently unnecessary. It
is a dead read wearing a live name, which is the same hazard as a dead-code deletion in reverse:
the next person to need a rating will find it and use it, reintroducing the per-client events
sweep the fold removed. **Delete it in G2** with the other cleanups, or sooner if a PR is in
that file.

**And one clarification the D2d entry needs, which is not a contradiction.** That entry says the
turns and events routes "carry no parts", which is true. It does not follow that they carry no
user content: **the events read carries a rating's free-text note (up to 500 characters) to every
device of the account.** That is the developer's own words going to the developer's own devices,
which is fine — but nobody should read "no parts" as "no developer text", least of all anyone
later deciding what may be logged, cached, or handed to a third party.


## 2026-09-11 — What the writer dedupes on, and what that asks of an eve adapter (orchestrator, from C2b's audit)

C2b audited this file against main before starting and found the lane-C table's "Writer
caveats" row naming identities the writer does not use. The row is corrected above; this is the
record of what `apps/web/server/hosted/store/writer.ts` on main actually keys on, because C2b's
adapter is written against it and C3's and C7's will be too.

| Thing written | The identity it is told twice by |
|---|---|
| A tool part | the call id (`toolPartOf(row.parts, event.callId)`) |
| A reasoning summary | the reasoning item's own id, compared against the parts already held |
| A step boundary | the journal's own **count** of `step-start` parts — steps are counted, not named, so a step the journal already holds is a repeat and any later one appends exactly one boundary, whatever the stream dropped between |
| A message | its `clientId`, which is the client's minted id and not a row id |
| A turn | its own id |

**`sequence` is not an identity here. The writer never reads it.** So the requirement an eve
adapter carries is not "order by our numbering" but **stability**: a step eve retries and
re-emits under a new `meta.id` must still present the same call id for the same tool call and
the same item id for the same reasoning item, or the retry lands as a second part.

**And a reasoning event whose item names no id is dropped whole** — `IGNORED`, not written —
because nothing could tell its second delivery from a second item. An adapter that cannot lift a
stable id for a reasoning item therefore silently journals no reasoning at all. That is a real
hazard for C2b to test rather than assume.

What bounds both hazards: **the turn's completed projection replaces the journal whole,
boundaries and all, when the turn answers.** A duplicate or a dropped summary is therefore a
defect in what the panel sees *while the turn runs* and not in the record it settles to. That is
a smaller blast radius than the row implied, and it is not permission to skip the identities —
a live turn is what a developer watches.

**Also from the same audit, and needing no change:** item 3 above is done and now says so;
the `devices` timestamps were already ruled on in the corrections entry and are LUKE-160, in
flight. Everything else the audit checked held — `response_ids` nullable, `unique (conversation_id,
seq)` on messages and events, `unique (live_session_id)` on voice sessions, the standing-main
partial unique index, and `conversation_lease` with no writer.


## 2026-09-11 — One instant helper for every v2 column, and migration numbers are a shared namespace (orchestrator, from E6b)

**The schema convention, which is the part that outlives this PR.** E6b (LUKE-160, #1017) moves
`devices`' three instants to `timestamptz` under the ruling above, and does it **through one
shared instant helper**, collapsing the private copies that `storage-schema.ts` and
`voice-schema.ts` each kept. That is now how a v2 instant is declared: **one helper, no fourth
private copy.** The rule "`timestamptz` on every v2 instant" was true and still got violated
twice, because it lived in prose while the declaration lived in three places — a rule a type can
carry should not be left to a reader's memory. C5, D3, and G4 use the helper.

**Verified before approving:** `0019_d2_devices_quiet_until.sql` is the highest migration on main,
so **0020 is E6b's and uncontested.** The conversion carries `AT TIME ZONE 'UTC'` so stored
instants survive whatever zone the migrating session happens to run in, and the test is the part
worth copying: 0000–0019 applied to PGlite under `Asia/Tokyo`, naive rows inserted, 0020 applied,
epochs asserted — **and a mutation check with the `USING` clauses removed fails by exactly nine
hours.** A migration test that cannot fail proves nothing; that one names its own falsification.

**Standing rule from it: a migration number is a namespace shared across every PR in flight, and
nothing enforces it.** Two branches can both write `0020` and both pass every check in isolation;
the second one to merge is a broken deploy, not a merge conflict. So before claiming a number,
read the highest on **main** and in every **open** PR, and say in the PR body which number you
took. Added to the standing addendum every brief carries.


## 2026-09-11 — Two more gates that do not say what they appear to say (orchestrator, from C2a)

Added to the gate findings above, from C2a's #1018, because both will outlive that PR.

**7. The Vercel preview is not a required check, so a deploy-shape PR can merge unverified.** The
required checks are `TypeScript checks` and `macOS app and evidence` and nothing else. #1018's
whole purpose is making the eve service deployable; it could read `CLEAN`, pass its merge group,
and merge with that service never once built. **Ruling: C2a holds its enqueue until a preview has
actually built the eve service.** And a subtler trap inside the same finding — the preview for
#1018 came back **Ready** four minutes after the push, which looks like success and is not: with
the project's framework preset unflipped, Vercel's documented rule (the Services framework *and*
a `services` key, both) means it built the **old single-app shape with the services block
ignored.** A green Ready on the wrong shape is worse than a red one.

**8. Previews sit behind Deployment Protection, and no worker can read one.** Every path 302s to
`vercel.com/sso-api`, and no worker — nor this orchestrator — holds a Vercel credential, so the
build log is the only evidence and it needs dashboard access. Every remaining lane that wants to
check a deployed route meets this wall, and the answer today is always "ask Dean to look."
**Escalated: a Protection Bypass for Automation secret would turn a human lookup into a worker's
own check.** That is Dean's to decide; it is recorded here because the cost is paid per PR.

**And one fragility worth naming, not yet a ticket.** `scripts/oxlint.sh` downloads node 24.21
from `nodejs.org` through nvm inside the **required** `TypeScript checks`, so a third party's
connection reset fails the gate (`curl: (35) Recv failure`). It flaked once on #1018. Workers are
told to rerun and not to look in their own diffs, and not to fix it inside an unrelated PR. If it
recurs it becomes its own ticket rather than a tax every one of the remaining tickets pays.


## 2026-09-11 — C2c's scope transfer, the mutation check as a standard, and one shared stamper (orchestrator)

C2c (LUKE-158) merged as `c903460a` **without its route half**, because C2b's PR was not open
when it finished. Recorded here so the transfer is visible rather than folklore.

**Ruling: the route-level ownership tests ride C2b-2, and are not optional there.** No follow-up
ticket. A door merges with its refusals asserted, or main carries an unasserted door for however
long a follow-up waits. C2b-2 owes, at the HTTP layer: another account's conversation refused, an
unrecorded session id refused, a cleared conversation refused — and **if that PR approaches the
~800-line bound, the refusal tests are not what gets cut.**

I considered a separate ticket so a second pair of eyes wrote them adversarially, which is the
real argument for splitting them, and declined it: the Security Reviewer runs adversarially on
every PR, and the standard below gets most of the rest without a slot or a window.

**The mutation check is now the standard for lane C.** C2c proved four guarantees by removing
each and watching a test fail. A tests-only PR whose suite cannot fail is the exact failure mode
of a tests-only PR, and naming the falsification is what makes it evidence. Two of its tests are
load-bearing in a way worth keeping: **the concurrent start in both orders with the loser relaying
nothing** (a weaker test leaves one row while both callers proceed), and **a rotated session's tool
call refused before any seam** — the placement, not the outcome, is the property, since C1's
Security Agent found eve dispatching a durable, unmetered, unrecorded run before a
correct-but-too-late refusal.

**One shared eve event stamper: `tests/support/eve-events.ts` (`stampedEveEvent`).** The relay and
ownership tests share it, C7 is pointed at it by name, and C2b and C5 use it too. Three private
copies of one spelling is how `timestamptz` went wrong a directory away, and E6b spent part of its
PR collapsing exactly that.

**One dependency re-derived, in the loosening direction: C7 does not need C2's ask routes.** Its
ticket says "After C2", but what it needs is a turn and its events, and both are on main — C1
writes `turns`, B5 writes `events` numbered per conversation. A test opens a turn through C1's own
composition, as C2c's merged tests do. C7 therefore started immediately rather than waiting on
C2b, which matters because C7 is the narrowest link on the critical path: C7 → C8 → E5 → all five
of lane G.


## 2026-09-11 — C5 splits, C3 gains two things, and the speech claimant is C8 (orchestrator, from C5)

C5 built LUKE-129 whole, measured it at ~1,750 changed lines, and split it before opening
anything, at the seam pre-authorized in its brief: **(a)** the wire payloads, the speech store
module, `announce`'s offer with its expiry, and the deletion of `store.briefings`; **(b)**
`c5b-speech-sweep` stacked on it — hold, release, and expiry on the observation tick. Both PRs
carry **LUKE-129**: the ticket's acceptance spans both halves, and one ticket marked Done when the
guarantee is whole beats a tidier record. Finding the seam by building it rather than guessing is
what the bound is for.

**C3 gains two things from this, and neither is visible from either PR alone.**

1. **The opener must drain queued `turns` rows into eve.** C5's hold release writes a queued row
   with origin `hold_release` through `writer.enqueueTurn`, and **nothing drains queued rows
   today.** Until C3, a calendar hold releasing queues a turn that never runs.
2. **`BRAIN_HOST_TURN` has no `hold_release` kind.** The wire `TURN_ORIGIN` carries it; the host
   turn kind does not, so a drainer has nothing to dispatch it as. C3 adds it, and that addition
   is a wire value-set decision to be recorded here when made.

**Ruling on the intermediate state:** C5 lands anyway, and **says in its PR body** that a release
queues a turn nothing drains yet. A queued row nobody runs is the *looks-like-a-hang* class — the
same shape E4 found where a typed ask's reply landed in a store the panel no longer drew — and an
honest window in a PR body is the difference between a sequencing decision and a silent defect.

**And one question closed that would otherwise have produced a route nobody needs: the speech
claimant is C8, not D3 and not an HTTP route.** After C8 the live session service is the **sole
speech sink**, it runs in `apps/web`, and B7's voice writer already writes the `speech.*` events.
So C5's `claim` / `spoken` store functions are consumed **in-process by C8**, and **D3 only reads
the standing to decide whether to push.** Nothing is missing; no claim route should be added. C5
names the consumer in the module comment so the next reader does not go looking for one.

**Also required of C5(a), because both are contract-shaped:** the expiry reason (`due` /
`hold_released`) is an `as const` value set declared once in `@sidecar/wire`, not a string union
in a payload schema; and the two-devices-claim test is named for the **guarantee** (at most one
authorization to speak per run, never that the words were heard) rather than for the index, which
is its backstop and not its mechanism.
