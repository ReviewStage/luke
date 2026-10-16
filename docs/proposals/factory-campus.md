# Proposal: Factory as a campus of buildings

Status: **Exploration, undecided.** This is one of two directions for another
Factory view. It sits beside the open factory-floor direction so the two can be
compared. It is a mockup, not a feature: nothing in the app changes.

The design show is `docs/proposals/factory-campus/index.html`. It is one
self-contained file that fetches nothing. Open it in a browser. It copies the
window's own tokens from `base.css`, `desktop.css` and the generated motion
tokens, and lucide's glyphs, so the sidebar, toolbar, pane, rows and buttons
match the app. The campus itself is SVG drawn by the page's script.

Every task, agent and pull request on it is illustrative:

- Talking: Add another Factory view (on a call).
- Agents: Invite your teammates (Opus, needs an answer), Improve search ranking
  (Sonnet, working), Keyboard shortcuts (Opus, working).
- Pull requests: Fix reconnect handling (ready to merge), Faster workspace
  switching (merged), Polish empty states (merged).

## The idea

Every task is a building on the workspace's campus. You read its state from
the building, not from a column it stands in:

| On the building | What it means |
| --- | --- |
| Lit windows, smoke from the stack | Agents at work |
| A beacon pulsing on the roof | Someone needs an answer |
| Rings rising from the mast | You are talking it through with Luke |
| A packed truck at the loading dock | A pull request is ready to merge |
| A crane over unfinished floors | Going up |
| A flag on the roof, windows going dark | Merged |
| A dashed empty plot | New task |

Window light uses the app's own state colours (`--state-working`,
`--state-attention`, `--voice-developer`, `--state-complete`,
`--state-merged`), so a building's glow means what a row's dot means elsewhere.
Night is the dark appearance and day is the light one.

## What you can do in the show

- Click a building, or its task in the sidebar. Its roof lifts off, the walls
  facing you drop, and you see inside: the agent at its desk, a question
  bubbling over it, packed crates by the dock, or you and Luke at a table.
  The inspector pane opens beside the campus with the question, the pull
  request, who is inside and their activity.
- Answer Opus's question. The beacon goes out and the windows turn working
  blue.
- Merge #3081. The truck pulls off the dock and drives off the campus, then the
  flag goes up.
- Press **2 need you** to fly from one building that needs you to the next.
- Drag to pan, scroll to zoom, and turn the campus with ⟳ or R. Escape closes
  the building. Switch between Night and Day in the page's header.
- The URL takes `?theme=light`, `?open=<id>` and `?rot=<0–3>`, so a reviewer
  can link to one frame.

## Open questions

- Is the layout arbitrary, or does it mean something? The show places plots
  by when the task was started, oldest at the back. Grouping by repository
  into districts is the natural alternative.
- How does a campus hold 40 tasks? Taller buildings for bigger tasks, merged
  buildings fading into a back lot, or a cap with the rest in a list.
- Is the campus its own view, or a mode of the factory-floor view behind one
  switch?
