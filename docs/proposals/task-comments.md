# Proposal: comments on a task's plan

Status: **Approved as shown** by the developer for the plan "Support comments on
tasks". Built in three stacked pull requests: the store and service, the desktop,
then the agents and Send to.

The design show is `docs/proposals/task-comments/index.html`. It is one
self-contained file that fetches nothing, drawn by hand on the desktop
renderer's own tokens and geometry (`base.css`, `desktop.css`, `planning.css`)
over a synthetic Acme, in light and dark. It has a prototype to click through and
a frame for every state.

## Decided

- **Where a thread sits.** In the right margin beside its passage (a 288px card,
  48px from the reading column, the column moving left to make room) when the
  document's column has room; otherwise the margin folds into a count at the end
  of the passage's line, which opens the thread as a card floating under it.
- **Starting one.** Select words and press the bubble's Comment, or press a
  block's own button at the column's end to comment on the whole block.
- **Send to** lives in each thread's reply field: Luke first, then the task's
  coding agents by name. Posting asks no one; Send to asks the one picked to read
  the thread and the plan and answer in the thread.
- **History** is the side panel's Comments tab, Open and Resolved, with Reopen;
  the summary's Tabs section counts the open threads.
- **Marks** wear a new amber pair, `--comment-mark` and its active and edge
  forms, which no selection, find, or attention colour shares.
- **Links** are the task's link with `?comment=<thread>`, so `#heading` stays
  free for section links.

## How an anchor is kept

The service keeps a thread's anchor as offsets into the plan's Markdown beside
the thread, never in the text, so every reader of the text (the notetaker's
phrase matching, the agents, Copy plan, section links, bylines, revisions) reads
none of it. The plan's one save moves every anchor with its words
(`@luke/features/plan-comment-anchor`); a thread whose every word was deleted
keeps its quote and says "Original content deleted". In the open editor an
anchor is a mark that moves with its words and comes back with them on undo;
each save reports where the editor's anchors stand, which is how undo anchors a
thread again and redo takes it off.
