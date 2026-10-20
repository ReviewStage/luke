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
`--spring-fast` (the same damping ratio at a higher frequency) for what is
small or arrives over the window: a switch's thumb, and a menu, tooltip,
dialog, palette, or toast rising into place. Settings pages change at once;
task navigation does not travel. The window's panes are the one exception to
the spring: the sidebar and the side panel open, close, and fill the window on
`--motion-pane` over `--duration-pane`, a plain ease-out, because a pane
stands on the window's own edge and a spring's overshoot would part the two
for a frame. Durations and delays come only from the tokens in
`packages/brand/src/generated/motion-tokens.css` (`--duration-shape`,
`--duration-exit`, `--duration-quick`, `--duration-fast`, `--duration-hover`,
`--duration-pane`, `--motion-exit`, `--motion-pane`, `--row-stagger`,
`--hint-delay`, `--late-delay`). Never write a literal millisecond into a
rule: reduced motion and capture runs zero the tokens, and a literal is a
motion those runs cannot stop. The one sanctioned exception is an endless loop
(a spinner, a breathing idle, the face's own motions) whose
`animation-play-state` answers `--loop-motion` or `--luke-face-motion`: those runs
stop it by pausing rather than by zeroing, so its duration may be a literal,
and a loop that carries one must answer a play-state token. A finite companion
timed to a generated face gesture may also use the gesture's literal phase,
but it must answer `--luke-face-motion`, live beside a comment naming the generated
cycle and phase it follows, and do no work when that gesture is not selected.
A TypeScript constant that mirrors a CSS timing (`WARM_MS` in `tooltip.tsx`)
names the `MOTION_DURATION_MS` or `MOTION_DELAY_MS` tokens it mirrors.

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
moving edges over time in a headless run with CDP sampling.
`scripts/evidence.sh` cannot stand in for that: it captures still frames of
the fixture with every duration zeroed, so it shows where a motion lands,
never the motion. The claim to check is always the same: nothing that holds
text changes size mid-motion, and each move runs as
one transition. Chromium serializes `inset()` with collapsed components;
parse computed clip-paths accordingly before trusting a sample.

Repository checks hold one part of this contract: the generated brand art and
motion tokens must match their generators in `@luke/brand`. The rest is held by review:
renderer CSS may not reintroduce `@starting-style`, and no rule may transition
a layout property. A new exception belongs in this contract in the same change.

## Shared tokens and components

The tokens a control is drawn with, and the controls more than one app draws,
are `@luke/ui`'s (`packages/ui/src/tokens/`, `packages/ui/src/components/`),
so the window and the site draw one control at two densities rather than two
controls. A root, and every overlay it portals into the body, carries two
attributes (`surfaceAttributes` in `surface.ts`): `data-luke-profile`,
`desktop` or `web`, which picks the density, and `data-luke-theme`, `dark`,
`light`, or, on the desktop alone, `system`, which picks the palette. Both
roots follow the Theme setting: the desktop's stays `system` while Electron
steers the Mac's appearance to the setting, and the web's wears the setting
resolved, following the machine under System (`apps/web/src/app/web-appearance.tsx`).
A sheet picks a colour of its own by `light-dark()`, which the theme decides
through `color-scheme`, never by `prefers-color-scheme`, and script asks
`@luke/ui/appearance`.

The tokens come in three layers. The base scale (`scale.css`) names a value
by what it is, so `--luke-space-16` is sixteen pixels in either app. A role
(`profiles.css`) names what a value is for, a control's height, a field's gap,
a dialog's corner, a type role's size and leading, and each profile sets every
role its own way. A palette (`palettes.css`) names each colour by its role,
for each profile in each theme. A component reads roles and the palette, never
a base value at its call site, so it moves with its profile. Both profiles set
the same roles and every palette the same names; `tokens.test.ts` holds them
to it. Both apps read the roles alone; neither keeps a name of its own for one.

A shared component takes its data and callbacks as props and no class or
style: it owns its insides, and the room around it is its container's. Its
rules sit in the `components` cascade layer (`styles.css`), above an app's
element resets and below its utilities. A choice a caller makes is a named
role rather than a length or a level: a Stack's gap is the field gap, not
sixteen pixels; Text's type role is chosen apart from its element, so no
heading level is picked for its size; a Button's look says what a press does
(`quiet`, `outline`, `primary`, `danger`, `danger-outline`) rather than where
it stands. Every component is in `packages/ui/src/components/`, and the
catalog (`apps/catalog`) draws each at both profiles in both themes on
synthetic data, which is where a new one is first seen.

## Readability and access

Semantic colours are named once, in `@luke/ui`'s palette, and the window's own
(whose voice is live, the code's and the terminal's inks, a file icon's, the
sidebar's and a well's grounds) in `base.css` and `desktop.css`; component
sheets consume the token rather than inventing another error red, overlay
black, or text gray. The desktop's palette writes each colour once as a
`light-dark()` pair, and the root's `system` theme follows the Mac's
appearance, which Luke's Theme setting drives through Electron's
`nativeTheme.themeSource`. Every colour of the window's own that differs in
the light is restated in its file's `@media (prefers-color-scheme: light)`
`:root` block. Either way a change of appearance is the stylesheet's alone:
nothing re-renders, and the whiteboard takes it as a new theme for the canvas
already mounted. No colour literal belongs anywhere but a token block, a
`:root` or a palette's profile; a mask's black is an alpha rather than a
colour, so a mask may spell it.
Text that communicates a label, status, count, or instruction must meet WCAG
AA contrast at its rendered size. Decorative marks and disabled controls may
sit below that threshold only when their meaning is available elsewhere.

Words the window draws are selectable, so any of them can be copied; a
control's words are not, since a control is pressed rather than read
(`base.css`). A rule that takes selection away from words says why.

Every pointer action has a keyboard path and an accessible name. Tab lists use
one tab stop and Left/Right/Home/End navigation. A control that floats over a
thumbnail keeps at least a 24px target even when its glyph is smaller; on a
coarse pointer every button takes a press at least `--luke-touch-target` (44px)
across around what it draws, its glyph unmoved, but a close beside the words it
closes (a tab's ×, a toast's) grows up and down alone, so a near miss on the
label closes nothing, and a resize edge takes one across both columns' gutters,
no further, so it never stands over a row; and
errors that appear after an action are live alerts. Reduced motion and capture
runs must still leave every state legible and reachable.

Compact geometry uses local optical spacing where one-off alignment demands
it. Repeated structural widths, heights, gaps, radii, colors, and motion belong
to semantic or generated tokens; a repeated literal is evidence that the
vocabulary is missing a name.

Spacing in the desktop window comes from one scale, `@luke/ui`'s, read in the
window's stylesheets as `--luke-space-2` through `--luke-space-48`, and the
names built from it in `shell.css`'s and `desktop.css`'s `:root`. Every column holds its
rows `--column-inset` from its edges, every row holds its glyph or words
`--row-inset` from its own, so a column's words start at `--content-inset`
whether a row carries them or not: the sidebar's text, the task's tab, the
side panel's first tab, the transcript, and Settings' page list all read down
that one edge. Controls in a row stand `--luke-control-gap` apart, a glyph
`--luke-icon-gap` from its words, a column's groups `--luke-section-gap`, and a page's
content `--luke-page-inset` from its column, each the desktop profile's role.
No pixel of padding, margin, or gap in `shell.css`, `desktop.css`,
`sign-in.css`, and `tooltip.css` is anything but one of these; the optical
exception above is marked `/* off-scale */` on its declaration, so a reader
sees it is deliberate.

The window draws two buttons of its own, both in `desktop.css`, and no screen
of it mounts `@luke/ui`'s Button and IconButton yet. A glyph alone is an
`.icon-button`: a `--luke-control-height` square with a `--luke-control-icon` glyph in
`--luke-color-text-muted`, nothing behind it at rest, the `--luke-color-fill-selected` fill and
`--luke-color-text` under the pointer, `--luke-color-fill-pressed` held down, and the
`--luke-color-focus-ring` for the keyboard. A glyph and words, or words alone, is a
`.toolbar-button` of the same height, corner, glyph, and states, its glyph
`--luke-icon-gap` from its words; `.primary-button` and `.danger-button` are that
button filled with the accent or with red. Every glyph is drawn in a 24 box at
the one stroke `glyphs.tsx` draws with, so the button sizes the glyph and
never the glyph its button. A button floating over something that moves
beneath it, the title bar over a sliding pane or the transcript's way back to
its newest line, sets `--button-ground` and fills over that rather than over
what passes. What is not one of these is a row, a tab, or a round control and
says why where it is drawn: the call bar's round mutes, its solid End call
disc, and its start pill, Chat's round send, and a tab's ×, which brightens
without a fill. A chip, which names a value or a thing rather than an act, is
`@luke/ui`'s Chip.

The keyboard's ring is one rule in `base.css`. Every button, link, tab,
switch, option, and menu item, and anything else in the tab order, draws
`--luke-color-focus-ring` at `--focus-ring-width`, `--focus-ring-offset` off its edge, and
only once the keyboard has moved focus (`keyboard-modality.ts`), so a press
never rings a control. A control whose drawn shape is a part of it, a picture
tile's picture over its caption, marks that part `data-focus-ring`, which
rings in the control's place, so the ring takes the shape that is seen. An
unavailable button that keeps the keyboard (`aria-disabled`) fades its fill
and words rather than itself, so its ring stays at full strength. A box that clips
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

Every menu and popover is one surface, from the menu tokens: the desktop
profile's menu roles, and `--menu-glyph` and `--menu-shadow` in
`desktop.css`'s `:root`. It is the `--luke-color-overlay` ground in a
`--luke-color-border-strong` edge, the `--luke-menu-radius` corner and `--menu-shadow` under
it, its items `--luke-menu-inset` from its edge, each row `--luke-menu-row-height` tall
with a `--luke-menu-row-radius` highlight and a `--menu-glyph` glyph. The corner is
the row's corner plus the inset, so a highlighted row follows the menu's
curve; the profile works the corner out from the other two. A task's menu, a
picker, a submenu, a crumb's tree, the find bar, and a tooltip card all draw
it, and none of them may spend its own corner, shadow, ground, or row. The
command palette is a dialog rather than a menu, so it keeps a dialog's corner
(`--luke-dialog-radius`) and deeper shadow, as the confirm dialog does; its
rows are a menu's. The summary card is a panel of the summary's own rows
rather than a menu, so it keeps the 12px corner those rows' `--luke-control-radius`
sits concentric in. The agent's context popover is a panel too, a bar and its
legend rather than rows: it draws the menu's ground, edge, corner, and shadow,
and pads what it holds with steps of the scale rather than a menu's inset.

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
control cannot. This is "Trivial comments are the enemy" (`docs/STYLE.md`)
pointed at the screen: never narrate. A subtitle restating the toggle above
it repeats what the reader can already see, and costs them the reading every
time the page opens rather than once.

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
"live under Account and usage", long after that section had been renamed
everywhere but that sentence. A label cannot go stale that way; only a
paragraph about another part of the surface can. When a second place has to
name a section, that is a reason to cut the sentence, not to maintain it.

What follows from this everywhere else:

- Sentence case on every button and label. *Check for updates*, never *Check
  for Updates*. The Mac's menu bar is the one exception: it is the system's,
  and keeps the title case every Mac app's menus are set in.
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

Copy that reaches a model rather than the screen (the brain's own
instructions, the live session's instructions) obeys a different rule. Verbosity
there is not slop, but a fact dropped from them is one Luke no longer has, so
compress the prose and never drop the fact. One rule per line beats three
fused with em-dashes: the instruction to be brief has to be readable itself.
