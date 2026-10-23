import { type ReactNode, useRef } from "react";
import { RevealArea, revealArea } from "../reveal/reveal.js";
import {
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
} from "../settings-section/settings-section.js";
import { Skeleton } from "../skeleton/skeleton.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * settings-page.tsx -- a settings page: its title and what acts on the whole page above its sections, in a column that scrolls.
 *
 * The page is its own scroller and owns everything between its edges and
 * its sections: the inset around the column, which narrows when the page
 * does, the measure the column reads at, the title's place and size, the
 * room under the head, and the room between one section (`SettingsSection`)
 * and the next. Its column of sections is a reveal area (`RevealArea`), so
 * as a setting's rows unroll in (`Reveal`), the sections under them glide
 * down with the rows. A section owns its heading and card, and a row its padding,
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
 *
 * A page whose name is not yet known, Settings while its chunk loads, stands
 * as a whole page of placeholders (`SettingsPageSkeleton`): the page itself,
 * a block for its title, and its sections' blocks.
 *
 * A page under a bar that names it, a phone's header, draws no head of its
 * own (`SETTINGS_PAGE_TITLE.IN_BAR`): the bar holds the title and what acts
 * on the page, and the sections start at the column's top.
 */

/** Where a page's title stands: at the head of its column, or in a bar above the page that names it. */
export const SETTINGS_PAGE_TITLE = {
  IN_PAGE: "in-page",
  IN_BAR: "in-bar",
} as const;

export type SettingsPageTitle = (typeof SETTINGS_PAGE_TITLE)[keyof typeof SETTINGS_PAGE_TITLE];

/**
 * How wide a placeholder title stands: a short page name's, five controls'
 * height across. Note that it is a length rather than a share, because the
 * title's line is only as wide as what it holds.
 */
const SKELETON_TITLE_WIDTH = "calc(5 * var(--luke-control-height))";

/** A column of `children`, one section each, under `title` and beside it `actions`, or under the bar that names the page where `place` says so. */
export function SettingsPage({
  title,
  place = SETTINGS_PAGE_TITLE.IN_PAGE,
  actions,
  children,
}: {
  /** The page's name, its `h1`. */
  title: ReactNode;
  /** Where the title stands; in a bar, the page draws neither it nor `actions`, which the bar holds. */
  place?: SettingsPageTitle | undefined;
  /** What acts on the whole page, at the end of the title's line. */
  actions?: ReactNode;
  /** The sections, a section's gap apart. */
  children: ReactNode;
}): React.JSX.Element {
  const sections = useRef<HTMLDivElement>(null);
  return (
    <div className="luke-settings-page">
      <div className="luke-settings-page-column">
        {place === SETTINGS_PAGE_TITLE.IN_BAR ? null : (
          <header className="luke-settings-page-head">
            <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H1}>
              {title}
            </Text>
            {actions === undefined ? null : (
              <div className="luke-settings-page-actions">{actions}</div>
            )}
          </header>
        )}
        <RevealArea root={sections}>
          <div ref={sections} className="luke-settings-page-sections" {...revealArea()}>
            {children}
          </div>
        </RevealArea>
      </div>
    </div>
  );
}

/** A page of placeholders while `label` is read, drawn by the page itself: a block for its title, where the page draws one, over sections of `sections`' shapes. */
export function SettingsPageSkeleton({
  label,
  place,
  sections,
}: {
  /** What is being read, said to a reader: "Loading Settings". */
  label: string;
  /** Where the loaded page's title will stand, as `SettingsPage` takes it. */
  place?: SettingsPageTitle | undefined;
  /** The sections likely to land, each in its shape. */
  sections: readonly SettingsSectionSkeletonShape[];
}): React.JSX.Element {
  return (
    <SettingsPage title={<Skeleton width={SKELETON_TITLE_WIDTH} />} place={place}>
      <SettingsSectionsSkeleton label={label} sections={sections} />
    </SettingsPage>
  );
}
