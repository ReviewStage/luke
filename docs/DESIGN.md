# Design: how the window moves and reads

This is the contract every animated element in Luke's window obeys, and the
bar every word drawn in it has to clear. The "Panel motion" section of
`apps/desktop/src/renderer/AGENTS.md` says what the Electron window under it
is; this file says how anything drawn in it is allowed to move, how much it is
allowed to say, and which of the machine's keys Luke may take. A change that
adds or alters motion or copy is reviewed against these rules, and the fastest
way to pass that review is to build from them.

## The vocabulary

One spring drives everything that needs to travel: `--spring`, and
`--spring-fast` (the same damping ratio at a higher frequency) for small
elements like switch thumbs. Settings pages change at once; task navigation
does not travel. The window's panes are the one exception to the spring: the
sidebar and the side panel open, close, and fill the window on `--motion-pane`
over `--duration-pane`, a plain ease-out, because a pane stands on the
window's own edge and a spring's overshoot would part the two for a frame.
Durations and delays come only from the tokens in
`packages/brand/src/generated/motion-tokens.css` (`--duration-shape`,
`--duration-exit`, `--duration-quick`, `--duration-fast`, `--duration-hover`,
`--duration-pane`, `--motion-exit`, `--motion-pane`, `--row-stagger`,
`--hint-delay`). Never write a literal millisecond into a rule: reduced motion
and capture runs zero the tokens, and a literal is a motion those runs cannot
stop. The one sanctioned exception is an endless loop (a spinner, a breathing
idle, the face's own motions) whose `animation-play-state` answers
`--loop-motion` or `--face-motion`: those runs stop it by pausing rather than
by zeroing, so its duration may be a literal, and a loop that carries one must
answer a play-state token. A finite companion timed to a generated face
gesture may also use the gesture's literal phase, but it must answer
`--face-motion`, live beside a comment naming the generated cycle and phase it
follows, and do no work when that gesture is not selected. A TypeScript
constant that mirrors a CSS timing (`WARM_MS` in `tooltip.tsx`) names the
`MOTION_DURATION_MS` or `MOTION_DELAY_MS` tokens it mirrors.

## Layout lands at once; motion is transform and opacity

Nothing that holds text animates its width, height, padding, or font-size:
that re-shapes the text on every frame, and that is what makes motion
stutter. Everything moves with `transform`, `opacity`, and, for reveals,
`clip-path`. A scrolling viewport may animate a `mask-image` edge to disclose
overflow, because the mask neither changes layout nor moves content; nothing
else gets a size-animation exception.

The window's panes keep the same rule. A pane opening, closing, or filling the
window lands in the layout at once, and what it displaced replays the journey
on `transform` and `clip-path` (`pane-motion.tsx`); a drag between a pane's
bounds changes its width alone and plays nothing, so the edge stays under the
pointer. Whatever else a change of room displaces replays its journey the same
way, FLIP-style, from where it was to where it now is.

No motion is the browser's rather than a transition of ours: nothing borrows a
native motion in place of the spring, so no renderer style sets
`scroll-snap-type`.

Content arriving rides the pair every arriving element rides — opacity over
`--duration-quick`, any travel on `--spring` — and content leaving goes first,
over `--duration-exit`. An element that unmounts is held mounted through its
own exit and taken out when the exit finishes, never on the frame the state
changed.

## Mount animations, not `@starting-style`, for reveals

An element that animates on mount cannot transition from a style it never
held. `@starting-style` exists for this, but the engine quietly skips some
properties transitioned from it (`clip-path` among them) while running
others from the same block, which ships a half-applied choreography. Use a CSS
**animation** with `backwards` fill instead: an animation on a freshly matched
selector starts without fail, and the `from` keyframe holds the covered pose
through the delay. Keyframes may read `var()` custom properties, which is how
a component tells the stylesheet a measured distance.

## Every layer of one gesture shares a beat

A gesture that moves several elements gives each the same duration and
spring and staggers only the delay, so the whole reads as one object. Stagger
a list that arrives together by `--row-stagger` per step.

## Proving it

A motion change is verified, not eyeballed: drive the real app and sample the
moving edges over time (the repo's evidence and verify scripts on macOS; a
headless run with CDP sampling anywhere). The claim to check is always the
same: nothing that holds text changes size mid-motion, and each move runs as
one transition. Chromium serializes `inset()` with collapsed components;
parse computed clip-paths accordingly before trusting a sample.

Repository checks hold one part of this contract: the generated brand art and
motion tokens must match their generators in `@luke/brand`. The rest is held by review:
renderer CSS may not reintroduce `@starting-style`, and no rule may transition
a layout property. A new exception belongs in this contract in the same change.

## Readability and access

Semantic colors are named once in `base.css`, and the window's grounds in
`desktop.css`; component sheets consume the token rather than inventing another
error red, overlay black, or text gray. Every colour token is restated for the
light appearance in its file's `@media (prefers-color-scheme: light)` `:root`
block, which Luke's theme drives through Electron's `nativeTheme.themeSource`,
so a change of appearance is the stylesheet's alone: nothing re-renders, and
the whiteboard takes it as a new theme for the canvas already mounted.
No colour literal belongs anywhere but a `:root`
block; a mask's black is an alpha rather than a colour, so a mask may spell it.
Text that communicates a label, status, count, or instruction must meet WCAG
AA contrast at its rendered size. Decorative marks and disabled controls may
sit below that threshold only when their meaning is available elsewhere.

Every pointer action has a keyboard path and an accessible name. Tab lists use
one tab stop and Left/Right/Home/End navigation. A control that floats over a
thumbnail keeps at least a 24px target even when its glyph is smaller, and
errors that appear after an action are live alerts. Reduced motion and capture
runs must still leave every state legible and reachable.

Compact geometry uses local optical spacing where one-off alignment demands
it. Repeated structural widths, heights, gaps, radii, colors, and motion belong
to semantic or generated tokens; a repeated literal is evidence that the
vocabulary is missing a name.

Spacing in the desktop window comes from one scale, `--space-2` through
`--space-48` in `desktop.css`'s `:root`, and the names built from it. Every
column holds its rows `--column-inset` from its edges, every row holds its
glyph or words `--row-inset` from its own, so a column's words start at
`--content-inset` whether a row carries them or not: the sidebar's text, the
plan's tab, the side panel's first tab, the transcript, and Settings' page list
all read down that one edge. Controls in a row stand `--control-gap` apart, a
glyph `--glyph-gap` from its words, a column's groups `--section-gap`, and a
page's content `--page-inset` from its column. No pixel of padding, margin, or gap in
`desktop.css`, `sign-in.css`, and `tooltip.css` is anything but one of these; the optical exception above is marked
`/* off-scale */` on its declaration, so a reader sees it is deliberate.

The window has two buttons, both in `desktop.css`. A glyph alone is an
`.icon-button`: a `--control-height` square with a `--control-glyph` glyph in
`--text-secondary`, nothing behind it at rest, the `--selected` fill and
`--text-primary` under the pointer, `--pressed` held down, and the
`--focus-ring` for the keyboard. A glyph and words, or words alone, is a
`.toolbar-button` of the same height, corner, glyph, and states, its glyph
`--glyph-gap` from its words; `.primary-button` and `.danger-button` are that
button filled with the accent or with red. Every glyph is drawn in a 24 box at
the one stroke `glyphs.tsx` draws with, so the button sizes the glyph and
never the glyph its button. A button floating over something that moves
beneath it, the title bar over a sliding pane or the transcript's way back to
its newest line, sets `--button-ground` and fills over that rather than over
what passes. What is not one of these is a row, a tab, or a call control and
says why where it is drawn: the call bar's round mutes, its solid End call
disc, and its start pill, the new-plan composer's round start, and a tab's ×,
which brightens without a fill.

The keyboard's ring is one rule in `base.css`. Every button, link, tab,
switch, option, and menu item, and anything else in the tab order, draws
`--focus-ring` at `--focus-ring-width`, `--focus-ring-offset` off its edge, and
only once the keyboard has moved focus (`keyboard-modality.ts`), so a press
never rings a control. A control whose drawn shape is a part of it, a picture
tile's picture over its caption, marks that part `data-focus-ring`, which
rings in the control's place, so the ring takes the shape that is seen. A box that clips
what it holds keeps the ring whole one of two ways: one that clips only to hold
in what runs long, a reply or a path, clips past the ring (`overflow: clip`,
`overflow-clip-margin: var(--focus-ring-room)`, which names its box because
Chromium drops a bare `calc()` there), and a card whose clip is its own edge
sets `--focus-ring-offset` to `--focus-ring-inset` for what it holds, so the
ring is drawn inside, on a header rounded as the card is. Every
control scrolls in with `--focus-ring-reach` to spare (`scroll-margin`), and a
scroller that fades an edge scroll-pads by the fade, so the keyboard never
leaves a row sliced at a scroller's edge or under its fade. A
scroller whose rows run edge to edge pads by `--focus-ring-reach` and gives it
back as a negative margin, so a row's ring is never cut off at its sides, and a
row holding the keyboard stands over its neighbours, so the next row's fill
leaves its ring whole. A row that runs the scroller's width by design, a line of
code or Pierre's tree, draws the ring inside it instead. A
field holding the caret wears the same ring centred on its edge however the
caret arrived, and a field set borderless in a well, a search's or the
composer's, rings the well (`.field-well`). A rule that takes the ring away
marks it `/* no ring: … */` with what shows focus instead; menus mark a row
with its fill. An unmarked one is a bug, and so is a ring drawn off the tokens.

Every menu and popover is one surface, from the menu tokens in `desktop.css`'s
`:root`: the `--surface-popover` ground in a `--hairline-strong` edge, the
`--menu-radius` corner and `--menu-shadow` under it, its items `--menu-inset`
from its edge, each row `--menu-row-height` tall with a `--menu-row-radius`
highlight and a `--menu-glyph` glyph. The corner is the row's corner plus the
inset, so a highlighted row follows the menu's curve. A plan's menu, a picker,
a submenu, a crumb's tree, the find bar, a tooltip card, and the context
popover all draw it, and none of them may
spend its own corner, shadow, ground, or row. The command palette is a
dialog rather than a menu, so it keeps a dialog's 14px corner and deeper
shadow, as the confirm dialog does; its rows are a menu's. The summary card
is a panel of the summary's own rows rather than a menu, so it keeps the 12px
corner those rows' `--control-radius` sits concentric in.

## The keys Luke takes from the machine

A key Luke registers takes its chord away from every other app on the Mac, so
which chord is a product decision and is argued about here rather than in
`voice-hotkey.ts`.

- **Option-Space talks.** It is where a macOS user already reaches for a voice
  assistant: Superwhisper, the ChatGPT desktop app, and Alfred all sit there.
- **Option-S stops.** S is for stop, and Option-letter is the family the talk
  key lives in. It is a sibling of Escape rather than of the talk key: it
  asks for quiet and nothing in its place, where speaking over a reply with
  the talk key held interrupts Luke and carries the conversation on.
- **There is no ask key.** Luke is voice only: there is no field to type to
  him in, so no chord summons one. Option-L, which once did, is given back to
  the machine.

The two may not be able to land on one chord. `hotkeyCandidates` is where
that is enforced, and says why.

## Copy: delete what describes, keep what instructs

A line of text earns its place on the surface only by saying something its
control cannot. This is the "Code comments" rule of AGENTS.md pointed at the
screen: never narrate. A subtitle restating the toggle above it repeats what
the reader can already see, and costs them the reading every time the page
opens rather than once.

Three categories, and only the first is ever cut:

- **Describes.** Restates the control, reassures, or explains the app to
  itself. "Their volume dips while you and Luke are talking, and returns
  after." under a switch reading *Quiet Music and Spotify*. Delete it. If the
  line seems necessary, the label is what to fix.
- **Instructs.** Tells the developer something they cannot act without.
  "Talking uses the GPT Live API, which needs billing enabled." Nobody can
  guess that. Keep it.
- **Reports state.** This is the row's content. "Version 0.2.0 is available to
  download." Keep it.

Prose describing the app's own layout rots, because it duplicates a fact that
lives somewhere else. A note once told the developer that voice's two ways in
"live under Account and usage", a section now named Provider everywhere
but that sentence. A label cannot go stale that way; only a
paragraph about another part of the surface can. When a second place has to
name a section, that is a reason to cut the sentence, not to maintain it.

What follows from this everywhere else:

- Sentence case on every button and label. *Check for updates*, never *Check
  for Updates*.
- One wording per idea across the whole product. A confirmation, a sign-in
  failure, or a bound refused must not be phrased three ways in three files.
- A bound the developer hit is stated plainly: "That message is empty or too
  long." A poetic restatement of the same bound tells them nothing they can
  act on.
- Consent copy names the data categories, destination, account association,
  default state, and where the control lives. It never substitutes a generic
  reassurance for those facts.
- No marketing register on the surface. Luke is not selling to someone who has
  already installed him.

Copy that reaches a model rather than the screen (the brain's planning
instructions, the live session's instructions) obeys a different rule. Verbosity
there is not slop, but a fact dropped from them is one Luke no longer has, so
compress the prose and never drop the fact. One rule per line beats three
fused with em-dashes: the instruction to be brief has to be readable itself.
