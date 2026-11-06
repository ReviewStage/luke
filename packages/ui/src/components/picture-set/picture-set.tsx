import { countWords } from "@repo/features/words";
import {
  Children,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useLayoutEffect,
} from "react";
import { cssCustomProperties } from "../../css.js";
import { ImageOffIcon } from "../../icons/icons.js";
import { RetryIcon } from "../../icons/lucide-glyphs.js";
import { PICTURE_STATE, type PictureState } from "../../picture-read.js";
import type { ReportedFailure } from "../../reported-failure.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";
import { PictureTile } from "../picture-tile/picture-tile.js";
import { Spinner } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * picture-set.tsx -- several pictures shown together, as tiles that open them: a few in one row at their own shapes, many as thumbnails that wrap, the last drawn saying how many more there are.
 *
 * A set of up to three stands in one row, each picture at its own shape,
 * uncropped, its caption under it, and the row stretched to the column so
 * they share a height. A set of more stands as thumbnails of one height
 * that wrap rather than stretch, since a row the narrow column leaves one
 * tile in would draw that tile the column's whole width; each names itself
 * in a hint instead of a caption, and words under the set say how many it
 * holds. A set that stands beside something else, as the pictures under a
 * call's row do, is thumbnails however few it holds (`thumbnails`). A set's
 * caller draws six (`PICTURE_SET_SHOWN`) and the last of them
 * wears a veil saying how many more the viewer holds, unless its read
 * failed, since the veil would cover its Retry.
 *
 * Each tile is a `PictureTile` whose face is the picture, the spinner while
 * its bytes are read, where they are gone the glyph and its words, or, where
 * the read did not land this time, the gone picture's glyph, a short line,
 * and Retry where the spinner stood (`PictureStandIn`, which a picture
 * standing alone draws too). A gone or
 * failed tile opens nothing, so it is no press, and a failed one's Retry is
 * its press instead; nor is one whose place drawing it gives no `onOpen`. The set is left out of the screen recording, because a
 * picture can hold words and the recording carries none, and it is a list
 * its caller names (`label`).
 *
 * It is drawn in Tailwind utilities over the theme, each tile's frame a
 * `Card` (shadcn/ui's), its shape the picture's own (`aspect-picture`, from
 * the `--ui-picture-ratio` its tile sets).
 */

/** How many pictures a set may hold and still stand in one captioned row. */
const SET_FEW = 3;

/** How many of a set's pictures its caller draws before the last says how many more the viewer holds. */
export const PICTURE_SET_SHOWN = 6;

/** The shape a picture waits in while its size is not known yet: a screenshot's. */
const WAITING_RATIO = 16 / 10;

/** What the spinner says to a reader while a picture's bytes are read. */
const READING_LABEL = "Reading the picture";

/** What a picture that is not there says, after its words, where its place says no more. */
const NOT_AVAILABLE = "not available";

/** What a picture whose read did not land says, after its words. */
const COULD_NOT_READ = "could not be read.";

/** What a failed picture's Retry is named. */
const RETRY = "Retry";

/** What a set counts its pictures as. */
const PICTURE = { one: "picture", many: "pictures" } as const;

/** A gone picture's glyph and words, in the caption's type, the words wrapping and clipped by the frame where a thumbnail is small. */
const STAND_IN =
  "ui-picture-stand-in flex min-w-0 items-center gap-control-gap text-caption text-muted-foreground wrap-anywhere [&>svg]:size-icon-16 [&>svg]:flex-none";

/** What a failed picture says on screen, short enough for a thumbnail's box; its whole sentence is spoken. */
const FAILED_LINE = "Couldn't load image";

/**
 * A failed picture's stand-in, filling the box the spinner stood in and the
 * container its narrow look asks about: the gone picture's glyph over a
 * short line, then Retry, centered, as a picture that failed reads in most
 * apps. Its sentence, with the picture's own words, is spoken as the alert
 * rather than drawn. Note that a narrow box, a portrait thumbnail's, keeps
 * the glyph and Retry's glyph alone, because the line would not fit.
 */
const FAILED_STAND_IN =
  "ui-picture-failed @container/ui-picture-failed flex w-full flex-col items-center justify-center gap-ui-4 p-ui-8 text-center text-caption text-muted-foreground";

/** The gone picture's glyph at a control's glyph size. */
const FAILED_GLYPH =
  "ui-picture-failed-glyph flex flex-none items-center [&_svg]:size-control-icon";

/** The short line, given up in a narrow box. */
const FAILED_WORDS = "ui-picture-failed-words @max-[160px]/ui-picture-failed:hidden";

/** Retry, its glyph alone in a narrow box. */
const FAILED_RETRY =
  "ui-picture-failed-retry contents @max-[160px]/ui-picture-failed:[&_.ui-button-words]:sr-only";

/**
 * A tile's frame, filling the tile's room at the picture's shape, what stands
 * in for the picture centered in it: a gone one's words, inset, a file's long
 * name wrapping rather than running out of the frame, or a failed one's glyph
 * and Retry.
 */
const FRAME =
  "ui-picture-set-frame grid w-full place-items-center aspect-picture text-muted-foreground [&>.ui-picture-stand-in]:p-ui-8";

/**
 * A tile's room in the row: a few grow by their shape from a common height,
 * so the row stretched to the column keeps them one height; many keep one
 * height and wrap rather than stretching to the column.
 */
const TILE = "ui-picture-set-tile flex min-w-0 max-w-full flex-col";
const TILE_FEW = "shrink grow-[var(--ui-picture-ratio)] basis-picture-row";
const TILE_MANY = "w-picture-thumb flex-none";

/** Where a tile stands in its set: among many, and how many more the set holds past it. */
interface TilePlace {
  readonly many: boolean;
  readonly more: number;
}

const TilePlaceContext = createContext<TilePlace>({ many: false, more: 0 });

/** The words a gone picture says: its own and why, or why alone where it has none. */
function goneWords(words: string, why: string): string {
  return words === "" ? `This picture is ${why}` : `${words} · ${why}`;
}

/** The sentence a picture whose read did not land says: its own words first, or this picture where it has none. */
function failedWords(words: string): string {
  return `${words === "" ? "This picture" : words} ${COULD_NOT_READ}`;
}

/**
 * A failed picture's stand-in: its glyph, line, and Retry. Note that it
 * offers no Copy details, unlike a failure on a line, because a picture's
 * box is kept as quiet as the pictures around it, as most apps keep one; so
 * it says its failure shown and hidden itself, as `FailureCopy` would, and
 * the app still hears of every failure it shows.
 */
function FailedStandIn({
  words,
  onRetry,
  failure,
}: {
  words: string;
  onRetry: (() => void) | undefined;
  failure: ReportedFailure;
}): React.JSX.Element {
  useLayoutEffect(() => {
    failure.shown();
    return () => failure.hidden();
  }, [failure]);
  return (
    <span className={FAILED_STAND_IN} role="alert">
      <VisuallyHidden>{failedWords(words)}</VisuallyHidden>
      <span className={FAILED_GLYPH} aria-hidden="true">
        <ImageOffIcon />
      </span>
      <span className={FAILED_WORDS} aria-hidden="true">
        {FAILED_LINE}
      </span>
      {onRetry === undefined ? null : (
        <span className={FAILED_RETRY}>
          <Button
            variant={BUTTON_VARIANT.QUIET}
            icon={<RetryIcon />}
            turns
            onClick={() => onRetry()}
          >
            {RETRY}
          </Button>
        </span>
      )}
    </span>
  );
}

/**
 * What stands in a picture's place while it is not drawn: the window's
 * spinner, said as reading the picture, while its bytes are read; the
 * glyph of a picture gone and its words, with why (`not available` unless
 * its place says more), where they are gone; and, where the read did not
 * land this time, the gone picture's glyph, a short line, and Retry in the
 * spinner's place, the failure's whole sentence said as the alert; a span
 * since a picture may stand inside a paragraph.
 */
export function PictureStandIn(
  props: {
    /** The picture's words, its alt text or caption; empty where it has none. */
    words: string;
  } & (
    | {
        state: typeof PICTURE_STATE.READING | typeof PICTURE_STATE.MISSING;
        /** Why a gone picture is not there, after its words. */
        why?: string | undefined;
      }
    | {
        state: typeof PICTURE_STATE.FAILED;
        /** Reads a failed picture again. */
        onRetry?: (() => void) | undefined;
        /** The read that did not land, as the app reports it. */
        failure: ReportedFailure;
      }
  ),
): React.JSX.Element {
  const { state, words } = props;
  if (state === PICTURE_STATE.READING) return <Spinner delay label={READING_LABEL} />;
  if (props.state === PICTURE_STATE.FAILED) {
    return <FailedStandIn words={words} onRetry={props.onRetry} failure={props.failure} />;
  }
  return (
    <span className={STAND_IN}>
      <ImageOffIcon aria-hidden="true" />
      <span>{goneWords(words, props.why ?? NOT_AVAILABLE)}</span>
    </span>
  );
}

/** A tile's face: the picture, or what stands in its place. */
function TileFace({
  state,
  words,
  why,
}: {
  state: PictureState;
  words: string;
  why: string | undefined;
}): ReactNode {
  if (state.kind === PICTURE_STATE.FAILED) {
    return (
      <PictureStandIn
        state={state.kind}
        words={words}
        onRetry={state.retry}
        failure={state.failure}
      />
    );
  }
  if (state.kind !== PICTURE_STATE.READY) {
    return <PictureStandIn state={state.kind} words={words} why={why} />;
  }
  return (
    <img
      className="ui-picture-set-image block size-full"
      src={state.url}
      alt={words}
      decoding="async"
      draggable={false}
    />
  );
}

/**
 * One picture of a set, by where its read stands: at its own shape (`width`
 * by `height`), or a screenshot's until its size is known; opening it on a
 * press unless it is gone, failed, or its place gives nothing to open.
 */
export function PictureSetTile({
  state,
  width,
  height,
  words,
  caption = "",
  why,
  onOpen,
}: {
  state: PictureState;
  /** The picture's size in pixels; none while it is not known. */
  width?: number | undefined;
  height?: number | undefined;
  /** The picture's words, which a press is named for and a gone picture says. */
  words: string;
  /** The words under it in a few, none where it has none. */
  caption?: string | undefined;
  /** Why a gone picture is not there, where there is more to say than that it is not available. */
  why?: string | undefined;
  /** Opens the picture; without one, the tile is no press. */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const { many, more } = useContext(TilePlaceContext);
  const ratio = width === undefined || height === undefined ? WAITING_RATIO : width / height;
  const gone = state.kind === PICTURE_STATE.MISSING;
  const failed = state.kind === PICTURE_STATE.FAILED;
  const frame = (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      dashed={gone}
      role={gone ? "img" : undefined}
      aria-label={gone ? goneWords(words, why ?? NOT_AVAILABLE) : undefined}
      className={FRAME}
    >
      <TileFace state={state} words={words} why={why} />
      {/* Note that a failed tile wears no veil, because the veil would cover its Retry, and the words under the set still say how many it holds. */}
      {more > 0 && !failed ? (
        <span
          className="ui-picture-set-more absolute inset-0 grid place-items-center bg-veil text-dialog font-dialog text-on-veil"
          aria-hidden="true"
        >
          +{more}
        </span>
      ) : null}
    </Card>
  );
  const said =
    many || caption === "" ? null : (
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
        {caption}
      </Text>
    );
  return (
    <li
      className={`${TILE} ${many ? TILE_MANY : TILE_FEW}`}
      style={cssCustomProperties({ "--ui-picture-ratio": ratio })}
    >
      {gone || failed || onOpen === undefined ? (
        <span className="ui-picture-set-still flex w-full min-w-0 flex-col gap-ui-4">
          {frame}
          {said}
        </span>
      ) : (
        <Tooltip label={many ? words : undefined}>
          <PictureTile name={words} fill onOpen={() => onOpen()} caption={said}>
            {frame}
          </PictureTile>
        </Tooltip>
      )}
    </li>
  );
}

/**
 * A set of pictures, its tiles (`PictureSetTile`) the first of them its
 * caller draws, and `count` how many it holds in all, of which the last
 * tile says how many more there are.
 */
export function PictureSet({
  label,
  count,
  thumbnails = false,
  children,
}: {
  /** What the list of tiles is named. */
  label: string;
  /** How many pictures the set holds, drawn or not. */
  count: number;
  /** Whether it is thumbnails however few it holds, rather than a few at the column's width. */
  thumbnails?: boolean | undefined;
  /** The tiles drawn: at most `PICTURE_SET_SHOWN` where the rest are left to a viewer, or every one. */
  children: ReactNode;
}): React.JSX.Element {
  const many = thumbnails || count > SET_FEW;
  const tiles = Children.toArray(children);
  return (
    <figure className="ui-picture-set ph-no-capture m-0 max-w-full" data-many={many}>
      <ul
        className="ui-picture-set-tiles m-0 flex list-none flex-wrap gap-item-gap p-0"
        aria-label={label}
      >
        {tiles.map((tile, index) => (
          <TilePlaceContext.Provider
            // Note that `Children.toArray` keys each tile by its caller's key, which this keeps.
            key={isValidElement(tile) ? (tile.key ?? index) : index}
            value={{ many, more: index === tiles.length - 1 ? count - tiles.length : 0 }}
          >
            {tile}
          </TilePlaceContext.Provider>
        ))}
      </ul>
      {count > SET_FEW ? (
        <figcaption className="mt-item-gap block">
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {countWords(count, PICTURE)}
          </Text>
        </figcaption>
      ) : null}
    </figure>
  );
}
