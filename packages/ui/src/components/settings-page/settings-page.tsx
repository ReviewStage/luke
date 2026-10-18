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
 * whole page, a quiet reset, ends the title's line flush with the cards'
 * edge, its words rather than its hover's pill standing in the column, and
 * drops below the title when the column is too narrow for both, rather than
 * breaking the title inside a word.
 *
 * A section whose read is still out stands as placeholder rows shaped as
 * its own (`SettingsRowsSkeleton`), and a page that has not yet read what
 * its sections are stands as placeholder sections
 * (`SettingsSectionsSkeleton`), so the page is never blank under its title
 * and what lands takes the place its blocks stood in. An empty state that is the
 * page's whole content fills the room under the title and stands in its
 * middle. Rows scrolled up dissolve into the page's top edge rather than
 * being sliced against it, and a page at rest at its top is left whole.
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
