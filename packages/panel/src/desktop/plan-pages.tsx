import type { PageLine, PagePlace } from "@repo/features/page-wire";
import {
  GROUP_HEADING,
  GroupHeader,
  LIST_DENSITY,
  List,
  ListRow,
  RowHint,
  RowHintOptions,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { SUMMARY_GLYPH } from "./agent-archive.js";
import { tabCard } from "./tab-card.js";

/**
 * plan-pages.tsx -- the open task's pages in its Overview, under the agents, as a group: one dense row each, a page's glyph and its title, hanging the card its tab hangs.
 *
 * The pages are the task's, not any one agent's, so they stand in the
 * Overview beside its agents, the same shape every group of the head takes,
 * a `GroupHeader` over a dense `List`, Pages and how many, which folds them.
 * Each row wears its Page tab's look (`tab-look.tsx`) and hangs that tab's
 * card, a preview of the page's newest version (`tab-card.tsx`), so the row
 * and the tab never say different things. A row's press is the page's to
 * answer (`onOpenPage`): the task's page opens it in the side panel, as the
 * panel's "+" row for it does. A task with no page draws no group.
 */

/** What the group is called, and its list for a reader moving between lists. */
const PAGES_LIST = "Pages";

/** What the group's count counts, said to a reader beside the figure. */
const PAGES_NOUN = { one: "page", many: "pages" } as const;

/** One page's row: its tab's glyph and title, and the card its tab hangs. */
function PlanPageRow({
  page,
  place,
  onOpen,
}: {
  page: PageLine;
  place: PagePlace;
  onOpen: () => void;
}): React.JSX.Element {
  const { icon, label } = tabLook({ kind: TAB_KIND.PAGE, title: page.title });
  const card = tabCard({ kind: TAB_KIND.PAGE, place, pageId: page.id, name: page.title, page });
  return (
    <RowHintOptions card={card}>
      <ListRow
        motionKey={page.id}
        leading={<span className={SUMMARY_GLYPH}>{icon}</span>}
        title={label}
        titleReplayMasked
        hint={card === null ? undefined : { Hint: RowHint, label }}
        onPress={onOpen}
      />
    </RowHintOptions>
  );
}

/**
 * The task's pages in its Overview, under their group's head, in the order
 * the task holds them; nothing while they are read or for a task with none.
 * A row's press is handed to `onOpenPage` by its page's id.
 */
export function PlanPages({
  pages,
  place,
  onOpenPage,
}: {
  /** The task's pages, each by its newest version; none while they are read. */
  pages: readonly PageLine[] | undefined;
  /** The task the pages stand on, whose pages a row's card previews. */
  place: PagePlace;
  onOpenPage: (pageId: string) => void;
}): React.JSX.Element | null {
  if (pages === undefined || pages.length === 0) return null;
  return (
    // Note that the group is pulled out by a row's inset on each side, as the agents' is, so its marks stand on the title's edge.
    <div className="plan-pages -mx-row-inset mb-block-gap">
      <ReplayUnmask>
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          label={PAGES_LIST}
          count={{
            value: pages.length,
            noun: pages.length === 1 ? PAGES_NOUN.one : PAGES_NOUN.many,
          }}
          fold={{ defaultOpen: true }}
        >
          <List label={PAGES_LIST} density={LIST_DENSITY.DENSE} moves>
            {pages.map((page) => (
              <PlanPageRow
                key={page.id}
                page={page}
                place={place}
                onOpen={() => onOpenPage(page.id)}
              />
            ))}
          </List>
        </GroupHeader>
      </ReplayUnmask>
    </div>
  );
}
