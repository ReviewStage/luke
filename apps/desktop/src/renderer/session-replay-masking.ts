/**
 * What a screen recording is allowed to see.
 *
 * Split from `session-replay.ts` so it can be read and tested without loading
 * the recorder itself: this is the part that carries the promise, and a
 * promise nothing can assert is one that drifts.
 */

/**
 * The class a region wears to be replaced entirely. Nothing of it is
 * recorded: not its contents, not its shape, not the length of what it holds.
 *
 * It is the only masking class there is. Text is already masked everywhere by
 * the posture below, so there is no "mask this too" to ask for — a component
 * marks itself only when being drawn as blocks of the right length is still
 * more than it should say, which is true of credentials and of nothing else.
 */
export const REPLAY_BLOCK_CLASS = "ph-block";

/**
 * The attributes that can carry a session's own words, and so are masked
 * alongside the text. Text masking does not reach an attribute: a row whose
 * words are blocks still names its session in the `aria-label` that makes it
 * readable, and a truncated title still says itself in full in `title`.
 *
 * Named one by one rather than through `maskAllElementAttributes`, which also
 * takes `class`, `style`, `id`, `src`, and `href` — and a recording with no
 * classes is not a masked recording of the panel but an unreadable one.
 */
const MASKED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-valuetext",
  "alt",
  "placeholder",
  "title",
  "value",
]);

/** Where an element's pixels come from, which may be the bytes themselves. */
const SOURCE_ATTRIBUTES: ReadonlySet<string> = new Set(["src", "srcset", "href", "poster"]);

/**
 * What the recorder is allowed to see, and the whole of what keeps a recording
 * offerable. Everything else in this file only decides whether to start.
 *
 * The posture is an allowlist rather than a blocklist: text is masked
 * everywhere, and nothing opts out. A blocklist would read better — button
 * labels and headings would survive — but it makes silence something each
 * component has to remember, and almost every component here draws what a
 * provider wrote. The next row somebody adds would leak until it was noticed,
 * and "noticed" is not a privacy guarantee. Masked by default, a new component
 * is silent for free.
 *
 * What survives is the shape of the surface and what was done to it: which
 * rows exist, which was pressed, which page opened, how long someone sat
 * before doing it. That is what replay was wanted for.
 *
 * `posthog-js` at this version has no unmask selector — `maskTextSelector` is
 * the only lever and `"*"` is all of it — so this cannot drift into a
 * blocklist by half-measures. It is one edit or none.
 */
export const REPLAY_MASKING = {
  maskAllInputs: true,
  maskTextSelector: "*",
  maskAttributeFn: (name: string, value: string) => {
    const attribute = name.toLowerCase();
    if (MASKED_ATTRIBUTES.has(attribute)) return "";
    // An inline image is its own bytes rather than a reference to a file this
    // build ships, so it is content by construction: the feedback composer
    // draws a screenshot the developer attached this way, and a screenshot can
    // hold anything that was on their screen. The chips are blocked outright
    // too — this is the rule that holds when markup forgets, and the reason
    // `src` is otherwise left alone is that every other one names an asset.
    if (SOURCE_ATTRIBUTES.has(attribute) && value.trimStart().toLowerCase().startsWith("data:")) {
      return "";
    }
    return value;
  },
  // Blocked rather than masked: a masked credential still reports how many
  // characters it has, and the shape of a key is a fact about the key.
  blockSelector: `.${REPLAY_BLOCK_CLASS}`,
  // A canvas is pixels, which no text rule reaches. Luke draws his own face on
  // one, which is harmless — but a rule that has to be re-argued for the next
  // canvas is not one worth keeping, so none are recorded.
  captureCanvas: { recordCanvas: false },
} as const;
