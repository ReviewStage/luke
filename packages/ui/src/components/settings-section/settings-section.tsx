import { type ReactNode, useId } from "react";
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
 */

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
  frame = SETTINGS_SECTION_FRAME.CARD,
  children,
}: {
  /** The group's name, or nothing when the page's title already names it. */
  title?: ReactNode;
  /** The card around the children, or none for one control that draws its own frame. */
  frame?: SettingsSectionFrame;
  /** The rows, each drawn edge to edge with a rule above every one but the first. */
  children: ReactNode;
}): React.JSX.Element {
  const headingId = useId();
  const headed = title !== undefined && title !== null && title !== false && title !== "";
  return (
    <section className="luke-settings-section" aria-labelledby={headed ? headingId : undefined}>
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
