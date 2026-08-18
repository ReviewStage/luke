# Design: how motion works

This is the contract every animated element in the panel obeys. The "Panel
motion" section of AGENTS.md says what the window and the surface are; this
file says how anything drawn on them is allowed to move. A change that adds or
alters motion is reviewed against these rules, and the fastest way to pass
that review is to build from them.

## The vocabulary

One spring drives everything that needs to travel: `--spring` for the surface
and anything that travels with it, `--spring-fast` — the same damping ratio at
a higher frequency — for small elements like switch thumbs. Settings pages and
the tab selection indicator change at once; task navigation does not travel.
Durations and delays come only from the tokens in
`packages/sidecar-core/src/motion-tokens.css` (`--duration-shape`,
`--duration-exit`, `--duration-quick`, `--duration-fast`, `--expand-delay`,
`--peek-delay`, `--slot-delay`, `--row-stagger`). Never write a literal
millisecond into a rule: reduced motion and capture runs zero the tokens, and
a literal is a motion those runs cannot stop. The one sanctioned exception is
an endless loop — a spinner, a breathing idle, the face's own motions — whose
`animation-play-state` answers `--loop-motion` or `--face-motion`: those runs
stop it by pausing rather than by zeroing, so its duration may be a literal,
and a loop that carries one must answer a play-state token. A main-process
constant that mirrors a CSS total (`COLLAPSE_ANIMATION_MS`) names the
`MOTION_DURATION_MS` tokens it mirrors.

## The surface owns size; everything else owns transform and opacity

The black surface is a leaf element and the only thing whose width and height
animate. Everything layered on it moves with `transform`, `opacity`, and — for
reveals — `clip-path`. Animating width, height, padding, or font-size on an
element that holds text re-shapes that text on every frame, and that is what
makes motion stutter.

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
