import { PICTURE_STATE, type PictureState } from "@luke/ui/picture-cache";
import { ImageOffIcon } from "lucide-react";
import { Spinner } from "./spinner.js";

/**
 * picture-block.tsx -- a picture drawn in written words: its own block, at its own size up to the column's, its caption under it, a press opening it over the window.
 *
 * While its bytes are read it is a quiet box on the section's fill with the
 * window's spinner; a picture this reader cannot reach, or whose bytes are
 * gone, is its alt text and says it is not available. The block is left out
 * of the screen recording (`ph-no-capture`), because a picture can hold
 * words and the recording carries none (`session-replay.ts`), and because a
 * `data:` address is megabytes of attribute a recording has no use for even
 * masked. Nothing here knows whose picture it is; the place drawing one
 * hands its state and what a press does.
 */

/** What a picture's press is named for a reader, its alt text after it. */
const ENLARGE_LABEL = "Enlarge";

/** What a picture that is not there says, after its alt text where it has any. */
const MISSING_WORDS = "not available";

/** What the spinner says to a reader while the bytes are read. */
const READING_LABEL = "Reading the picture";

/** The picture's own block, by where its read stands. */
export function PictureBlock({
  state,
  alt,
  caption,
  onOpen,
}: {
  state: PictureState;
  /** The picture's description, as its Markdown's alt text gives it; empty where it gives none. */
  alt: string;
  /** The words drawn under it, as its Markdown's title gives them; none where it gives none. */
  caption: string | undefined;
  /** Opens the picture over the window; without one, the picture is drawn with no press to it. */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const said =
    caption === undefined || caption === "" ? null : (
      <span className="picture-caption">{caption}</span>
    );
  // A picture with nothing to open on a press is drawn as itself, no button.
  if (state.kind === PICTURE_STATE.READY && onOpen === undefined) {
    return (
      <span className="picture-block ph-no-capture" data-state={state.kind}>
        <span className="picture-frame">
          <img
            className="picture-image"
            src={state.url}
            alt={alt}
            decoding="async"
            draggable={false}
          />
        </span>
        {said}
      </span>
    );
  }
  if (state.kind === PICTURE_STATE.READY) {
    const open = onOpen;
    return (
      <span className="picture-block ph-no-capture" data-state={state.kind}>
        <button
          type="button"
          className="picture-frame"
          aria-label={alt === "" ? ENLARGE_LABEL : `${ENLARGE_LABEL} ${alt}`}
          onClick={(event) => {
            // Note that the press stops here, because a click into a section opens its editor.
            event.stopPropagation();
            open?.();
          }}
        >
          <img
            className="picture-image"
            src={state.url}
            alt={alt}
            decoding="async"
            draggable={false}
          />
        </button>
        {said}
      </span>
    );
  }
  if (state.kind === PICTURE_STATE.READING) {
    return (
      <span className="picture-block ph-no-capture" data-state={state.kind}>
        <span className="picture-frame picture-pending">
          <Spinner label={READING_LABEL} />
        </span>
        {said}
      </span>
    );
  }
  return (
    <span className="picture-block ph-no-capture" data-state={state.kind}>
      <span className="picture-frame picture-missing" role="img" aria-label={alt}>
        <ImageOffIcon aria-hidden="true" />
        <span>{alt === "" ? `This picture is ${MISSING_WORDS}` : `${alt} · ${MISSING_WORDS}`}</span>
      </span>
      {said}
    </span>
  );
}
