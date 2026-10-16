# Proposal: the pinned summary beside an empty side panel

Status: **decided by Dean on 2026-10-16: (a)**. Dean: "I think we had some
work to close the panel when the last tab closes, so check for that first and
then build the reopen logic on top." The close is #3123. The reopen logic, and
the panel staying hidden on a plan with no tab open (D2, D3 as recommended),
come in a PR stacked on it. D4 and D5 are still open.

The design show is `docs/proposals/summary-beside-empty-panel/index.html`. It
is one self-contained file that fetches nothing. Its frames are drawn by hand
on the desktop stylesheet's own tokens (`desktop.css`, `base.css`, main at
`f3444923`), in dark and light, over a synthetic plan. They are not rendered
by the app's components. The frames respond to presses: closing a tab,
Show panel, switching plans, and choosing a row all do what the option says,
and nothing is sent.

The task: "UI is confusing when pinned summary is open and right panel is open
with no tabs. Brainstorm some better UX patterns."

## 1. Today

On a wide window, two lists stand side by side:

- **The summary**, pinned at the right of the plan's column
  (`task-summary.tsx`). Under Tabs it lists the Inbox and each panel kind
  the plan has used (Board, Code, Call). Then come Coding agents, Changes,
  Subagents, Files and Pages. A row opens what it names: a kind, a subagent,
  a file or a page opens in the side panel, and an agent opens in the plan's
  column.
- **The empty side panel** (`side-panel.tsx`'s `NoTabs`). It says "No tabs
  open" and lists every row its "+" offers, under the same headings: all
  three kinds, then Changes, Subagents, Files, Pages and Terminal.

So the window shows the same rows twice, side by side across a hairline, with
nearly the same headings. The empty panel's bar also has its own "+", which
is a third way to open the same things. Nothing says how the two lists
relate. The summary looks like it is about the panel, the panel looks like it
is a list, and the panel uses its whole width (400px by default, 280px at
least) to repeat the column next to it. Pinned needs a 1040px column
(`SUMMARY_WIDE`), so this shows on windows about 1700px wide or more.

The summary's first heading is "Tabs" while the panel beside it says "No tabs
open". That reads as a contradiction: the summary lists tabs the plan has
used, not tabs that are open.

### How the window gets there

The panel's `open` is held for the window, and its tabs are held per plan
(`use-side-panel.ts`). So there are three ways in:

1. **Closing the last tab** with its × or ⌘W. `withoutTab` picks no
   replacement and leaves `open` true.
2. **Switching plans with the panel open** to a plan whose strip is empty,
   because nothing there is held yet or everything was closed there.
3. **Show panel** (the top-right toggle, or its shortcut) on a plan whose
   strip is empty.

Path 2 is easy to hit without noticing, and an option that only handles path 1
leaves it standing.

The panel is blank, rather than a list, when it has never closed a kind and
offers nothing past the three kinds. That case looks broken in another way,
and every option below covers it too.

## 2. What others do

- **VS Code** closes an editor group when its last editor closes
  (`workbench.editor.closeEmptyGroups`, on by default), so the empty state
  does not exist. When a view container is dragged out of the secondary side
  bar, the bar hides.
- **Browsers** close a window when its last tab closes. Their New Tab page is
  the one place that lists where you can go.
- **Cursor's** summary, which ours copies (`task-summary.tsx`), stands beside
  a document whose panel holds something. Cursor has no empty-panel state
  beside it.
- **Xcode's inspector** and **Figma's right panel** always show something for
  the selection, or show nothing. They never show a list of what they could
  show.

The common rule: an empty pane is either removed, or it is the one place that
lists what can go in it. It is never a second copy of a list that is already
on screen.

## 3. The options

**(a) The panel goes with its last tab.** Closing the last tab hides the
panel. The panel is shown while it is open *and* the plan's strip holds a
tab, so switching to a plan with an empty strip slides it shut, and switching
back slides it open again. Show panel on an empty strip reopens the plan's
most recently closed tab (what ⌘⇧T reopens). If there is none, it opens the
first kind the plan holds, and if there is none of those either, Call. The
summary is now the one list, and its rows reopen the panel. `NoTabs` is
deleted.

**(b) The empty panel is the summary.** While the panel is open and empty, the
summary moves out of the column and into the panel, as its page: the same
rows and headings, with the "+" in the bar above it. The column gets its 240px
back. Once a tab opens, the summary moves back to the column. That way there is
one list, in the place things open into, like a browser's New Tab page. An
agent's row still opens in the column.

**(c) One list at a time.** The summary and the empty panel never both show
their lists. In (c1), the empty panel defers: while the summary is pinned, the
empty panel shows only "No tabs open" and "Open one from the summary, or
with +", with no list. In (c2), the summary yields: while the panel is open,
the summary collapses to its rail. Either way, nothing about the panel's
state changes.

**(d) Linked lists.** Keep both lists, but tie them together. Rename the
summary's "Tabs" heading to **Views** (or drop the heading). A row whose tab is
open in the panel gets an open mark (a filled glyph or a dot, as an editor's
Open Editors list does). The empty panel's line points at the summary. This
explains the duplication instead of removing it.

**(e) The summary becomes the panel's home tab.** The summary leaves the column
and becomes an Overview tab that always leads the panel's strip and cannot be
closed. The panel is never empty, and the column never has a summary. This is
the largest change: it gives up the Cursor-style summary pinned beside the
document, and the rail and the card with it.

| | (a) Goes with last tab | (b) Empty panel is the summary | (c1) Panel defers | (c2) Summary yields | (d) Linked lists | (e) Home tab |
|---|---|---|---|---|---|---|
| Two lists side by side | Never | Never | Never | Never | Still, explained | Never |
| All three ways in covered | Yes | Yes | Yes | Yes | Yes | Yes |
| Blank panel case | Gone | Summary or "+" | Still blank | Still blank | Still blank | Gone |
| Summary not pinned (rail, none) | Panel still goes | The panel holds the whole summary | Panel keeps its list | Panel keeps its list | As today | n/a |
| Motion | Panel slides shut | Summary glides across | None | Rail glide | None | None |
| What it costs | Show panel needs a default tab | One component with two homes | A third empty-state variant | Summary hides while you use the panel | Adds marks | Redesigns the summary |
| Size | 1 PR, mostly `use-side-panel.ts` | 2 PRs | 1 small PR | 1 small PR | 1 small PR | 3 or more PRs |

## 4. The pick: (a), with (d)'s rename

(a) removes the state instead of decorating it. It matches the platform rule
(VS Code's empty groups, a browser's last tab), and it handles all three ways
in, including the blank panel. The summary stays as it is, pinned beside the
document, and becomes the only list of what the plan holds. Its rows
already open the panel. Most of the change is in `use-side-panel.ts`: what
`withoutTab` leaves when it picks no replacement, what Show panel opens on an
empty strip, and a derived "shown" that is `open` while the strip holds a tab.

(d)'s rename of "Tabs" to "Views" is worth doing either way, because the
heading names kinds the plan has used, not tabs that are open. It is one
string.

(b) is the best fallback if an empty panel should keep explaining what can go
in it. It is a bigger move, though: the summary would have two homes, and its
glide across the window would be a new motion in `pane-motion.tsx`. (c1) is
the cheapest fix, but it leaves a dead pane that takes the window's width.
(c2) hides the summary just when you are using the panel it summarizes. (e)
is a different design, not a fix.

## 5. PR plan for (a)

All in `apps/desktop/src/renderer`, with no wire, host or service change.

1. `feat(desktop): the side panel goes with its last tab, and Show panel on an empty strip reopens the last closed`
   (S to M: about 80 lines, plus tests in `use-side-panel.test.ts` and
   `side-panel.test.ts`).
   - Closing the last tab sets `open` false.
   - The panel is drawn while `open` holds and the plan's strip holds a tab.
     Switching to an empty plan slides it shut through the existing exit,
     without clearing `open`.
   - Show panel and ⌘T on an empty strip open a tab first: the most recently
     closed, else the first kind the plan holds, else Call.
   - `NoTabs` and its `.side-panel-no-tabs` rules are deleted.
2. `fix(desktop): the summary's first heading says Views`
   (XS). Only if D4 says yes.

## 6. Decisions

| # | Question | Recommended |
|---|---|---|
| D1 | Which option? | (a) |
| D2 | Under (a), should switching to a plan with an empty strip hide the panel, or open a default tab there? | Hide it, and keep `open` so it returns on a plan that holds a tab. A default tab opened on every plan you pass through would fill strips you never asked for. |
| D3 | Under (a), what does Show panel open on an empty strip? | The most recently closed tab, then the first kind the plan holds, then Call. |
| D4 | Rename the summary's "Tabs" heading to "Views"? | Yes. |
| D5 | Under (a), what does ⌘W do once the last tab is gone and the panel has the focus? | As today with no tab chosen, it falls through to the menu bar. The panel is hidden by then, so the focus goes back to the column, and ⌘W acts there. |
