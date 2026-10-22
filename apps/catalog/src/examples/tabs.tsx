import {
  AlertIcon,
  BoardIcon,
  CodeIcon,
  DocumentIcon,
  FolderIcon,
  TABS_GROUND,
  Tab,
  TabCard,
  TabCards,
  Tabs,
  TEXT_TONE,
  TerminalIcon,
  Text,
  UserIcon,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * tabs.tsx -- a strip of tabs to choose, close, and drag along, the chosen
 * one raised: one with a count after its name, one marked failed, one that
 * something arrived on, a preview, and one anchored at the start for good;
 * the same strip in a narrow row, where it scrolls along with the chosen tab
 * pinned; a lone quiet tab; and a switcher's row of recent cards, a still
 * and glyphs, one chosen and the screen here dimmed.
 */

/** One tab of the example strips: its key, glyph, name, and what it wears. */
interface SampleTab {
  readonly id: string;
  readonly icon: React.JSX.Element;
  readonly label: string;
  readonly detail?: string;
  readonly failed?: boolean;
  readonly unread?: boolean;
  readonly preview?: boolean;
  readonly anchored?: boolean;
}

const SAMPLE_TABS: readonly SampleTab[] = [
  { id: "plan", icon: <DocumentIcon />, label: "Plan", anchored: true },
  { id: "inbox", icon: <FolderIcon />, label: "Inbox", detail: "3" },
  { id: "agent", icon: <UserIcon />, label: "Refresh tokens before they expire" },
  { id: "failed", icon: <UserIcon />, label: "Migrate the sessions table", failed: true },
  { id: "changes", icon: <CodeIcon />, label: "Changes", unread: true },
  { id: "terminal", icon: <TerminalIcon />, label: "Terminal" },
  { id: "board", icon: <BoardIcon />, label: "token-refresh.ts", preview: true },
];

/** The ids of every tab but the anchored ones, in their order now. */
function movedIds(tabs: readonly SampleTab[], from: number, to: number): SampleTab[] {
  const anchored = tabs.filter((tab) => tab.anchored === true);
  const moving = tabs.filter((tab) => tab.anchored !== true);
  const [taken] = moving.splice(from, 1);
  if (taken !== undefined) moving.splice(to, 0, taken);
  return [...anchored, ...moving];
}

/** A strip of the sample tabs, chosen, closed, kept, and moved for real. */
function Strip({ narrow = false }: { narrow?: boolean }): React.JSX.Element {
  const [tabs, setTabs] = useState<readonly SampleTab[]>(SAMPLE_TABS);
  const [chosen, setChosen] = useState("agent");
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className={narrow ? "catalog-tab-row catalog-tab-row-narrow" : "catalog-tab-row"}>
      <Tabs
        label={narrow ? "Narrow tabs" : "Tabs"}
        ground={TABS_GROUND.GROUND}
        onMove={(from, to) => setTabs((was) => movedIds(was, from, to))}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            icon={tab.icon}
            label={tab.label}
            detail={tab.detail}
            endMark={
              tab.failed === true ? (
                <span className="catalog-end-mark" role="img" aria-label="Failed">
                  <AlertIcon />
                </span>
              ) : undefined
            }
            unread={tab.unread === true && !seen.has(tab.id)}
            preview={tab.preview === true}
            anchored={tab.anchored === true}
            selected={tab.id === chosen}
            onSelect={() => {
              setChosen(tab.id);
              setSeen((was) => new Set([...was, tab.id]));
            }}
            onKeep={() =>
              setTabs((was) =>
                was.map((each) => (each.id === tab.id ? { ...each, preview: false } : each)),
              )
            }
            onClose={
              tab.anchored === true
                ? undefined
                : () => {
                    setTabs((was) => was.filter((each) => each.id !== tab.id));
                    if (tab.id === chosen) setChosen("plan");
                  }
            }
          />
        ))}
      </Tabs>
    </div>
  );
}

/** A small picture of a screen, standing in for a switcher's still. */
const STILL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="352" height="220"><rect width="352" height="220" fill="#f4f4f5"/><rect x="16" y="16" width="200" height="14" rx="4" fill="#d4d4d8"/><rect x="16" y="44" width="320" height="8" rx="4" fill="#e4e4e7"/><rect x="16" y="60" width="280" height="8" rx="4" fill="#e4e4e7"/><rect x="16" y="76" width="300" height="8" rx="4" fill="#e4e4e7"/></svg>',
)}`;

/** A switcher's recent screens: the one here dimmed, the one after it chosen. */
function Cards(): React.JSX.Element {
  const [chosen, setChosen] = useState(1);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const cards = [
    { icon: <DocumentIcon />, label: "Fix token refresh", detail: "Plan · Code", still: STILL },
    { icon: <FolderIcon />, label: "Inbox", detail: undefined, still: undefined },
    {
      icon: <DocumentIcon />,
      label: "Migrate the sessions table",
      detail: "Changes",
      detailIcon: <UserIcon />,
      still: undefined,
    },
  ];
  return (
    <>
      <TabCards label="Recent tabs">
        {cards.map((card, at) => (
          <TabCard
            key={card.label}
            icon={card.icon}
            label={card.label}
            detail={card.detail}
            detailIcon={card.detailIcon}
            still={card.still}
            here={at === 0}
            chosen={at === chosen}
            onPoint={() => setChosen(at)}
            onPick={() => setPicked(card.label)}
          />
        ))}
      </TabCards>
      <Text tone={TEXT_TONE.SUBTLE}>
        {picked === undefined ? "Press a card to pick it." : `Picked ${picked}.`}
      </Text>
    </>
  );
}

function TabsExamples(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="tabs-strip" title="A strip: choose, close, double-click a preview, drag">
        <Strip />
      </CatalogSection>
      <CatalogSection id="tabs-narrow" title="Narrow: the strip scrolls, the chosen tab pinned">
        <Strip narrow />
      </CatalogSection>
      <CatalogSection id="tabs-quiet" title="A lone quiet tab">
        <div className="catalog-tab-row catalog-tab-row-narrow">
          <Tabs label="Lone tab" ground={TABS_GROUND.GROUND}>
            <Tab icon={<DocumentIcon />} label="Plan" selected quiet onSelect={() => undefined} />
          </Tabs>
        </div>
      </CatalogSection>
      <CatalogSection id="tabs-cards" title="A switcher's recent cards">
        <Cards />
      </CatalogSection>
    </>
  );
}

export const TABS_EXAMPLE: Example = {
  id: "tabs",
  title: "Tabs",
  Render: TabsExamples,
};
