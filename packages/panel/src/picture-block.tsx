import {
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  isVideoDataUrl,
  PictureStandIn,
  PictureTile,
  VideoPlayer,
} from "@repo/ui";
import { PICTURE_STATE, type PictureState } from "@repo/ui/picture-read";

export const PICTURE_BLOCK_CLASS =
  "picture-block ph-no-capture my-block-gap block w-fit max-w-full";

export const PICTURE_FRAME_CLASS = "picture-frame w-fit max-w-full";

export const PICTURE_IMAGE_CLASS =
  "picture-image block h-auto max-h-picture-most max-w-full object-contain";

export const PICTURE_PENDING_CLASS =
  "picture-pending grid aspect-screenshot w-picture-stand-in max-w-full cursor-default place-items-center";

export const OUTSIDE_GLYPH_CLASS = "mr-[0.25em] size-picture-glyph align-[-0.12em]";

const PICTURE_MISSING_CLASS =
  "picture-frame picture-missing w-picture-stand-in max-w-full cursor-default p-card-snug";

const PICTURE_CAPTION_CLASS =
  "picture-caption mt-item-gap block text-picture-caption text-muted-foreground";

export function PictureBlock({
  ref,
  state,
  alt,
  caption,
  onOpen,
}: {
  ref?: React.Ref<HTMLSpanElement> | undefined;
  state: PictureState;
  alt: string;
  caption: string | undefined;
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const said =
    caption === undefined || caption === "" ? null : (
      <span className={PICTURE_CAPTION_CLASS}>{caption}</span>
    );
  if (state.kind === PICTURE_STATE.READY && isVideoDataUrl(state.url)) {
    return (
      <span ref={ref} className={PICTURE_BLOCK_CLASS} data-state={state.kind} data-video="">
        <VideoPlayer dataUrl={state.url} label={alt} onExpand={onOpen} />
        {said}
      </span>
    );
  }
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
          padding={CARD_PADDING.FLUSH}
          className={`picture-frame ${PICTURE_PENDING_CLASS}`}
        >
          <PictureStandIn
            state={PICTURE_STATE.FAILED}
            words={alt}
            onRetry={state.retry}
            failure={state.failure}
          />
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
