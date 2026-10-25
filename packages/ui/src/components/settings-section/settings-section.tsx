import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { type ReactNode, useId, useRef } from "react";
import { RevealArea, revealArea } from "../reveal/reveal.js";
import { SettingsRow, SettingsRowValue } from "../settings-row/settings-row.js";
import { SKELETON_SHAPE, Skeleton, SkeletonRegion } from "../skeleton/skeleton.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * settings-section.tsx -- one group of a settings page: its heading above a card of rows.
 *
 * The heading stands outside the card, in the section role and a step
 * quieter than the rows, as macOS and Linear head a group. The card holds
 * the rows edge to edge with a hairline between each and the next, so a
 * row (`SettingsRow`) owns its padding and the section owns everything
 * around it: the room under the heading, the card's edge and corner, and
 * the rules. A section with no heading draws the card alone, for a page
 * that is one group and whose title already says what the rows are. A
 * headed section is a region named by its heading, so a reader moving by
 * landmark hears what the rows are for before reaching them. The room
 * between sections is the page's. A section of one control that draws its
 * own frame, a text area, stands it under the heading with no card, so no
 * frame is drawn within a frame.
 *
 * A section a Settings link or a search result lands on wears its `anchor`
 * whole. Its card is a reveal area (`RevealArea`), so the rows a setting
 * in it brings (`Reveal`) unroll in under it and the rows under them glide
 * down, where no page around it moves its sections as well. Where the card has no rows to draw, it holds a line
 * (`SettingsLine`) in their place, a row's height and inset: a note in the
 * muted words of a description, who to sign in as or that there is nothing
 * here, or a read that failed, holding the failure (`ErrorState`).
 *
 * While a read is out, placeholder rows stand in the rows' place, built in a
 * row's own boxes (`SettingsRow`), so each block sits where a label, a
 * description, and a control will: in a card that is already drawn
 * (`SettingsRowsSkeleton`), or as whole sections, a heading's block over a
 * card of them, where the page has not yet read what its sections are
 * (`SettingsSectionsSkeleton`). The rest of the page stands meanwhile, and
 * the region around the blocks says what is being read.
 *
 * It is drawn in Tailwind utilities over the theme with no shadcn/ui base:
 * shadcn's card is a frame for whatever a caller lays in it, and a section's
 * card is a column of rows it rules one from the next, a reveal area whose
 * rows unroll in it. The rules between rows stay in `settings-section.css`,
 * since they fall on other components' boxes, as do the placeholders' own
 * boxes, which a skeleton's lint rule holds to a skeleton's class alone.
 */

/** A card's line where its rows would stand: a note's words, in a description's muted words, or a failure (`ErrorState`). */
export function SettingsLine({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="luke-settings-line m-0 box-border flex min-h-settings-row min-w-0 items-center gap-control-gap px-settings-row-inline py-settings-row-block font-sans text-caption font-caption text-muted-foreground wrap-anywhere">
      {children}
    </div>
  );
}

/* ----- Skeletons ----- */

/** The control a placeholder row ends in, in the shape of the one that lands. */
export const SETTINGS_SKELETON_CONTROL = {
  /** A button of a word or two: Connect, Rename, Copy link. */
  BUTTON: "button",
  /** A row's ⋯, a quiet `IconButton`: one control's square. */
  MORE: "more",
  /** A pop-up's field chip, at the select field's width. */
  SELECT: "select",
  /** A `Switch`. */
  SWITCH: "switch",
  /** A segmented `ChoiceBar` of a few short words. */
  CHOICE: "choice",
  /** A `TextField`, as wide as the row's controls, so a button after it wraps under it as the field's does. */
  FIELD: "field",
  /** A word the row ends in (`SettingsRowValue`): a member's role. */
  VALUE: "value",
} as const;

export type SettingsSkeletonControl =
  (typeof SETTINGS_SKELETON_CONTROL)[keyof typeof SETTINGS_SKELETON_CONTROL];

/** The width of the mark a provider's or a service's row leads with (`SettingsRowMark`), read inside the row. */
export const SETTINGS_ROW_MARK_WIDTH = "var(--luke-settings-row-mark-size)";

/** One placeholder row, shaped as the row that lands: whether it is described, what it leads with, and what it ends in. */
export interface SettingsRowSkeletonShape {
  /** Whether the row that lands carries a description under its label. */
  readonly described: boolean;
  /** The controls at its end, in order; none where it ends in nothing. */
  readonly controls: readonly SettingsSkeletonControl[];
  /** How wide the face or mark it leads with stands, a length; none where it leads with none. */
  readonly mark?: string | undefined;
}

/** One placeholder section, shaped as the section that lands: whether it is headed, and its rows. */
export interface SettingsSectionSkeletonShape {
  readonly headed: boolean;
  readonly rows: readonly SettingsRowSkeletonShape[];
}

/** How wide each placeholder row's label and description stand, as shares of their lines, so the rows read as settings of their own. */
const SKELETON_ROW_WIDTHS = [
  { label: "34%", description: "62%" },
  { label: "26%", description: "48%" },
  { label: "40%", description: "70%" },
  { label: "30%", description: "56%" },
] as const;

/**
 * How each control's block stands, as a control's box of a width or a word's
 * line. Note that a switch's and a segmented choice's are lengths of their
 * own, measured against the controls they stand for, since neither names a
 * token, and a field's is the controls' whole width, as a text field's is.
 */
const SKELETON_CONTROL_BLOCK = {
  [SETTINGS_SKELETON_CONTROL.BUTTON]: "calc(3 * var(--luke-control-height))",
  [SETTINGS_SKELETON_CONTROL.MORE]: "var(--luke-control-height)",
  [SETTINGS_SKELETON_CONTROL.SELECT]: "var(--luke-select-field-width)",
  [SETTINGS_SKELETON_CONTROL.SWITCH]: "calc(var(--luke-control-height) + var(--luke-space-4))",
  [SETTINGS_SKELETON_CONTROL.CHOICE]: "calc(7.5 * var(--luke-control-height))",
  [SETTINGS_SKELETON_CONTROL.FIELD]: "100%",
  [SETTINGS_SKELETON_CONTROL.VALUE]: "100%",
} as const satisfies Record<SettingsSkeletonControl, string>;

/** How wide a placeholder section's heading stands, as a share of its line. */
const SKELETON_HEADING_WIDTHS = ["18%", "24%", "14%"] as const;

/** One control's block, in the shape of the control that lands: a word's line in a row's value column, else a control's box. */
export function SettingsControlSkeleton({
  control,
}: {
  control: SettingsSkeletonControl;
}): React.JSX.Element {
  const width = SKELETON_CONTROL_BLOCK[control];
  if (control === SETTINGS_SKELETON_CONTROL.VALUE) {
    return (
      <SettingsRowValue>
        <Skeleton width={width} />
      </SettingsRowValue>
    );
  }
  return <Skeleton shape={SKELETON_SHAPE.CONTROL} width={width} />;
}

/** A placeholder of one row, drawn by the row itself with its words, mark, and controls as blocks. */
function RowSkeleton({
  at,
  shape,
}: {
  at: number;
  shape: SettingsRowSkeletonShape;
}): React.JSX.Element {
  const widths = SKELETON_ROW_WIDTHS[at % SKELETON_ROW_WIDTHS.length] ?? SKELETON_ROW_WIDTHS[0];
  return (
    <SettingsRow
      label={<Skeleton width={widths.label} />}
      description={shape.described ? <Skeleton width={widths.description} /> : undefined}
      leading={
        shape.mark === undefined ? undefined : (
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={shape.mark} />
        )
      }
    >
      {() =>
        shape.controls.map((control, place) => (
          <SettingsControlSkeleton key={place} control={control} />
        ))
      }
    </SettingsRow>
  );
}

/** The placeholder rows, ruled one from the next as a card's rows are. */
function RowsSkeleton({ rows }: { rows: readonly SettingsRowSkeletonShape[] }): React.JSX.Element {
  return (
    <div className="luke-settings-skeleton-rows">
      {rows.map((shape, at) => (
        <RowSkeleton key={at} at={at} shape={shape} />
      ))}
    </div>
  );
}

/**
 * Placeholder rows standing in a card's rows while `label` is read, one to
 * each shape in `rows`; with no `label`, the rows alone, for a surface whose
 * own region already says what is being read.
 */
export function SettingsRowsSkeleton({
  label,
  rows,
}: {
  /** What is being read, said to a reader: "Reading the members"; none where a region around them says it. */
  label?: string | undefined;
  /** The rows likely to land, each in its shape, from what the loaded rows are drawn from. */
  rows: readonly SettingsRowSkeletonShape[];
}): React.JSX.Element {
  if (label === undefined) return <RowsSkeleton rows={rows} />;
  return (
    <SkeletonRegion label={label}>
      <RowsSkeleton rows={rows} />
    </SkeletonRegion>
  );
}

/** One placeholder section, drawn in a section's own frame: a heading's block where it is headed, over a card of its rows. */
function SectionSkeleton({
  at,
  shape,
}: {
  at: number;
  shape: SettingsSectionSkeletonShape;
}): React.JSX.Element {
  const head = shape.headed ? (
    <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.DIV}>
      <Skeleton width={SKELETON_HEADING_WIDTHS[at % SKELETON_HEADING_WIDTHS.length]} />
    </Text>
  ) : undefined;
  return (
    <SectionFrame head={head}>
      <RowsSkeleton rows={shape.rows} />
    </SectionFrame>
  );
}

/** Placeholder sections standing in a page's while `label` is read, one to each shape in `sections`, a section's gap apart. */
export function SettingsSectionsSkeleton({
  label,
  sections,
}: {
  /** What is being read, said to a reader: "Reading the integrations". */
  label: string;
  /** The sections likely to land, each in its shape, from what the page's sections are drawn from. */
  sections: readonly SettingsSectionSkeletonShape[];
}): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <div className="luke-settings-skeleton">
        {sections.map((shape, at) => (
          <SectionSkeleton key={at} at={at} shape={shape} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Whether the children stand in the card, or bare under the heading for one control that is its own frame. */
export const SETTINGS_SECTION_FRAME = {
  CARD: "card",
  NONE: "none",
} as const;

export type SettingsSectionFrame =
  (typeof SETTINGS_SECTION_FRAME)[keyof typeof SETTINGS_SECTION_FRAME];

/**
 * A section's frame: its head where it has one, over the card of its rows or
 * the one control that is its own frame, the region named by `labelledBy`
 * where it is headed. The section and its placeholder both draw through it.
 */
function SectionFrame({
  head,
  labelledBy,
  anchor,
  frame = SETTINGS_SECTION_FRAME.CARD,
  children,
}: {
  head: ReactNode;
  labelledBy?: string | undefined;
  anchor?: string | undefined;
  frame?: SettingsSectionFrame;
  children: ReactNode;
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null);
  return (
    <section
      className="luke-settings-section flex min-w-0 flex-col gap-luke-8"
      aria-labelledby={labelledBy}
      {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
    >
      {head === undefined ? null : (
        <div className="luke-settings-section-head px-luke-2">{head}</div>
      )}
      {frame === SETTINGS_SECTION_FRAME.CARD ? (
        <RevealArea root={card}>
          <div
            ref={card}
            className="luke-settings-section-card flex min-w-0 flex-col rounded-control border border-border bg-surface"
            {...revealArea()}
          >
            {children}
          </div>
        </RevealArea>
      ) : (
        children
      )}
    </section>
  );
}

/** A card of `children`, one row or line each, under `title` when there is one. */
export function SettingsSection({
  title,
  anchor,
  frame = SETTINGS_SECTION_FRAME.CARD,
  children,
}: {
  /** The group's name, or nothing when the page's title already names it. */
  title?: ReactNode;
  /** The id a Settings link or a search result lands on, worn by the whole section. */
  anchor?: string | undefined;
  /** The card around the children, or none for one control that draws its own frame. */
  frame?: SettingsSectionFrame;
  /** The rows, each drawn edge to edge with a rule above every one but the first. */
  children: ReactNode;
}): React.JSX.Element {
  const headingId = useId();
  const headed = title !== undefined && title !== null && title !== false && title !== "";
  return (
    <SectionFrame
      head={
        headed ? (
          <Text
            variant={TEXT_VARIANT.SECTION}
            tone={TEXT_TONE.MUTED}
            as={TEXT_ELEMENT.H2}
            id={headingId}
          >
            {title}
          </Text>
        ) : undefined
      }
      labelledBy={headed ? headingId : undefined}
      anchor={anchor}
      frame={frame}
    >
      {children}
    </SectionFrame>
  );
}
