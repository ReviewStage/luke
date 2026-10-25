import {
  Card,
  CardPress,
  GAP,
  List,
  ListRow,
  SelectionBar,
  SelectionRegion,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * selection.tsx -- a list whose rows are chosen at once: ⌘-click one in or
 * out, ⇧-click a run, ⇧↑↓ grow the run, ⌘A every row, Esc none, a plain
 * click still opening its row; one row unavailable, which nothing chooses;
 * and the bar over it while any is chosen, its count, its acts, and Clear.
 * Then cards of the app's own under two heads, chosen the same way across
 * both in one region.
 */

const TASKS = [
  { id: "sign-in", title: "Fix the sign-in loop", status: "Working" },
  { id: "release", title: "Ship the spring release", status: "Ready" },
  { id: "inbox", title: "Move the Inbox to one list", status: "Ready" },
  { id: "workers", title: "Name the workers", status: "Done" },
  { id: "deleting", title: "Old onboarding notes", status: "Deleting" },
  { id: "folds", title: "Remember the chat rail's folds", status: "Ready" },
] as const;

const UNAVAILABLE = "deleting";

const SECTIONS = ["Today", "This week", "Later"] as const;

function ChoosingTasks(): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["release", "inbox"]));
  const [open, setOpen] = useState<string | undefined>(undefined);
  const clear = () => setSelected(new Set());
  return (
    <div className="catalog-column">
      <SelectionBar
        count={selected.size}
        onClear={clear}
        controls="selection-tasks-list"
        acts={[
          { label: "Mark done", icon: <GLYPH.DONE />, onAct: clear },
          {
            label: "Move to section",
            icon: <GLYPH.MOVE />,
            menu: [SECTIONS.map((section) => ({ label: section, onSelect: clear }))],
          },
        ]}
      />
      <List id="selection-tasks-list" label="Tasks" selection={{ selected, onChange: setSelected }}>
        {TASKS.map((task) => (
          <ListRow
            key={task.id}
            selectKey={task.id}
            leading={<GLYPH.TASK />}
            title={open === task.id ? `${task.title} (open)` : task.title}
            meta={task.status}
            disabled={task.id === UNAVAILABLE}
            onPress={() => setOpen(task.id)}
          />
        ))}
      </List>
    </div>
  );
}

/** The cards of the region, under the head each stands under. */
const GROUPS = [
  { head: "Working", tasks: TASKS.slice(0, 2) },
  { head: "Ready", tasks: TASKS.slice(2) },
] as const;

function ChoosingCards(): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["sign-in", "inbox"]));
  const [open, setOpen] = useState<string | undefined>(undefined);
  const clear = () => setSelected(new Set());
  return (
    <div className="catalog-column">
      <SelectionBar
        count={selected.size}
        onClear={clear}
        controls="selection-cards-region"
        acts={[{ label: "Mark done", icon: <GLYPH.DONE />, onAct: clear }]}
      />
      <SelectionRegion id="selection-cards-region" selection={{ selected, onChange: setSelected }}>
        {GROUPS.map((group) => (
          <Stack key={group.head} gap={GAP.TIGHT}>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {group.head}
            </Text>
            {group.tasks.map((task) => (
              <Card key={task.id}>
                <CardPress
                  selectKey={task.id}
                  disabled={task.id === UNAVAILABLE}
                  onPress={() => setOpen(task.id)}
                >
                  <Text>{open === task.id ? `${task.title} (open)` : task.title}</Text>
                </CardPress>
              </Card>
            ))}
          </Stack>
        ))}
      </SelectionRegion>
    </div>
  );
}

function Selection(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="selection-tasks" title="Rows chosen with ⌘ and ⇧, and the bar over them">
        <ChoosingTasks />
      </CatalogSection>
      <CatalogSection id="selection-cards" title="Cards of the app's own, chosen across groups">
        <ChoosingCards />
      </CatalogSection>
    </>
  );
}

export const SELECTION_EXAMPLE: Example = {
  id: "selection",
  title: "Selection",
  Render: Selection,
};
