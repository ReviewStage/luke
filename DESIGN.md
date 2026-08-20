# Design: how the surface moves and reads

This is the contract every animated element in the panel obeys, and the bar
every word drawn on it has to clear. The "Panel motion" section of AGENTS.md
says what the window and the surface are; this file says how anything drawn on
them is allowed to move, and how much it is allowed to say. A change that adds
or alters motion or copy is reviewed against these rules, and the fastest way
to pass that review is to build from them.

## The vocabulary

One spring drives everything that needs to travel: `--spring` for the surface
and anything that travels with it, `--spring-fast` — the same damping ratio at
a higher frequency — for small elements like switch thumbs. Settings pages and
the tab selection indicator change at once; task navigation does not travel.
Durations and delays come only from the tokens in
`packages/sidecar-core/src/motion-tokens.css` (`--duration-shape`,
`--duration-exit`, `--duration-quick`, `--duration-fast`, `--duration-hover`,
`--motion-exit`, `--expand-delay`, `--peek-delay`, `--slot-delay`,
`--row-stagger`). Never write a literal
millisecond into a rule: reduced motion and capture runs zero the tokens, and
a literal is a motion those runs cannot stop. The one sanctioned exception is
an endless loop — a spinner, a breathing idle, the face's own motions — whose
`animation-play-state` answers `--loop-motion` or `--face-motion`: those runs
stop it by pausing rather than by zeroing, so its duration may be a literal,
and a loop that carries one must answer a play-state token. A finite companion
timed to a generated face gesture may also use the gesture's literal phase,
but it must answer `--face-motion`, live beside a comment naming the generated
cycle and phase it follows, and do no work when that gesture is not selected.
A main-process
constant that mirrors a CSS total (`COLLAPSE_ANIMATION_MS`) names the
`MOTION_DURATION_MS` tokens it mirrors.

## The surface owns size; everything else owns transform and opacity

The black surface is a leaf element and the only thing whose width and height
animate. Everything layered on it moves with `transform`, `opacity`, and — for
reveals — `clip-path`. Animating width, height, padding, or font-size on an
element that holds text re-shapes that text on every frame, and that is what
makes motion stutter.

The surface's fixed bounds are generated vocabulary too. Panel width and its
height ceiling come from `design/generate-surface-shared.mjs`; TypeScript and
CSS consume the emitted constants and custom properties rather than restating
pixels. Pseudo-elements that merely extend the opaque surface into its notch
flares count as part of that same leaf shape and may size with it. A scrolling
content viewport may animate a `mask-image` edge to disclose overflow, because
the mask neither changes layout nor moves content; no other layered content
gets a size-animation exception.

**Never make the surface chase.** The surface's size is measured off content
and animated by one transition. If content grows gradually — its own height
animating frame by frame — every frame re-measures, and the surface's
transition restarts toward a moving target: it lags hundreds of milliseconds
and the content is drawn on the desktop. Content changes must land in the
layout **at once**, so the surface takes one clean spring to a fixed
destination. The choreography below is how an instant layout change is made to
look gradual.

## Content joining a growing shape

Three rules, one per element involved:

1. **Its room lands at once.** The new element takes its final laid-out size
   and position on the frame it mounts. This is what keeps the surface to one
   spring.
2. **It becomes visible only over black.** The element arrives with the pair
   every arriving element rides — opacity over `--duration-quick`, any travel
   on `--spring` — delayed until the surface has grown under it. A large
   element cannot rely on a fade alone: reveal it with a `clip-path` that
   rides the **surface's own delay, duration, and spring**, so the shape's
   edge is what uncovers it (the caption and the feedback preview both do
   this). The element itself does not move; it is uncovered.
3. **Whatever its room displaced replays the journey.** Layout has already
   moved the elements below it; animate them FLIP-style from where they were
   to where they now are, on the same spring (`session-motion` does this for
   re-sorted rows; `.feedback-follow` does it for the composer's send row).

Ordering comes from delay, and direction decides it: against a **growing**
edge, trail it (`--slot-delay`-class delays keep a traveling element behind
the surface, over black); against a **shrinking** edge, lead it
(`--duration-exit`-class delays keep it above the edge on the way up). When in
doubt, sample both edges over time — an element whose visible edge ever passes
the surface's is wrong, whatever it looks like at speed.

## Content leaving a shrinking shape

Content leaves first, over `--duration-exit`, and only its end releases the
room: the surface must never shrink out from under something still drawn. For
elements that unmount, hold them mounted through their own exit (the key slot
and the feedback preview both keep drawing what they last held) and take them
out when the exit finishes — never on the frame the state changed.

## Mount animations, not `@starting-style`, for reveals

An element that animates on mount cannot transition from a style it never
held. `@starting-style` exists for this, but the engine quietly skips some
properties transitioned from it — `clip-path` among them — while running
others from the same block, which ships a half-applied choreography. Use a CSS
**animation** with `backwards` fill instead: an animation on a freshly matched
selector starts without fail, and the `from` keyframe holds the covered pose
through the delay. Keyframes may read `var()` custom properties, which is how
a component tells the stylesheet a measured distance (`--preview-room`).

## Every layer of one gesture shares a beat

A gesture that moves several elements (surface, reveal, displaced rows) gives
each the same duration and spring and staggers only the delay, so the whole
reads as one object. Stagger with the row idiom (`--row-index` clamped by
`--row-fan-limit`, `--row-stagger` per step) when a stack arrives; stagger
with a single named delay (`--slot-delay`) when one thing follows the shape.

## Proving it

A motion change is verified, not eyeballed: drive the real app and sample the
moving edges over time (the repo's evidence and verify scripts on macOS; a
headless run with CDP sampling anywhere). The claim to check is always the
same — content never crosses the shape, and the surface runs each move as one
transition. Chromium serializes `inset()` with collapsed components; parse
computed clip-paths accordingly before trusting a sample.

Repository checks keep this contract executable: `DESIGN.md` is required,
generated geometry must be current, and renderer CSS may not reintroduce
`@starting-style`. A new exception belongs in this contract and its check in
the same change.

## Readability and access

Semantic colors are named once in `base.css`; component sheets consume the
token rather than inventing another error red, overlay black, or text gray.
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

## Copy: delete what describes, keep what instructs

A line of text earns its place on the surface only by saying something its
control cannot. This is the "Code comments" rule of AGENTS.md pointed at the
screen: never narrate. A subtitle restating the toggle above it repeats what
the reader can already see, and costs them the reading every time the page
opens rather than once.

Three categories, and only the first is ever cut:

- **Describes** — restates the control, reassures, or explains the app to
  itself. "Their volume dips while you and Luke are talking, and returns
  after." under a switch reading *Quiet Music and Spotify*. Delete it. If the
  line seems necessary, the label is what to fix.
- **Instructs** — tells the developer something they cannot act without.
  "Create a key in Jules under Settings · API key. It is shown only once."
  Nobody can guess that. Keep it.
- **Reports state** — is the row's content. "Version 0.2.0 is available to
  download." Keep it.

Prose describing the app's own layout rots, because it duplicates a fact that
lives somewhere else. A note once told the developer that voice's two ways in
"live under Account and usage", a section renamed to What Luke runs on
everywhere but that sentence. A label cannot go stale that way; only a
paragraph about another part of the surface can. When a second place has to
name a section, that is a reason to cut the sentence, not to maintain it.

What follows from this everywhere else:

- Sentence case on every button and label. *Check for updates*, never *Check
  for Updates*.
- One wording per idea across the whole product. A confirmation, a sign-in
  failure, or a bound refused must not be phrased three ways in three files.
- A bound the developer hit is stated plainly — "That message is empty or too
  long." A poetic restatement of the same bound tells them nothing they can
  act on.
- Consent copy names the data categories, destination, account association,
  default state, and where the control lives. It never substitutes a generic
  reassurance for those facts.
- No marketing register on the surface. Luke is not selling to someone who has
  already installed him.
- The urgency labels in `session-display.ts` are generated by
  `design/generate-surface-shared.mjs` and may not be hand-edited. Change the
  table in the script, re-run it, and commit what it writes;
  `repository-checks.sh` runs it with `--check`.

Copy that reaches a model rather than the screen — `luke-guide.ts`, the
realtime instructions — obeys a different rule. Verbosity there is not slop,
but a capability the guide does not describe is one Luke will deny having, so
compress the prose and never drop the fact. One rule per line beats three
fused with em-dashes: the instruction to be brief has to be readable itself.
