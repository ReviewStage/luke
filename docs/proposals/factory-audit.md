# Proposal: Factory, audited and fixed

Status: **A decided by Dean on 2026-10-15, with fixes 1–9, and built as
#2953 → #2958.**

Dean asked for an audit: "The Factory tab is really hard to see and
understand. Let's do a design audit and propose fixes on a Conductor show."
He chose to keep the line: "I think we still want something like A. The
shape of the 'factory' is what I'm trying to capture here. So let's go with A
with fixes 1-9." Then he named the stations: the first is Talk, so the
line reads Talk → Build → Ship, and "Use the block icon for Build", so
Build wears lucide's Blocks.

The design show is `docs/proposals/factory-audit/index.html`. It is one
self-contained file that fetches nothing. Every frame is drawn by the
renderer's real `DesktopShell`, sidebar and stylesheet, in light and dark,
over a synthetic team of five:

- 18 tasks and 7 agents at work;
- 3 questions, 2 failed agents and failing checks;
- 2 pull requests ready to merge and 2 merged;
- quiet, empty, failed-read and 900px frames as well.

The research behind it, with a URL on every claim, is
`docs/proposals/factory-audit/research.md`.

## 1. What was wrong

The show numbers 21 problems on the before frames. The ones that shaped the
fixes:

- **The 3-second test failed.**
  - Three equal cards with arrows read as a board.
  - What needed the developer sat at the foot of two cards, under three
    lines of headings each.
  - The summary that answered "what now" was 13px secondary text.
- **Counts disagreed.**
  - Build showed 6, "5 agents working" and "5 agents on 4 tasks" at once.
  - Factory counted only the account's own agents' questions, while Home
    and the Inbox count every member's.
- **Failures were nowhere.** A failed agent appeared in no step. Failing
  checks differed from passing ones by colour alone.
- **Ship was almost always empty.** A merge stood for 60 seconds, and only
  if this window saw it.
- **Rows were inconsistent.**
  - Questions didn't name their task.
  - The time slot held five kinds of thing, "#2511" among them.
  - "2 more" was text, not a button.
- **Surfaces were faint.** The cards stood at 1.04:1 (dark) and 1.08:1
  (light) against the page, and the arrows at 2.1–2.8:1.
- **Narrow windows broke the line.** At 900px, names cut to two words and
  questions wrapped a word a line.
- **Empty, loading and failed read** all said "Nothing is happening right
  now".

## 2. What others do

All eight products surveyed show agents as a list in attention order, not a
board:

- Claude Code's agent view, Devin, GitHub Copilot's agents, Codex, Cursor,
  Vercel's deployments, Linear and Conductor.

Worth borrowing:

- fixed sections in attention order;
- a word beside every status glyph;
- failed runs and failing CI counted as needing the developer;
- one line per row;
- one rule for every count.

Dean kept the line for the factory's shape, and A takes the rest.

## 3. The fixes, as built

1. **One count per station**, counting the rows it lists.
2. **One row anatomy:** what · which task · who · when, as Home draws a row.
   - **Who:** a teammate's face, whoever started the agent, else whoever
     created the task.
   - **The time slot:** only ever a time.
   - **A pull request:** "#2511 ready to merge" with a plain link's ↗,
     opening on GitHub.
3. **Failures need the developer.** An agent that failed in the last day, and
   failing checks, wear the app's failed mark.
4. **What needs the developer leads its own station**, rather than one list
   above the line. This was reworked for A so a blockage stays at the
   station it holds up.
   - Under Build: questions, then failures.
   - Under Ship: failing checks, then pull requests ready to merge.
   - A hairline sets these rows apart from the rest.
   - The summary is the page's first line: "8 need you · 5 agents working ·
     2 shipped today".
5. **The stations are the app's card.** This was reworked for A so the
   shape stays.
   - Settings' fill, the strong hairline and the control radius.
   - The three stretch to one height and fill the room.
   - The arrows are in the tertiary ink, past 3:1.
6. **No row cap.**
7. **Empty, loading and failed read.**
   - Empty is the app's `EmptyState`.
   - While loading, nothing is drawn.
   - A failed read gets the sidebar's sentence and Retry.
8. **Narrow:** under 720px of room the stations stack and the arrows turn
   down.
9. **↑ and ↓ move through the rows, and Return opens one**, as on Home.

## 4. Decisions

| # | Question | Decided |
|---|---|---|
| 1 | The shape | A, fixes 1–9 (Dean) |
| 2 | A Build row | Each agent, its task as context |
| 3 | Whose work | Everyone's, through Home's Inbox read, so the counts agree |
| 4 | Ship | Merged in the last 24 hours, at the task's last activity |
| 5 | The first station | Talk, holding only the task on a call with Luke; drafts out (Dean) |
| 5b | Build's glyph | lucide's Blocks (Dean). The show draws the toy brick as the alternative |
| 6 | Needs-you order | Build: questions, then failures. Ship: failing checks, then merges. Each newest first |
| 7 | The chord | ⇧⌘F freed; Factory reached from ⌘K and the sidebar |
| 8 | A count on the sidebar's Factory row | None |
| 9 | One-off agents | In Build once chain D's planless agents read (#2932) lands |
| 10 | The name | Factory |
| 11 | An agent that finished with no pull request | Not listed (Dean) |

## 5. PRs

| PR | What | Fixes |
|---|---|---|
| #2953 | Waits for the list, says when it could not be read, and is the empty state | 7 |
| #2954 | Stations lead with what waits; failures among it; rows say what, which task, who, when; Build lists each agent | 1–4 |
| #2955 | Talk holds the call; Build wears the blocks; Ship holds the last day's merges; `noteMerged` deleted | d4, d5 |
| #2956 | The app's cards, readable arrows, no cap, stacked when narrow | 5, 6, 8 |
| #2957 | Every member's open items, through Home's read (`use-waiting-items.ts`) | d3 |
| #2958 | ↑ / ↓ / Return, through Home's keys (`use-row-keys.ts`) | 9 |

Fixes 1–4 land as one PR, because each rewrites the same station and row.

#2968 frees ⇧⌘F through #2905's ⌘K-only commands.

Two things follow the stack:

- listing one-off agents, after #2932;
- reading 324's activity time, which comes through `taskTime` once #2935
  lands, with no change of Factory's own.

Factory stays a thin layer in the renderer: it composes reads the app
already has (the task list, Home's Inbox read, agents' status, `taskTime`),
and nothing in the service, wire, database or host exists for it alone.

The stack waits outside the merge queue until the LUKE-369 renames (#2855,
#2857) land, then rebases onto their names.
