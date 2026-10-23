import {
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  isVideoDataUrl,
  PictureTile,
  Spinner,
  VideoStill,
} from "@luke/ui";
import { PICTURE_STATE, type PictureState } from "@luke/ui/picture-cache";
import { ImageOffIcon } from "lucide-react";

/**
 * picture-block.tsx -- a picture drawn in written words: its own block, at its own size up to the column's, its caption under it, a press opening it over the window.
 *
 * While its bytes are read it is a quiet box on the section's fill with the
 * window's spinner; a picture this reader cannot reach, or whose bytes are
 * gone, is its alt text and says it is not available. The block is left out
 * of the screen recording (`ph-no-capture`), because a picture can hold
 * words and the recording carries none (`session-replay.ts`), and because a
 * `data:` address is megabytes of attribute a recording has no use for even
 * masked. A video an agent recorded is drawn the same way, as its still
 * (`@luke/ui`'s `VideoStill`), and the same press opens it, where the viewer
 * plays it. Nothing here knows whose picture it is; the place drawing one
 * hands its state and what a press does.
 */

/** What a picture that is not there says, after its alt text where it has any. */
const MISSING_WORDS = "not available";

/** What the spinner says to a reader while the bytes are read. */
const READING_LABEL = "Reading the picture";

/** The picture's own block, by where its read stands. */
export function PictureBlock({
  ref,
  state,
  alt,
  caption,
  onOpen,
}: {
  /** The block's own element, as the place drawing it may need to find it among others. */
  ref?: React.Ref<HTMLSpanElement> | undefined;
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
  const video = state.kind === PICTURE_STATE.READY && isVideoDataUrl(state.url);
  // A picture with nothing to open on a press is drawn as itself, no button.
  if (state.kind === PICTURE_STATE.READY && onOpen === undefined) {
    return (
      <span
        ref={ref}
        className="picture-block ph-no-capture"
        data-state={state.kind}
        data-video={video ? "" : undefined}
      >
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.FLUSH}
          className="picture-frame"
        >
          {video ? (
            <VideoStill dataUrl={state.url} label={alt} />
          ) : (
            <img
              className="picture-image"
              src={state.url}
              alt={alt}
              decoding="async"
              draggable={false}
            />
          )}
        </Card>
        {said}
      </span>
    );
  }
  if (state.kind === PICTURE_STATE.READY) {
    const open = onOpen;
    return (
      <span
        ref={ref}
        className="picture-block ph-no-capture"
        data-state={state.kind}
        data-video={video ? "" : undefined}
      >
        <PictureTile
          name={alt}
          onOpen={(event) => {
            // Note that the press stops here, because a click into a section opens its editor.
            event.stopPropagation();
            open?.();
          }}
        >
          <Card
            as={CARD_ELEMENT.SPAN}
            corner={CARD_CORNER.CONTROL}
            padding={CARD_PADDING.FLUSH}
            className="picture-frame"
          >
            {video ? (
              <VideoStill dataUrl={state.url} label={alt} />
            ) : (
              <img
                className="picture-image"
                src={state.url}
                alt={alt}
                decoding="async"
                draggable={false}
              />
            )}
          </Card>
        </PictureTile>
        {said}
      </span>
    );
  }
  if (state.kind === PICTURE_STATE.READING) {
    return (
      <span ref={ref} className="picture-block ph-no-capture" data-state={state.kind}>
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.FLUSH}
          className="picture-frame picture-pending"
        >
          <Spinner delay label={READING_LABEL} />
        </Card>
        {said}
      </span>
    );
  }
  return (
    <span ref={ref} className="picture-block ph-no-capture" data-state={state.kind}>
      <Card
        as={CARD_ELEMENT.SPAN}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.NONE}
        dashed
        role="img"
        aria-label={alt}
        className="picture-frame picture-missing"
      >
        <ImageOffIcon aria-hidden="true" />
        <span>{alt === "" ? `This picture is ${MISSING_WORDS}` : `${alt} · ${MISSING_WORDS}`}</span>
      </Card>
      {said}
    </span>
  );
}
