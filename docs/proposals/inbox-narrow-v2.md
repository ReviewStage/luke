# Proposal: the Inbox when it is one column wide

Status: **proposed, waiting on Dean's pick.** Nothing is built yet.

The design show is `docs/proposals/inbox-narrow-v2/index.html`. It is one
self-contained file that fetches nothing. Every frame is the desktop
renderer's real shell, components and stylesheet (`DesktopShell`,
`InboxList`, `InboxPane`, main at `79d807e8`) over a synthetic plan,
in light and dark. The options are drawn by editing those same files.
The frames are live: rows, options, `‹ Inbox`, the arrows, `J` and `K`
all respond to presses, and nothing is sent. The research behind it is in
`docs/proposals/inbox-narrow-v2/research.md`.

Dean, with a screenshot of a plan's Inbox tab at about 790px beside the
pinned sidebar and the side panel open on Call: "I don't like this view of
inbox items at this width. How can we redesign it?"

## 1. Today

Since #2680, a plan's Inbox tab and the window's Inbox each measure their
own width. Under 860px (`inbox-columns.ts`'s `INBOX_SPLIT`) they show one
column at a time. First comes the list, a page of sidebar rows (agent tile,
title, time, blue dot). A press opens the item alone under `‹ Inbox`, and
`⌘[` or `Esc` goes back. With one item, as in Dean's screenshot, that
column is one row over empty space, and reading or answering anything
means pressing first. Moving from one item to the next means going back to
the list in between. If the window narrows while an item is open, it falls
back to the list.

## 2. What others do

The details and sources are in `research.md`. In short:

- One column is a stack: you see the list or the item (Material, UIKit,
  PatternFly, iPhone Mail).
- When a window narrows with an item open, the item stays open
  (Material).
- You move between items with keys or arrows, not by going back to the
  list: `J`/`K` in Linear's and Superhuman's item views, and next/previous
  arrows in iPhone Mail.
- When you finish an item, you move forward, not back to the list
  (Superhuman's auto-advance).
- No source covers a list of one or two items. Slack's Detailed feed and
  Things' expanding rows come closest: they put enough of each item in the
  list that a short list needs no second page.

## 3. The options

**(a) The item first.** In the one-column tier, the Inbox opens on its item
instead of its list. The item is chosen as it is today: the first that
needs you, else the newest. The bar keeps `‹ Inbox` and the crumbs, and
adds "2 of 8" with up and down arrows (`K` and `J`) that step through the
list in its own order. On a plan's Inbox holding one item there is no list
to go back to, so neither `‹ Inbox` nor the pager is shown. Once an item is
settled, its box gives way to **Next**: the next item that needs you, with
`J` beside it. If the window narrows while an item is open, the item stays.

**(b) Cards in the list.** The list stays the page, but each item that
needs you becomes a card. The card shows the agent and when it asked, the
title, three lines of context, and what the item asks for, answerable in
place: options and Send, Decline and Approve, Can't do this and Done, or a
one-line field. Pressing **Add a note** or the title opens the whole item.
Settled items fold back to rows under **Answered**.

**(c) List over item.** One column holds both: the list on top, about three
rows tall and scrolling, and the chosen item under it. This is Mail's
bottom preview.

| | (a) The item first | (b) Cards in the list | (c) List over item |
|---|---|---|---|
| One item (Dean's case) | The item is the page | One card, answerable | A row, then the same item |
| Eight items | One at a time, 2 of 8, J/K | A long scroll of cards | Two scrollers in one column |
| Code cards, images, forms | The pane, as today | Must open the item | The pane, as today |
| Answering | The one box, as today | A second answer surface, with its own sending, failure and "already answered" states | The one box, as today |
| Overview | One press away | On the page | On the page, three rows at a time |
| Window Inbox | The same pane, paging across plans | Needs a live read and an answer path for every listed plan (today it holds one) | Its head uses up height |
| Worker 320's Recommended | Unaffected | Drawn twice | Unaffected |
| Size | 3 small PRs | 4–5 PRs | 2 small PRs |

## 4. The pick: (a)

(a) fixes what Dean pointed at: one item, one row, and the item a press
away. It also handles eight items without a long page. Every item stays on
the one pane that already reads code cards, images and forms. It follows
what the research agrees on: an open item stays open as the window narrows,
and you move on with `J`/`K` rather than back through the list. It doesn't
touch ChoiceOptions, so worker 320's Recommended redesign is unaffected.

(b) is the nicest with one to three items. But it is a second way to read
and answer every item. The window Inbox would need a live read for every
plan it lists. And with eight items it becomes a long page.

(c) gives up a third of the column's height and stacks two scrollers. With
one item it stays closest to today's problem.

## 5. PR plan

All in `apps/desktop/src/renderer`, with no wire, host or service change.

1. `feat(desktop): an Inbox one column wide opens on its item, the list a press of ‹ Inbox away`
   (S: about 60 lines plus 150 of tests).
   - `inbox-columns.ts` shows the item whenever one is chosen, unless the
     list was asked for.
   - A window narrowed with an item open keeps it.
   - A plan's Inbox holding one item gets no `onBack`.
   - Rewrites the #2680 cases in `desktop-plans.test.ts` and
     `desktop-inbox.test.ts`.
2. `feat(desktop): an Inbox item standing alone says where it stands, 2 of 8, and steps up and down the list by its arrows, J and K`
   (M: about 150 lines plus 120 of tests).
   - A `Pager` in `InboxPane`'s bar over `listedItems`.
   - `J` and `K` become two app commands in `#shared/shortcuts`, so they
     appear on the Keyboard shortcuts page and in ⌘K, and stay quiet while
     a field has focus.
   - They also move the chosen row in the two-column tier.
3. `feat(desktop): a settled Inbox item offers the next that needs you where its box stood`
   (S: about 70 lines plus 60 of tests).
   - The next waiting item's tile and title, wrapping round.
   - Nothing is shown where nothing waits.

## 6. Decisions

| # | Question | Recommended |
|---|---|---|
| D1 | When one column wide, open on the item rather than the list? | Yes. The item is the first that needs you, else the newest, as today. |
| D2 | On a plan's Inbox holding one item, drop `‹ Inbox` and the pager? | Yes. The window's Inbox always keeps `‹ Inbox`, because its list holds Needs you and the grouping. |
| D3 | After an answer, move on automatically (Superhuman's auto-advance)? | No. Keep your answer on screen and offer Next with `J`. An answer sent to an agent should be seen landing. |
| D4 | `J`/`K` in the two-column tier too? | Yes, as in Linear. |
| D5 | What do the arrows step through? | The list's own order, settled items included, so "2 of 8" matches the list. Next skips to what needs you. |
| D6 | Keep an open item when the window narrows? | Yes (Material's rule). This reverses #2680. |
| D7 | Up and down arrows, or left and right? | Up and down, as in Mail's message toolbar. Left is already `‹ Inbox`. |

These stay as they are: the list's grouping, the ActorRef tiles and their
hover cards (#2853), the bold title and blue dot for what needs you, `⌘[`
and `Esc` for back, a notification opening its item (#2767), and the
two-column tier above 860px.
