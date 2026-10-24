import { countWords } from "@luke/features/words";
import { Children, createContext, isValidElement, type ReactNode, useContext } from "react";
import { cssCustomProperties } from "../../css.js";
import { ImageOffIcon } from "../../icons/icons.js";
import { PICTURE_STATE, type PictureState } from "../../picture-cache.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";
import { PictureTile } from "../picture-tile/picture-tile.js";
import { Spinner } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";

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
 * wears a veil saying how many more the viewer holds.
 *
 * Each tile is a `PictureTile` whose face is the picture, the spinner while
 * its bytes are read, or, where they are gone, the glyph and its words
 * (`PictureStandIn`, which a picture standing alone draws too). A gone
 * tile opens nothing, so it is no press; nor is one whose place drawing it
 * gives no `onOpen`. The set is left out of the screen recording, because a
 * picture can hold words and the recording carries none, and it is a list
 * its caller names (`label`).
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

/** What a set counts its pictures as. */
const PICTURE = { one: "picture", many: "pictures" } as const;

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

/**
 * What stands in a picture's place while it is not drawn: the window's
 * spinner, said as reading the picture, while its bytes are read, and the
 * glyph of a picture gone and its words, with why (`not available` unless
 * its place says more), where they are gone.
 */
export function PictureStandIn({
  state,
  words,
  why = NOT_AVAILABLE,
}: {
  state: typeof PICTURE_STATE.READING | typeof PICTURE_STATE.MISSING;
  /** The picture's words, its alt text or caption; empty where it has none. */
  words: string;
  /** Why a gone picture is not there, after its words. */
  why?: string | undefined;
}): React.JSX.Element {
  if (state === PICTURE_STATE.READING) return <Spinner delay label={READING_LABEL} />;
  return (
    <span className="luke-picture-stand-in">
      <ImageOffIcon aria-hidden="true" />
      <span>{goneWords(words, why)}</span>
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
  if (state.kind !== PICTURE_STATE.READY) {
    return <PictureStandIn state={state.kind} words={words} why={why} />;
  }
  return (
    <img
      className="luke-picture-set-image"
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
 * press unless it is gone or its place gives nothing to open.
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
  const frame = (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      dashed={gone}
      role={gone ? "img" : undefined}
      aria-label={gone ? goneWords(words, why ?? NOT_AVAILABLE) : undefined}
      className="luke-picture-set-frame grid w-full place-items-center"
    >
      <TileFace state={state} words={words} why={why} />
      {more > 0 ? (
        <span className="luke-picture-set-more" aria-hidden="true">
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
      className="luke-picture-set-tile"
      style={cssCustomProperties({ "--luke-picture-ratio": ratio })}
    >
      {gone || onOpen === undefined ? (
        <span className="luke-picture-set-still">
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
    <figure className="luke-picture-set ph-no-capture" data-many={many}>
      <ul className="luke-picture-set-tiles" aria-label={label}>
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
        <figcaption>
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {countWords(count, PICTURE)}
          </Text>
        </figcaption>
      ) : null}
    </figure>
  );
}
