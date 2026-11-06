import type { HTMLAttributes, ReactNode } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import type { StatusTone } from "../../status-tone.js";
import { GAP, LAYOUT_ELEMENT, Stack } from "../layout/layout.js";
import { useLinkAddress } from "../menu/link-address.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { SCROLL_FADE, SCROLL_SIZE, ScrollArea } from "../scroll-area/scroll-area.js";
import { Skeleton, SkeletonRegion } from "../skeleton/skeleton.js";

const CARD = "ui-hover-card flex flex-col gap-1";
const HEAD = "ui-hover-card-head flex items-baseline gap-icon-gap";
const LEAD = "ui-hover-card-lead flex items-center gap-control-gap";
const LED_HEAD = "min-w-0 flex-1";
const GLYPH =
  "ui-hover-card-glyph inline-flex h-lh w-menu-glyph flex-none items-center justify-center self-start [&>:not(.ui-avatar,:has(.ui-avatar))]:size-hover-card-glyph";
const TITLE = "ui-hover-card-title flex min-w-0 flex-1 flex-col gap-0.5";
const NAME =
  "ui-hover-card-name overflow-hidden text-label leading-[inherit] font-label wrap-anywhere";
const SUB =
  "ui-hover-card-sub flex min-w-0 items-center gap-1 text-caption leading-[inherit] text-muted-foreground tabular-nums [&>span]:min-w-0 [&>span]:wrap-anywhere";
const CORNER =
  "ui-hover-card-corner flex-none whitespace-nowrap text-caption leading-[inherit] text-muted-foreground tabular-nums data-tone:text-tone-ink";
const NOTE =
  "ui-hover-card-note m-0 overflow-hidden text-muted-foreground wrap-anywhere [&_code]:font-mono [&_code]:text-hover-card-code pointer-coarse:[&_code]:text-caption";
const RULE = "ui-hover-card-rule m-0 h-px w-full flex-none border-0 bg-border";
const ROW =
  "ui-hover-card-row group/row -mx-2 box-border flex h-menu-row w-[calc(100%+--spacing(4))] min-w-0 items-center gap-icon-gap rounded-menu-row border-0 bg-transparent px-2 py-0 text-left text-body leading-[inherit] text-foreground transition-colors duration-(--ui-duration-hover) ease-motion-exit data-[look=detail]:text-caption data-[look=detail]:leading-[inherit] data-[look=detail]:text-muted-foreground";
const ROW_PRESS =
  "[font-family:inherit] [font-style:inherit] [font-weight:inherit] cursor-press hover:bg-fill-strong";
const ROW_FOCUS = "focus-visible:bg-fill-strong focus-visible:outline-none";
const ROW_GLYPH =
  "ui-hover-card-row-glyph inline-flex w-menu-glyph flex-none justify-center [&>:not(.ui-avatar,:has(.ui-avatar))]:size-menu-glyph group-data-[look=detail]/row:[&>img]:size-hover-card-glyph";
const ROW_LABEL = "ui-hover-card-row-label min-w-0 flex-1 overflow-hidden whitespace-nowrap";
const ROW_END =
  "ui-hover-card-row-end flex-none whitespace-nowrap text-caption leading-[inherit] text-muted-foreground tabular-nums";
const FIGURES = "ui-hover-card-figures m-0 flex flex-col gap-list-gap text-caption";
const FIGURE =
  "ui-hover-card-figure flex justify-between gap-control-gap [&_dd]:m-0 [&_dd]:tabular-nums [&_dt]:text-muted-foreground";
const SCROLL = "ui-hover-card-scroll -mx-2 flex max-h-hover-card-list flex-col";
const SCROLL_BODY = "ui-hover-card-scroll-body px-2";

const CARD_READING = "Reading…";

const SUB_WIDTH = "50%";

const LAST_NOTE_WIDTH = "80%";

type HoverCardMarks = { readonly [mark: `data-${string}`]: string | undefined };

export interface HoverCardFigure {
  readonly label: string;
  readonly figure: ReactNode;
}

export const HOVER_CARD_ROW_LOOK = {
  DETAIL: "detail",
  LINE: "line",
} as const;

export type HoverCardRowLook = (typeof HOVER_CARD_ROW_LOOK)[keyof typeof HOVER_CARD_ROW_LOOK];

type HoverCardRowAnchor = Omit<
  HTMLAttributes<HTMLElement>,
  "className" | "style" | "children" | "role" | "tabIndex"
>;

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

export function HoverCardHead({
  mark,
  glyph,
  name,
  oneLine = false,
  sub,
  corner,
  cornerTone,
}: {
  mark?: ReactNode;
  glyph?: ReactNode;
  name: ReactNode;
  oneLine?: boolean;
  sub?: ReactNode;
  corner?: ReactNode;
  cornerTone?: StatusTone | undefined;
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
      {corner === undefined ? null : (
        <span className={CORNER} data-tone={cornerTone}>
          {corner}
        </span>
      )}
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

export function HoverCardSkeleton({
  mark,
  glyph,
  name,
  sub = false,
  notes = 1,
  ...marks
}: {
  mark?: ReactNode;
  glyph?: ReactNode;
  name: ReactNode;
  sub?: boolean;
  notes?: number;
} & HoverCardMarks): React.JSX.Element {
  const lines = Array.from({ length: notes }, (_, at) => at);
  return (
    <HoverCard {...marks} data-hover-card-skeleton="">
      <HoverCardHead
        mark={mark}
        glyph={glyph}
        name={name}
        sub={sub ? <Skeleton width={SUB_WIDTH} /> : undefined}
      />
      <SkeletonRegion label={CARD_READING}>
        {lines.map((at) => (
          <Skeleton key={at} width={at === notes - 1 ? LAST_NOTE_WIDTH : undefined} />
        ))}
      </SkeletonRegion>
    </HoverCard>
  );
}

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

export function HoverCardRule(): React.JSX.Element {
  return <hr className={RULE} />;
}

export function HoverCardFigures({
  label,
  figures,
}: {
  label: string;
  figures: readonly HoverCardFigure[];
}): React.JSX.Element {
  return (
    <dl className={FIGURES} aria-label={label}>
      {figures.map((figure) => (
        <div key={figure.label} className={FIGURE}>
          <dt>{figure.label}</dt>
          <dd>{figure.figure}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HoverCardRow({
  look = HOVER_CARD_ROW_LOOK.LINE,
  glyph,
  label,
  end,
  onPress,
  linkHref,
  ...anchor
}: {
  look?: HoverCardRowLook;
  glyph: ReactNode;
  label: ReactNode;
  end?: ReactNode;
  onPress?: (() => void) | undefined;
  linkHref?: string | undefined;
} & HoverCardRowAnchor): React.JSX.Element {
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
    <span {...anchor} className={ROW} data-look={look}>
      {row}
    </span>
  ) : (
    <button
      {...anchor}
      type="button"
      className={`${ROW} ${ROW_PRESS} ${ROW_FOCUS}`}
      data-look={look}
      ref={linkAddress}
      onClick={pulseOnPress(onPress, PRESS_PULSE.QUIET)}
    >
      {row}
    </button>
  );
}

export function HoverCardScroll({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className={SCROLL}>
      <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
        <div className={SCROLL_BODY}>{children}</div>
      </ScrollArea>
    </div>
  );
}

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
