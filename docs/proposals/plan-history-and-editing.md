# Proposal: plan edit history and developer editing

Status: draft for Dean's decision. Plan only, no code.

Dean's ask: "The 'Updated by Command K board for plans · 2h ago' at the top isn't
enough. I also want to support users editing the plan."

Both halves reverse lines in `docs/PLANNING.md`, so they need an explicit
product decision first. "What the tab is not" says "no version history, no diff
view" and "The assumption list is read-only" (`docs/PLANNING.md:36-38`).
"Document" says "It is read-only" (`:226`). The notetaker "is the plan's only
writer" (`:463`). The PR that ships each piece amends those lines too.

## 1. What exists today

### Storage: structured fields, with the body derived from them

- A plan is one row in `plan` (`apps/web/server/db/plan-schema.ts:29-73`).
- `fields jsonb` holds the fixed template's fields, defined by
  `planFieldsSchema` in `packages/hosted/src/plan-template.ts:126-143`. They
  are Goal (problem, outcome), Scope (included, excluded, constraints), rules
  with Given/When/Then examples, Implementation (changeMap, contracts,
  patterns, order), decisions, verification, leftToAgent, openQuestions, and
  dataAndMigration.
- `body text` is formatted from `fields` by `planBody()`
  (`plan-template.ts:323-354`). The formatter owns every heading and escapes
  any field line that would open a heading or an HTML block. "No code reads
  the body back into fields" (`plan-template.ts:27-28`).
- `assumptions jsonb` sits beside the body.
- `updated_at` records the last save of any kind.
- There is no revision counter, no `updated_by`, and no earlier copy of the
  document. "There is no earlier document to fall back on"
  (`plan-schema.ts:17-20`).
- The wire document is `{ body, assumptions }`, "replaced whole on every save"
  (`packages/hosted/src/plan-wire.ts:12-13, 53-59`).
- `PLAN_BOUNDS.MAX_BODY_CHARS = 200_000` (`plan-wire.ts:35`) is the "body
  bound". It is checked after formatting (`plan-notes.ts:108`) and again by
  rename (`plan-store.ts:517-522`).

### Writes: one function, notes, under the row lock

- **There is no `update_plan` tool any more.** It survives only in a stale
  comment (`apps/web/server/hosted/board-tool.ts:27`) and in a test asserting
  it is gone (`packages/live/src/instructions.test.ts:36`).
- The planning brain "never write[s] the document yourself"
  (`brain-host/planning.ts:106-108`).
- Every content write is `saveNotes` (`apps/web/server/hosted/plan-notes.ts:141`).
  It opens a transaction and takes `readPlanForUpdate`, a
  `SELECT … FOR UPDATE` (`plan-store.ts:273-278`). It then runs `applyNotes`
  over the **current** fields, re-formats, enforces the bound, and runs one
  `UPDATE`.
- A note is `add`, `addExample`, `replace {find, text}` or `remove {find}`
  (`plan-template.ts:415-495`). A note whose `find` the field no longer holds
  is passed over and returned as `missed`.

There are two writers:

- **The notetaker** (`apps/web/server/voice/plan-scribe.ts`). It runs
  `gpt-5.6-luna` after each ~1 s pause in speech, and its runs never overlap.
  It saves with **no author**, so nothing records that it wrote
  (`plan-notes.ts:20-23`, `plan-scribe.ts:254-257`).
- **Coding agents' `edit_plan`** (`coder-host/plan-edit.ts:125-148`). Each
  save is capped at 40 notes and appended to `plan.agent_edits` as
  `{agentId, at, notes}`. Only the last 50 are kept (`withAgentEdit`,
  `plan-template.ts:498-520`).

Rename (#1856, `updatePlan`, `plan-store.ts:543-575`) also takes the row lock.
It re-titles the body's heading but leaves `updated_at` alone: "a change is
not a save".

### Where "Updated by" comes from

- `plan-body.tsx:200-208` shows `plan.agentEdits?.at(-1)`: the newest
  **coding-agent** journal entry. The label is resolved from the agent's row
  at read time (`plan-store.ts:140-153`), so the line reads
  "Updated by Command K board for plans", which is an agent's title.
- A later notetaker save, which is most of what changes a plan, does not move
  the line.
- `agoText` reads `Date.now()` with no tick, so "2h ago" goes stale. The
  sidebar's `useMinute` (`planning/plan-time.ts:73`) already fixes the same
  problem.

### History you can rebuild today: almost none

| Source | What it holds | Usable as history? |
| --- | --- | --- |
| `plan.agent_edits` | Last 50 agent saves, as notes | Agent patches only, with no before or after body |
| `coding_agent.plan_snapshot` (`coding-agent-schema.ts:49`) | The Markdown handed to each agent at Start | A few point-in-time snapshots |
| Agent conversations' `messages.parts` | `edit_plan` inputs and outputs | Agent edits past the cap of 50, until the purge |
| Voice transcript segments | What was said | The notetaker's inputs, not its edits |
| Notetaker notes, renames, `plan.draft` frames | Not stored | No |

Migration `0053_plan_template_reset.sql` already wiped bodies once.
**Conclusion: history starts when its table ships. Don't backfill.**

### How the desktop draws the plan and streams drafts

- **Rendering.** `PlanBody` (`planning/plan-body.tsx:163`) renders the body
  through `react-markdown` and `remark-gfm` (`markdown-message.tsx`). It cuts
  the body into units by `##`/`###` heading, and a rule is known by its
  statement (`plan-reveal.ts:52, 148, 434`).
- **The typing chase.** It retypes each unit's difference at 200 chars/s
  (`plan-reveal.ts:29-46`). The difference comes from jsdiff word hunks
  (`plan-diff.ts:139`; `diff` 9.0.0 is already bundled). The only highlight
  is the fading `.plan-fresh` tint.
- **Live drafts.** The notetaker sends `plan.draft {planId, document, savedAt?}`
  at most every 150 ms (`live-contract.ts:357-368`), then once more after the
  save. The path is `live-session-source.ts:1002` → `compose-live.ts:83` →
  `compose-planning.ts:319-329` (`showDraft`), which swaps the held document.
- **No live push for other writers.** Agent edits and renames arrive only on
  the next `PLANNING_REFRESH` (`use-plans-tab.ts:367-375`). "Nothing polls"
  (`docs/PLANNING.md:106-108`).
- **No write path from the desktop.** No act, gateway method, or route writes
  a document. `plans-app.ts:46-47` says "Nothing here writes a document", and
  the PATCH takes name, repository, pinned, and archived only
  (`plan-wire.ts:100-105`).

### What the brain and agents assume about ownership

- **Planning brain.** Every turn it re-reads the plan and gets
  `[saved document]` as JSON, plus `[recent edits by coding agents]`: the
  newest 5, each note cut to 300 chars (`brain-host/planning.ts:253-322`,
  `host.ts:301-314`). **A saved developer edit would reach Luke on its next
  turn**, but unlabelled.
- **Notetaker.** Every run it re-reads `{fields, assumptions}` and is told
  "never restate or reword a point the plan already holds"
  (`planning.ts:228-250`).
- **Voice model (GPT-Live).** It gets the plan once, as the call's seed
  (`voice/opening.ts:168-183`), and is never refreshed mid-call.
- **Running coding agents.** They hold the Markdown snapshot taken at Start
  (`coder-host/start.ts:106`) and are not refreshed. This is already true of
  the notetaker's edits.

**The useful consequence.** Because notes are re-applied to the current fields
under the lock, a developer edit saved between a notetaker run's read and its
save is not overwritten wholesale. At worst, a `replace` or `remove` aimed at
text the developer changed misses. Merge on the server is mostly built already.

## 2. Edit history UX

Options, cheapest first:

| | Option | Like | Needs |
| --- | --- | --- | --- |
| A | Richer header: "Edited by Luke during your call · 2h ago", an editor stack (You, Luke, agent marks), "View history" | Google Docs' "Last edit was…", Linear's activity line | Revision rows; derived per read |
| B | History side-panel tab: revisions grouped by day, each with actor, time, call or agent, and change count. Selecting one shows that version in the document area with changes against its predecessor, plus **Restore this version** | Google Docs version history, Notion page history | Revision snapshots, 3 routes, a diff renderer (jsdiff, already bundled) |
| C | Per-section attribution: hovering a field's heading shows "Problem · edited by you · 3h ago" | Notion's block hover, Cursor's blame | Derived by comparing successive snapshots, field by field |
| D | Changes since you last looked: units changed since your last visit carry a persistent tint and a "4 changes since yesterday" chip, dismissed on scroll or click | Linear's "new" dots, GitHub's "viewed" | A last-seen revision per plan, kept in the desktop's local state; plus B's snapshots |

**Recommendation: A and B first, then C and D.** A is what Dean pointed at,
and B is what makes A trustworthy: an edit you can see but not undo is the
complaint behind the ask. Both C and D are pure derivations once revisions
exist.

### Header (A)

```
Edited by Luke during your call · 2h ago · ⓨⓛⓐ  View history
```

- **Actor names.** The notetaker is named **"Luke"**, because the developer
  talks to Luke and doesn't know a notetaker exists. A coding agent is named
  by its title, as today. The developer is **"You"**.
- **"during your call"** appears when the revision belongs to a voice session.
- **The time ticks** through `useMinute`.
- **During a call** the line reads "Luke is writing…" (the existing
  `onWriting` activity) rather than a timestamp.

### History tab (B)

- The fifth side-panel tab, wired the way the others are
  (`use-side-panel.ts:85-158`; `desktop/side-panel.tsx` `TAB_ICON` /
  `TAB_COMMAND` / switch; a `SHOW_HISTORY` chord in `shared/shortcuts.ts`).
  It also appears as "Version history" in the ⋯ menu's first group
  (`plan-actions.tsx:84-122`).
- **Rows:** "Luke · during your call · 14 changes · 2:14 PM", "You · 3
  changes", "Command K board · 1 change", and "Earlier" for the baseline (see
  §4).
- **Selecting a row** puts the document area into a read-only "viewing a
  version" mode. Insertions get an accent tint and deletions are struck
  through, diffed per unit with the same word tokens `plan-diff.ts` cuts.
- A bar above the document reads
  `Version from Oct 11, 2:14 PM · Luke   [Restore this version] [Back to current]`.
  Esc goes back.
- **Restore** is a new revision (`You restored the version from 2:14 PM`), so
  it can be undone. It is refused while a call on the plan is live.
- The diff renders in the main area rather than the narrow panel, the way
  Google Docs does it.

## 3. Developer editing

### Options

1. **WYSIWYG over the whole rendered document** (Tiptap/ProseMirror, Lexical,
   Milkdown).
   - It fights the model. The body is derived, and its headings belong to the
     formatter. A whole-document editor would need either a Markdown → fields
     parser, which the template deliberately doesn't have, or headings locked
     inside the editor schema.
   - Every candidate costs tens of kB gzipped or more. The 5% slack on the
     698,487 B renderer budget is ~35 kB, so any of them would need a
     deliberate re-record.
   - **Rejected.**
2. **Raw Markdown mode** (CodeMirror, or a textarea over the whole body).
   - Same parser problem.
   - A typo in a heading would silently break the round trip.
   - **Rejected.**
3. **Section (field) editing.** Click a field (or its hover pencil, or press
   Enter on a focused field), and that field's Markdown opens in an
   auto-growing `<textarea>` in place. Headings stay fixed.
   - It maps one-to-one onto `fields`, the unit the server already stores and
     the notetaker already writes.
   - The formatter's containment already makes typed text safe: a `# Heading`
     line the developer types is escaped, so it can't fake a section.
   - No new dependency: a few kB of our own code.
   - **Recommended.**

### Shape per field kind

- **Text fields** (problem … dataAndMigration):
  - One textarea holding the field's Markdown.
  - Emptying it saves `null`, which draws as "Unanswered" as today.
  - Clicking "Unanswered" opens the empty field.
- **Optional fields left out while empty** (Order; Data and migration):
  "Add section ▾" at the end of the document lists them.
- **Rules:**
  - The statement is an inline input, since it is one sentence of at most
    500 chars.
  - Each example is a Given / When / Then row of three inputs.
  - "Add rule", "Add example", and a hover × to delete.
- **Open questions and assumptions:** each item is editable in place, with
  "Add" at the end and × to delete. The assumptions section stops being
  read-only (see open question 5).

### The write: one new developer edit, through the same locked save

`POST /api/plans/{id}/edits` with `{ field, base, value }`:

- `field` is a `PLAN_FIELD`, as today.
- `base` is the field's value when the editor opened.
- `value` is the new value, typed per field: `string | null` for text, the
  rules array, or a string list.
- The server adds `applyDeveloperEdit` beside `applyNotes`
  (`plan-template.ts`), and `savedUnderLock` (`plan-notes.ts:93-137`) takes
  either kind of change.
- The locking, formatting, bound, and journal stay in one place.

This is a **separate wire schema**, not a fifth `NOTE_KIND`. `planNotesSchema`
is what models are shown, so its JSON-Schema goldens are prompt-cache bytes
(`packages/CLAUDE.md`). A developer edit must not change them.

Under the lock:

1. **The current value equals `base`:** the server sets the field and saves.
2. **It differs** (Luke or an agent wrote meanwhile):
   - For a text field, the server rebases: `structuredPatch(base, value)` is
     applied to the current text with jsdiff's `applyPatch` at fuzz 0. If the
     hunks apply cleanly, the merged text is saved.
   - If they don't, or the field is a rule or list (which compare whole), the
     answer is `conflict` with the current value.
3. **On a conflict**, the editor stays open with the developer's text and a
   one-line choice: "Luke changed this section while you were editing.
   [Keep mine] [Use Luke's]". Keep mine re-sends with the new base. Luke's
   text is in history either way, so nothing is lost.

Refusals reuse `PLAN_SAVE_REFUSAL`, adding `TOO_LONG`, which is the body bound.

### Concurrency with Luke writing live

- **No server-side section lock.** A lock would need a heartbeat from the Mac,
  and an expiry for when the Mac sleeps. Notes re-applied under the row lock,
  plus the base-checked set above, give a merge without one.
- **Draft flicker is a renderer concern.** A notetaker run that read the
  fields before the developer's save streams drafts built on the old text.
  `compose-planning.ts`'s `showDraft` holds the developer's field on top of
  incoming drafts while it is being edited or a save is in flight. It lets
  go at the first saved frame or read whose `savedAt` ≥ the edit's save.
  Saved frames are re-applied under the lock, so they carry the edit.
  `plan-reveal.ts` must not chase a held unit.
- **A unit open in an editor** is never re-typed underneath the caret. Changes
  to other units keep typing in as now.
- **What Luke sees next turn:**
  - The standing context gains `[recent edits by the developer]` beside
    `[recent edits by coding agents]` (`planning.ts:255`): field, time, and
    a before → after excerpt, read from revisions.
  - The notetaker's `SCRIBE_INSTRUCTIONS` gains one fact plus a
    `[fields the developer edited]` list: "The developer edits the plan
    directly too. Never reword or strike what the developer wrote unless they
    say so on the call."
  - Model-facing words only add facts (`docs/DESIGN.md:214-219`). The changed
    instruction costs one prompt-cache prefix, once.
- **What Luke doesn't see:** the live voice model's seed. Pushing a mid-call
  "You edited Scope" line is open question 4.
- **Running agents** keep their snapshot, as with notetaker edits today. They
  can be told with `message_coding_agent`, but automating that is out of scope.

### Saving, undo, failure

- **Autosave** fires after 1 s of idle typing and on blur. Each success moves
  `base` forward.
- **Esc** reverts to the text the editor opened with, then closes.
- **Status sits in the header line:** "Saving…" → "Edited by you · just now";
  on failure, "Not saved: the service could not reach its store. [Try again]".
- **Undo:**
  - Inside an open editor: the textarea's own undo.
  - After the editor closes: ⌘Z within the plan page undoes the developer's
    last edit as a base-checked set back to its prior value.
  - Further back: History → Restore.
- **Offline or failed saves:**
  - Unsaved text stays in the editor and in the renderer's memory. It is
    **never written to disk** (the panel's privacy rule, `PRIVACY.md:43-44`).
  - Leaving the plan with unsaved text asks first, through
    `useConfirmDialog`.
- **Plumbing** follows the renderer's one write door
  (`apps/desktop/src/renderer/CLAUDE.md`): new act kinds `PLANNING_EDIT`
  and `PLANNING_RESTORE`, the gateway methods `planning.edit`,
  `planning.history`, and `planning.revision`, `compose-planning.ts`, and
  `HostedPlanClient`.

## 4. Data model, wire, migration, privacy

### `0072_plan_revision.sql`

- Next after `0071`. It also needs a journal entry and the Drizzle module in
  `plan-schema.ts`. `drizzle-schema.test.ts` holds both directions.

```sql
CREATE TABLE "plan_revision" (
  "plan_id"          uuid NOT NULL REFERENCES "plan"("id") ON DELETE CASCADE,
  "seq"              integer NOT NULL,          -- per plan, from 1
  "actor"            text NOT NULL,             -- PLAN_ACTOR: developer | notetaker | agent | earlier
  "agent_id"         uuid REFERENCES "coding_agent"("id") ON DELETE SET NULL,
  "voice_session_id" uuid REFERENCES "voice_sessions"("id") ON DELETE SET NULL,
  "restored_from"    integer,                   -- seq, when this revision is a restore
  "fields"           jsonb NOT NULL,            -- the content after this revision
  "assumptions"      jsonb NOT NULL,
  "changes"          integer NOT NULL,          -- notes taken / fields set, summed over the group
  "started_at"       timestamptz NOT NULL,
  "at"               timestamptz NOT NULL,
  PRIMARY KEY ("plan_id", "seq")
);
```

- **Snapshots, not patches.** Plans are small, Postgres compresses large
  `jsonb`, and a snapshot makes diff and restore a read rather than a replay.
  The body is re-derived with `planBody`. Snapshots keep `fields`, so a
  restore is exact.
- **Coalescing keeps the row count sane.** A save by the same actor and source
  as the newest revision updates that row in place, moving `fields`, `at`,
  and `changes`. The source is the same voice session, the same agent, or the
  developer within 10 minutes. So a call is about one notetaker revision,
  interleaved with the developer's.
- **The save writes it.** `savedUnderLock` writes the revision in the same
  transaction as the `UPDATE`, so a plan and its history can't disagree.
- **The baseline.** The first save after the migration first inserts the
  pre-save state as `actor = earlier` ("Earlier"), so the first diff has a
  left side.
- **The notetaker needs its call's id.** `planScribe` gets `voiceSessionId`
  threaded from `voice/live-exchange.ts:238`.
- **`agent_edits` stays** for the brain's notes context in the first PRs. The
  brain's two "recent edits" blocks move onto revisions with PR 4, and the
  column is dropped once nothing reads it.
- **Rename writes no revision.** It changes the heading, not the content.

### Wire (`packages/hosted/src/plan-wire.ts`)

- `planSchema.lastEdit?: { actor, label, at, duringCall: boolean }`, plus
  `editors?: { actor, label }[]`: the most recent distinct editors, at most 3.
  Optional, so an older service still reads.
- `GET /api/plans/{id}/revisions` returns
  `{ revisions: { seq, actor, label, startedAt, at, changes, duringCall, restoredFrom? }[] }`,
  newest first, paged by `before`.
- `GET /api/plans/{id}/revisions/{seq}` returns
  `{ document, previous: document | null }`, both formatted under the current
  name.
- `POST /api/plans/{id}/revisions/{seq}/restore` with `{ base: currentSeq }`.
- `POST /api/plans/{id}/edits` (§3) answers
  `{ status: "saved", plan } | { status: "conflict", current } | { status: "refused", reason }`.
- **Value sets** are `as const` (`PLAN_ACTOR`, `PLAN_EDIT_STATUS`).
- Every request refuses unknown keys, as the wire does. After the routes are
  added, run `pnpm --filter @luke/web functions:rewrites`.

### Privacy

- **`PRIVACY.md` "Feature plans"** (`:58-67`). Replace "A save replaces the
  document and no earlier version is kept" with: earlier versions are kept as
  the plan's version history (who wrote each, when, the content), readable by
  operators like the document, and deleted at once with the plan
  (`ON DELETE CASCADE`; plan deletion is a hard `DELETE`,
  `plan-store.ts:337-344`) and with the account.
- **Name the developer as a writer** in the same section and in "How the plan
  is written during a planning call" (`:170-181`).
- **Name `agent_edits`.** The section doesn't mention it today.
- **Usage data.** Optionally add two property-less events, `plan_edited` and
  `plan_version_restored`, to `packages/analytics/src/product-events.ts` and
  the fixed list (`PRIVACY.md:219-226`). Never a field name, never text.
  Plan text enters no counted event, trace, or fixture, per the root "Never"
  rule.
- **Session replay.**
  - A `<textarea>`'s value is masked by the library default, and text nodes
    are masked by `maskTextSelector: "*"`.
  - But rrweb records a mutation per keystroke, so masked lengths would still
    show typing rhythm.
  - Put `ph-no-capture` on the editor root and the History tab root, the
    precedent for the composer, board, and transcript.
  - Update the block count in `session-replay.ts:22-31` and the list in
    `PRIVACY.md:228-246`.
  - Deliberately don't use `contenteditable`: it is not an input, so only
    text masking would cover it.

## 5. Tests (hermetic, smallest layer)

- **`packages/hosted`, pure:** `applyDeveloperEdit`:
  - Set when base matches; null-out.
  - A clean rebase over a notetaker `add` in the same field.
  - A conflict when hunks overlap.
  - A typed `## Heading` line contained by `planBody`.
  - The rules and list kinds compared whole.
- **`packages/hosted`, goldens:** the existing JSON-Schema goldens prove
  `planNotesSchema` didn't move.
- **`apps/web` on PGlite** (`it.layer(testSqlClient)`, `support/hosted-store-database.ts`):
  - A developer edit writes a revision and answers the saved plan.
  - Notetaker saves in one session coalesce into one revision; a developer
    save between two of them splits the group.
  - An agent save records `agent_id`.
  - A notetaker `replace` aimed at text the developer rewrote misses, and the
    developer's text stands.
  - Restore is a new revision.
  - Deleting the plan leaves no revisions.
  - Another account's plan id answers as no plan, on every new route.
  - A stale `base` answers `conflict`.
  - Lock contention between two connections goes in `test:store` on real
    Postgres (`anotherConnection`), since PGlite has a single connection.
- **`brain-host`:** the standing context names the developer's recent edits,
  with a test through `planningStandingContext`.
- **Desktop, pure models:**
  - The draft hold: a draft is ignored for a held field until a saved frame
    at or after the edit.
  - The history list rows and labels.
  - The version diff marks.
  - The editor's autosave, Esc, and conflict states, through
    `use-plans-tab`-style models.
  - No test of a constant or a call count.
- **Mac evidence:** `verify.sh` captures the header, the History tab, a
  version view, and a field open in the editor. CI can't verify the Mac.

## 6. PR plan

Ordered so the first PR fixes the header Dean pointed at, and editing only
ships once history can undo it.

| # | PR | Size | Contents |
| --- | --- | --- | --- |
| 1 | Revisions and an honest header | M (~500) | `0072_plan_revision`, written by `savedUnderLock` with coalescing and the baseline; `voiceSessionId` into the notetaker; `lastEdit`/`editors` on the wire; header "Edited by Luke during your call · 2h ago" with a ticking time; PRIVACY "Feature plans" |
| 2 | History tab | M-L (~800) | The 3 revision routes, gateway and act plumbing, the History side-panel tab, version view with diff, Restore; `ph-no-capture`; PLANNING.md "no version history, no diff view" amended |
| 3 | Edit a text field | L (~900) | `applyDeveloperEdit` with rebase and conflict, `POST …/edits`, `PLANNING_EDIT`, the textarea editor, autosave and status, the draft hold, Esc and ⌘Z, the leave-with-unsaved confirm; **brain and notetaker told of developer edits** (it ships with editing, not after); PLANNING.md "read-only" amended; PRIVACY writer wording |
| 4 | Edit rules, lists, assumptions | M (~600) | Rule statement and example rows, item editing, "Add section" for optional fields; the brain's recent-edits blocks read from revisions; `agent_edits` read path retired |
| 5 | Who wrote what | M (~400) | Per-field attribution on hover (C), and changes since you last looked (D) with the last-seen revision in desktop state |

PRs 1 → 2 → 3 → 4 stack, and 5 can follow 2 in parallel. PR 1 alone answers
"isn't enough". PRs 1 and 2 together give real history before any new writer
exists.

## 7. Risks

- **Row volume.** If coalescing is wrong, the notetaker writes a revision
  every ~1 s. A PGlite test pins one row per session.
- **Merge surprises.** A clean jsdiff rebase can still read oddly. Mitigation:
  the merged text is what the editor shows after the save, and history holds
  both sides.
- **Instruction drift.** One more fact for the notetaker can still lead it to
  avoid legitimate corrections. `test:agent`'s offline brain eval gets a case:
  a developer-edited field, then a spoken correction to it.
- **Spec drift.** PLANNING.md and PRIVACY.md change in the same PRs, or
  review should refuse them.
- **No Mac CI** (LUKE-159). Each UI PR carries the developer's own
  `verify.sh` run.

## 8. Open questions for Dean

1. **Confirm reversing PLANNING.md's "no version history, no diff view" and
   "read-only document".** Everything else depends on this.
2. **Editing during a live call: allowed with merge (recommended), or editing
   locked while a call is live?** Locking is simpler, but it blocks the
   moment you most want to fix what Luke just wrote.
3. **Retention: keep every revision for the plan's life, or cap it** (say,
   the newest 500, or coalesce anything past 90 days into daily rows)?
4. **Should the voice acknowledge a mid-call edit** ("I see you tightened the
   scope")? That needs a line pushed into the live session, which doesn't
   exist today.
5. **Assumptions.** Does editing an assumption confirm it? Should there be an
   "Accept" that moves it into a field, or do assumptions just become
   editable like the rest?
6. **Actor names.** The notetaker shown as "Luke" (recommended) or
   "Notetaker"?
7. **Running coding agents.** Offer "Send changes to <agent>" after an edit
   while an agent is running, or leave that to the developer?
8. **Free sections.** Is a section of the developer's own outside the fixed
   template out of scope? (Recommended: yes. The template is the contract
   agents are built against.)
