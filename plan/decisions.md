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
