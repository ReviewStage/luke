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


## 2026-09-11 — Correction: the adapter's stability obligation is structural, and C1 already discharged it (orchestrator)

Amending my own entry above, the one that told C2b an adapter "must carry a call id and a
reasoning item id through a retry unchanged" and warned that **a reasoning event whose item names
no id is dropped whole**. Both halves are true of the writer read in isolation. **Both are
irrelevant in the composition**, and a reader who stops at that entry will believe reasoning is
being dropped when it is not.

**`apps/web/server/hosted/brain-host/ids.ts` (C1) is where the obligation actually lives.** It
mints the ids eve's stream names only relatively, as **name-based version-8 uuids** over fixed
coordinates — SHA-256 of a fixed namespace and a JSON-joined coordinate — and its own comment
states the requirement I thought I was imposing on a future adapter: *"a retried step that
re-emits an event under a new event id lands on the row the first attempt opened rather than
beside it."* The relay therefore never hands the writer a no-id reasoning item.

- `hostTurnId(sessionId, eveTurnId)` — the store's turn id.
- `receivedMessageId(sessionId, eveTurnId)` — the user message's client id, **one per turn,
  "since eve delivers one message per turn."**
- `answerMessageId(sessionId, eveTurnId)` — the assistant message's client id.
- `reasoningItemId(sessionId, eveTurnId, stepIndex, ordinal)` — a reasoning item's id.

**So the rule for C3, C5, C7 and C8 is: mint through `ids.ts`, never invent a coordinate.** The
one soft spot, raised with C2b and not yet answered: three of `reasoningItemId`'s coordinates are
eve's own and the **`ordinal` is ours** — the relay's count within the step — so a *partial*
replay of a step's reasoning items would shift it. C2b is answering that from eve's behaviour
rather than from the code's shape.

**And one independent confirmation for the `asks` decision now with Dean.** `receivedMessageId`'s
"one message per turn" is the same fact from the other end: a folded turn has **one** received
message, so the route cannot write a user message per ask, and two client ids cannot map onto it.
C2b derived that from eve's stream; C1's id module assumed it in a comment. Two paths to the same
constraint is the strongest evidence available that the ask record has to exist somewhere, and
that `turns` is not that somewhere.


## 2026-09-11 — E8 widens the Gateway vocabulary, and draws conversation text outside the blocked subtree (orchestrator, from E8)

E8 measured LUKE-139 at ~1,410 changed lines and split before opening: **(1)** the write path
(the Gateway method, the hosted client's `rate()`, the host's sync fold, the composer method and
the counted event, the desktop act and operator) at ~880 lines of which ~410 are tests;
**(2)** the control itself on top of it. **Accepted at ~880 against a ~800 bound, with the
production/test split required in the PR body** — the bound measures what a reviewer can hold,
~470 production lines is inside it, and a third stack level on the desktop would buy a smaller
number at the cost of two rebase cycles.

**1. A new Gateway method: `conversation.rateMessage`.** CLAUDE.md: *"Widening the method
vocabulary, the event set, or what a node may be asked is a product decision, not an
implementation detail."* **Ruled authorized by the ticket rather than escalated**, because the
only architecturally legal path from the renderer to the service is act → main → Gateway → host
→ hosted client: the method implements an approved feature and widens nothing about what Luke may
do. Conditions: named in the PR body as a vocabulary widening in `protocol.ts`, request and answer
shapes declared **once as `@sidecar/wire` schemas in `protocol.ts`** as the live-session methods
are, and **mutating and idempotency-keyed** like every other mutating method. Flagged to Dean the
same hour; one method name is cheap to reverse.

**2. The finding worth keeping: this is the first PR in the rework that draws conversation text
outside the one blocked subtree.** The Conversation view is the single explicit exception to the
session recording — its root carries the recording library's blocking class, which is the whole
reason the conversation's words do not leave the machine. E8's thumbs-down **offers the feedback
composer prefilled with the rated message and the ask before it**, and the feedback composer is
**not** in that subtree. Typed field contents are withheld by the library's default, so a prefill
that exists only as an input's value is probably safe; **text drawn anywhere outside an input — a
quoted preview, a "you rated this" line, a tooltip — travels in a recording.**

**Required: keep the rated text inside masked inputs, or give the offer's own subtree the blocking
class, and say in the PR body which and why the other was not needed.** CLAUDE.md is explicit that
what a recording may see is decided by what the panel draws, *"which makes drawing something new
on the panel a decision about what leaves the machine."* This is that decision, and it is the
first time this rework has faced it.

**3. And the distinction E8 must not collapse:** C6's optional note (≤500 characters, travelling
to the account's own devices on the events read) and the feedback composer's draft (reaching us
only if the developer presses send) are **two different things**. The counted event carries
`rating` and the message's kind as a bucket, and no note, no message id, and no free text can
reach a property — structurally, since the allowlist builds its output from the allowlist.


## 2026-09-11 — Why the relay's reasoning identity is the item's text, and one caveat to the no-rebase rule (orchestrator, from C2b-1)

**The soft spot I raised in the entry above is answered, from eve's source rather than from the
shape of our code, and the answer favours C2b's design.** `harness/emission.js` keeps **one**
reasoning buffer per model call and emits one `reasoning.completed` for it only when a text delta
follows or the stream ends — a tool call does not flush it — so a step's reasoning items are
eve's own concatenation in stream order. `harness/tool-loop.js` retries are always the **whole**
model call from the step's start: `runModelCallWithRetries`, the empty-response reissue, and the
unsupported-tool reissue each re-run the entire call. **There is no mid-stream resume**, and a
durable replay re-emits the recorded stream in recorded order under new event ids. So
`reasoningItemId`'s `ordinal` is stable across every failure mode eve actually has.

**The relay dedupes a step's reasoning by its text before minting, and that is a deliberate trade
rather than a heuristic left lying around.** Recorded here because the next reader will otherwise
"fix" it into the failure it prevents:

- Mint by **ordinal alone** and a **durable replay inside one relay lifetime** advances the
  counter, so the same reasoning lands twice — and not only in the journal, which the completed
  projection would heal, but **in the projection itself**, since the projection is built from the
  relay's own step state. A replay on a function restart is ordinary eve behaviour.
- Dedupe by **text** and the one cost is that **two distinct items with byte-identical text in one
  step fold into one part**: one block drawn instead of two, nothing misattributed, nothing
  duplicated, and vanishingly rare.

A rare cosmetic loss in exchange for a common correctness failure is the right way round.

**One caveat to my own no-rebase-on-`BEHIND` rule, which C2b-1 earned.** The rule stands — the
queue carries behind-but-clean branches and a needless rebase costs a full check cycle. **But
rebase when a PR merged since your base added tests that exercise the code you are changing.**
C2c's merged ownership suite drives the relay through the real writer, and C2b-1 adds a step
boundary to every answer, so C2c's assertions could have moved — and they would have moved **in
the merge group**, which runs on current main, where a failure reads like somebody else's problem
and costs an eviction to learn. Added to the standing addendum.


## 2026-09-11 — SPEECH_EXPIRY_REASON, and `unless` as a store contract (orchestrator, from C5a #1030)

**Wire value set added**, per Dean's standing instruction that a wire value-set decision is
recorded the hour it is made: **`SPEECH_EXPIRY_REASON = { DUE: "due", HOLD_RELEASED:
"hold_released" }`** in `packages/wire/src/conversation-event.ts`, beside
`SPEECH_OFFERED_EVENT_PAYLOAD { expiresAt }`, `SPEECH_HELD_EVENT_PAYLOAD { quietUntil }`, and
`SPEECH_EXPIRED_EVENT_PAYLOAD { reason }`. An expiry that cannot say which of the two it was
would leave the view unable to tell a briefing that timed out from one a meeting retired.

**Store contract widened: `recordEvent` takes an optional `unless: ConversationEventKind[]`** —
kinds whose standing on the message refuses the write, checked under the conversation lock and
answered as `STORE_WRITE_REFUSAL.SUPERSEDED`. Found by C5a's thermo-nuclear pass, tested, and
mutation-checked five ways.

This is what turns "the unique index stops a double claim" into the property the speech states
actually need: **no transition can land after a settled one.** A claim racing a push, or the
sweep's expiry arriving after a claim, cannot re-open a settled offer.

**Two races, two mechanisms, and both must be understood together:** a claim losing to another
claim is refused by B2's unique partial index on `(message_id) where kind = 'speech.claimed'`; a
claim losing to a *settled* transition is refused as `SUPERSEDED`.

**Ruling: the speech store module is the one door, and `unless` is not a caller's option.**
`unless` is a list the caller supplies, so a caller who omits it silently loses the atomicity —
and the callers are other lanes: **C8 writes `speech.spoken`** through B7's voice writer, **D3
writes `speech.pushed`**. Every `speech.*` write goes through `offer` / `claim` / `spoken` /
`pushed`, each carrying its own `unless` set internally, exactly as `admit()` is the one door for
actions and the strip is the only way to mint a `ClientUIMessage`. Stated in the module comment,
and better still made unrepresentable in `recordEvent`'s own kind union if a type can carry it —
this repository prefers the unrepresentable to the refused. Carried into C8's and D3's notes so
neither begins by writing a `speech.*` event the wrong way.


## 2026-09-11 — Nothing stores a turn's live events, and nothing should: C7 is a projection (orchestrator, from C7 #1032)

**Correcting my own brief.** I told C7 that B5's numbered `events` rows were its cursor. They are
not, and building on that premise would have put a run's moments into the conversation's record.
Verified in the tree: `CONVERSATION_EVENT_KIND` is the six `speech.*` kinds and `rating`, and the
store writer's `switch` **ignores** `SLOW_STEP`, `ACTIONS_SETTLED`, `REPLY_SENTENCE` and `ENDED`
under a comment that settles it — *"The rest of the stream is the relay's, about a run's moments
rather than the record."* B5's author drew that line deliberately.

**Ruling: `GET /api/brain/turns/{id}/events` is a projection over the turn row and the turn's
journal message, polled and numbered inside the turn. `CONVERSATION_EVENT_KIND` is NOT widened.**
No schema, no migration, no wire value-set change. C7 stopped at the value set and asked rather
than widening it, which is the behaviour the escalation rule exists to produce.

**Three reasons, so the next person who wants stored turn events finds them:**

1. **`events` is a record, not a transport.** Storing live telemetry there conflates the
   conversation's durable record with delivery for one consumer.
2. **The trust reason, which is the strongest: widening the kinds would push reply text to every
   device of the account through `/api/conversation/events`.** The events read already carries a
   rating's free-text note to the account's own devices, which is fine and disclosed; reply
   *sentences* would turn a mid-turn transport into a read route, and what leaves the machine is
   decided deliberately rather than as a side effect.
3. No schema means nothing for G4 to unpick and nothing for another lane to collide with.

**The consequence for C8, which is what CLAUDE.md already requires: reply sentences arrive at
turn end on the eve path.** eve's interim `message.completed` text is not the reply, and the relay
writes the answer only on `turn.completed`. CLAUDE.md: the desktop's voice "hands their words to
the brain through the voice's one tool and **says the brain's reply whole**." So **C8 must not go
looking for an incremental reply.** What the stream carries mid-turn is the slow step and actions
settling — which is exactly the commentary the voice service needs, and the reply whole at the end
is the shape the rollout's own seams assume.

**Required in C7's body:** that a client attached *after* the end receives the end exactly once and
closes (a poll's failure mode is hanging until a timeout, which reads to the voice service as a
turn that never ended), and that the poll is bounded, ends with the turn, and assumes nothing that
outlives a function's 800 s `maxDuration`.


## 2026-09-11 — The one door is a type, and claiming precedes speaking (orchestrator, from C5a #1030)

**The one-door requirement is enforced by the compiler rather than a comment**, which is better
than what I asked for: the plain write's kind is `Exclude<ConversationEventKind, SpeechEventKind>`
and a speech write is a separate `SpeechEventWrite` whose `unless` is **required**, so a `speech.*`
kind on a plain event write does not compile. Nobody can forget the guard, including someone who
never read the PR. The module comment names the two races apart: the unique partial index answers
`already_claimed`, the exclusion check under the lock answers `superseded`.

**A test that passed for the wrong reason, found and fixed:** the claim transition's own `unless`
was never exercised, because PGlite always ordered the racing claim first. C5a added a
deterministic interleaving through the writer seam; mutation M9 (`unless: []`) now fails it. Six
mutations, each failing a test. **This is what the mutation standard is for** — not to prove the
tests are thorough, but to find the ones that are decorative.

**New wire payload schema:** `SPEECH_SPOKEN_EVENT_PAYLOAD { voiceSessionId, atMs }`, replacing
B7's ad-hoc snake_case body. **Verified safe for the phone before approving:** LukeKit's
`ConversationEvent` carries `payload` as an untyped `JSONValue?`, and only `RatingEventPayload` is
typed (`rating`, `note`). So speech payload fields ride as opaque JSON today — and a client that
ever wants to *read* `voiceSessionId` is the moment that needs a typed Swift mirror, with
`tools/ios-parity` holding the two equal.

**And a rule that follows from B7's refusal, which reaches C8 and D3 rather than C5.**
`markSpeechSpoken` refuses `NOT_CLAIMANT` for an unclaimed briefing, another device's claim, or a
voice session with **no device** — and `voice_sessions.device_id` is nullable, so the third case is
reachable.

**Ruling: claim first, speak only if the claim succeeded, never the other way round.** Speak-then-
record leaves the offer unclaimed when the record refuses; the sweep expires it; **D3 then pushes
the same briefing to another device and the developer hears it twice.** CLAUDE.md's own shape is
the same — the Conversation write precedes any offer, and what is guaranteed is at most one
authorization to speak per run, never that the words were heard. Carried into C8's and D3's notes,
and into C5a's module comment beside the two races, because whoever gets it wrong will be reading
that module and not this file.


## 2026-09-11 — A malformed rating event is dropped whole, and the read-back fold is this design's most error-prone seam (orchestrator, from E8 #1027/#1029)

**E8's trust asks landed at the narrowest possible scope:** the feedback form's **message textarea
itself** carries the recording library's blocking class — one element, nothing wider — so the
screenshot attachment and the rest of the feedback flow record exactly as before while the
conversation's words rest on Luke's own posture rather than a vendor default. The draft is drawn
nowhere but that field, and `PRIVACY.md` says both that the form may open prefilled with the rated
message and the developer's ask, and that the field is blocked from recordings.

**A pattern worth naming, now three for three.** E8 fixed a Medium where an events walk cut short
could leave an older read-back mark standing over a newer fold. That is the same family as F4's
`eventsCaughtUp` gate and D2b's window: **the fold between what the service already folded and
what a client has read since is the most error-prone place in this design**, and all three
presented as a rendering glitch rather than a bug. **C8 and D3 both fold read-back state; look
here first.** The shape of E8's fix — the fold forgets read-back marks for any message a page
re-answers — is the one to copy.

**A four-way divergence, ruled: a malformed rating event is dropped whole.**

E8 found that `ConversationThread.take` skips a rating event whose payload spells no verdict
(`guard let … else { return }`), leaving any older mark standing, while the **service fold,
`selectConversationView`, and the Mac** read it as "no rating" — and the phone's own test asserts
the phone's behaviour. Two further facts settle it:

- **The phone's doc comment contradicts the phone's code**: it says *"a payload the wire does not
  spell a verdict in marks nothing."* A reader trusts the comment, which makes that the sharper
  defect.
- **The state is unreachable.** `RATING_EVENT_PAYLOAD_FIELDS.rating` is
  `s.enumOf(MESSAGE_RATING)` with no `.optional()`, so the route cannot write a verdict-less
  rating event, and there is no un-rating in this design — a later rating is a newer event, never
  an edit.

**Ruling: converge on the phone's behaviour, not the service's.** CLAUDE.md's posture for a record
this build cannot read faithfully is already *"dropped whole rather than guessed at"*, and letting
garbage **clear a verdict the developer really did set** is worse than letting a valid older
verdict stand. **Sweep-ins, not PR reopenings** — two reviewed stacks must not be reopened for a
state the wire cannot produce: the next iOS PR touching `ConversationThread.swift` fixes the
comment and flips the test; the next service PR touching the rating fold matches it. The
structural half: the phone should decode through the **typed `RatingEventPayload`** that already
exists in `ConversationReads.swift` rather than hand-parsing a `JSONValue`, so "malformed" becomes
a decode failure and the divergence cannot return.


## 2026-09-11 — C8 reaches the brain in process, not over HTTP, and the lift goes through @sidecar/voice (orchestrator, from C8)

**The finding: the voice function drops the bearer after the handshake, by design (`accounts.ts`),
so it cannot call `/api/brain/ask` or C7's stream as the user.** A session-lifetime bearer held in
a function to call our own routes would be a credential living far longer than the request that
earned it.

**Ruling: C8 calls the ask door and projects turn events IN PROCESS**, the same shape #1030 already
uses for the speech claim. Two consequences:

- **The 800 s / 300 s re-attach dance does not apply to C8.** It is in C8's brief because C7's
  stream is a 300 s function and a voice session's is 800 s; in process there is no HTTP hop and no
  second ceiling. C8 reuses `projectTurnEvents` over the store.
- **A cost to state honestly: C7's stated consumer will not use C7's HTTP route.** The
  *projection* C7 built is load-bearing and is what C8 reuses; the **HTTP wrapper around it**
  currently has no caller. It stays as the out-of-process seam — the original design had a separate
  `apps/voice-service`, and a client following a turn over HTTP is the shape a phone or a
  detached service would need — but **if nothing calls it by G-lane, deleting it is the honest
  outcome and should be considered rather than carried.**

**The lift's shape, approved.** A straight copy into `apps/web` is ~3,400 lines and a straight move
breaks the desktop before E5, so the transport-neutral machinery (`LiveSessionService`,
`AppendChannel`, `ProactiveQueue`, roster context, trace, the `LiveBrain`/`LiveRecord` doors,
graceful close) moves by `git mv` into **`@sidecar/voice` behind a live-session door**; the host
composes it from there unchanged, and `apps/web/server/voice/` gains the record over `voiceWriter`,
the sideband over the upstream socket, and the composition. Conditions: **the door is not optional**
— `apps/web` must not resolve `ws`, `node:http`, or anything Electron-shaped through that import,
and `@sidecar/gateway/websocket` is the precedent under `packages/AGENTS.md`; **C8 rebases onto the
rollout's PR 13 deletions** in `packages/voice/src/orchestrator/*` rather than asking them to hold,
as already ruled for their PR 12; and **the machinery lands unattached to the sessions route**,
because with the desktop still owning the exchange both ends would append.

**Escalated to the rollout, not decided here: how a desktop asks for a service-owned exchange.**
`VOICE_DELEGATION_MODE = { CLIENT, RESPONSES }` already exists and is recorded per session at
create, but what those words *mean* is the rollout's design and the create frame is theirs. The two
shapes are a create-frame field (per session, widens their contract) or **by build** (one mode at a
time, no wire change, the switch flips in our E5) — by build is my stated preference, because every
other cutover in this rework worked that way and two live modes is two paths to test forever.
**C8 is told not to invent a third mode** and to leave the attach seam explicit and unwired.


## 2026-09-11 — `delegation_mode` is the API's target, not who answers; the service-owned exchange is BY BUILD (orchestrator, with the GPT-Live rollout)

**Asked rather than assumed, and the assumption would have been wrong.** C8 needed to know how a
desktop asks for a service-owned exchange, and `VOICE_DELEGATION_MODE = { CLIENT, RESPONSES }`
already existed on `voice_sessions.delegation_mode`. Reusing it was the obvious move and is a
falsehood: those two values are the **GPT Live session's delegation target as the OpenAI API
defines it** — `CLIENT` means OpenAI emits `session.delegation.created` to whoever holds the
session (the sideband), `RESPONSES` means OpenAI runs its own Responses backend. **Every desktop
session is and stays `CLIENT`** (`packages/live`'s `session.ts` fixes `delegation.type = client`).

**Who answers the delegation — the desktop host today, our service after C8 — is a different axis
and not a mode of the session.** Had C8 written it onto that column, the row would have recorded
something untrue about the OpenAI session and no later reader could have separated the two axes.

**Ruling, both orchestrators agreeing: BY BUILD. No field on the create frame.** The frame is
unchanged and **E5 flips the composition.** Two live modes on one wire is two paths to test
forever. A later per-session need would be a **new** frame field and a product decision, never a
reuse of `delegation_mode`.

**Three facts from the rollout that change C8's work:** their **PR 13 (#955) is already merged**,
so `packages/voice/src/orchestrator/*` is gone from main and there is nothing to stage around —
C8 rebases onto main; a live-session entry in `@sidecar/voice` is agreed, with a constraint sharper
than mine — **the package must never name `ws` at all**, because sockets arrive through the
injected `openSocket` seam rather than an import; and they confirm **the service owns the append
decision and the desktop never appends**, so claim-before-append is consistent on both sides.

## The asymmetry between a hold and an expiry, ruled

The rollout added that the desktop's `LiveSessionService` treats an **unspoken briefing as held and
re-decided**, so "recorded unspoken" must stay **observable to the brain**. Ruling, so C5 and C8
inherit one answer:

- **Observable is required and already satisfied:** the `speech.expired` row stands, the view marks
  the announcement unspoken, and the brain's standing context carries recent Conversation lines. The
  trail is appended to, never overwritten.
- **A hold's release queues a `hold_release` turn; a due expiry queues nothing, deliberately.** A
  hold is a known, bounded reason the words were not said — the meeting ends, the reason is gone,
  and the briefing deserves a fresh decision against the roster **as it then is**. A due expiry
  means nobody could hear it inside its window, and queuing a re-decision would re-announce what
  the brain thought half an hour ago; CLAUDE.md's rule is that a held briefing is re-decided rather
  than **spoken stale**. Dropping it is the honest outcome and the trail is what keeps it from
  being a silent one. **C5b states the asymmetry in its body**, because one a reader cannot find a
  reason for gets "fixed" later.


## 2026-09-11 — A move and a behaviour change are separate PRs (orchestrator, from C8's size check)

C8's lift measured **1,331 changed lines** with rename detection: ~450 mechanical move, ~600 tests,
~160 new web source, ~90 docs. **By arithmetic alone I would have let it through** — about 250
lines of genuinely new logic, and E8 was accepted at 880 on exactly that reasoning.

**Ruling: split it anyway, and the reason is the review and not the number.** A pure-move PR is
reviewable by *proving nothing changed* — rename detection, unchanged bodies, the moved suites
passing untouched. Mixing 160 lines of new source into it forces a reviewer to separate "what
moved" from "what changed" by eye, **which is precisely where a behaviour change hides inside a
move.** Both adversarial reviewers do a worse job on the combined diff than on either half.

- **a1** `refactor(LUKE-132): move the live session machinery behind @sidecar/voice/live-session`
- **a2** `feat(LUKE-132): the live record over the voice writer and the upstream sideband`

**The moved tests go with the code in a1, not a2.** A move PR that leaves its tests behind is not a
move; a1 grows and stays mechanical, and the moved suites passing with untouched bodies is the
strongest evidence its claim is true. **a1's body must state that no behaviour changed, that the
host composes from the new home unchanged, and what demonstrates it** — and must name individually
any body that genuinely did change. One named exception is fine; an unnamed one is what the split
exists to catch. Added to the standing addendum.

Also corrected: both titles take **the ticket as scope** (`refactor(LUKE-132)`, not
`refactor(voice)`), per the repository's Conventional Commits rule for Linear work. LUKE-132 is
marked Done when the lift is whole, as LUKE-129 and LUKE-139 are running.


## 2026-09-11 — The barrel leak in C8's a2, and why it would have been invisible (orchestrator, from #1041)

Recorded because the class matters more than the instance, and because this rework adds the first
edge from `apps/web` into a package that also holds Node-shaped flows.

C8's a2 declares `@sidecar/voice` as a workspace dependency of `apps/web` (no third-party addition)
and imports correctly through the door in one file — `import type { LiveRecord } from
"@sidecar/voice/live-session"` — and **through the barrel in another**:
`import { type LiveSideband, type LiveSocket, sidebandOverSocket } from "@sidecar/voice"`, with both
new test files doing the same.

`packages/AGENTS.md`: *"A barrel is an all-or-nothing door. Importing a package resolves its whole
export graph, not the one name asked for."* So `apps/web`'s bundle resolves
`packages/voice/src/index.ts` entire — `live-socket.ts`, `live-session-source.ts`,
`capability-assembler.ts` and their imports — rather than the live-session door built for exactly
this purpose.

**Nothing is broken today, and that is the trap rather than the reassurance.** The barrel is clean
now, so the bundle resolves and `check.sh` is green. It becomes a Vercel build failure the first
time anyone adds a socket- or Electron-shaped import anywhere in that package — and the person who
breaks it will not have read this PR and will have done nothing wrong by their own lights. The
rollout's constraint (**`packages/voice` names no `ws`**) was verified from the diff and holds: the
only `ws` import C8 added is `packages/host/src/voice/socket-over-ws.ts`, the adapter on the host
side. A barrel import is how a verified constraint gets undone anyway.

**Required: import the door in source and tests; if a symbol is not behind it, export it there.**
`sidebandOverSocket`, `LiveSideband` and `LiveSocket` belong behind the same door as `LiveRecord`,
since they are what the web side consumes. And the body says `apps/web` reaches that package
**only through subpath doors** — checkable from the diff, the way "names no `ws`" was made
checkable. Added to the standing addendum.


## 2026-09-11 — ESCALATED: `prompts.text` de-seals the workspace and outlives an account deletion (orchestrator, from C4)

**Correcting my own brief, which got this wrong in the reassuring direction.** I told C4 that
storing the composed prompt introduced "no new category of data" because the hosted workspace
already lives in this database. C4 read the schema instead of my paragraph:

- **`workspace_file.sealed_content` and `personal_fact.sealed_words` are sealed per user** under the
  payload key ring, for the reason the file states — *"the contents are sealed, because every word
  of them is the developer's or the brain's."*
- **The composed prompt embeds `AGENTS.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md` and
  `BOOTSTRAP.md` whole** (under the 20,000 / 60,000 bounds).
- **`prompts` is `hash` primary key, `text` not null — no `user_id`, no cascade.** Verified in the
  tree. Every other table in `storage-schema.ts` is keyed by the user it belongs to and cascades
  with the user row; `provider_cursors` says so in its own comment, and the header makes "deleting
  an account is still one statement" a property of the schema.

So writing `prompts.text` as the plan draws it **de-seals sealed content into an unsealed
cross-account table, and puts the developer's remembered facts where account deletion cannot reach
them.** The second half is the decisive one: it is not an exposure question but a deletion that does
not delete.

**Escalated to Dean. Orchestrator recommendation: seal `prompts.text` under the user's own payload
key ring — not a deployment-wide seal — and key the table `(user_id, hash)`.**

- The **user's own ring** because the content's owner is the user and the posture for exactly this
  content exists one table over; a deployment-wide seal protects against a database dump and not
  against the service, and leaves the content unattributed.
- **`(user_id, hash)`** restores the cascade. It costs cross-account dedupe, whose value is near
  zero — a composed prompt embeds `USER.md` and `MEMORY.md`, so two accounts sharing a hash is a
  curiosity. **The ticket's acceptance is satisfied per user, which is all it ever meant.**
- One pre-release migration over an empty table (nothing has written `prompt_hash` yet; C4 counts
  and says so).
- It **contradicts `storage-schema.ts`'s "nothing here is sealed" line**, which changes with the
  reason attached: that line was true when these tables held no sealed-origin content, and the
  prompt is the first thing that does.
- **The cost, stated rather than hidden: an operator can no longer read a stored prompt.** The
  service holds the ring so automated replay still works; debugging by eye does not. That is the
  right trade for content whose every word is the developer's.

C4 builds the write behind one `prompts.record` seam so the choice is a one-module change, opens
under the plan's shape, and **does not enqueue until Dean rules.**

## And the eve semantics that make the ticket's acceptance wrong as written

A `session.started` dynamic system instruction **applies at its lifecycle scope**, which is the
session. So the prompt a turn runs under is the one composed at **session start**, carried
`session.started` → `turn.started` in eve's durable state. A workspace edit mid-session shows on
**the first turn of the next session**, not the next turn of the running one, and **recording a
recomputed hash per turn would make the record claim a prompt the turn did not run under.** The
hash recorded is the session-start hash. LUKE-128's acceptance is amended to say so.

## A disclosure defect on main today, filed as LUKE-161

`PRIVACY.md` says *"Nothing about a conversation is written on our servers"* and that the workspace
files *"stay on your Mac."* **Both are untrue of the service running now** — C1 writes `messages`,
`events` and `turns` per turn, D2 answers them, E4 and F1 draw them, and the hosted workspace lives
in `workspace_file` / `personal_fact` rows. Found by C4 and not C4's to fix.

**Ruling: this does not wait for G5.** G5 is last, behind four refactors, and that ordering is right
for a rewrite and wrong for a falsehood — `PRIVACY.md` is the file CLAUDE.md names as *where a user
learns any of this happens*, and it is currently wrong about where the developer's conversation
lives. Filed as **LUKE-161** with the minimum true statement as its scope, **owner Dean's call**,
because deciding what a privacy document says about a live service is not an implementation detail.


## 2026-09-11 — eve's `session_not_active` 409 is a startup race, not a retirement signal (orchestrator, from C2b-2a's Bugbot finding)

**The finding, confirmed and fixed in `4c8aa713`, and the one most likely to have been misdiagnosed
in production.** C2b-2a's eve wrapper read a 409 `session_not_active` as RETIRED at once. eve's docs
say that **one** 409 covers three different things: an **unknown** session, a **terminal** one, and
one **not yet active** — the command inbox still starting after the `202`. The SDK itself retries it
three times, at **250 / 500 / 1000 ms**, before concluding terminal.

**As written, a queued follow-up arriving while the inbox was still coming up would have been read
as retirement and reopened a second eve session for a live conversation** — precisely the race
C1's forward-only claim exists to lose safely. The symptom would have been a conversation that
occasionally forgot itself under load, with every test green.

**The fix:** the wrapper follows the SDK's schedule as a data table
(`SESSION_NOT_ACTIVE_RETRY_MS`), reads **accepted** the moment the inbox is up, and concludes
**retired** only past the last wait; reopening stays the host's under the forward-only claim.
Tested in both directions — not-active, not-active, accepted; and four not-actives to RETIRED.

**Two conditions on the module, both about what a later reader will assume:**

- **The table names the pinned eve version it mirrors (0.53.1).** The numbers are the SDK's, not
  ours to tune, and a dependency bump should be a visible decision about whether the table still
  matches rather than a silent divergence.
- **The backstop is named beside the mechanism.** **The retry makes a wrong RETIRED rare; C1's
  forward-only claim makes it safe.** Two guarantees, and a reader who meets only the retry will
  think the timing is load-bearing for correctness. It is load-bearing for not losing a session
  pointlessly. Same shape as C5a's two races, one door.

**Scope beyond C2b: every path that sends to eve inherits this**, including the ask handlers that
C8's in-process call goes through. C2b-2b's send path carries it by construction.


## 2026-09-11 — Gate finding 9: `test:store` files share one Postgres on CI, and PGlite hides it (orchestrator, from C5b)

**The ninth gate tonight that did not say what it appeared to say, and the first that says the
opposite.** Green locally means *less* than green on CI here, for a reason that has nothing to do
with the change under test.

**On CI every `test:store` file runs in parallel against ONE Postgres. PGlite gives each file its
own.** So a test that writes or sweeps across accounts reaches into another file's fixtures. C5b
lost three tests to it: its far-future "settle leftovers" sweep expired the **voice-writer** file's
just-claimed offers — that file's fixture clock is a day earlier — and `markSpeechSpoken` then
answered settled, which the voice writer maps to `not_claimant` at `voice-writer.test.ts:375`.
**Nothing was wrong with the code under test, and the failing test was in a file C5b had never
touched.**

Worth recording that **my own hypothesis was wrong and the worker checked it before acting on it.**
I guessed a rebase had dropped C5a's claim-first update to that test; `git diff a4f42ab4 HEAD --
apps/web/tests/voice-writer.test.ts` was empty and the update was intact. A plausible story about a
lost fix would have sent it editing the wrong file.

**Two rules, now in every brief:**

- **A `test:store` test scopes every write and every sweep to the accounts it created.** "Every
  account" is a production posture that happens to compile in a test. C5b added
  `SpeechSweepOptions.userIds` — the tick names none and sweeps all accounts, every test names its
  own — and **deleted** the far-future settle helper rather than scoping it, which is right when
  reaching everything was the helper's whole purpose.
- **Reproduce the CI condition before believing a green run:** Postgres 16, a fresh database,
  `db:migrate`, then the whole suite with all thirteen files in parallel. C5b's 128/128 that way is
  worth more than any PGlite pass. **Every remaining PR that adds a `test:store` file inherits
  this** — C2b-2b, C4, C8's a2, D3, and G4, which drops thirteen tables.

**And the starvation finding beside it, from Bugbot on the same PR:** held offers are the oldest
open rows, so they could starve the 500-row bound — **one account's long meeting could have
silently stopped every other account's briefings from being considered at all.** The sweep now
reads quiet accounts each under their own bound and the rest with quiet accounts excluded, with a
starvation test that fails under the mutation dropping the exclusion.

**One clause better than what I asked for:** `speech.held` is written once per hold and
**re-held only when the quiet instant moves later** — idempotent on the *hold* rather than on the
tick, so a meeting extended by ten minutes writes a second held event and a meeting merely still
standing does not.


## 2026-09-11 — `test:store` is a definition, not an inventory (orchestrator, from C2b-2a)

**Gate finding, the tenth, and a sibling of the ninth.** `test:store` in `apps/web/package.json` is
an **explicit file list**. A store-backed test left out of it **runs on PGlite and nowhere else** —
so a guarantee that exists *because* of real Postgres is asserted only against a substitute.

C2b-2a's `hosted-standing-main.test.ts` was outside the list: a compare-and-set under a **partial
unique index**, the loser reading the winner's row, and a `23505` that Drizzle wraps in `cause`.
PGlite is Postgres-derived and very probably behaves identically — **and "very probably" is what
that list exists to remove.** Same shape as every other gate finding tonight: the check that appears
to cover the thing does not cover the thing.

**Ruling: add it, in 2a rather than deferring.** One more bot cycle against a guarantee that would
otherwise sit behind the `asks` table decision, which is the one item in this graph with no
estimate. And **joining the list means joining the shared CI database** (gate finding 9), so the
file's scoping to accounts it created stops being good practice and becomes a requirement — stated
in the body as deliberate.

**A small ticket worth considering later, not now:** something that fails when a test reaching
real-Postgres helpers is absent from the list, so this cannot be done quietly. Two gate findings in
one morning came from a list or a check that looked authoritative and was not.

**And one reproduction detail worth more than it looks:** `db:migrate` wants
**`DATABASE_URL_UNPOOLED`**, not `DATABASE_URL`. Otherwise the connection error reads like a schema
problem. C2b reproduced the CI condition with Postgres 16 in Docker and ran 18 files / 151 tests in
parallel — the strongest green this rework has produced, and the standard now asked of C3, D3 and
G4.


## 2026-09-11 — `vercel.json` routes move under the web service, and the old place fails silently (orchestrator, from C2a #1018)

C2a rebased across 21 commits with one conflict: **C7's turn event stream route**, which #1032 added
to `vercel.json`'s top-level `routes`, carried into **`services.web.routes`** — the web service now
carries seven routes. Two consequences, and the second is the one that would have bitten somebody
who never read that PR.

**1. A test that asserts on `vercel.json`'s routes must read the web service's.** #1032's own test
read the top level, which does not exist in services mode, and had to be repointed.

**2. In services mode Vercel *ignores* a top-level `routes` key rather than erroring.** So the
failure shape for a future PR adding a route in the old place — out of habit, or by copying an older
example — is: **every check passes and the route does not exist in production.** That is the worst
shape available, and a note in a merged PR body reaches nobody.

**Required of C2a: assert the structure.** `vercel.json` has no top-level `routes` key and every
route lives under a service, so the old place fails locally in seconds with a message saying where
routes go.

**And the ordering, which neither orchestrator nor worker controls:** C2b-2b adds three routes
(`/api/brain/ask`, the turn read, the cancel) and is blocked on the `asks` decision; C2a is blocked
on Dean's Vercel framework-preset flip. **Whichever merges first dictates the other's shape.** Both
workers, and the staged C3, D3, G4 and E5 briefs, now carry both shapes: under the web service if
#1018 has landed, top level if not, with C2a's rebase carrying it across as it already did once.

This is also an argument about timing rather than scope: **a `vercel.json` conflict per route-adding
PR is the running cost of the services block not having landed**, which is a reason to land it as
soon as the preset allows and not a reason to widen it.


## 2026-09-11 — Seal and scope `prompts`; leave `tool_sets` shared (orchestrator, refining the escalation)

Sharpening the recommendation already with Dean, because B+ applied to both tables would be wrong
and the asymmetry is the whole point.

- **`prompts.text` is the developer's content.** It embeds `USER.md`, `MEMORY.md` and `IDENTITY.md`
  whole. Hence the seal under the user's own payload key ring, hence keying `(user_id, hash)`, hence
  the cascade that `hash`-only cannot give. The acceptance — "two turns under the same prompt share
  one row" — was always about **one account's** two turns; the cross-account case was never the
  point and becomes unreachable by construction. A test asserting it would be asserting the hazard.
- **`tool_sets.schemas` is the build's content.** The schemas are what this build offers, identical
  for every account, carrying nothing of anyone's. **Cross-account dedupe there is real and worth
  keeping** — one row genuinely serves every user under the same catalog — and sealing it would
  encrypt the build's own constants while losing that sharing for nothing.

**So: `prompts` sealed and keyed `(user_id, hash)`; `tool_sets` unchanged, `hash` primary key,
shared.** C4 states the asymmetry and its reason in the PR body, because a reviewer meeting one
sealed table beside an unsealed neighbour will otherwise read it as an oversight.

**Migration number verified for C4: `0021`.** Highest on main is `0020_e6b_devices_timestamptz.sql`
and **no open PR in this rework carries a `drizzle/0*.sql`**, so the namespace is clear.

**And the one test that proves the session-scope ruling rather than assuming it:** C4's eve eval
asserts a real eve run carries `prompt_hash` **through durable state** from `session.started` to the
turn row. The amendment to LUKE-128's acceptance rests on eve's documented lifecycle scope; that
test is what makes it a fact about this build.


## 2026-09-11 — DEPLOYMENT GATE: the preset flip must precede #1018's merge, not follow it (orchestrator)

The strongest reason for C2a's enqueue hold is one neither the worker nor I said out loud until the
fourth preview. **#1018 is not merely unverified until the framework preset is flipped — it is
unsafe to merge until then.**

C2a's diff **removes** the top-level `installCommand`, `buildCommand` and `ignoreCommand` and puts
them inside `services.web`, which is correct for services mode. **On a project still set to the
single-app preset, a merged #1018 therefore leaves `vercel.json` with no top-level build at all and
a `services` key Vercel ignores** — Vercel auto-detects Vite and **skips `pnpm db:migrate && pnpm
auth:seed`** and the function bundling, on **main**, for every production deploy until someone
changes the setting.

**So the order is fixed, and it is the reverse of the intuitive one:**

1. **Flip the project's framework preset to Services first.** Safe on main because main's
   `vercel.json` carries no `services` key and Vercel requires **both** conditions — the project
   keeps building the old way. Confirm with one redeploy of main.
2. **Then** #1018's preview builds as services, the eve service's outcome is read from the build
   log, and only then does it merge.

**Recorded as a merge precondition in #1018's own body**, in those words rather than as "waiting on
a preview": anyone with merge rights reading "green, waiting for a preview" might reasonably help by
enqueueing it, and that sentence is what stops them.

**A cheap signal, since previews are behind Deployment Protection and no worker holds a Vercel
credential (gate finding 8):** a services build that runs `eve build` and writes a 13.7 MB /
3.01 MB gzip `__server` output cannot finish in about a minute. **Ready in ~70 s is the single-app
signature** — four previews now, at 72 s and 69 s among them. If a post-flip redeploy returns Ready
that fast, the preset did not take.

This is the one place in the rework where **the order of a settings change and a merge decides
whether production keeps migrating its database.**


## 2026-09-11 — A delegation arriving late left the developer's words unwritten while Luke spoke (orchestrator, from C8's a2 / Bugbot)

**The most serious finding of the rework so far, and it is a broken trust rule rather than a missing
row.**

`LiveSessionService` skipped the delegated write when the utterance had already settled and been
written **undelegated** by the settle timer. On the desktop both writes were the same ask line, so
nothing showed. **Over the hosted record an undelegated write is segments alone** — so a delegation
arriving more than `gap + margin` (2 s) after the developer stopped speaking left **the developer's
own words never written while Luke's reply was still spoken.** The record would hold a reply with no
ask: not a lost row, **a conversation that misrepresents who said what.**

CLAUDE.md's shape everywhere is that the record precedes the effect — the Conversation write
precedes any offer, an action is journaled before its effect. This broke it in the one place the
hosted split creates.

**The fix is in the service, not the record.** The delegated write runs for **every** delegated ask
and is **awaited ahead of the reply**; `DeveloperUtteranceRecord` carries the ledger's `rowId`; the
desktop's `conversationLiveRecord` dedupes by it so its lines are unchanged.

**The rejected fix is the instructive half.** Consuming at arrival fixed the record and left the
service asking nothing of it, so a fast reply could still land before the message row — **and it
failed under the parallel Postgres suite**, which is gate finding 9 earning its keep inside the
hour: a race PGlite's per-file isolation hides and a single-threaded run calls green. **The
guarantee belongs where the ordering is decided**, which is the service.

**Ruling: split, and the service fix goes first as its own PR** — `fix(LUKE-132): the delegated
write runs for every delegated ask and precedes the reply`, over `packages/voice` and
`packages/host` with the desktop dedupe and its tests. It touches no `apps/web` route, dependency or
migration, so it may enqueue with Vercel pending. **a2 then rebases onto it**, returns under the
~800 bound, and still owes the barrel fix. LUKE-132 is Done when all three are in.

Same reasoning as the a1/a2 split one layer down: **a trust-ordering fix to a live path must not be
reviewed inside eight hundred lines of new web source.** Its body names the motivation honestly —
benign on the desktop today, wrong the moment the record splits — so a reviewer does not spend the
review wondering why a no-op changed.


## 2026-09-11 — The Security Agent found the `prompts` exposure independently, at HIGH (orchestrator)

Cursor's Security Agent reviewed C4's #1045 and raised, from the code and without reading the
escalation above: **"hosted sessions persist unsealed workspace/notebook prompt text in a global,
non-cascading `prompts` table"**, rated **HIGH**. Corroboration of the strongest available kind —
two independent readings of the same schema reaching the same conclusion.

**This changes the decision's character.** A is no longer "the plan's shape" beside a safer
alternative; **A is "ship against an open HIGH from the security reviewer."** The thread stays
unresolved until the decision lands rather than being tidied away.

**The hold is the orchestrator's and stands whatever the shape:** a PR with an unresolved HIGH is
not enqueued. So the practical position is that **B+ is the only path that lands C4 at all**, and
Dean's ruling narrows to authorizing the schema change or explicitly accepting the finding. The
default of silence is stasis, not risk.

### A third option, named because CLAUDE.md already takes it for this content

**C′: store the hash and not the text at all** — `text` dropped in the same migration, `prompts`
keeping `(user_id, hash)` and `created_at`.

The argument is the repository's own: for the developer's facts, *"the canonical record is the
notebook … and the runtime store keeps only provenance beside it."* **A hash is provenance; the text
is a copy.** C′ stores nothing sensitive rather than storing it well.

**Recommendation stays B+**, on a narrow ground: the seal under the user's own ring makes the copy no
more exposed than its source, `(user_id, hash)` makes deletion reach it, and **C′ loses a capability
the ticket asked for** — "any turn is replayable" cannot be satisfied from a hash, because the
workspace rows are not versioned, so the prompt a turn ran under becomes unrecoverable the moment a
file changes. B+'s only loss is that an operator cannot read it by eye.

C4 keeps B+ prebuilt as one commit (migration `0021`, `tool_sets` untouched and the asymmetry stated
in the schema comment, cross-account tests flipped to per-user, `prompts.read` proving the sealed row
re-hashes to the turn's hash). **Under C′ it is the same migration with the column dropped rather
than sealed** — the switch is cheap either way, and `prompts.read`'s test disappears, which is worth
noting because it is the test that proves the seal is reversible by the service and by nobody else.


## 2026-09-11 — Expire may follow a claim; push may not (orchestrator, from D3)

D3 found that C5a's store did not enforce the rule D3's own brief gave it — *"a claimed briefing is
never pushed"* — because of a **read→mark window**: the push pass read "unclaimed", a claim landed,
and the push mark still applied. Both a claim and a push would then stand on one offer, and **the
developer hears the same briefing twice.**

**Authorized and recorded: `markSpeechPushed` refuses a `CLAIMED` offer** (`refusals`
`CLAIMED → already_claimed`, and `unless` gains `speech.claimed`). The guarantee moves **into the
transition** rather than living in the caller — the same move C5a made putting `unless` inside the
speech module, and for the same reason: **the door enforces, the caller cannot forget.** D3's push
pass is not the last caller this will ever have.

**The asymmetry this creates is deliberate and must be stated in the module, because it reads as an
inconsistency:**

- **The sweep MAY expire a claimed offer.** A device that claimed and then vanished must not hold a
  briefing forever; expiry is cleanup, and it is why C5a's `unless` deliberately omits `claimed`.
- **Nothing may push over a claim.** A push is a **second delivery**, and the harm is not a stale
  record but the developer hearing the same words twice.

So: *expire may follow a claim; push may not.* Beside the two races in the same comment.

**Consequence for the record: two of C5a's merged assertions change**, and D3 says so in its body
rather than leaving a reviewer to find another PR's tests edited — "a claim racing a push: the push
lands either way" becomes "exactly one lands, whichever reached the lock first", and "push closes a
claim that never became speech" now expects `already_claimed`. **Neither is a weakening**; the first
was asserting the window.

**Split ruling, the third on this basis today** (after C8's a1/a2 and C8's delegated-write fix): a
trust-rule tightening to already-merged code, including edits to another PR's tests, gets its own
PR and its own revert handle rather than being reviewed inside a thousand lines of new push
machinery. **(a)** `fix(LUKE-134): a push never lands over a claim`, ~150 lines, merges first, may
enqueue on Vercel-pending. **(b)** the push pass, tick, route, PRIVACY.md and eight tests, ~1,000
accepted with the production/test split stated — ~480 source against ~560 tests and ~90 of prose is
inside what the bound measures, and **tests are not cut to reach a number.**


## 2026-09-11 — The last double-delivery guarantee standing on discipline, and how it becomes a type (orchestrator, from D3b and C8)

D3 was asked, in its brief, whether the push pass can tell **"unclaimed"** from **"spoken but the
spoken mark was refused"** (`NOT_CLAIMANT`: an unclaimed briefing, another device's claim, or a
voice session with no device — and `voice_sessions.device_id` is nullable, so the third is
reachable). **Its answer, stated in #1055 rather than worked around: it cannot, from anything
recorded** — the only trace of the second case is the voice's **paraphrased transcript**, not the
briefing's text.

So *"never speak without a claim"* is load-bearing for **not delivering the same briefing twice**,
and until now it was held by C8's discipline alone: nothing stopped an append that never claimed.

**Ruling: make it unrepresentable.** The briefing append **takes the claim's own result** — a value
only `claimSpeech` can mint, the way the strip is the only way to produce a `ClientUIMessage` and
`admit()` the only way to mint a validated action. Then "appended without claiming" is not a bug to
avoid; it is a call that does not compile. If C8's seam makes that awkward inside a2 it becomes a
named follow-up rather than bending the lift out of shape, and D3's sentence changes from *"closed
from C8's side alone"* to *"closed by construction in C8"* when it is true.

**Why this is worth a type and not a rule, in the shape this lane converged on:** every
double-delivery risk in the speech design is now closed by a structure rather than a convention.
C5a made a `speech.*` kind on a plain event write **not compile**. D3a made a push over a claim
**refuse in the transition** rather than in its caller. Claim-before-append was the last one resting
on discipline — **and it is the one whose failure a developer would actually hear.**

**Also recorded from #1055, because it changes what to look for:** D3's push adds **no route and no
`api/` stub.** The push rides inside `/api/observation/tick`, whose answer gains a push-counts
object. It still waits for the Vercel preview because `apps/web` changed and the payload shape is
new, which is the conservative side of the enqueue rule and the right one here.


## 2026-09-11 — The `asks` ruling now gates six tickets, and a correction to my own status (orchestrator)

**A correction first, because I have said the wrong thing twice.** I have been reporting that a2
merging releases **E5**. It does not. C8's own reading, which I accept:

- **a2** completes the hosted **record** and the **sideband**. It wires **no briefing delivery at
  all** — no `deliverBriefing` caller, no `noteAppend`, no claim.
- **Part b** is the hosted composition with the **in-process `LiveBrain`**, and it is what makes the
  service able to run an ask. **The lift is not whole until part b.**

So **E5 needs C8 whole**, and part b needs the ask door, which is C2b-2b, which is held on Dean's
`asks` table ruling. The chain reads:

**`asks` ruling → C2b-2b → C8 part b → LUKE-132 done → E5 → G1, G2, G3, G5.**

**One decision gating six tickets.** G4 is the exception in lane G — its preconditions (C5, D2, E4,
F1) are all met, and it is held only behind the worker cap.

**And the claim-token ruling lands in part b rather than a2, for a reason that is now three lanes
deep:** a branded `SpeechClaim` in a2 would be an export with no consumer, which `knip` refuses.
**A guarantee introduced before its consumer is not a guarantee; it is a lint failure.** C2b found
that rule, C8 hit it splitting the move, D3 applied it unprompted, and it decides the placement
here.

The shape, which is better than the one I asked for: `LiveSessionService` is **generic over its
`Delivery` type**, so the **hosted composition alone** declares
`Delivery = { briefing, decidedAt, claim: SpeechClaim }`, with `SpeechClaim` a brand only
`claimSpeech` mints. `deliverBriefing` without a claim then **does not compile on the hosted path**,
and the desktop's composition is untouched — a small change rather than a rewrite of a live path.
**Recorded as a commitment: its absence from part b is a regression, not an omission**, and D3's
#1055 now says "closed by construction in C8 part b".


## 2026-09-11 — Twice in two hours: a bounded read across accounts starves (orchestrator, from C5b and D3)

**One bug class, two independent instances, two different passes over the same table, both found by
review rather than by writing.**

- **C5b's sweep** read open speech offers across **every** account and excluded quiet ones *after*.
  One account in a long meeting filled the 500-row bound with held offers, so **every other
  account's briefings were never considered at all.** Bugbot found it.
- **D3's push pass**, an hour later, had the identical bug for the identical reason. Its own
  thermo-nuclear review found it.

**Both fixes took the same form: exclude at the read, not after it** — `notInArray` in the sweep,
`notUserIds` in the push pass — with the bound **per account** rather than global, and the proving
test being **two accounts under `limit: 1`**. A test with one account cannot see this, which is why
neither instance was caught while writing.

**Warned C3 directly rather than only adding it to the addendum**, because its opener drains queued
`turns` rows across accounts under a bound and is therefore the third instance unless designed out:
one account queueing twenty turns — a burst of roster diffs, a retry loop, a busy developer — takes
the whole pass. Its exclusion axis is fairness rather than quietness (one turn per conversation or
per account before a second from any), and if it concludes its pass cannot starve by construction it
says so with the reason.

**And a distinction from the same review, worth keeping:** a `FAILED` or `REFUSED` send ends the
pass (a transport problem is not each recipient's problem), while **`TOKEN_GONE` is that one
device's own answer and the pass continues**, the next tick delivering the spared offer exactly
once. Marking-and-failing the remainder would have written a lie into the record about offers
nothing ever tried.


## 2026-09-11 — The observation tick has three consumers and one budget; the order is unstated (orchestrator)

Raised with C3 and D3 rather than ruled, because it is a question about a shape only visible from
outside any one pass.

**`observation-tick.ts` owns the outer bound and owns it well:** `BUDGET_MS = 50_000`, a per-account
deadline, and a flag for whether the tick stopped on its budget with accounts still listed, under a
function duration the bundle declares with headroom left beneath it.

**Inside that bound there are now three consumers:** C5b's **speech sweep**, D3's **push pass** with
its own `SPEECH_PUSH.BUDGET_MS = 15_000`, and **C3's opener** draining queued `turns` rows, being
written now.

**The outer bound is not the problem; the order is.** If the sweep runs first and takes forty
seconds, the push gets ten of its fifteen and the opener gets nothing — **the starvation shape found
twice this morning, one level up: the passes starve each other rather than the accounts starving
each other.** And it is just as invisible, because each pass tests green on its own.

**Asked of both, as a sentence rather than a design:** state in the PR body where the pass sits in
the tick's order, what share it takes, and what happens to the passes after it when it takes its
whole share. *"The tick's budget flag already reports it and the next tick picks up where this one
stopped"* is a fine answer and should be written down. *"Nothing — the later passes silently do not
run"* is a ticket, and better had now than after the first quiet morning where Luke never woke.
**C3 is told not to add a fourth budget constant without saying how it relates to the other two.**

**And one ordering detail from D3 worth keeping:** `SPEECH_PUSH.BUDGET_MS` is checked **before the
mark**, so nothing is settled unsent. Same family as record-precedes-speech and
claim-before-append — **never record an effect you have not performed.**


## 2026-09-11 — A queued turn is the opener's inbox, never the run's record; and ESCALATED: who may open a durable eve run for an account (orchestrator, from C3)

### Approved: observation turns write no queued row at all

C3 found that **a queued `turns` row cannot become the turn eve runs** — the relay mints
`hostTurnId(session, eveTurnId)` at `turn.started` and eve may fold several deliveries into one
turn, which is the same fact that forced the `asks` record. So a pre-minted row could only ever
misname the run.

**The design, approved:** observation turns write **no queued row**; eve's queued delivery *is* the
queue; the relay records the turn under eve's identity with origin `roster_diff`; the received
message is the observation message. **Cursors advance and diffs are consumed in one transaction only
after eve accepted the send**, and a refused send leaves both standing.

**C5b's `hold_release` rows keep their meaning and lose their pretence:** the opener drains each
conversation's queued rows into one eve message under a new host turn kind and, on acceptance,
removes them through a new writer op **`dequeueTurn`**, guarded to *a queued row no message
references*; the relay's row for that turn carries origin `hold_release`.

**The sentence to keep: a queued `turns` row is the opener's inbox, never the run's record.** It
binds C2b-2b and the G lane.

Two answers wanted in C3's body rather than changes: **does D1's view draw a queued turn** (between
`enqueueTurn` and `dequeueTurn` a row stands, and a view that draws it shows a turn that never ran
and then vanishes), and **does the causal record survive the dequeue** (the relay's row plus its
`hold_release` origin must still say why Luke spoke).

**Wire additions:** `BRAIN_HOST_TURN.HOLD_RELEASE = "hold_release"` → `BRAIN_TURN_ORIGIN.HOLD_RELEASE`
/ `BRAIN_TURN_TRIGGER.HOLD_RELEASED` / `TURN_ORIGIN.HOLD_RELEASE`, and
`BRAIN_HOST_HEADER.ACCOUNT = "x-luke-account"`. **Fairness answered by construction:** the opener is
per account with no cross-account read, tested with two accounts under `limit: 1`.

### ESCALATED: the tick has no user bearer

`eve-sessions.ts` forwards **the caller's** `Authorization`, and the tick has none — **nothing in the
tree lets the deployment act for an account at eve's door.** So observation cannot open a turn at
all until this is decided. C3's design: a second authenticator ahead of `lukeAccount`, admitting the
deployment's `CRON_SECRET` (constant-time) with the account named in `x-luke-account`, as principal
`{ principalId: account, principalType: user, authenticator: luke-scheduled-observer }`, with
`ownedAuth`'s ownership check still running on it.

**Recommendation: reuse `CRON_SECRET` rather than add a secret.** The decisive argument is that
**whoever holds `CRON_SECRET` can already read every account's provider keys and write their
rosters** — letting that holder also open a metered run is not the marginal risk, while a second
secret narrows nothing that matters and adds a state where **observation is silently off until
someone provisions it**, which is the exact class of gate this rework has spent the day finding.

**Required whichever secret is chosen: the scheduled principal is a different TYPE, not a flag.**
`authenticator: luke-scheduled-observer` as a field is a distinction every route must remember to
check; a distinct type means a route serving a developer **cannot be handed the scheduler's
principal at all**, so `CRON_SECRET` cannot become a universal impersonation token through one
forgotten check. **Ownership is not scope** — `ownedAuth` proves the account owns the conversation,
not that the caller may ask anything of it. The scheduled principal opens observation turns and does
nothing else: no ask route, no cancel, no rating, and the compiler says so.

**And it is not only C3's:** C8 part b needs the same header-based account naming, because the voice
function drops the bearer after the handshake. **One shape for both**, written so part b uses it
unchanged.


## 2026-09-11 — One decision, two callers: a deployment principal at eve's door (orchestrator, from C3 and C8 independently)

**Correcting my own ruling first.** I told C8 to "answer `LiveBrain` in process". That was about not
calling **our own** route over HTTP and **it never addressed eve's door**, which is the thing that
matters: `eveSessions()` posts to eve's routes over HTTP at the deployment's origin and forwards
**the caller's** `Authorization`, which eve's door (`ownedAuth` over `lukeAccount(userInfo)`)
resolves through userinfo. The voice function resolved and dropped its bearer at the handshake —
deliberately, and I ruled out holding it — so at delegation time it holds a `userId` and **no
credential that door accepts.** In-process changes nothing, because the door is eve's and eve is a
service.

**And two workers reached the same design independently, from opposite ends:**

- **C3's tick** has no user bearer: nothing lets the deployment act for an account at eve's door.
- **C8's voice function** has a `userId` and no bearer, for the same reason.

Both propose a **second principal at eve's door beside `lukeAccount` and `localDev`: a
deployment-fixed credential that authenticates the caller itself and names the account it acts for
in `x-luke-account`, with `ownedAuth`'s conversation-ownership check applied to that account
unchanged**, so admit-before-dispatch still holds.

**So this is ONE decision with TWO callers, not two decisions**, and that is how it stands with Dean.
Recommendation unchanged: **reuse `CRON_SECRET`** rather than provision a second secret — whoever
holds it can already read every account's provider keys and write their rosters, so opening a
metered run is not the marginal risk, and a second secret adds a state where **observation is
silently off until provisioned.** Required whichever way: **the deployment principal is a distinct
TYPE, not a flag**, so a route serving a developer cannot be handed it and no forgotten check turns
that secret into universal impersonation. **Ownership is not scope.** C3 writes it; C8 part b uses it
unchanged and says so if it does not fit while C3 can still change it.

### A requirement this puts on C2b-2b

**Expose the ask standing as an in-process reader, not only behind the route.** The voice service keys
an exchange by the **ask's** id; `projectTurnEvents` keys on the **turn's** own id, which
`HostedBrainTurnAnswer` says exists only once eve names it. So `LiveBrain` answers `runId = ask id`,
reads the standing until `turnId` is set, projects with `projectTurnEvents`, and translates `turnId`
back to the ask id per event. Without the reader it would have to call C2b's route over HTTP with a
bearer it does not have. **Sent to C2b so it lands in its PR rather than as a follow-up in its file
written by someone else.**

### And C2a is on part b's end-to-end path

`eveSessions` needs the deployment's rewrites to carry `/eve/v1/*` into the eve service, which main's
`vercel.json` does not yet. **Part b is unit-testable against a fake eve; end to end only after
#1018**, which is parked on the framework-preset flip. The preset is therefore a dependency of C8's
verification and not only of C2a's merge.

`observedSideband` needs nothing from C2b-2b: its only seam is E5's attach in `VoiceService.#serve`,
so part b waits on E5 for nothing.


## 2026-09-11 — G4's counts are zero, measured; and a one-character catastrophe worth a test (orchestrator)

**All thirteen tables at zero**, read directly from Neon project `luke`, branch `production`. The
reasoning that "nothing has written these" was almost certainly right and would have been an awful
thing to be wrong about, which is why the brief made it the first instruction rather than a
footnote. **And I was wrong that no worker could reach that database** — G4 did, so C4 is now asked
to measure its own `prompts` count the same way rather than leaving it in Dean's queue. A fact a
worker can measure should not sit behind three decisions.

**Two corrections to the ticket, both G4's:**

- **`conversation_line_rating` has never existed** in any migration or in production. Named in the
  ticket, so its absence from the migration is stated in the body rather than silently omitted — a
  reader comparing the two would otherwise think one was missed.
- **The ticket's list omitted the v1 `conversation` directory table**, which four of the listed
  tables FK to and only the deleted modules read. **Dropping it is approved:** keeping it would
  leave an orphan with no readers and no writers, the same dead-code-wearing-a-live-name problem as
  `latestMessageRating`. The ticket's list was written from the store modules; the FK graph gives
  the better one.

**And the hazard that sits beside it: the table being dropped is `conversation`; the table that is
the entire new design is `conversations`.** A typo in `0021` — in the migration, a later hand-edit,
or a merge resolution — drops the v2 table and takes every conversation, message, event and turn
with it by cascade. **Required: assert after the migration that `conversations`, `messages`,
`events` and `turns` still exist.** Four lines, and the cheapest insurance in that PR.

**The payload envelope helpers stay, correctly scoped:** `workspace_file`, `personal_fact`,
`roster_snapshot` and `roster_diff` still seal through them, which is what the ticket's "remove the
sealing helpers for conversation payloads (the vault's stay)" meant. `@sidecar/brain/store-shapes`
and an unused `RunEndReason` export go, both having existed only for what G4 removed.


## 2026-09-11 — C3 splits three ways, and puts the trust decision alone in one small PR (orchestrator)

C3 measured its work at ~1,690 insertions / 354 deletions and stopped before opening anything. The
split, approved:

- **(a) `feat(LUKE-127): the deployment acts for an account at eve's door`** — ~280 production /
  ~230 tests. The **trust half**: the `ACCOUNT` header, the authenticator and principal-type sets,
  `deploymentActor` + `actedForAccount`, the door and conversation reads taking the acted-for
  account, `channel.ts` composing `scheduledObserver` first, **the secret behind one production
  seam**, `eveSessions` taking a typed `EveCaller` (account bearer | deployment secret + account)
  and a turn-kind type parameter, and the constant-time bearer check shared with `http.ts`.
- **(b)** the opener, the tick's `openTurns` seam, the route composition, `store.directory.observed`,
  the cursor writer split out — ~430 production / ~640 tests. **Accepted at ~1,070** with the split
  stated; tests are not cut to reach a number.
- **(c)** the `hold_release` drain (`BRAIN_HOST_TURN.HOLD_RELEASE`, the relay mapping,
  `writer.dequeueTurn`, the released-briefings read, the opener extension), ~300 lines, not yet
  built.

**(a) alone is the best structural decision of the day**, and the reason is sequencing rather than
tidiness: **it is the trust half Dean is ruling on, reviewable without the opener, and C8 part b can
proceed on it without waiting for (b) or (c).** A decision that was blocking two lanes is now one
small PR that either lands or does not, with **Dean's ruling changing one constant and one production
seam.** All five of C8's requirements are met in it, including attribution through
`admitted.target`, refusal-not-redirect, and the fake-eve harness taking a caller.

**Recorded because it is the right way to hold a requirement: my two-types-one-accessor line is one
of (a)'s five mutation checks.** "The accessor collapsing to `principalId`" fails a named test, so
the next person who writes `ownedAuth` against `principalId` because it is simpler breaks a check
rather than quietly deleting the guarantee. The other four: writes outside the transaction, **consume
before the send** (cursors advancing before eve accepted would lose an observation permanently and
look like a quiet morning), no per-account bound, and the actor checking no turn kind.

**(c) is a PR and not a follow-up: LUKE-127 is not Done until it lands**, because until then a
calendar hold releasing queues a turn that nothing runs — the window C5b states honestly in its own
body.

**And the tick question is answered by fitting inside the arithmetic rather than claiming a share of
it:** the opener runs inside each account's 25 s pass, no fourth constant, D3's assertion untouched.
D3's test now guards three consumers and refused to become a fourth's problem.


## 2026-09-11 — Presence is not the same as being able to speak (orchestrator, from D3)

**The bug, found by Bugbot on D3's rebased head and real:** the phone reports `activeUntil` on its
foreground poll (`LukeKit`'s `ConversationStore.swift`), and **the phone cannot claim speech.** So
the push rule read "a device is here, wait for them" about a device that was never going to say
anything — and a developer holding the phone with the Mac idle **waited out the whole two-minute
grace in silence.** The field was honest; the question asked of it was wrong.

**Fix and the value set it introduces: `SPEAKING_PLATFORMS = { macos }`.** Presence counts only from
platforms that can claim an offer and speak it. Tested: an active phone gets a push at once.

**Required comment on the set, because `{ macos }` is a today-fact and not a permanent one:** the
watch never speaks; the phone **does** hold voice calls but nothing on it claims a briefing today.
The rule to write beside it is *"a platform joins this set when it can claim an offer and speak it,
not when it can report presence"* — otherwise whoever adds iOS voice reads `{ macos }` as an
oversight and widens it without bringing the claim path along.

**And a second `PRIVACY.md` falsehood, found independently: its Devices paragraph says "The phone and
the watch report neither"** — neither presence nor quiet — **which the iOS presence write already
contradicts on main.** It went stale when the iOS Conversation screen began polling with
`activeUntil`. **Folded into LUKE-161 rather than filed as a third ticket**, with the true statement
noted for whoever writes it: the Mac reports presence and quiet, iOS reports `activeUntil` on its
Conversation poll, the watch reports neither — and *"reports presence"* and *"can be spoken to"* are
two different facts about a device that the file should not conflate.

**D3 deliberately did not edit it**, which was right: a privacy document corrected in passing inside
a push PR is worse than one corrected on purpose. **Two independent staleness findings in one
morning is the argument for not letting that file wait for G5.**


## 2026-09-11 — One shared secret cannot name two callers, and the record must not pretend otherwise (orchestrator, from C8 reading C3's #1069)

**C8 read C3's door PR against part b's needs and found the interaction that decides how Dean's
ruling lands.** All five of part b's requirements are met by #1069 —
`EveCaller.DEPLOYMENT { secret, account }` beside the account caller with `BRAIN_HOST_HEADER.ACCOUNT`
named once; `actedForAccount` as the one accessor, with `ownedAuth` **and** `admitConversation` both
comparing against it; the relay writing under `admitted.target` so `store.turns.named(userId)` finds
the turn; the initiator check comparing **acted-for** accounts, so a main whose eve session the
desktop opened admits the voice function's follow-up for the same account and the reverse;
`EveSessions<Turn>` taking `BRAIN_HOST_TURN.SPOKEN` as its type parameter; and `deploymentActor`
admitting exactly the open and follow-up routes, which is all part b calls (Stop is an instructions
append, events are projected from the store).

**The catch: `deploymentActor` refuses outright, with `NOT_DEPLOYMENT_ACT`, any request under its
secret whose turn kind is not in its own set** — the right fail-closed property, and it means **two
actors composed with the SAME secret cannot coexist in the walk.** The observer, first, refuses a
spoken turn carrying `CRON_SECRET` before a voice actor behind it could admit it.

**Ruling: C8's structure, with one change.** C8 proposed one deployment authenticator over a table
from **turn kind → authenticator name** (`observation → luke-scheduled-observer`,
`spoken → the voice service's name`). **Take the table as turn kind → ADMITTED, and keep ONE
authenticator name, with the turn kind carried in the record as the role.**

**Why: the authenticator name is an identity claim.** Under one shared secret, anything holding it
can send any kind, so a `spoken` turn proves only that *something holding `CRON_SECRET`* acted in
the spoken role. Writing "the voice service" into the session record would claim what the credential
cannot support — **an overclaim, and this rework has spent the day removing overclaims rather than
manufacturing them**: a `speech.*` kind made uncompilable, a push refused over a claim, an append
requiring a claim token, all so the record says exactly what is known. "A deployment caller, acting
in the spoken role" is true; "the voice service opened this" is not.

**If Dean rules a distinct secret, the name becomes a real identity claim**, #1069 fits as written,
and part b composes a second `deploymentActor` behind the first — C8's own reading, and right.

**Everything else of C8's stands:** one authenticator rather than two under one secret; refuse-
outright kept for every other route and kind; and **`brainHostChannelInput` taking the actor table
rather than `observerSecret` alone, so part b adds a row rather than a parameter** — the difference
between part b being a line and being a signature change in someone else's file.

**And this is now an argument bearing on Dean's own choice, which neither worker quite made: the two
options differ in what the record can honestly say.** Recommendation unchanged — one secret with
honest naming, because a silently-missing secret is worse than a coarser record, and the coarser
record is still true.


## 2026-09-11 — C3's (c) shape, and the question its own principle raises about the turns read (orchestrator)

**(a) #1069 carries the ruled shape, and in one place better than I asked: `principalType: service`.**
I required "a distinct type, not a flag"; C3 put the distinction in the **principal type itself**
rather than in an authenticator string, so a route expecting a user principal cannot be handed the
deployment one at all. One authenticator name **`luke-deployment`**, the acted-for account as
attribute **`luke:account`**, the turn kind as **`luke:turn`** recorded as the turn's origin, the
table as **kind → admitted** (`observation` true today), and **`DeploymentActor { secret, admits }`**
in `brainHostChannelInput` so part b adds a row rather than a parameter. CLEAN with a complete
verdict set; rebasing stopped per the hold policy.

**(c)'s shape, recorded — and it is NOT a wire change.** `TURN_ORIGIN.HOLD_RELEASE` already exists on
the wire from A3b, so what is added is the **host's** turn-kind vocabulary:
`BRAIN_HOST_TURN.HOLD_RELEASE`, its `BRAIN_HOST_TURN_KIND` entry
(`origin: BRAIN_TURN_ORIGIN.HOLD_RELEASE`, `trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED`), the relay's
`TURN_ORIGIN_OF_HOST_TURN` mapping, and `DEPLOYMENT_TURNS[hold_release]`. Stated in the body so a
reader does not go looking in `@sidecar/wire` for a change that is not there.

Store: **`writer.dequeueTurn`** (removes a queued row no message names; a started or named row is
left as it stands), **`releasedBriefings`** over messages and events only — no turns join, so the
store-writer boundary test is unchanged — and **`queuedTurns`**. The opener drains hold releases
first, one eve message per conversation listing the briefings released since one offer lifetime
before its oldest queued row, dequeued after eve accepts.

**Both of my earlier questions answered:** D1's view draws no queued row, because it groups messages
by turn and a queued row has none; and the causal record survives the dequeue as the relay's row
under origin `hold_release` plus the `speech.expired(hold_released)` events.

### The third question, which follows from C3's own principle

C3 established the sentence this entry has quoted all morning — **"a queued `turns` row is the
opener's inbox, never the run's record"** — and then reported honestly that *"the turns read lists it
for the minute it stands."*

**If a queued row is an inbox entry rather than a run, should `GET /api/brain/turns?after=` answer it
at all?** That is a read of what ran. Answering an inbox entry there invites the client bug the view
avoids: LukeKit's `ConversationTurnRows` reads turns directly, and a message-less turn could draw as
an empty row for up to a minute, appearing then vanishing — the *looks-like-a-hang* family in
reverse, and the third time this rework has met it.

**Three ways, C3's call with the reason in the body:** filter queued rows from the turns read (most
consistent with its own principle); confirm `ConversationTurnRows` draws nothing for a message-less
turn and leave the route honest; or state the one-minute window as a known intermediate state — the
weakest, because it is a state no client asked for. **Orchestrator leans the first:** a route that
answers inbox entries from a record read contradicts the principle, and the contradiction stays
invisible until a client draws one.


## 2026-09-11 — G4 merged, and it added the first gate this rework built rather than found broken

**`dc9ff94d`, #1066, LUKE-146 Done. Lane G's first merge, and the only one of its five that never
needed E5.** Thirteen v1 tables, `briefings`, and `conversation_lease` gone; the store-shapes door and
an unused `RunEndReason` export with them, so **G1 finds one fewer seam.** Counts measured on Neon
(project `luke`, branch `production`) and tabled in the body at all thirteen zero.

**The assertion is better than the one I required, in a direction I did not think of.** I asked for
"`conversations`, `messages`, `events` and `turns` still exist after `0021`" — a guard against one
typo, since the table being dropped (`conversation`) and the table that is the whole new design
(`conversations`) differ by a character. At the thermonuclear reviewer's suggestion, G4 asserted
instead that **Postgres's public tables equal, as a sorted list, every table `server/db/schema.ts`
declares.**

That catches the typo **and the reverse — a table declared and never migrated.** So **the schema
declaration and the database are now held equal in both directions, for every future migration in
this repository.** Mutation-checked by dropping the `0021` journal entry and watching it fail naming
all thirteen tables.

**Worth naming against the day's other findings.** The record above holds eight gate findings, every
one of them a gate that did not say what it appeared to say: a `CLEAN` check that was not mergeable,
a `test:store` list that silently downgraded files to PGlite, a Push-on-main that skipped lint, a
preview reporting Ready on the wrong shape, a store-backed test on PGlite alone, `test:store` files
sharing one database, the Vercel preview not being required at all, and previews unreadable behind
Deployment Protection. **G4's is the first gate this rework has added rather than found broken.**

And one method worth keeping: **measuring rather than reasoning.** G4's counts made its own migration
safe as a fact, and they corrected my claim that no worker could reach that database — which then let
C4 measure its own `prompts` count and took an item off Dean's list.


## 2026-09-11 — A named invariant, found three times independently: monotone state is forward-only, by compare-and-set

Recorded so the fourth author finds it rather than rediscovering it from a race test.

**The rule: a late writer may not move a monotone value back.** Not "should not" — the write is
refused by a compare-and-set against the value the reader began from, so a slow path that finishes
after a faster one has no way to retreat the state.

**Three instances, three authors, three pieces of state:**

- **C1's session claim** — a conversation's eve session is claimed **forward-only by compare-and-set
  on eve's sortable ids**, so a stale start cannot reclaim a rotated session.
- **The conversation cutoff** (CLAUDE.md, and B6's index) — *"only ever raised by a deletion, so a
  late line from before it is refused whatever the disk did."*
- **C3's observation bookmark** (Bugbot on #1070) — an opening that outran its tick could put the
  bookmark **back behind a later pass's**, which does not fail, does not error, and quietly
  **re-observes what was already seen.** Fixed as a CAS keep over the bookmark the read began from,
  race-tested three ways.

The failure shape is the same every time and it is why the rule is worth naming: **moving a cursor
backwards is silent.** Nothing throws, no check goes red, and the symptom is duplicated work or
re-read history that looks like a provider misbehaving.

**Also from C3's (c), and the reason the inbox principle is now enforced rather than stated:**
`listTurns` **and** `latestTurnPosition` skip queued rows, so the turns read and the **change-signal
head** answer a turn only once the relay moved it to running. The head mattering as much as the read
is the half I did not ask for: a head that advanced on a queued turn would have every client polling
for a turn none of them can see — a poll storm whose cause is invisible from the client side.

**And the detail that proves the change was real:** two storage-reads cursor tests used a **queued
row** as their fixture. Left alone they would have asserted the read's behaviour on a row the read
now skips — passing, and testing nothing. Moved to started rows **with assertions unchanged**, which
shows the behaviour on real rows did not change and only the queued case did.


## 2026-09-11 — A fix that flipped the failure direction, and why loss is worse than duplication here (orchestrator, from C3's (c))

Bugbot found two real gaps in #1079 and both fixes are recorded, but the first one is worth reading
carefully because **it traded one failure for its opposite.**

**Before:** the opener's lookback of one offer lifetime could **re-list** releases an earlier drain
already carried — a duplicate re-decision. **After:** the boundary is the record's rather than a
clock's — `releasedBriefings` takes releases strictly after the instant eve started the
conversation's newest `hold_release` turn, read from the relay's own row via
`latestStartedTurnQueuedAt`. Anything released before it "was that turn's or an earlier one's to
carry".

**The direction it flipped to is the worse one**, by the ruling already in this file: a hold is a
known, bounded reason the words were not said, and when it lifts the briefing **deserves a fresh
decision against the roster as it then is.** A duplicate means the brain decides twice and may say
nothing the second time. **A lost release means Luke is silent after a meeting — the precise outcome
the hold exists to prevent.** C3 knows this hazard: it is the reason it gave for removing the
eight-briefing cap in the same PR (*"a release left behind would fall behind the next turn's
boundary and never be decided again"*). **The cap fix removed that loss; the boundary is where it
still lives.**

**The assumption, stated in C3's body, which is honest and is still timing:** the sweep writes a
release a minute after the last, and eve starts a turn seconds after taking its message, so the
last re-decision has started before the next release could be written. **Probably true.** Two holds
on one conversation lifting inside a minute — a device reporting a `quiet_until` a few seconds out,
a meeting ending as another's grace expires — is uncommon rather than impossible, and the symptom is
silence nobody can trace.

**Question put to C3, its call with a reason either way: can the boundary be the message's CONTENTS
rather than the turn's start instant?** The opener already builds one eve message per drain
**listing the briefings it carries**, so "unhandled" could be *released and named in no prior
`hold_release` message* — the record itself, no clock, no assumption, duplicates impossible rather
than improbable. If the read is unaffordable, the cost goes in the body and the assumption stands
named.

**The second fix needs nothing: no per-turn cap, every unhandled release in the one message, and a
read bound of 64 against a runaway only — reported when met rather than trimmed silently.** That
last word is what makes it acceptable: at sixty-five releases something says so, and a reader can
tell a bound from a loss.

**Ten mutation checks across C3's three PRs**, each naming a way the record could have lied.


## 2026-09-11 — The carried set is the record's own words, and the failure direction is now always a duplicate (orchestrator, from C3's (c))

C3 took the record-content boundary. **A release is carried once a hold-release message of the
conversation names it**: the opening words the relay writes for each re-decision list every briefing
by the instant the brain decided it and its words, so `releasedBriefings` reads those messages first
(source `hold_release`, bounded at 256, their text parsed as the brain's own `[hold released]` item
through a wire record read) and takes only the `speech.expired(hold_released)` releases they do not
name, oldest first, paged by `seq`. **`latestStartedTurnQueuedAt` is gone** rather than left as a
second way to answer the same question, and the read stays inside `speech.ts` over messages and
events.

**No clock and no assumption, and C3 stated the property better than the request did: the failure
direction is always a duplicate re-decision, never silence.** A message the relay has not written yet
can only make the next drain re-list; a turn eve took but never ran leaves its releases uncarried for
the next drain. Both land on the benign side. **The 256 bound fails the same way** — past it the
oldest carried set falls out of view and those releases re-list.

**The one coupling it introduces, and the test required for it:** the carried set is recovered by
**parsing a message the system itself wrote**, so the boundary is coupled to that text's format.
**Required: a round-trip test that the item the relay writes parses back to exactly the set it
listed**, and one sentence in the body saying the coupling exists.

**Why it matters even though the failure is benign: a re-decision is not free.** The brain decides
again against the roster as it then is and may announce the same news a second time — **not a
delivery duplicate** (C5's claim and D3's push refusal stop that) **but a judgment duplicate**, and
the developer hears it twice. A round-trip test turns a silent wording change into a failing check,
and it is the only thing that can: a reader comparing writer and parser by eye will believe them.

**Eleven mutation checks across C3's three PRs**, and the shape of the newest is the one to copy —
"carried filter dropped **fails three tests**": not one test naming the mechanism, three naming the
consequences.


## 2026-09-11 — Under eve, which delivery produced a message is not a property of the message (orchestrator, from C3's (c))

**The third consequence of eve's folding, and worth seeing as one thing rather than three
coincidences.**

1. **It forced the `asks` record to exist** (with Dean): a folded turn has **one** received message,
   so two client ids cannot map onto it, and no pre-minted row can be the turn eve runs.
2. **It forced C2b's ordinal identity**: a retried step re-emits under a new `meta.id`, so the
   reasoning item's id is minted from stable coordinates rather than taken from the event.
3. **And now: a folded message carries the LAST delivery's kind**, so filtering C3's carried read on
   the metadata source would have missed exactly the messages eve folded.

**C3 found it while writing the round-trip test I asked for.** The read now filters on **the brain's
authorship plus the marker's presence in the text**, newest first, bounded at 256 — and that answer
is only available because the A lane named brain-authored user messages in the metadata. **That field
was added for a different reason and is what stops a developer's typed ask impersonating a carried
set.** Stated in the body so nobody "simplifies" the filter back to the source.

**The round-trip test tests the right things:** quotes, braces, a newline and non-ASCII (the four
that break a naive parse); the folded shape between two `[observed events]` items with blank lines
(the arrival shape a reader would not think to construct); two items in one message (the case that
silently drops one); and unreadable JSON, an observation item and empty text naming **nothing** —
the half that matters most, because a parser answering "nothing" on garbage re-lists while one that
throws takes the drain down with it.

**`heldBriefingsNamed(text)` exported rather than private** is what makes the round trip testable at
all: writer and reader are two named things a test holds together, rather than one function's halves
that drift in a single edit.

**C3's lane, complete pending one ruling:** three PRs, twelve changed or added tests in (c) alone,
eleven mutations each failing a named test, every open question closed. Order when the ruling lands:
(a), then (b) retargeted, then (c).


## 2026-09-11 — The migration-namespace rule proved itself inside the hour, and #1081 moved the ground under three PRs (orchestrator)

**The rule earned its place, and I am the one it caught.** At ~10:00 I told C4 that `0021` was free,
verified against main and every open PR. **At ~10:29 G4 merged `dc9ff94d` carrying
`0021_g4_drop_v1_conversation_tables.sql`.** C4's prebuilt B+ commit carries
`0021_c4_prompts_sealed_per_user`. Two files, one number, and the second to merge is a broken deploy
rather than a merge conflict.

**C4 takes `0022`, and is told to re-verify rather than trust the message** — the same instruction
the rule already carried, now with a worked example: *"I was right about 0021 when I said it and
wrong within the hour, which is the whole reason that rule exists."* **A verified fact about a shared
namespace has a shelf life measured in merges, not minutes.**

**And #1081 landed on main: the storage migrations now run on an Effect migrator, with Drizzle's
history adopted.** It changed `server/db/migrate.ts`, added `server/db/effect-migrator.ts`, and
touched `tests/storage-schema.test.ts` and `tests/support/hosted-store-database.ts`.

**That reaches three of this rework's PRs, none of which caused it:**

- **C4 (#1045)** — its migration runs under a changed runner, its store tests sit on a moved
  harness, and **G4's schema-equality assertion lives in a file #1081 also edited.**
- **C3 (#1070, #1079)** — its PGlite and Postgres store tests use that harness.
- **C2b-2b (held)** — the same, plus its `hosted-standing-main.test.ts` addition to the `test:store`
  list.

All three told, with the instruction to read those four files on main rather than assume a prepared
rebase still applies. **None of it changes what they are waiting for, and all of it is cheaper found
now than at the moment a ruling lands and three PRs rebase at once.**

The wider point, since this is the second cross-workstream collision this morning after the
`vercel.json` route shape: **a lane that is "finished and waiting" is not static.** Its
correctness is relative to a main that moves — sixty-plus commits today — and keeping prepared work
true is orchestration rather than bookkeeping.


## How to pick a mutation (C3, from LUKE-127's eleven)

**A mutation is chosen from the guarantee, not from the code.** Before writing one, state the
sentence the PR body promises — *"a refused send leaves the cursor and the diffs standing"*, *"the
deployment may open only the turns its table admits"*, *"a release is never lost"* — and then ask
**what the cheapest edit is that would make a working system break that sentence while every existing
test still passes.** That edit is the mutation, and it is almost always one of four shapes:

1. **Move a write across the boundary it is supposed to sit behind** — the cursor keep pulled out of
   the transaction, the dequeue moved before eve accepts.
2. **Delete a filter or a comparison** — the release reason dropped from the read, the turn kind
   unchecked at the door, the carried filter removed.
3. **Collapse two things the design keeps distinct into one** — the accessor answering `principalId`
   for every principal type, *which is how a rule quietly becomes a field.*
4. **Replace a bound with its absence or its old value** — the per-account limit gone, the read cut
   back to eight.

**If none of the four breaks the sentence, either the sentence is not a guarantee or the code does
not yet hold it** — and both are worth knowing before the PR opens. Apply the mutation, run the
suite, revert. **A mutation that passes is the finding**, and the response is a test that names the
consequence, not a test that names the line.

**The test a mutation fails should name what the developer would have suffered**, because that is
what makes the failure legible and the count worth quoting. *"Carried filter dropped fails three
tests"* beats one test asserting the filter exists, because the three are the three consequences — a
release read back that a message already named, a re-decision sent for briefings already decided, a
turn listing twelve when it should list twelve minus one — and **each would still fail if the filter
were rewritten some other wrong way, where a test of the mechanism would pass.**

**Two corollaries.**

- **A fixture that happens to satisfy the mutated code is the commonest way a mutation passes for
  the wrong reason.** The fake database whose transaction failed but had no insert to expose the
  moved write, and the writer clocked to real time while the fixture's events sat at the fixture
  instant, **both hid a real defect until the fixture was made to carry the state the mutation would
  corrupt.**
- **When a change moves a boundary, look for existing tests that used the old boundary as a
  convenient fixture** — the two cursor tests that used a queued row — **and move them onto the new
  one with their assertions unchanged**, so they keep testing what they tested rather than passing
  on a row the code now skips.


## 2026-09-11 ~12:20Z — The fourth cross-workstream shape change to reach held work, and the first quiet period (orchestrator)

**The watcher reported 45 minutes of no worker traffic — the first quiet stretch since the graph
started.** Every lane is either merged or holding for a decision. Using the quiet to sweep rather
than wait turned up the fourth shape change to land under held work.

**#1093: the brain contract's four routes are now one HttpApi group.** It added
`apps/web/server/brain-app.ts` and `apps/web/server/routes/brain/capabilities.ts`, rewrote
`hosted/brain-route.ts`, `brain-v2.ts`, `http-effect.ts` and `environment.ts`, and brought a
`fixtures/brain-route/` set with it.

**Why it matters to held work: "a brain route" is no longer a standalone function beside the
others.** C2b-2b adds three — the ask, the turn read, the cancel — and must now decide whether they
belong inside that group. **Told to read `brain-app.ts` and `routes/brain/capabilities.ts` before
opening and to state the answer either way**, because a reviewer who has just read #1093 will ask
why three new brain routes sit outside the group it created. If they genuinely do not fit (the ask
door admits before dispatch, which may not suit an HttpApi handler's shape), that reason goes in the
body.

Also on main now: **`api/brain/turns.js` beside `api/brain/turns/events.js`**, so paths resolve
differently than they did when C7 landed; regenerate rather than assume.

**The running count of shape changes that reached this rework's held branches, none of them caused
by it:** the `vercel.json` services conversion (ours, C2a's), #1081's Effect migrator and the store
test harness, G4's table drops, and now #1093's brain group. **All four were absorbed while the
branches waited rather than discovered at the rebase.** That is the whole argument for sweeping main
during a quiet period instead of treating quiet as idle: **a lane that is finished and waiting is
not static, and the cost of finding out late is paid by three PRs at once.**


## 2026-09-11 — The ask's logic is a function, not a handler (orchestrator, from C8 reading #1093)

**A requirement on C2b-2b, relayed as a requirement rather than a suggestion, because it decides
whether part b needs a follow-up in someone else's file.**

**#1093's brain group is not a template for the ask.** C8 read `brain-app.ts` and
`routes/brain/capabilities.ts`: the group is an `HttpRouter` of Effects whose handlers read the
caller **straight off `HttpServerRequest`** — `account()` takes `request.headers.authorization`,
`brainOperation` reads the body from the request — and answer `HttpServerResponse`. **Nothing in that
composition is reachable in process without fabricating a request.** Correct for the four brain
routes, which have no in-process caller. **Wrong for the one route that has one.**

**The requirement:**

- **The ask's logic is a function over plain arguments** — the already-resolved `userId`, the
  question, origin, `clientId`, optional `conversationId`, **and the `EveCaller` to reach eve as** —
  answering `HostedBrainAskAnswer` / `HostedBrainTurnAnswer` **or a typed refusal**. Admission,
  `standingMain`, the eve open-or-send, the record: all inside it.
- **The handler is a thin adapter**: resolve the bearer, read the body, call the function with
  `EVE_CALLER.ACCOUNT`.
- **Part b calls the same two functions** with the `userId` it resolved at the handshake and
  `EVE_CALLER.DEPLOYMENT`.
- **Where they are mounted — inside #1093's group or beside it — is C2b-2b's call.** The only
  requirement is that **the logic is not inside the handler.** `askStanding` is already this shape;
  this extends it to the ask.

**The consequence C8 named, which is what makes it act-now rather than act-later:** *"if C2b-2b
writes the ask the way `brain-app.ts` writes `respond()`, part b would need a request-shaped seam
that does not exist, and that is a follow-up in someone else's file."*

**And a route-layout correction, verified in the tree rather than relayed:** `api/brain/turns.js`
re-exports `dist-functions/brain/turns.js` and is **the turns LIST route**, and `vercel.json`'s only
brain rewrite is C7's `/api/brain/turns/([^/]+)/events` → `turns/events.js?id=$1`. **So
`brainTurnPath(id)` and its cancel need their own function file and their own rewrite in that
shape — not a rewrite onto `turns.js`**, or a per-turn read answers the list.


## 2026-09-11 — An orchestrator error worth recording: a broadcast must be true of every recipient

**I wrote the #1093 note for C2b-2b and sent it verbatim to C4, including the sentence that "your
three routes ARE brain routes". C4 has no routes; #1045 adds none.** C4 checked it against its own
thirteen files rather than believing it and said so.

**The lesson is mine: sending one text to three sessions to save time means every sentence in it
must be true of all three, or the message should be split.** Three lanes read main differently, and
a claim that is precise for one is a false statement about another. **Twice today a worker has
caught me over-generalising** — C3 narrowing the same #1093 note ("the HttpApi group is the hosted
brain contract, not eve's channel, and my lane adds no brain route") and now C4 rejecting a sentence
about routes it does not have.

Both caught it because the standing instruction is to verify rather than take, including from me.
**That instruction is load-bearing in both directions: it is what makes a wrong broadcast
survivable.**

## And one concrete trap made recognisable (C4)

`bootstrap before check.sh` has been in the addendum all day without a symptom. C4 supplied one:
**on today's main `packages/credentials` wants `@effect/platform-node` and `@effect/vitest`, so a
`check.sh` run before bootstrapping reads as FIFTEEN FAILURES that look like your own broken
imports.** That is the shape that sends someone hunting in their own diff, and a number makes it
recognisable where the rule alone did not.


## 2026-09-11 — The guarantees survived a rewrite by people who never read the PRs that made them

**#1104 rewrote the hosted store's writers and speech onto `@effect/sql` and Schema.** Fifth
cross-workstream shape change to land under this rework's held branches, and **the first to rewrite
the modules themselves** rather than the harness, the routes, or the tables around them.

**Verified on main before telling anyone, because this is the case the whole discipline was for:**

- **`writer.ts:240`** still types a plain event write's kind as
  **`Exclude<ConversationEventKind, SpeechEventKind>`** — a `speech.*` kind on it still does not
  compile. **C5a's one door is intact.**
- **`speech.ts:349`** still has **`unless` required** on a speech write, and the push transition
  still carries **`unless: [SPEECH_CLAIMED, ...NOT_OPEN_KINDS]`** — **D3a's "a push never lands over
  a claim" is intact.**
- **`speech.ts:531`** still answers **`NOT_CLAIMANT`** unless `claimedByDeviceId === deviceId`, so
  **claim-before-append still means something** and C8 part b's commitment still has a floor.
- The writer's dedupe identities are intact: tool parts by **`callId`**, steps by the journal's own
  **count of boundaries** (`held >= event.step`), reasoning by the part's **id**.

**A workstream that never read C5a, D3a or C2b-1 rewrote their modules onto a different SQL layer,
and every guarantee held — because they were types and required parameters rather than comments and
discipline.** That is the argument this record has been making all day, tested by an actual refactor
within hours of the guarantees being written. C5a's own body put the case for it: *"a guarantee that
exists only as an implementation detail is one refactor from disappearing."* The refactor came.

**Told the four affected lanes** (C2b-2b, C3, C4, C8 part b) to rehearse again, and — the part that
matters for a conflict resolution — **their job in `writer.ts` and `speech.ts` is to re-apply their
own change on top, not to re-establish the invariants**, which are on main. **If a resolution seems
to want one added back or dropped, stop and report**: that is the signal something was lost that
this check did not catch.


## 2026-09-11 — A requirement withdrawn: one lock at the database is not two transaction scopes (orchestrator, corrected by C2b-2b)

**I relayed C8's "take one `HostedStoreContext`" as a requirement on C2b-2b, with my own reason
attached: two runners over one database is two connection paths and two transaction scopes over the
same rows. C2b read main and narrowed it, and it is right — so the requirement is withdrawn for
that module.**

**Two corrections, both from the tree:**

- **`standingMain`'s drizzle transaction and Clear's `@effect/sql` transaction take the same
  user-row lock AT THE DATABASE.** One lock, two clients, **still serialised** — and the Clear-race
  test passing on the rebased branch is the evidence rather than the argument. My hazard is real for
  **read-your-own-write visibility** and not for a row lock. **I was reasoning about clients; the
  lock is not in the client.**
- **`acceptAsk` never writes through `db` at all.** Its writes go through the injected `AskRecord`,
  so there is no read-after-write across two clients inside one ask: admit reads, the record writes,
  eve is dispatched. So it keeps `db` for `conversationOwnedBy`, `recordedRuntimeSession` and
  `standingMain`, takes **no `run`**, and `askStanding` keeps `db.select`.

**And the structural decision inside it, which is better than the shape I asked for: `run` enters 2b
exactly once, in new code, in the new idiom.** The `AskRecord` implementation over the `asks` table
becomes **its own module under `store/` beside `ratings` and `soft-delete`**, written on `run` the way
`soft-delete.ts` and the writers now are, composed at the route from the web runtime. **So the one
place 2b reaches the new table reaches it the way the store now does, and 2b adds no legacy-idiom
module to a store mid-migration.**

Both bodies will say which function takes which and why, including the lock sentence — because a
reviewer who has read #1104 will see a drizzle transaction beside an `@effect/sql` one and raise
exactly the objection I raised.

**Third time today a worker has answered a question from main rather than from a summary of main,
and the third time the answer was better than the summary.** The standing instruction to verify
rather than take is what keeps a wrong requirement of mine from becoming a wrong line of code.


## 2026-09-11 — Relay a peer's requirement as a question unless I have verified the reasoning (orchestrator)

**The withdrawal above cost C2b-2b an implementation.** I relayed C8's "take one
`HostedStoreContext`" **as a requirement**, with a justification of my own I had not verified;
C2b re-shaped `acceptAsk` to match; then I withdrew it on the strength of C2b's reading of main. It
restored the narrower shape from the previous commit rather than re-deriving, so nothing was lost
but the round trip — and the round trip was mine.

**The rule: when a requirement about one worker's module comes from another worker, relay it as a
QUESTION unless I have checked the reasoning myself.** The worker holding the code can answer in
minutes; a requirement makes them implement first and answer afterwards. C8's five points about
`acceptAsk`'s shape were right and worth relaying as requirements because they were about **part b's
needs**, which only C8 could state. The `db`-versus-`run` question was about **C2b's module**, which
only C2b could answer — and that is the line I crossed.

Recorded beside the broadcast lesson, because both are the same failure in different clothes:
**a message of mine carrying more authority than its evidence.**


## 2026-09-11 — When a held PR should adopt the store's new idiom and when it should not (orchestrator)

Ruled because two lanes touch the store mid-migration and I had told them opposite things without
saying why.

- **C2b-2b writes its `AskRecord` in the NEW idiom** (`@effect/sql` + Schema, its own module under
  `store/` beside `ratings` and `soft-delete`, composed at the route from the web runtime). **New
  code over a NEW table**: there is no existing shape to preserve, so the new idiom costs nothing and
  choosing the old one would add to the migration debt deliberately.
- **C4 keeps `content-addressed.ts` in Drizzle.** It reads and writes tables **B2 already created**,
  in a module **written before #1104 landed**, and `database.ts` still allows a Drizzle module. The
  Effect lane is migrating these systematically and will sweep it. Moving it now would add an idiom
  migration to a PR already carrying a schema change, a seal, a migration and a renumber — **the
  scope growth the size bound exists to prevent**, putting new risk into the one part of #1045 that
  is currently beyond doubt.

**Both say it in the body**, for the same reason C2b-2b says its lock sentence: a reviewer who has
just read #1104 will see a Drizzle module in a store half-moved to `@effect/sql` and ask.
*"`database.ts` still allows it, the module predates #1104, and the Effect lane will sweep it"* is
one line.

**And the clause that holds even under B+:** B+ rewrites that module — new key, sealed column, the
read — and it **still stays Drizzle**, because the rewrite is about *what the row holds and who it
belongs to*, and changing the SQL layer in the same commit would mix a trust fix with an idiom
migration. **The trust fix is the part that has to be reviewable.**

**The general form, for the G lane and anything else that lands mid-migration: adopt the new idiom
where you are writing new code against new tables; leave it where you are changing what existing
rows mean.** An idiom migration and a semantic change in one diff are two reviews wearing one hat.


## 2026-09-11 — Which guarantees survive a rewrite by strangers, and which need their author (orchestrator, from C3's second rehearsal)

**A correction to the conclusion I drew this afternoon.** When #1104 rewrote the hosted store's
writers and speech, I verified that C5a's one-door type, the required `unless`, D3a's push refusal
and `NOT_CLAIMANT` all survived, and said they survived **because they were types and required
parameters rather than comments.** True — and the general conclusion I implied was wrong.

**C3's forward-only cursor keep survived only because C3 was the one rewriting it.**
`consumeRosterDiff` became an Effect over `SqlClient`, the Drizzle transaction that paired it with
the cursor write went away, and the property had to be **rebuilt as a SQL predicate**: one
insert … on conflict do update **`where provider_cursors.cursor = from`**, with a null `from`
comparing to nothing. **Nothing in the type system was holding it.** Had the Effect lane rewritten
`provider_cursors` instead of the module beside it, there is no reason to think the compare-and-set
would have come through — **they had no way to know it was load-bearing.**

**So: a guarantee encoded in a TYPE survives a rewrite by strangers. A guarantee encoded in a SQL
PREDICATE survives only if its author is the one rewriting it.** That is an argument for the G lane
and for anything that outlives this rework: the forward-only cursor, the standing-main partial
unique index, the claim's uniqueness, the `unless` exclusions — **some are structures and some are
predicates, and the predicates need naming somewhere a rewriter will look**, not only in the PR body
of whoever wrote them.

**And the test that proves a boundary rather than a call.** C3's one-transaction test drives the real
client through **a proxy whose `withTransaction` fails after its body has run** — so it proves the
transaction actually wraps the writes rather than that the code calls `withTransaction`. That is the
"move a write across the boundary it is supposed to sit behind" mutation from C3's own write-up
turned into a fixture, and a test asserting the call would have passed the mutation.

**Accounting correction owed to Dean:** C3's post-ruling cycle has been reported as "minutes". True
of the first rehearsal, no longer the whole truth. #1104 required **real rewrites** — (b)'s
transaction and cursor keep, (c)'s `dequeueTurn` as a `Write<>` over `SqlSchema`, the released and
carried reads as `findAll` pages, the tick's composition moving into `observationTickHandler`. **The
replay is minutes; the work was hours, and the delay caused it.**


## 2026-09-11 ~14:00Z — Dean rules six of seven (orchestrator)

1. **The `asks` table — still open**, pending one clarification Dean asked for (industry practice on
   folding). **Correction to how I framed it: the table is needed whether or not asks fold**, because
   the turn id does not exist until `turn.started`, so the route cannot answer with one and a caller
   needs something keyed by its own client id to poll. Folding makes it *also* true that two asks can
   share a turn; lateness alone already forces the record.
2. **Reuse `CRON_SECRET`. RULED.** C3's #1069 lands as it stands — no constant change, no environment
   rename. Its bodies say why it is not a widening (whoever holds it already reads every account's
   provider keys) and why the record names **one** authenticator with the turn kind as the role.
3. **`prompts`: C′. RULED — store the hash, not the text.** Dean's reason: nobody is replaying yet.
   The migration adds no sealed column; `prompts` keeps `(user_id, hash)` with `created_at` and the
   cascade; `recordPrompt` stores the hash alone; the seal-reversibility assertions go. **The
   Security Agent's HIGH is answered by the change rather than by an argument.** Two questions put to
   C4 before it builds: **does `prompts` need to exist at all** under C′, since `turns.prompt_hash`
   already carries the hash and the row's only content becomes "first seen at" — if not, the
   migration drops the table rather than reshaping it; and the **asymmetry with `tool_sets`** (which
   keeps its schemas, being the build's own content) goes in the schema comment in one sentence.
4. **The Vercel preset is flipped.** C2a's hold lifted, in a fixed order: rebase once, let checks and
   both bots run, **read the preview's build outcome before enqueueing** (a services build with two
   entries, and `eve build` ending `built output at .../agent/.vercel/output`), **confirm main's own
   production deploy is still green after the flip**, then enqueue. **Ready in ~70 s still means the
   preset did not take.**
5. **Notification permission on first launch. RULED** — Dean: "that feels more standard." One point
   his ruling does not settle, handed to F3 rather than back to him: the introduction runs **before
   any account exists**, and a token is useless until there is an account to attach it to — so ask at
   first launch and upload on sign-in, and **say where the dialog lands relative to the
   introduction's takeover**, since CLAUDE.md is explicit that the introduction raises no dialog of
   its own. **If it cannot be shown at first launch without landing inside the introduction, F3 tells
   me rather than moving it** — that is Dean's ruling meeting a constraint he did not have.
6. **LUKE-161 gets a worker.** Launched with a brief that names the four false claims, the true
   narrower statements, and the scope line: **correct what is false, leave G5's rewrite alone.**
   Prose only, plus the one `devices-schema.ts` comment; anything that would change behaviour to
   match a sentence comes back to me as a different ticket.
7. **Do not interrupt the Effect lane over `packages/providers`. RULED.** G3's notes already carry
   the two instructions that matter either way: **deletion wins a conflict with a rewrite**, and G3
   reads who imports a module **now** rather than who imported it when the plan was written.


## 2026-09-11 — Under C′ the `prompts` table is dropped, not reshaped (orchestrator, from C4)

**Dean ruled C′ — store the hash, not the text, because nobody is replaying yet. C4 then showed that
the honest C′ has no `prompts` table at all**, and the argument is stronger than the question I
asked:

- **`turns.prompt_hash` has no foreign key to it** — B2 declared none — so the table **anchors
  nothing.**
- With the text gone, the row says only *"this account first saw this fingerprint at this instant"*,
  which is **derivable in one query from `turns`** (`min(started_at)` grouped by `user_id`,
  `prompt_hash`), a table that already carries the hash and already cascades with the account.
- **Nothing in this build reads it by hash** except C4's own tests and the eval.
- **It does not help a future replay**, because replay needs the text — the one thing C′ declines to
  store. If replay is wanted later, that is the moment to add a text table under that day's ruling.
- Keeping it means a migration, a schema comment and a store method for a row that duplicates a
  column, **and a table named `prompts` that holds no prompt** — a name that lies.

**Ruling: `0022` becomes `DROP TABLE prompts`.** `tool_sets` keeps its row and its write.
`recordPrompt` / `readPrompt` and the store's prompts group go; `host.prompt()` computes
`promptHashOf(text)` and stores nothing. **G4's schema-equality assertion holds the drop to the
declaration**, which is that assertion doing work within hours of landing.

**Taken as the consequence of Dean's ruling rather than escalated again**, and told to him plainly
with a veto offered: no reading of "store the hash, not the text" wants a table named `prompts`
holding no prompt, and C4 says either shape is under an hour, so the reversal cost is bounded.

**Three conditions.** Keep `0022` and re-read the number before pushing. **The `turns.prompt_hash`
column comment must say there is nothing behind it** — *a content address for the composed prompt;
the prompt's own text is not stored, because it embeds the developer's notebook and nothing replays
it* — because a reader meeting that column will otherwise hunt for a table and conclude something is
missing. And **grep the prose**: `apps/web/server/README.md` and the root README may describe the
table, and a doc describing a dropped table is the same defect as a comment promising what the code
does not do.

**`storage-plan.md` is now contradicted**, as C4 flagged: *"prompts and tool_sets are
content-addressed by hash and referenced from the turn"* is true of **`tool_sets` alone**. G5 takes
it from here.

**And C4's acceptance rewrite supersedes the ticket's:** *"two turns under the same prompt carry one
`prompt_hash`; a changed workspace file yields a new one on the next session's first turn"* — the
same property, asserted on the rows that hold it, with the session-scope correction folded in.


## 2026-09-11 ~15:10Z — Dean approves the `asks` table (orchestrator)

**Ruled: the table exists.** The four refinements that accompanied the escalation carry with the
approval:

1. **`hostTurnId(sessionId, eveTurnId)` remains the only turn-id scheme.** The earliest ask's id does
   **not** become the turn id; `GET /api/brain/turns/{id}` accepts either an ask id or a turn id and
   resolves an ask through `asks.turn_id`, uniformly. One scheme, one resolution path.
2. **A queued ask's Stop is honoured rather than refused** — `cancel_requested_at` on the ask, and the
   relay posting eve's scoped cancel the moment `turn.started` names that delivery. **Behaviour lands
   in C2b-3; the column is designed in now** so 3 is a behaviour change and not a migration.
   `NOT_RUNNING` keeps its own case: a Stop on a conversation recording no session at all.
3. **The account's first main is opened by compare-and-set** under the standing-main partial unique
   index — already built and race-tested against Clear.
4. **Named `asks`**, with the body noting that **CLAUDE.md calls the local one "the requests"**, so G5
   reconciles one concept under two names.

**And the correction to how this was framed, recorded because it changes the argument rather than
the outcome: the table is needed whether or not asks fold.** The turn id does not exist until
`turn.started`, so the route cannot answer with one and a caller needs something keyed by its own
client id to poll. **Folding adds a second reason; lateness alone already forces the record.** On
folding itself: there is no crisp industry convention — OpenAI's Assistants model refuses a second
message during an active run, while **OpenClaw, which this repo ports from, folds and answers both**,
and CLAUDE.md already documents that as Luke's own local behaviour ("the run reads it at its next
model boundary … and answers both"; an ask past the queue's depth "is folded into a summary line the
next turn opens with"). **eve's folding matches the desktop's documented behaviour.**

**Migration numbers, assigned to prevent the collision the rule exists for:** C4 holds **`0022`**
(`DROP TABLE prompts`), C2b-2b takes **`0023`** — and is told to re-read main and every open PR at
the moment it writes it rather than trusting the assignment, because that rule caught the
orchestrator once today already.

**What unblocks behind it:** C2b-2b → C2b-3 → **C8 part b → LUKE-132 done → E5 → G1, G2, G3, G5.**


## 2026-09-11 — Amendment: the watch reports presence too, and the error was mine (orchestrator, corrected by the LUKE-161 worker)

**The entry above titled "Presence is not the same as being able to speak" says "the watch reports
neither" presence nor quiet. That is false, and it is my sentence rather than a worker's.**

D3 reported the **phone's** `activeUntil` write and separately flagged `PRIVACY.md`'s "the phone and
the watch report neither". I wrote the corrected "true statement" from those two facts and **inferred
the watch reported nothing because D3 had only mentioned the phone.** The LUKE-161 worker read the
code instead:

- `LukeWatchApp.swift` registers a `DeviceRegistrar(.watchOS)`.
- `LukeWatchView.swift:53` hands its stored device id to a `ConversationStore`.
- `WatchConversationView.swift` polls every **5 s** while the scene is active.
- `ConversationStore.poll` sends `changes(deviceId:activeUntil:)` with a **30 s horizon** whenever a
  device id stands.

**The true statement, and it supersedes the earlier one:** the **Mac** reports presence **and** quiet;
the **phone and the watch both** report presence from their Conversation screen in the foreground;
**neither reports quiet**; and **only macOS presence delays a push** (`SPEAKING_PLATFORMS`).

**Worth naming as a pattern, because it is now four for four.** Every false claim in this family was
an **inference from a partial report rather than a reading of the code** — `PRIVACY.md`'s three, and
now mine. The workers who caught each of them did the same thing every time: they opened the file.
**A "true statement" assembled from two correct reports can still be false, and mine was.**


## 2026-09-11 — Incident: five failed production deploys from the Vercel Services preset, and four errors of mine (orchestrator)

**Closed. Cause confirmed by recovery.**

**Timeline.** Dean saved the project's Framework Preset as **Services** at ~15:05Z while main's
`vercel.json` carried no `services` key. **Five consecutive production deploys then failed**
(15:05:58Z → 15:15:18Z) on **five unrelated merges**, one of them ours. Zero had failed earlier that
day. Production served the previous deployment throughout — probed every two minutes at 200/401/401,
never down. Dean reverted to **Vite**; no merge existed to test it, so he redeployed main's head; the
**first real merge after the revert (96e01cbd, 15:37:25Z) succeeded and built** — "Deployment has
completed" rather than a skip. **Services preset with no services key is a failed build, not a
fallback.**

**The doc says otherwise, which is why this happened.** Vercel's Services guide: *"A project builds as
services only when two conditions are both true… If either is missing, Vercel falls back to its
default framework detection and ignores your services configuration."* **That fallback does not hold
in the preset-set/key-missing direction.** My "flip first, it is safe on main" ordering rested on that
sentence.

**Four errors of mine, recorded because each has a general form.**

1. **I trusted a documented fallback over an untested state.** The right instruction would have been
   "flip and immediately redeploy main to confirm", which I did say — but I framed the flip as safe
   rather than as needing confirmation before anyone merged.
2. **I invented a diagnostic from an unmeasured assumption and offered it twice.** "Ready in ~70 s
   means single-app" rested on the belief that a services build must take much longer. C2a measured
   `eve build` at **42 s**, and the two services build in parallel — so **duration cannot distinguish
   the shapes at all**, including for the four builds I had already classified with it.
3. **I held enqueues after authorising one, and the hold raced the work.** F3 enqueued under my go at
   15:07:33Z and merged at 15:14:14Z; my blanket hold surfaced afterwards. **Our own merge became the
   fourth failure.** A hold must account for what is already in the queue; the queue is where
   in-flight lives.
4. **My reopen broadcast was false for the one PR it would have broken worst.** Merging the services
   PR under Vite puts main in the third state — key present, preset off — where Vite detection ignores
   the block and main deploys with **no top-level `buildCommand`**. C2a caught it. **Third over-broad
   broadcast of the day, second after I wrote the rule against them.**

   **Amended the same hour, by C2a against its own report.** I first recorded this as "no function
   bundling, so every `api/` stub re-exports a bundle that was never built." That is wrong. Vercel's
   static build runs the package.json script (`vercel-build`, `now-build`, `build`, in that order)
   when no `buildCommand` is configured, rather than a framework default, and `apps/web`'s `build`
   script ends in `tsx scripts/bundle-functions.ts` — so **the functions would in fact be bundled and
   the stubs would work.** What the fallback drops is exactly the prefix `vercel.json`'s
   `buildCommand` adds: **`pnpm db:migrate && pnpm auth:seed`**. The real failure is **a successful
   deploy onto an unmigrated, unseeded database**, which is still worse than a failed deploy because
   it succeeds and serves — but it is not a site whose API points at nothing. The claim is corrected
   rather than deleted, because what it got right is why the PR is still held.

**Three self-corrections from C2a, each tightening a claim it had just made:** that "Skipped — Not
affected" proved services mode (it is consistent with a dashboard Ignored Build Step, not proof); the
duration heuristic, which it withdrew including for its own earlier builds; and finding the doc line
that cut against its own diagnosis and reporting it anyway.

**What remains and why it is not urgent.** The services PR is held. It is a **leaf** — no ticket
depends on it — so it blocks no merge; it gates the hosted brain **running a turn end to end in
production**, since eve is not deployable without it. **The sitting:** Dean re-flips to Services, the
preview is confirmed green under services mode (which is itself the verification, since the project
would be in services mode and the branch carries the key), the PR enqueues within the minute, and our
other lanes hold. **Its price, stated rather than discovered: any other workstream's merge inside that
window costs one transient failed deploy**, resolved the moment the PR lands. Cheapest when that lane
is idle.


## 2026-09-11 — Migration ids: the real invariant, replacing "C4's 0022 goes first"

**Ruled.** I had ordered C4's `0022` (#1045) ahead of C2b's `0023` (#1129), with a twenty-minute
fallback. That rule was a proxy for the actual constraint and it does not generalise: **renumbering
upward is not a fix by itself.** If C2b took `0024` and merged first, C4's `0022` would then sit at
or below the highest applied id and the Effect migrator would **silently skip it in production**
(`@effect/sql` 0.52.1, `dist/esm/Migrator.js` 86–101), with every check green. The hazard is not the
numbers two PRs hold; it is **the number the second one to merge holds at the moment it merges.**

**The invariant, which every migration PR from here obeys:**

1. **Immediately before enqueueing**, read the highest applied `migration_id` against main's own
   state, not your branch's — C4 reads it on the PR's Neon preview branch, which is the practice this
   rule generalises — and confirm your id is **strictly above** it.
2. **Re-confirm after any rebase.**
3. **If another migration merges while you are in the queue, dequeue, renumber above it, and go
   again.** A queue position is not a reservation.
4. **Say the number and the reading in the PR body**, so a reviewer can check the claim rather than
   trust it.

The ordering between #1045 and #1129 is therefore **released**: whichever is ready first goes, and
the other applies the rule. Neither waits on the other, and neither may enqueue on a stale reading.

**This is a rule because the test does not exist yet.** LUKE-163 is filed to build the test that
would enforce it — but it needs `openPglite` moved onto `runWebMigrations` first, because the two
dialects do not share a bookkeeping table (PGlite still migrates through Drizzle into
`drizzle.__drizzle_migrations`, which stores a hash and no id, while CI Postgres uses the Effect
migrator's `effect_sql_migrations` with `(migration_id, name)`). **C4 declined the sweep-in and was
right to**: the assertion is five lines only after that move, and it cited the two tables rather than
pleading scope. Until LUKE-163 lands, the invariant above is carried by hand and named in every
migration PR's body.


## 2026-09-11 — The Vercel preset should be in the repository, not the dashboard

**Direction accepted, sequenced deliberately.** C2a found that `vercel.json`'s schema
(`openapi.vercel.sh/vercel.json`) accepts **`services`** among the top-level `framework` slugs, and
that a top-level `framework` **overrides the project's Framework Preset per deployment**. If that
holds, `"framework": "services"` in the file **ends this entire incident class**: preset-without-key
becomes unrepresentable, because one file carries both, and key-without-preset likewise. No future
`vercel.json` change would depend on a dashboard state nobody can see in a diff.

**Two reasons it is not proven and does not go into #1018.** The services documentation says a
top-level `framework` "should be moved into the relevant service", so it may be **refused or ignored
in services mode** despite the schema accepting it; and C2a's own guard test deliberately refuses a
top-level `framework` key today. **Adding an untested element to an already-careful sitting is how a
careful sequence becomes an incident**, which is the lesson of the morning rather than a general
caution.

**The sequence:** #1018 lands under the flipped preset as planned → a one-line follow-up adds
`framework: services` and narrows the guard → Dean reads that preview's build log → if it shows the
services build, he sets the dashboard back to Vite and one redeploy proves the file alone is enough.

**Detection, separately (LUKE-164).** The preview is the oracle and always was: under
key-present/preset-off the preview builds single-app, so `GET <preview>/eve/v1/health` answers 404
instead of eve's health, and under preset-on/key-missing the deploy fails outright. A CI job reading
the PR's preview URL from the GitHub deployment record and asserting **`/eve/v1/health` is not 404**
and **`/api/brain/capabilities` is 401** would have failed #1018 red on every one of the day's five
previews. Its one cost is the Protection Bypass for Automation secret, already asked of Dean for
another reason. **Rejected: a CI step reading the project's framework from Vercel's REST API** — it
needs a token in CI and couples us to that API's shape, to detect a state the file-level fix makes
impossible. **Deferred: a `vercel-build` script in `apps/web/package.json`** as a mitigation; it would
put the build command in two places, and C2a's own later reading showed the fallback already runs
`build`, so what it would recover is only the `db:migrate && auth:seed` prefix — worth doing only if
the repo-controlled preset does not hold.


## 2026-09-11 — The device id a hosted briefing is claimed by: refuse on null, verify on write

**Found by C8 while scoping LUKE-132 part b.** Claiming speech needs a device id — `claimSpeech`
takes one and `markSpeechSpoken` refuses a session with none — but **`voice_sessions.device_id` is
never written.** `register()` takes no device and the voice handshake carries none. So on the hosted
path **no session can claim today**, and a briefing delivered there would have no speaker to
attribute itself to.

**Ruled, and buildable now.** Part b composes the claim from the row's `device_id` and **refuses to
deliver while it is null**, naming the inertness in the PR body. A path that cannot prove which
device is speaking does not speak. An honest inert path merges; a path that guesses a device does
not.

**Ruled, trust.** Whatever route carries the device id, **`register()` verifies the device row
belongs to the authenticated account before storing it, and refuses the registration otherwise** —
never store-and-ignore, never the client's word. A device id a caller can assert without proof lets
one account's session claim speech as another account's device. This is the ownership rule already
in force applied at one more door, not a new rule, which is why it is ruled here rather than
escalated.

**Open, and not ours.** *How* the device id reaches the handshake is the voice path, owned by the
GPT-Live rollout. Two shapes: a **handshake header** the desktop's `HostedLiveSessionSource` sends,
or a **field on the live-session create frame** (which changes their wire schema). Asked of their
orchestrator with a recommendation for the header — the device id is a fact about *who is
connecting* rather than about the session's content, it travels with the handshake that creates the
row, it sits beside the authorization it must be checked against, and it leaves their schema
untouched. The desktop half lands in **E5's attach** whichever shape wins.

**No schema change either way:** the column exists; it is the writer that does not.


## 2026-09-11 — Resolved: the device id rides a handshake header, and both halves are ours

**The GPT-Live rollout chose the header**, for the reasons offered: the device is a fact about the
connecting client, it belongs beside the bearer it is checked against, and the create frame stays
the session document alone. They also handed us **both halves** — the desktop has no notion of a
device id today, so the client side belongs to the account/device model rather than to the voice
path — and stated they will stay out of it.

**The shape, as they ruled it:**

**(a) The header is named once in `@sidecar/hosted`**, beside `VOICE_SERVICE_FRAME` and
`VOICE_SERVICE_PATH`. The hosted wire boundary owns every name both ends must spell; **a string
literal in either app is wrong** even when the two literals agree, because the agreement is the
thing that has to be structural.

**(b) It rides only the handshake that creates the row.** A `session.attach` re-attach — after
`maxDuration` — carries none, because the row already has it. A header on the re-attach would be a
second place the truth could differ from itself.

**(c) `register()` verifies the device row belongs to the authenticated account and refuses
otherwise**, as already ruled here. Never store-and-ignore, never the client's word.

**(d) A missing header leaves `device_id` null and the briefing path refusing** — the inert default
already built into LUKE-132 part b — **never a guessed device.** The accountless **introduction
route carries none and can therefore never claim**, which is correct rather than a limitation: the
introduction speaks from the build's own script and has no briefing to claim.

**Where it is built: E5**, both halves. Desktop touchpoints named by the rollout:
`HostedLiveSessionSource` in `packages/voice` — whose `openSocket(url, headers)` **already takes
headers**, and whose assembler options already plumb them — and whatever bootstrap hands the desktop
its device id. **`packages/voice` stays free of `ws` and the package graph stays acyclic**, which is
the standing rule in `packages/AGENTS.md` rather than a new constraint.

**Nothing was blocked while this was open**, because part b was built refusing on null from the
start. That is the general shape worth keeping: when the open question is *how a value arrives*,
build the refusal first and the arrival second.


## 2026-09-11 — The wake path cannot outrun its drain, and one open question about what it drops

**Asked of C3 before LUKE-127 was called done, and answered by construction.** Coalescing bounds
duplicates rather than rate, so "can anything enqueue faster than the drain empties?" needed its own
answer.

**No, and for three reasons worth keeping:**

1. **Production and consumption share the visit.** The pass writes at most one roster diff per
   account visit (an unchanged pass writes none) and the opener runs in the same visit immediately
   after it (`accountTurn`: observe, then `openTurns`). So while eve accepts, consumption ≥ production
   **every visit** and the inbox cannot grow. N accounts slow both halves equally; **there is no
   cross-account queue to fall behind**, which is the structural reason rather than a measured one.
2. **`plan()` always takes the oldest diff**, cut to the bound only when that one diff alone is
   wider.
3. **Every hold-release row descends from a turn the drain itself bounded.** The sweep queues one row
   per conversation per lift (a `Set` dedupes within a sweep), a row exists only because a briefing
   was announced into a hold, and `announce` is offered only in observation and `hold_release` turns —
   both opened by this same opener under `TURNS_PER_ACCOUNT = 8` per visit. So steady-state production
   can **equal** 8 conversations per visit and never exceed it. A burst after a long hold across C
   conversations drains in **`ceil(C/8)` visits**, during which observations take the remainder of the
   bound (possibly zero) and diffs pile at ≤ 1 per visit, then clear.

**No rate ticket.**

**The degraded mode, and the question it raises.** eve refusing — or an account outrunning its 25 s
share — makes consumption zero while diffs still arrive at ≤ 1 per visit. Storage is bounded at
`MAXIMUM_PENDING_ROSTER_DIFFS = 20`, oldest dropped, **the snapshot being the truth**. C3 states the
cost precisely: *the wake of a session whose last change sat in the dropped diff and that never
changes again.* A **permanently missed wake** — bounded, rare, and silent.

**Put back to C3 because CLAUDE.md rules this case for the desktop and rules it the other way:**

> The two cursors are two on purpose: a throttled or failed inference leaves every entry standing
> for the next turn, a crash between capture and run loses nothing and reads nothing twice.

**eve refusing is a failed inference.** On the desktop the entry stands; on the hosted path the diff
is dropped and the snapshot has already moved past it. So: **is the snapshot advanced when the diff
is written, or when it is consumed?** If only on consumption, an undrained diff **re-derives itself**
on the next pass — wider, against the older snapshot, which is the coalescing already wanted — and
overflow becomes **self-healing instead of lossy**, with at most one pending diff per account.

Asked rather than directed. There may be a good reason for one snapshot: the diff may carry what the
snapshot cannot re-derive, re-deriving may cost a read deliberately avoided, or the two-cursor shape
may not map onto a roster as it maps onto a transcript. **A deliberate difference with a stated cause
is fine and is what G5 needs to write the sentence correctly; an undocumented one is not.** Answered
in the LUKE-127 wrap; a follow-up ticket if it is worth changing, never a reopened PR.


## 2026-09-11 — Why the hosted wake path drops rather than defers: the snapshot is shared

**Answered by C3, and the answer is the cause rather than a defence.** The roster snapshot advances
when the diff is **written**, in one transaction with it (`advanceRosterSnapshot`: CAS on the
observed-at instant under the pass row lock; a pass that found nothing changed moves only the
snapshot). **It cannot advance on consumption, and the reason is not the diff's content.**

**The snapshot is the roster every reader draws, not the brain's private cursor:**
`readHostedRoster` for the brain's standing context (`host.ts`), the opener's own wake descriptions
(`observation-app.ts`), the voice session's roster seed (`voice-mint` / `remote-voice-mint`), and the
pass itself as its previous. **If it moved only when eve accepted, the voice would be seeded with a
roster as old as eve's outage.**

**So `CLAUDE.md`'s two-cursor rule does not transfer by moving this cursor later — it transfers by
adding a second one.** A transcript's capture cursor is the brain's alone, which is why the desktop
could put the capture on it. Here the shared snapshot means the two-cursor shape needs **a second
per-account roster**, not a different time to move the first. **The difference from the rule is
deliberate, and this is its cause** — which is what G5 needs to write the guide sentence correctly
rather than as a contradiction.

**C3's correction to its own bound:** the degraded cost is **20 changed passes** of eve refusal, not
20 minutes, since an unchanged pass writes no diff.

**Filed as LUKE-166**, C3's design and not mine: keep one more sealed roster per account — the roster
as of the last diff the opener **consumed** — derive the one pending diff as current snapshot minus
consumed roster on every visit, and move the consumed roster in the same transaction that today
consumes the diffs and keeps the cursors. A dropped or undrained diff then **re-derives itself,
wider**, `MAXIMUM_PENDING_ROSTER_DIFFS` bounds nothing that can happen, and **the `roster_diffs`
table can go**. Cost: one snapshot-sized sealed row per account and an in-memory diff per visit, with
**no extra provider read** — the diff is fully re-derivable from two snapshots (`roster-diff.ts`).

**The one semantic change, recorded as needing deliberate acceptance:** a session that appeared and
vanished inside an undrained window **nets to nothing** rather than producing an `appeared` +
`vanished` pair. C3 argues that is right for a session no longer there to wake a conversation about.
The honest statement of the cost is that a session which appeared, did something worth briefing, and
vanished would never be mentioned — and the reason to accept it anyway is that **this arises only in
the degraded window, where today's behaviour is to drop the diff entirely. Netting is strictly better
than dropping.** It is a clear win over the unhealthy path rather than a pure win over the healthy
one, and the ticket says so in those terms.

**LUKE-127's PRs stand; nothing is reopened.**


## 2026-09-11 — Amendment: one migration in the queue at a time, and the ids are on two scales

**Two corrections to the migration invariant recorded earlier today.**

**1. "Dequeue and renumber if another migration merges while you are queued" cannot be relied on.**
If two migration PRs are both in the queue, **both readings were valid at enqueue time** — with main
at `0021`, `0022 > 0021` and `0023 > 0021` are each true. The damage lands at **merge** time on
whichever merges second: if `0023` lands first, `0022` is then at or below the highest applied and is
**silently skipped in production** with every check green. Acting on that in time would require
watching the queue continuously and dequeuing within seconds. **That is not a rule, it is a hope.**

**Ruled: at most one migration PR in the merge queue at a time, and the orchestrator holds the
slot.** A worker claims it, is answered taken or hold within the minute, enqueues; the other waits
for the squash to land, re-reads the highest applied, renumbers if it is no longer above, and claims
in turn. Non-migration PRs enqueue normally and ignore all of it.

**Amended within the hour, because C2b's first claim exposed the flaw:** it claimed while still
waiting on two bots and a preview. **A slot held by someone who cannot press enqueue is a
reservation that idles**, and would cost a merge window if the other worker's verdicts completed
first. So: **claim at the moment you are ready to enqueue, not before.** An earlier claim is
first-in-line, which decides only a tie. The slot serializes merges; it is not a turn-taking queue.

**2. The migrator's ids are offset from the file numbers**, and this is the more dangerous of the
two. Observed on main: file `0021` is **journal idx 21, migrator id 22**; file `0023` would land as
**migrator id 24**. So a check comparing a file number against a `migration_id` — or reading one
scale and reasoning about the other — is **off by one, and wrong in exactly the direction that hides
a skipped migration.**

**Ruled: a slot claim states four numbers** — the file name, the migrator id it will land as, and the
highest applied **as a migrator id**, each labelled with its scale. A claim is cheap; a strict
inequality asserted between two different scales is not.

**Added to LUKE-163**, because a test that gets the scale wrong would **pass on a skipped
migration** — the one failure it exists to catch. That test is what retires the slot rule.


## 2026-09-11 — Incident: 34 minutes of total API failure from one value import

**Closed 16:36:00Z. Cause confirmed inside Vercel's runtime by the recovery itself.**

**The defect.** #1070 (`b9114944`, the wake cron) added **one runtime import** to
`server/hosted/observation-tick.ts`: `NOTHING_OPENED` and the type `TurnOpeningOutcome` from
`./brain-host/opener.js`. **Because `NOTHING_OPENED` is a value, esbuild followed it** — opener →
`conversation.ts` → `brain-host/auth.ts` → `eve/channels/auth`, and → `eve-sessions.ts` →
`@effect/platform/Headers`. And `observation-tick.ts` is reached by **every** function, through
`hosted/environment.ts` (`HostedEnvironment`, read by every route) importing
`OBSERVATION_ENVIRONMENT` from it.

**Measured, not inferred:** eve went from **0 of 38 function bundles to 38 of 38**;
`@effect/platform/Headers` from **14 to 38**; `@effect/sql` from 37 to 38 import lines. **Nothing else
changed.** Before #1070 no api function loaded eve at all — the brain-host code ran only inside eve's
own service.

**A type-only import would have been erased and none of this would have happened.**

**Impact.** Every bundled function answered **500 `FUNCTION_INVOCATION_FAILED`** from 16:02:23Z to
16:36:00Z — `/api/brain/capabilities`, `/api/devices`, `/api/auth/get-session`,
`/api/observation/tick`. The page served 200 throughout and the hand-written `api/feedback.mjs`
answered 405 normally, which is what proved the bundles rather than the platform. **Cache-busted
probes with `x-vercel-cache: MISS` confirmed the functions failed on every call.**

**Why nothing caught it.** Typecheck passes (types resolve through the edge fine), the tests pass (a
different module graph), the build passes (bundling this is legal), **the preview was green**, and the
**deploy reported success**. `check.sh` was green. The failure existed only at **module load inside
the Lambda** — a state no gate in the pipeline observed. **#1070's own preview functions were also
500 and nobody probed them**, because a preview's "green" means *the checks passed*, not *the
functions run*.

**Diagnosis path, for the record.** Three hypotheses were raised and two were killed by evidence
rather than argument: a **cycle or module-scope throw** (killed — bundles import cleanly in node under
a production-like environment, identically to the parent), and **a `devDependency` become a runtime
import** (killed — eve is a real dependency, and `@vercel/nft` traced 2,937 files including eve's 22
files and its `#`-subpath internals, with only the two pre-existing optional warnings).
`eve/channels/auth` also imports cleanly under Node 20.19, 22.20 and **24.14**, so eve's
`engines: node>=24` is a declaration rather than a load-time failure. **The Lambda-side reason was
never reproduced from outside**, and did not need to be: the **externals diff** localised the change
regardless of which of the three the runtime choked on.

**The fix (#1132, `5286681a`), three elements and no others:**

1. `OBSERVATION_TICK_PATH` / `OBSERVATION_ENVIRONMENT` / `OBSERVATION_TICK` moved to
   **`hosted/observation-bounds.ts`**, a leaf. Chosen over moving `NOTHING_OPENED` because **a bounds
   module every route may read is a thing with a name**, and the tick keeps its own value import of
   the opener legitimately.
2. `recordedRuntimeSession` split out of `conversation.ts` into **`brain-host/recorded-session.ts`**,
   so even the tick's own bundle never loads eve — **the opener talks to eve over HTTP and needs
   nothing of its package.** That sentence is the layering rule the incident was missing.
3. The bundle plan extracted to `server/function-bundles.ts`, so **the build script and the guard
   share one plan.**

**Verification, which is the part worth copying.** Not "eve is gone" but **every bundle's whole
external set restored**: all 38 bundles' externals **identical** to the last deployment that served
(846 bundle→external lines, zero differing), measured **independently by two workers with different
scripts**, and confirmed by a **third** that reproduced 38-of-38 on the broken base without being
asked. The claim it supports is stronger than the eve count: *whatever the Lambda choked on, it was
among the externals that differed, and none differ now.*

**The guard, which is the durable outcome.** A test over the esbuild **metafile** asserting **no
`dist-functions` bundle imports `eve` or `eve/*`**, running in `check.sh` in 1.4 s. It was
**demonstrated failing on the broken tree** ("received 38 bundles, expected []"). It reads each
bundle's *actual* externals, so it catches **the next carrier** and not only today's path. Its stated
blind spots: type-only imports (erased, and the right way to reach an eve type), modules no bundle
reaches (harmless by that fact), and **being eve-specific by name** — which LUKE-167 closes by
asserting each bundle's whole external set against a committed map, with **a negative test that
breaks the guard on purpose**, because an unfalsified guard is a belief.

**It has already paid for itself twice.** Within minutes of merging it caught a **second, unsuspected
instance** in unmerged #1129 — `brain-ask.ts` → `conversation.ts` (for `conversationOwnedBy`, a
**pure SQL read**) → `auth.ts` → `eve/channels/auth`, where `withAuthChallenges` and `ForbiddenError`
are value imports. **Same class: a value reached through a module that also holds a leaf-shaped
read.** Fixed by moving the read into #1132's eve-free leaf.

**A general hazard now named:** a pure read living in a module that also holds value imports of a
heavy package is a landmine, because importing the read drags the package. When you need one function
out of such a module, **move the function to a leaf.**

**And one still live, found by C4 while measuring:** `apps/web/agent/session-prompt.ts`
**value**-imports `defineState` from `eve/context`, and is safe today **only because 0 of 38 bundles
reach `apps/web/agent/*`**. #1070's exact shape, one edge away. It is LUKE-167's negative-test probe
for that reason.

### Four errors of mine

1. **I handed five workers a measurement practice with a hole in it.** "Verify what your diff makes
   reachable by bundling it" is right; I did not say **against which baseline**. Measured against a
   base where #1070's edge was live, every bundle reaches eve on both sides and **your own edge is
   invisible**. C2b measured, reported clean, and was wrong; the guard caught it. **Corrected to:
   measure against a base you know to be clean, and verify against the guard rather than your own
   script.**
2. **I relayed a peer's inference to Dean as fact and sent him at a worse rollback target during a
   live outage.** From "the parent is docs-only" I published "`ignoreCommand` skipped it, no
   deployment exists" and told him to switch from `ec66c92a` to `06e30e6a`. Both halves were false:
   `ec66c92a` deployed at 15:45:54Z (record 6396605308) and **is** what served 401s at 15:55Z,
   because #1128 touched `apps/web` — **26 comment-only lines** in `devices-schema.ts`, enough to
   defeat `ignoreCommand` and not enough to move a bundle. **Third instance of relaying an unverified
   claim; the rule is widened to: anything Dean will click gets read from the record, or is labelled
   unverified.**
3. **I nearly had Dean un-pin a rollback that did not exist.** A `success` on `5286681a` **74 seconds**
   after merge, against a consistent ~11 minutes, read to me as a pinned promotion. It was a
   **preview** record — the merge group's build of the squash tree, created *before* the merge.
   Retracted before he acted. **Rule: a deployment record has an environment; name it in every
   report.** The timing was the right tell and pointed the right way; the error was reading a status
   without its environment.
4. **My hold raced an authorised enqueue for the second time today.** #1130 entered the queue at
   16:05:07Z, seconds before the hold reached C2a, which pulled it at 16:06Z (`mergeQueueEntry` null,
   state OPEN, never merged). **What worked was asking "are you already queued" rather than assuming**
   — four workers answered with timestamps. That question is now part of the hold.

### What the workers did that I want repeated

**`api/feedback.mjs` answering 405** separated "the bundles" from "the platform" and every later step
rested on it. **Two workers independently refused to report a number they could not stand behind**,
finding a 302 to `sso-api` where a 401-versus-401 discrimination had been asked for — "there is no
function response at all" is a better answer than a plausible one. **C2a corrected its own report
three times**, including the correction that killed my rollback-target error. **C3 was asked whether
it would merge its own fix onto a live outage and answered with the caveat it could not close**, which
is why the 38-bundle equality became the merge condition rather than the eve count. **C4 proposed the
negative test on its own file** — the one that would break the guard on purpose. And **nobody pressed
enqueue.**

### Still owed

**The Protection Bypass for Automation secret**, which is now blocking three things rather than one:
LUKE-164's preview probe, the runtime before-and-after on this incident (both previews answered 302
to `sso-api` at the edge, so no worker could see a function's behaviour at all), and any future
"the deployed shape works" assertion. **One ask, three reasons.**


## 2026-09-11 — The Vercel preset cannot be repo-controlled: LUKE-165 closed negative from source

**Established from `vercel/vercel` itself, with no deploy.** A top-level `framework` beside a
`services` key is **refused** — not honoured, not ignored.

`packages/cli/src/util/validate-config.ts` (main), lines 851–863: with `services` (or
`experimentalServicesV2`) present, any of `functions`, `installCommand`, `buildCommand`,
`devCommand`, `ignoreCommand`, `outputDirectory` or **`framework`** at the top level is collected into
`ambiguousTopLevel` and the validator **returns a `NowBuildError`**, code
`SERVICES_AND_TOP_LEVEL_BUILD_SETTINGS`: *"The top-level property … cannot be used with … because the
owning service is ambiguous."* An error return, not a warning. `validateConfig` is invoked by the
CLI's build command (`packages/cli/src/commands/build/index.ts`, lines 60 and 499) — **the same path
the platform runs in its build container** — so a deployment carrying both keys **fails at config
validation before any service builds.**

**Why the schema made it look possible**, which is the part worth keeping:
`fs-detectors/src/services/detect-services.ts` has **no check on the project framework at all**.
Services resolution triggers on the **`services` key**; with no key it falls back to layout
auto-detection (Railway, Render, Procfile, blessed layouts). **So `framework: "services"` exists for
projects whose services are auto-detected from layout, never for an authored `services` block.** Our
shape — an authored eve service with a custom build — can only be selected by the dashboard preset.
The schema listing the slug and our case being unreachable are both true.

**Consequences, and they change a priority.** The preset/key split **cannot** be closed by a file.
The incident class is closed by **ordering discipline** plus **LUKE-164's preview probe**, which makes
LUKE-164 **the primary defence rather than the second line** — and makes the **Protection Bypass for
Automation** secret it needs correspondingly more important. That secret now blocks three things:
LUKE-164, the runtime evidence on the function-bundle outage, and any future "the deployed shape
works" assertion.

**Worth recording about how this was found.** C2a proposed the repo-controlled preset itself, then
went to the source and **refuted its own proposal**, reporting the refutation rather than the parts
that supported it. That is the third time in one afternoon the same worker has produced the evidence
against its own claim — the "Skipped — Not affected" retraction, the duration heuristic it withdrew
including for its own earlier readings, and this. **A negative finding from source, for free, is worth
more than a positive one bought with a deploy.**

**One side note it flagged and correctly discounted:** #1018's preview for `e4aa2973` built Ready in
65 s under the Vite preset. Single-app as expected, and **uninformative** — consistent with the
duration heuristic already retracted, and named as uninformative rather than offered as evidence.


## 2026-09-11 — The review-thread audit: what "zero open threads" was worth

**Cause of the audit.** C8 found that **`cursor[bot]` auto-resolves its own review threads when it
re-reviews a new SHA, without re-raising the findings** — six threads on its stack, `resolvedBy` the
bot on every one, the worker resolved none, `isOutdated=false` throughout (so **not** GitHub's
outdated-line collapse). **Five of the six were real and still in the code.** Since "complete verdict
set, zero open threads, CLEAN" had been the merge condition all day, and every worker had force-pushed
repeatedly, the condition was worth auditing rather than trusting.

**Scope and result.** **85 threads across 42 of our PRs merged today** (the other workstream excluded;
its orchestrator was told the trap and given the query). Every bot-resolved thread and both open
threads read **against `origin/main`**, not against the thread text.

| | count |
|---|---|
| bot-resolved, **not** outdated (the signature) | 13 over 10 PRs |
| bot-resolved and outdated | 9 |
| human-resolved | 61 |
| **open on a merged PR** | **2** |
| PRs with no threads at all | 20 |

**Three findings stand, all now tracked:**

- **LUKE-169 (Urgent, human-resolved).** #1129's High — two concurrent first asks with different client
  ids both open an eve session, and the loser's ask reads `queued` forever. The bot **found** it; the
  worker resolved the thread with **a reply pasted from a different finding**.
- **LUKE-170 (High, open at merge).** #970's — `?? null` collapses "calendar not yet observed" into
  "no meeting", clearing a valid hold, so **Luke may speak into a meeting** for one poll interval after
  a relaunch. Found by the worker **in its own PR**, reported in full.
- **LUKE-171 (Medium, open at merge).** #957's — an open naming no turn kind is admitted and the
  session **runs under no prompt for life**. Mitigated in practice: the only opener sends the header.

**Everything else was addressed.** Which is the result worth stating as loudly as the findings: the
bot's auto-resolution is **usually correct**, and 61 human resolutions held up but for one.

**Two structural facts the audit established, each now a rule.**

**1. The queue checks resolved threads at enqueue, not at merge.** Both open-at-merge threads have the
same shape: the bot's review landed **while the PR was already in the queue** — #970 thread 03:08:37Z,
merged 03:11:07Z; #957 thread 06:05:10Z, merged 06:08:02Z. **Neither was ignored; neither was seen.**
Waiting for a complete bot verdict set on the exact head before enqueueing closes most of it; watching
for new threads between enqueue and merge closes the rest. **A queue position is not a reservation** —
the same sentence as the migration slot's, for the same reason.

**2. `resolvedBy` separates bot from person and nothing finer**, since every worker acts through one
account. And **`resolvedBy: cursor[bot]` with `isOutdated: false` is the sharp signal** — where the
lines did not move, the bot closed a thread it was not re-raising. Five of six wrong under that
combination; zero of three wrong where `isOutdated` was true.

**The method that made it trustworthy.** Verdicts were read from **the merged commit**, not the thread.
Where the worker could not fully verify — #881, read from the signature and doc rather than the
comparison — it **said so**. Where a fix addressed the finding but left residue — #938's
same-microsecond same-row update, still invisible — it **reported the residue beside the verdict**. And
on **its own six PRs it showed the working**, claim against merged behaviour, one line each, because a
self-review's clean verdict is the weakest result in the set.

**One candidate left open rather than asserted:** `compose-calendars.ts:237`'s
`[...(observations ?? []), ...]` may make `calendarMeetings` an empty array while Google observations
are merely unread — which would defeat LUKE-170's undefined-versus-null fix. To be read as part of
LUKE-170 rather than claimed now.


## 2026-09-11 — Wire: `quietUntil` on the device report carries three states (CONFIRMED, not changed)

**Corrected within the hour by C2a, against my own entry.** I recorded this as a wire contract
*change* I was ruling in. **It is not a change: the contract has carried all three states since the
change signal was declared.** `packages/hosted/src/reads-wire.ts:648` declares
`ChangesRequest.quietUntil` as an **exact optional** `number | null`, line 659 declares it once as
`EffectSchema.optionalWith(presenceInstantSchemaEffect, { exact: true })` **with no default**, and the
doc comment above it says *"null to clear the one on file, and absent to leave it"* **in as many
words.**

**The typecheck error was the host's request object, not the wire.** `device-registration.ts` spread
the report into the poll request, and under **`exactOptionalPropertyTypes`** a key **present and
holding `undefined`** is refused for an exact optional field. The fix is to leave the key off when the
instant is unknown.

**So this entry stands as a confirmation of the three states, and as the hop-by-hop proof that they
survive.** The states:

| state | meaning | the service does |
|---|---|---|
| **absent** | the calendar has not been observed yet this run | **leaves** the stored `quiet_until` |
| **`null`** | observed, no meeting active | **clears** it |
| **an instant** | a meeting covers now | holds until then |

Declared **once** as a `@sidecar/wire` schema, per CLAUDE.md — never as two literals agreeing at the
two ends.

**Verified hop by hop against `origin/main`, absent and `null` distinct the whole way:** the host
report (`quietUntilFrom` answering `number | null | undefined`); the host request, which builds the
poll with a conditional spread so the key is **never present-and-undefined**; the client transport
(`changes-client.ts`'s `changesRecord()` including the key only when defined, with a test asserting on
the **serialised body** that an unknown instant travels as absent — the assertion at the right layer
already existed); the schema parse (exact optional, no default); the route
(`change-signal.ts:94-96`, spreading into the heartbeat only when defined, `null` passing through as
`null`); and the store (`device-store.ts:139-141`, adding the `SET` clause only when defined, already
exercised for both `undefined` and `null`). **No hop coerces absent to `null`.**

**The one new flattening risk was the fix's own spread — and the compiler stopped it.**
`exactOptionalPropertyTypes` is what turned "I might reintroduce the bug I am fixing" into a build
error. Worth knowing which guarantee did the work here: not a test, and not review.

**Backward compatible in the direction that matters.** An older desktop that always sends `null`
keeps exactly today's behaviour — it clears when there is no meeting, including when it does not yet
know. That is the bug, but it is the bug already deployed, so **no existing client gets worse**. A
newer desktop omits the field while it does not know, and the hold survives a relaunch mid-meeting.

**The constraint that makes it real rather than nominal:** **absent** and **`null`** must survive the
whole path distinctly — the schema's parse, the route's read, the store's write. **A default in the
schema, a destructure with a default, or an object built with the key present-and-undefined collapses
the three states one layer along and makes the fix invisible.** The bug being fixed *is* a flattening
hop; the fix must not add a second. A test asserting absence therefore asserts on the **serialised
body**, since `JSON.stringify` makes `{ quietUntil: undefined }` and `{}` identical — which is correct,
both meaning absent, and is also why the object is the wrong thing to assert on.
