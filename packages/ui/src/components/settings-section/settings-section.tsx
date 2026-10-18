import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { type ReactNode, useId } from "react";
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
 * whole. Where the card has no rows to draw, it holds a line
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
 */

/** A card's line where its rows would stand: a note's words, in a description's muted words, or a failure (`ErrorState`). */
export function SettingsLine({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="luke-settings-line">{children}</div>;
}

/* ----- Skeletons ----- */

/** How wide each placeholder row's label and description stand, as shares of their lines, so the rows read as settings of their own. */
const SKELETON_ROW_WIDTHS = [
  { label: "34%", description: "62%" },
  { label: "26%", description: "48%" },
  { label: "40%", description: "70%" },
  { label: "30%", description: "56%" },
] as const;

/** How wide a placeholder row's control stands: a short button's, three controls' height across. */
const SKELETON_CONTROL_WIDTH = "calc(3 * var(--luke-control-height))";

/** How wide a placeholder section's heading stands, as a share of its line. */
const SKELETON_HEADING_WIDTHS = ["18%", "24%", "14%"] as const;

/** A placeholder of one row in a row's own boxes: its mark where `marked`, its label and description lines, and a control at its end. */
function RowSkeleton({ at, marked }: { at: number; marked: boolean }): React.JSX.Element {
  const widths = SKELETON_ROW_WIDTHS[at % SKELETON_ROW_WIDTHS.length] ?? SKELETON_ROW_WIDTHS[0];
  return (
    <div className="luke-settings-row" data-density="card" data-indent="none">
      <div className="luke-settings-row-body">
        <div className="luke-settings-row-line">
          <div className="luke-settings-row-subject">
            {marked ? (
              <div className="luke-settings-row-leading">
                <Skeleton
                  shape={SKELETON_SHAPE.CIRCLE}
                  width="var(--luke-settings-row-mark-size)"
                />
              </div>
            ) : null}
            <div className="luke-settings-row-copy">
              <span className="luke-settings-row-label">
                <Skeleton width={widths.label} />
              </span>
              <span className="luke-settings-row-description">
                <Skeleton width={widths.description} />
              </span>
            </div>
          </div>
          <div className="luke-settings-row-controls">
            <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_CONTROL_WIDTH} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** `rows` placeholder rows, ruled one from the next as a card's rows are. */
function RowsSkeleton({ rows, marked }: { rows: number; marked: boolean }): React.JSX.Element {
  return (
    <div className="luke-settings-skeleton-rows">
      {Array.from({ length: Math.max(1, rows) }, (_, at) => (
        // oxlint-disable-next-line react/no-array-index-key -- a placeholder's rows have nothing but their place.
        <RowSkeleton key={at} at={at} marked={marked} />
      ))}
    </div>
  );
}

/** Placeholder rows standing in a card's rows while `label` is read, each leading with a mark's circle where `marked`. */
export function SettingsRowsSkeleton({
  label,
  rows = 1,
  marked = false,
}: {
  /** What is being read, said to a reader: "Loading the members". */
  label: string;
  /** How many rows stand, as many as are likely to land; one where none is named. */
  rows?: number;
  /** Whether the rows lead with a face or a mark, as the rows that land will. */
  marked?: boolean;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <RowsSkeleton rows={rows} marked={marked} />
    </SkeletonRegion>
  );
}

/**
 * Placeholder sections standing in a page's while `label` is read: for each
 * count in `sections`, a heading's block over a card of that many rows, a
 * section's gap apart, so the page lands where the blocks stood.
 */
export function SettingsSectionsSkeleton({
  label,
  sections,
  marked = false,
}: {
  /** What is being read, said to a reader: "Loading the integrations". */
  label: string;
  /** How many rows each section's card holds, one section to a count. */
  sections: readonly number[];
  /** Whether the rows lead with a face or a mark, as the rows that land will. */
  marked?: boolean;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <div className="luke-settings-skeleton">
        {sections.map((rows, at) => (
          // oxlint-disable-next-line react/no-array-index-key -- a placeholder's sections have nothing but their place.
          <div key={at} className="luke-settings-section">
            <div className="luke-settings-section-head">
              <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.DIV}>
                <Skeleton width={SKELETON_HEADING_WIDTHS[at % SKELETON_HEADING_WIDTHS.length]} />
              </Text>
            </div>
            <div className="luke-settings-section-card">
              <RowsSkeleton rows={rows} marked={marked} />
            </div>
          </div>
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
    <section
      className="luke-settings-section"
      aria-labelledby={headed ? headingId : undefined}
      {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
    >
      {headed ? (
        <div className="luke-settings-section-head">
          <Text
            variant={TEXT_VARIANT.SECTION}
            tone={TEXT_TONE.MUTED}
            as={TEXT_ELEMENT.H2}
            id={headingId}
          >
            {title}
          </Text>
        </div>
      ) : null}
      {frame === SETTINGS_SECTION_FRAME.CARD ? (
        <div className="luke-settings-section-card">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
