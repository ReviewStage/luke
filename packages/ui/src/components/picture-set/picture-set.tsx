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

const SET_FEW = 3;

export const PICTURE_SET_SHOWN = 6;

const WAITING_RATIO = 16 / 10;

const READING_LABEL = "Reading the picture";

const NOT_AVAILABLE = "not available";

const COULD_NOT_READ = "could not be read.";

const RETRY = "Retry";

const PICTURE = { one: "picture", many: "pictures" } as const;

const STAND_IN =
  "ui-picture-stand-in flex min-w-0 items-center gap-control-gap text-caption text-muted-foreground wrap-anywhere [&>svg]:size-icon-16 [&>svg]:flex-none";

const FAILED_LINE = "Couldn't load image";

const FAILED_STAND_IN =
  "ui-picture-failed @container/ui-picture-failed flex w-full flex-col items-center justify-center gap-ui-4 p-ui-8 text-center text-caption text-muted-foreground";

const FAILED_GLYPH =
  "ui-picture-failed-glyph flex flex-none items-center [&_svg]:size-control-icon";

const FAILED_WORDS = "ui-picture-failed-words @max-[160px]/ui-picture-failed:hidden";

const FAILED_RETRY =
  "ui-picture-failed-retry contents @max-[160px]/ui-picture-failed:[&_.ui-button-words]:sr-only";

const FRAME =
  "ui-picture-set-frame grid w-full place-items-center aspect-picture text-muted-foreground [&>.ui-picture-stand-in]:p-ui-8";

const TILE = "ui-picture-set-tile flex min-w-0 max-w-full flex-col";
const TILE_FEW = "shrink grow-[var(--ui-picture-ratio)] basis-picture-row";
const TILE_MANY = "w-picture-thumb flex-none";

interface TilePlace {
  readonly many: boolean;
  readonly more: number;
}

const TilePlaceContext = createContext<TilePlace>({ many: false, more: 0 });

function goneWords(words: string, why: string): string {
  return words === "" ? `This picture is ${why}` : `${words} · ${why}`;
}

function failedWords(words: string): string {
  return `${words === "" ? "This picture" : words} ${COULD_NOT_READ}`;
}

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

export function PictureStandIn(
  props: {
    words: string;
  } & (
    | {
        state: typeof PICTURE_STATE.READING | typeof PICTURE_STATE.MISSING;
        why?: string | undefined;
      }
    | {
        state: typeof PICTURE_STATE.FAILED;
        onRetry?: (() => void) | undefined;
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
  width?: number | undefined;
  height?: number | undefined;
  words: string;
  caption?: string | undefined;
  why?: string | undefined;
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

export function PictureSet({
  label,
  count,
  thumbnails = false,
  children,
}: {
  label: string;
  count: number;
  thumbnails?: boolean | undefined;
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
