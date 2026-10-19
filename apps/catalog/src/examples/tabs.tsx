import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  CodeIcon,
  CountParts,
  DocumentIcon,
  GAP,
  linesCount,
  Stack,
  TAB_COUNT_TONE,
  TABS_INSET,
  TabCount,
  type TabItem,
  Tabs,
  type TabsInset,
  TEXT_TONE,
  Text,
  UserIcon,
} from "@luke/ui";
import { type ReactNode, useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * tabs.tsx -- a row of tabs with glyphs and counts in each tone, one set in
 * to a reading measure, a plain row of names, and a row too narrow for its
 * names.
 */

const VIEW = {
  CONVERSATION: "conversation",
  CHECKS: "checks",
  FILES: "files",
} as const;
type View = (typeof VIEW)[keyof typeof VIEW];

/** A pull request's three views, each counting what it holds. */
function viewsCounting(checks: ReactNode): readonly TabItem<View>[] {
  return [
    { value: VIEW.CONVERSATION, icon: <UserIcon />, label: "Conversation", count: "12" },
    { value: VIEW.CHECKS, icon: <CheckIcon />, label: "Checks", count: checks },
    {
      value: VIEW.FILES,
      icon: <CodeIcon />,
      label: "Files changed",
      count: <CountParts parts={linesCount(128, 42)} />,
    },
  ];
}

const PLAIN: readonly TabItem<View>[] = [
  { value: VIEW.CONVERSATION, icon: <DocumentIcon />, label: "Overview" },
  { value: VIEW.CHECKS, label: "Activity" },
  { value: VIEW.FILES, label: "Settings" },
];

/** A row the example holds, over a panel for each of its views. */
function Held({
  tabs,
  start,
  inset,
}: {
  tabs: readonly TabItem<View>[];
  start: View;
  inset?: TabsInset | undefined;
}): React.JSX.Element {
  const [view, setView] = useState<View>(start);
  const id = useId();
  const ids = (each: View) => ({ tab: `${id}-${each}-tab`, panel: `${id}-${each}-panel` });
  return (
    <Stack gap={GAP.CONTROL}>
      <Tabs<View>
        label="Pull request"
        tabs={tabs}
        value={view}
        onChange={setView}
        ids={ids}
        inset={inset}
      />
      {tabs.map((tab) => (
        <div
          key={tab.value}
          role="tabpanel"
          id={ids(tab.value).panel}
          aria-labelledby={ids(tab.value).tab}
          hidden={tab.value !== view}
        >
          <Text tone={TEXT_TONE.MUTED}>{`${tab.label} view`}</Text>
        </div>
      ))}
    </Stack>
  );
}

function TabsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="tabs-counts" title="Glyphs and counts">
        <Stack gap={GAP.SECTION}>
          <Held
            start={VIEW.CHECKS}
            tabs={viewsCounting(
              <TabCount tone={TAB_COUNT_TONE.DANGER} glyph={<CloseIcon />} glyphLabel="failing">
                2
              </TabCount>,
            )}
          />
          <Held
            start={VIEW.CONVERSATION}
            tabs={viewsCounting(
              <TabCount tone={TAB_COUNT_TONE.ATTENTION} glyph={<AlertIcon />} glyphLabel="running">
                3
              </TabCount>,
            )}
          />
          <Held
            start={VIEW.FILES}
            tabs={viewsCounting(
              <TabCount tone={TAB_COUNT_TONE.COMPLETE} glyph={<CheckIcon />} glyphLabel="passing">
                9
              </TabCount>,
            )}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="tabs-reading" title="Set in to a reading measure">
        <Held start={VIEW.CONVERSATION} tabs={viewsCounting("4")} inset={TABS_INSET.READING} />
      </CatalogSection>
      <CatalogSection id="tabs-plain" title="Names alone">
        <Held start={VIEW.CONVERSATION} tabs={PLAIN} />
      </CatalogSection>
      <CatalogSection id="tabs-narrow" title="Narrow column">
        <div className="catalog-narrow">
          <Held start={VIEW.CHECKS} tabs={viewsCounting("4")} />
        </div>
      </CatalogSection>
    </>
  );
}

export const TABS_EXAMPLE: Example = {
  id: "tabs",
  title: "Tabs",
  Render: TabsExample,
};
