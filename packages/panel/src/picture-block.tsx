import {
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  isVideoDataUrl,
  PictureStandIn,
  PictureTile,
  VideoPlayer,
} from "@luke/ui";
import { PICTURE_STATE, type PictureState } from "@luke/ui/picture-cache";

/**
 * picture-block.tsx -- a picture drawn in written words: its own block, at its own size up to the column's, its caption under it, a press opening it over the window.
 *
 * While its bytes are read it is a quiet box on the section's fill with the
 * window's spinner; a picture this reader cannot reach, or whose bytes are
 * gone, is its alt text and says it is not available, as a tile of a set
 * says it (`@luke/ui`'s `PictureStandIn`); one whose read did not land this
 * time says it could not be read, with Retry, in the same box. A gone picture
 * is plain words, never a `role="img"` named by its alt, which would hide the
 * "not available" beside it and leave an empty alt with no name at all. The block is left out
 * of the screen recording (`ph-no-capture`), because a picture can hold
 * words and the recording carries none (`session-replay.ts`), and because a
 * `data:` address is megabytes of attribute a recording has no use for even
 * masked. A video an agent recorded plays in its place instead
 * (`@luke/ui`'s `VideoPlayer`), with the player's own controls, Full screen
 * among them, since a press on a video plays it; what a press on a picture
 * opens is its Expand. Nothing here knows whose picture it is; the place
 * drawing one hands its state and what a press does.
 */

/**
 * A picture in written words: its own block, at its own width up to the
 * column's, standing apart from the words around it. A place that stands it
 * otherwise, in a row or under a version's mark, says so in its own sheet.
 */
export const PICTURE_BLOCK_CLASS =
  "picture-block ph-no-capture my-block-gap block w-fit max-w-full";

/** The frame, `@luke/ui`'s Card, hugging the picture. */
export const PICTURE_FRAME_CLASS = "picture-frame w-fit max-w-full";

/** The picture, no taller than a screenful's worth, at its own shape. */
export const PICTURE_IMAGE_CLASS =
  "picture-image block h-auto max-h-picture-most max-w-full object-contain";

/** While the bytes are read: a quiet box of a screenshot's shape. */
export const PICTURE_PENDING_CLASS =
  "picture-pending grid aspect-screenshot w-picture-stand-in max-w-full cursor-default place-items-center";

/** A picture from outside Luke, a link to it never fetched, marked by a glyph a step under its words' size. */
export const OUTSIDE_GLYPH_CLASS = "mr-[0.25em] size-picture-glyph align-[-0.12em]";

/** A picture this reader cannot reach, or whose bytes are gone: its words, at a stand-in's width. */
const PICTURE_MISSING_CLASS =
  "picture-frame picture-missing w-picture-stand-in max-w-full cursor-default p-card-snug";

/** Its caption under it in the secondary ink, which may run wider than a skinny picture, whose frame still hugs the picture. */
const PICTURE_CAPTION_CLASS =
  "picture-caption mt-item-gap block text-picture-caption text-muted-foreground";

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
      <span className={PICTURE_CAPTION_CLASS}>{caption}</span>
    );
  // A video plays where it stands, and what a press on a picture opens is its Expand.
  if (state.kind === PICTURE_STATE.READY && isVideoDataUrl(state.url)) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind} data-video="">
        <VideoPlayer dataUrl={state.url} label={alt} onExpand={onOpen} />
        {said}
      </span>
    );
  }
  // A picture with nothing to open on a press is drawn as itself, no button.
  if (state.kind === PICTURE_STATE.READY && onOpen === undefined) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.FLUSH}
          className={PICTURE_FRAME_CLASS}
        >
          <img
            className={PICTURE_IMAGE_CLASS}
            src={state.url}
            alt={alt}
            decoding="async"
            draggable={false}
          />
        </Card>
        {said}
      </span>
    );
  }
  if (state.kind === PICTURE_STATE.READY) {
    const open = onOpen;
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
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
            className={PICTURE_FRAME_CLASS}
          >
            <img
              className={PICTURE_IMAGE_CLASS}
              src={state.url}
              alt={alt}
              decoding="async"
              draggable={false}
            />
          </Card>
        </PictureTile>
        {said}
      </span>
    );
  }
  if (state.kind === PICTURE_STATE.READING) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.FLUSH}
          className={`picture-frame ${PICTURE_PENDING_CLASS}`}
        >
          <PictureStandIn state={PICTURE_STATE.READING} words={alt} />
        </Card>
        {said}
      </span>
    );
  }
  if (state.kind === PICTURE_STATE.FAILED) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
        <Card
          as={CARD_ELEMENT.SPAN}
          corner={CARD_CORNER.CONTROL}
          padding={CARD_PADDING.NONE}
          className={PICTURE_MISSING_CLASS}
        >
          <PictureStandIn state={PICTURE_STATE.FAILED} words={alt} onRetry={state.retry} />
        </Card>
        {said}
      </span>
    );
  }
  return (
    <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind}>
      <Card
        as={CARD_ELEMENT.SPAN}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.NONE}
        dashed
        className={PICTURE_MISSING_CLASS}
      >
        <PictureStandIn state={PICTURE_STATE.MISSING} words={alt} />
      </Card>
      {said}
    </span>
  );
}
