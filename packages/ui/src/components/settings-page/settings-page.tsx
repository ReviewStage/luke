import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * settings-page.tsx -- a settings page: its title and what acts on the whole page above its sections, in a column that scrolls.
 *
 * The page is its own scroller and owns everything between its edges and
 * its sections: the inset around the column, which narrows when the page
 * does, the measure the column reads at, the title's place and size, the
 * room under the head, and the room between one section (`SettingsSection`)
 * and the next. A section owns its heading and card, and a row its padding,
 * so a caller sets no length anywhere on a settings page. The title is the
 * page's `h1`, which each section's `h2` heads a part of. What acts on the
 * whole page, a reset, ends the title's line and drops below the title when
 * the column is too narrow for both, rather than breaking the title inside
 * a word.
 */

/** A column of `children`, one section each, under `title` and beside it `actions`. */
export function SettingsPage({
  title,
  actions,
  children,
}: {
  /** The page's name, its `h1`. */
  title: ReactNode;
  /** What acts on the whole page, at the end of the title's line. */
  actions?: ReactNode;
  /** The sections, a section's gap apart. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-settings-page">
      <div className="luke-settings-page-column">
        <header className="luke-settings-page-head">
          <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H1}>
            {title}
          </Text>
          {actions === undefined ? null : (
            <div className="luke-settings-page-actions">{actions}</div>
          )}
        </header>
        <div className="luke-settings-page-sections">{children}</div>
      </div>
    </div>
  );
}
