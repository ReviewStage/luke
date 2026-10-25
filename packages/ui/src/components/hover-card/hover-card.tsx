import type { ReactNode } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { GAP, LAYOUT_ELEMENT, Stack } from "../layout/layout.js";
import { useLinkAddress } from "../menu/link-address.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { SCROLL_FADE, SCROLL_SIZE, ScrollArea } from "../scroll-area/scroll-area.js";

/**
 * hover-card.tsx -- the parts every hover card is drawn from: its head, its notes, and its rule, in one type scale.
 *
 * A control with more to say than a pill hangs a card in the pill's place
 * (`TooltipCard`), and every card an app hangs says what it says in these
 * parts, so the same name reads at the same size wherever the pointer rests.
 * The head is the subject's glyph where it wears one, its name in the card's
 * one weight, wrapped to two lines, or on one line faded where it is cut
 * short as a tab's label is; under the name, a quieter line of what it runs
 * on or whose it is; and at the head's right its corner, muted: how long ago,
 * how it ended, or how many wait. Under the head stand its notes, read whole
 * and so wrapped to three lines, or one line faded at its end, and a rule
 * before what a card lists under it.
 *
 * A card's rows are set as a menu's rows are: a glyph on the head's glyph
 * column, words on one line fading out where cut short, and what stands at
 * the row's end, muted. A quieter row under the name (`DETAIL`) says where
 * the subject lives or who made it; a row of a list under a rule (`LINE`)
 * names one of the things the subject holds. Either is a button where a
 * press opens what it names and text where nothing does, in the same place
 * either way, washed under the pointer as a menu row is. A list names every
 * thing it holds, never a count of the rest: past a few rows' height it
 * scrolls within the card, fading at the edge where more stands
 * (`HoverCardScroll`), so whatever the subject holds can be reached.
 *
 * What is drawn here is the card's words alone. The surface it stands on,
 * when it shows, how long it lingers for the pointer to cross onto it, and
 * what its subject is read from are the app's.
 *
 * A card says what its subject is and offers no way to it, no "Open agent"
 * under a rule, because the control it hangs from opens the subject on a
 * press. Where that control's press does something else, as a group
 * header's folds, the card's own name is the way in; its rows may still
 * open what they name, another thing than the card's subject.
 */

/**
 * The card's parts in one type scale, each still named by its `luke-hover-
 * card-*` class for what finds a part in the page. The head's glyph takes a
 * menu glyph's footprint on the name's first line, so the rows listed under
 * the head start their words on the name's column, and sizes whatever it
 * holds bar a face, which brings its own. The name is in the medium weight,
 * wrapped to two lines or on one faded at its end; the line under it and
 * the corner a size down, never under 12px under a finger. Notes wrap to
 * three lines, or one faded. A row is set as a menu's row is: its height
 * and corner, its wash off the card's edge by a menu's inset under the
 * pointer, its glyph on the head's glyph column.
 */
const CARD = "luke-hover-card flex flex-col gap-1";
const HEAD = "luke-hover-card-head flex items-baseline gap-icon-gap";
const LEAD = "luke-hover-card-lead flex items-center gap-control-gap";
const LED_HEAD = "min-w-0 flex-1";
const GLYPH =
  "luke-hover-card-glyph inline-flex h-lh w-menu-glyph flex-none items-center justify-center self-start [&>:not(.luke-avatar,:has(.luke-avatar))]:size-hover-card-glyph";
const TITLE = "luke-hover-card-title flex min-w-0 flex-1 flex-col gap-0.5";
const NAME =
  "luke-hover-card-name overflow-hidden text-label leading-[inherit] font-label wrap-anywhere";
const SUB =
  "luke-hover-card-sub flex min-w-0 items-center gap-1 text-caption leading-[inherit] text-muted-foreground tabular-nums [&>span]:min-w-0 [&>span]:wrap-anywhere";
const CORNER =
  "luke-hover-card-corner flex-none whitespace-nowrap text-caption leading-[inherit] text-muted-foreground tabular-nums";
const NOTE =
  "luke-hover-card-note m-0 overflow-hidden text-muted-foreground wrap-anywhere [&_code]:font-mono [&_code]:text-hover-card-code pointer-coarse:[&_code]:text-caption";
const RULE = "luke-hover-card-rule m-0 h-px w-full flex-none border-0 bg-border";
const ROW =
  "luke-hover-card-row group/row -mx-2 box-border flex h-menu-row w-[calc(100%+--spacing(4))] min-w-0 items-center gap-icon-gap rounded-menu-row border-0 bg-transparent px-2 py-0 text-left text-body leading-[inherit] text-foreground transition-colors duration-(--luke-duration-hover) ease-motion-exit data-[look=detail]:text-caption data-[look=detail]:leading-[inherit] data-[look=detail]:text-muted-foreground";
const ROW_PRESS =
  "[font-family:inherit] [font-style:inherit] [font-weight:inherit] cursor-pointer hover:bg-fill-strong focus-visible:bg-fill-strong focus-visible:outline-none";
const ROW_GLYPH =
  "luke-hover-card-row-glyph inline-flex w-menu-glyph flex-none justify-center [&>:not(.luke-avatar,:has(.luke-avatar))]:size-menu-glyph group-data-[look=detail]/row:[&>img]:size-hover-card-glyph";
const ROW_LABEL = "luke-hover-card-row-label min-w-0 flex-1 overflow-hidden whitespace-nowrap";
const ROW_END =
  "luke-hover-card-row-end flex-none whitespace-nowrap text-caption leading-[inherit] text-muted-foreground tabular-nums";
const SCROLL = "luke-hover-card-scroll -mx-2 flex max-h-hover-card-list flex-col";
const SCROLL_BODY = "luke-hover-card-scroll-body px-2";

/** The data attributes a card's root carries, which name the card for a test or a capture. */
type HoverCardMarks = { readonly [mark: `data-${string}`]: string | undefined };

/** How a card's row is set: a quieter line under its name, or a row of a list under a rule. */
export const HOVER_CARD_ROW_LOOK = {
  DETAIL: "detail",
  LINE: "line",
} as const;

export type HoverCardRowLook = (typeof HOVER_CARD_ROW_LOOK)[keyof typeof HOVER_CARD_ROW_LOOK];

/** A card's root: its parts in a column, one gap apart. */
export function HoverCard({
  children,
  ...marks
}: { children: ReactNode } & HoverCardMarks): React.JSX.Element {
  return (
    <div {...marks} className={CARD}>
      {children}
    </div>
  );
}

/**
 * A card's head: its glyph where it wears one, its name and the line under
 * it, and its corner. A card about someone or somewhere leads instead with
 * their `mark` at a card's size, a face or a workspace's tile, the head
 * beside it and centred on it, as a profile card leads with its picture.
 */
export function HoverCardHead({
  mark,
  glyph,
  name,
  oneLine = false,
  sub,
  corner,
}: {
  /** What leads the head at a card's size, a face or a tile, beside the rest rather than on the name's first line. */
  mark?: ReactNode;
  glyph?: ReactNode;
  name: ReactNode;
  /** Whether the name stands on one line, faded where it is cut short, rather than wrapping to two: a task standing in for a title. */
  oneLine?: boolean;
  /** The quieter line under the name: what the subject runs on, whose it is, or when it ran. */
  sub?: ReactNode;
  /** What stands muted at the head's right. */
  corner?: ReactNode;
}): React.JSX.Element {
  const head = (
    <div className={mark === undefined ? HEAD : `${HEAD} ${LED_HEAD}`}>
      {glyph === undefined ? null : <span className={GLYPH}>{glyph}</span>}
      <div className={TITLE}>
        {oneLine ? (
          <ClippedLine
            className={`${NAME} block`}
            as={ONE_LINE_ELEMENT.SPAN}
            end={ONE_LINE_END.FADE}
          >
            {name}
          </ClippedLine>
        ) : (
          <span className={`${NAME} line-clamp-2`}>{name}</span>
        )}
        {sub === undefined ? null : <span className={SUB}>{sub}</span>}
      </div>
      {corner === undefined ? null : <span className={CORNER}>{corner}</span>}
    </div>
  );
  if (mark === undefined) return head;
  return (
    <div className={LEAD}>
      {mark}
      {head}
    </div>
  );
}

/** Words under a card's head, wrapped to three lines, or on one line faded where it is cut short. */
export function HoverCardNote({
  oneLine = false,
  children,
}: {
  oneLine?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return oneLine ? (
    <ClippedLine className={`${NOTE} block`} as={ONE_LINE_ELEMENT.P} end={ONE_LINE_END.FADE}>
      {children}
    </ClippedLine>
  ) : (
    <p className={`${NOTE} line-clamp-3`}>{children}</p>
  );
}

/** The hairline before what a card lists under its head. */
export function HoverCardRule(): React.JSX.Element {
  return <hr className={RULE} />;
}

/** A row of a card: its glyph, its words on one line, and what stands at its end; a button where a press opens what it names. */
export function HoverCardRow({
  look = HOVER_CARD_ROW_LOOK.LINE,
  glyph,
  label,
  end,
  onPress,
  linkHref,
}: {
  look?: HoverCardRowLook;
  glyph: ReactNode;
  label: ReactNode;
  /** What stands muted at the row's end: a size, a time, or a mark. */
  end?: ReactNode;
  /** Opens what the row names; a row without it is text. */
  onPress?: (() => void) | undefined;
  /** The address its press opens, where it opens one, which a right-click offers as a link's (`useLinkAddress`). */
  linkHref?: string | undefined;
}): React.JSX.Element {
  const linkAddress = useLinkAddress(linkHref);
  const row = (
    <>
      <span className={ROW_GLYPH}>{glyph}</span>
      <ClippedLine className={ROW_LABEL} as={ONE_LINE_ELEMENT.SPAN} end={ONE_LINE_END.FADE}>
        {label}
      </ClippedLine>
      {end === undefined ? null : <span className={ROW_END}>{end}</span>}
    </>
  );
  return onPress === undefined ? (
    <span className={ROW} data-look={look}>
      {row}
    </span>
  ) : (
    <button
      type="button"
      className={`${ROW} ${ROW_PRESS}`}
      data-look={look}
      ref={linkAddress}
      onClick={pulseOnPress(onPress, PRESS_PULSE.QUIET)}
    >
      {row}
    </button>
  );
}

/**
 * What a card holds past a few rows' height, scrolling within the card and
 * fading at the edge where more stands, so a long list is read whole rather
 * than cut short. Its rows keep their wash to the card's edges.
 */
export function HoverCardScroll({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className={SCROLL}>
      <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
        <div className={SCROLL_BODY}>{children}</div>
      </ScrollArea>
    </div>
  );
}

/** A list a card holds under a rule, named by `label`: every row it holds, each an `li` of the caller's, scrolling past a few rows' height. */
export function HoverCardList({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <HoverCardScroll>
      <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.NONE} aria-label={label}>
        {children}
      </Stack>
    </HoverCardScroll>
  );
}
