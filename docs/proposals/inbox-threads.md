# Proposal: Inbox items as threads

Status: **direction chosen by Dean, not built.** Dean picked B, the comment
thread, over A, the transcript thread. He then asked for three things: a
two-stage swipe (a short swipe opens a button, a long swipe does the
action), the standard mail icons for marking read and unread, and no Open
agent button in the thread's bar. This version of the design show has all
three. Nothing in §5 is built yet.

The design show is `docs/proposals/inbox-threads/index.html`. It is one
self-contained mockup that fetches nothing. It is hand-drawn in the
desktop's dark palette, not built from the renderer's components. The window
in it is live: the Design and Item switches, swiping a row with a pointer or
with two fingers on a trackpad, the hover button, right-click, `U`, the view
options' Mark all as read, and the agent's name all respond. Sliders under
the window move the swipe's two thresholds.

Dean's ask: make Inbox items feel more like threads.

## 1. What reads as off today

- **Who's speaking.** Every message gets a byline, `[mark] Agent asked 24m`,
  with the words indented under it (`Byline`, `.inbox-indent` in
  `inbox-pane.tsx`). No other surface in the window does this.
- **The subject.** The item's title is an `h3` inside the agent's message,
  so the thread itself has no subject.
- **Options.** `.inbox-option` rows all stay outlined after you answer, and
  the pick is said three times: on the option, in your bubble, and in "You
  chose 7 days".
- **Where it ends.** The thread stops at your answer. To see what the agent
  did with it, you have to open the agent's tab.
- **Context.** The agent's transcript draws the same post as a collapsed
  `post_to_inbox` row (`CALL_KIND.INBOX_POST`), so one exchange looks two
  different ways.
- **The list.** Each row is one line: mark, title, time, and a dot. It
  doesn't say what was said last or who's waiting on whom.

## 2. The thread: B, a comment thread

Every message is a comment: a 24px avatar, the name and a muted time on one
line, the words under it, and a line down the left joining it to the next
comment. The subject leads, with a muted line under it: agent, asked when,
reply count, and state. Once you answer, the options fold to one line and
your pick rides in your comment as a chip. The agent's next message follows,
and a reply box stays at the end.

The bar holds only the crumbs, the read toggle, and "3 of 9". **Open agent
goes.** The agent's name, in the crumbs and on its comments, opens its tab,
the way an agent's name does elsewhere in the window. The agent's hover card
already leaves out Open agent for the same reason (`hover-card.tsx`).

A, the transcript thread, stays in the show as the alternative.

## 3. Two states on a row: unread and needs you

The two are separate marks:

- **The blue dot and a semibold title mean unread.** You can flip it.
- **The orange attention mark beside the time means needs you.** It is the
  `attention-mark.tsx` disc, worn where `.task-mark-attention` already puts
  it. Only answering clears it.

An earlier version used the blue dot for needs you and drew every needs-you
row semibold, so a read needs-you item looked the same as an unread one. The
show keeps that version as "Before", next to a third option, "Needs you as a
section", which it rejects because it fights Group by task.

## 4. Marking read and unread

- Opening an item marks it read. Anything new in the thread makes it unread
  again.
- **Swipe right, in two stages, as in Mail.** Let go after a short swipe
  (past 24px) and the row stays open on a blue Read or Unread button. Click
  the button to flip the dot. A click anywhere else, a swipe back, or a swipe
  on another row closes it. Let go after a long swipe (past 60% of the row)
  and the dot flips without a click. While the swipe is past that line, the
  button gets brighter and its label moves with the row's edge. Pull back
  under the line before letting go and the row stays open instead. The row
  moves on `transform` alone (DESIGN.md). Swiping left does nothing for now.
- **Hover.** One button takes the place of the time.
- **Right-click.** Mark as read / Mark as unread goes at the top of the row's
  menu, with `U` beside it.
- **`U`** toggles the open item. `⇧⌘U` is already Automations'
  (`command-palette.tsx`).
- **The thread's bar** has the same toggle.
- **Mark all as read** goes in the list's view options. It clears dots only;
  attention marks stay.

Every one of these uses the standard mail icons: an open envelope (Lucide
`mail-open`) for Mark as read and a closed envelope (`mail`) for Mark as
unread.

## 5. The changes, in order

1. **The comment thread** (cards 1–3): the comment layout, the subject header
   and the trimmed bar, and the options folded once answered. Desktop only.
2. **Thread rows** (5), then **marking read and unread** (10). The preview and
   the attention mark are desktop only. Unread needs the service to keep a
   seen marker per item. Swipe comes last, since the hover button, the menu,
   and `U` cover the same action first.
3. **The agent's reply after yours** (4), then **earlier context** (6). Both
   read the agent's transcript, as the agent tab already does.
4. **One card in both places** (8). The agent tab draws the Inbox's card
   where it now draws the `post_to_inbox` row.

Cards 7 (quick replies over the box) and 9 (an "Edited" event for a
revised item) are small and can land whenever.

## 6. Open questions

- The swipe's two thresholds (24px and 60% of the row) are starting values.
  Use the show's sliders to tune them.
- Where the seen marker lives: per member and item on the service, or only
  on the device.
