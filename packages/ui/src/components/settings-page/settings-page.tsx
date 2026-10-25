import { type ReactNode, useRef } from "react";
import { useHeadingAway } from "../page-header/heading-away.js";
import { PAGE_HEADER_END, PageHeader } from "../page-header/page-header.js";
import { RevealArea, revealArea } from "../reveal/reveal.js";
import {
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
} from "../settings-section/settings-section.js";
import { Skeleton } from "../skeleton/skeleton.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK, Toolbar, type ToolbarLook } from "../toolbar/toolbar.js";

/**
 * settings-page.tsx -- a settings page: its title and what acts on the whole page above its sections, in a column that scrolls.
 *
 * The page stands under the window's bar (`Toolbar`), which leads with what
 * its caller hands it (a way back) and is still above the page's scroll;
 * once the header has scrolled away, the bar picks up its name
 * (`useHeadingAway`), so the reader never loses which page they are on.
 * Under it the page is its own scroller and owns everything between its
 * edges and its sections: the inset around the column, which narrows when the page
 * does, the measure the column reads at, the title's place and size, the
 * room under the head, and the room between one section (`SettingsSection`)
 * and the next. Its column of sections is a reveal area (`RevealArea`), so
 * as a setting's rows unroll in (`Reveal`), the sections under them glide
 * down with the rows. A section owns its heading and card, and a row its padding,
 * so a caller sets no length anywhere on a settings page. The page heads
 * itself with a document's header (`PageHeader`): the title is the page's
 * `h1`, which each section's `h2` heads a part of. What acts on the whole
 * page, a quiet reset, ends the title's line flush with the cards' edge,
 * and one quiet line under the title says what holds for all of it, where
 * its settings are kept,
 * its words rather than its hover's pill standing in the column, and drops
 * below the title when the column is too narrow for both, rather than
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
 * On a phone (`TOOLBAR_LOOK.PHONE`) the bar is a phone's header: its way back
 * in one corner, what acts on the whole page in the other (a ⋯ the caller
 * hands as `actions`), and the name it picks up centred between them; the
 * header in the page keeps the title alone.
 *
 * It is drawn in Tailwind utilities over the theme with no shadcn/ui base,
 * since a page's frame, scroller, and column are a layout shadcn has no
 * component for. The top's fade on its scroll timeline, an empty state's
 * room, and the column's narrow inset stay in `settings-page.css`.
 */

/**
 * How wide a placeholder title stands: a short page name's, five controls'
 * height across. Note that it is a length rather than a share, because the
 * title's line is only as wide as what it holds.
 */
const SKELETON_TITLE_WIDTH = "calc(5 * var(--luke-control-height))";

/** A column of `children`, one section each, under `title` and its `description`, beside them `actions`, or on a phone under a bar ending with them. */
export function SettingsPage({
  title,
  description,
  actions,
  lead,
  look = TOOLBAR_LOOK.WINDOW,
  children,
}: {
  /** The page's name, its `h1`. */
  title: ReactNode;
  /** One quiet line under the title that holds for the whole page: where its settings are kept. */
  description?: ReactNode;
  /** What acts on the whole page, at the end of the title's line, or on a phone at the end of the bar. */
  actions?: ReactNode;
  /** What leads the bar above the page: a way back, where the window gives one. */
  lead?: ReactNode;
  /** How the bar lays its slots: the window's, or a phone's one control a corner. */
  look?: ToolbarLook | undefined;
  /** The sections, a section's gap apart. */
  children: ReactNode;
}): React.JSX.Element {
  const page = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const sections = useRef<HTMLDivElement>(null);
  const named = useHeadingAway(page, head);
  const phone = look === TOOLBAR_LOOK.PHONE;
  return (
    <div className="luke-settings-page-frame flex h-full min-h-0 min-w-0 grow basis-0 flex-col">
      <Toolbar
        lead={lead}
        pickUp={{ name: named.name, shown: named.away }}
        {...(phone
          ? {
              look,
              place: "settings-page",
              start: TOOLBAR_INSET.COLUMN,
              end: TOOLBAR_INSET.COLUMN,
              actions,
            }
          : {})}
      />
      <div
        ref={page}
        className="luke-settings-page @container/luke-settings-page box-border min-h-0 min-w-0 grow basis-0 overflow-x-clip overflow-y-auto overscroll-contain scroll-py-page-inset [scrollbar-gutter:stable]"
      >
        <div className="luke-settings-page-column mx-auto">
          <div ref={head} className="luke-settings-page-head mb-luke-24">
            <PageHeader
              title={title}
              description={description}
              actions={phone ? undefined : actions}
              end={PAGE_HEADER_END.WORDS}
            />
          </div>
          <RevealArea root={sections}>
            <div
              ref={sections}
              className="luke-settings-page-sections flex min-w-0 flex-col gap-page-section-gap"
              {...revealArea()}
            >
              {children}
            </div>
          </RevealArea>
        </div>
      </div>
    </div>
  );
}

/** A page of placeholders while `label` is read, drawn by the page itself: a block for its title over sections of `sections`' shapes. */
export function SettingsPageSkeleton({
  label,
  lead,
  look,
  sections,
}: {
  /** What is being read, said to a reader: "Reading Settings". */
  label: string;
  /** What leads the bar above the page, as `SettingsPage` takes it. */
  lead?: ReactNode;
  /** How the bar lays its slots, as `SettingsPage` takes it. */
  look?: ToolbarLook | undefined;
  /** The sections likely to land, each in its shape. */
  sections: readonly SettingsSectionSkeletonShape[];
}): React.JSX.Element {
  return (
    <SettingsPage title={<Skeleton width={SKELETON_TITLE_WIDTH} />} lead={lead} look={look}>
      <SettingsSectionsSkeleton label={label} sections={sections} />
    </SettingsPage>
  );
}
