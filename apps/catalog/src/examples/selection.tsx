import {
  Card,
  CardPress,
  Checkbox,
  GAP,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  List,
  ListRow,
  SELECT_BOX_PLACE,
  SelectionBar,
  SelectionRegion,
  SelectionToolbar,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Toolbar,
  UnreadMark,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * selection.tsx -- a list whose rows are chosen at once: ⌘-click one in or
 * out, ⇧-click a run, ⇧↑↓ grow the run, ⌘A every row, Esc none, a plain
 * click still opening its row; one row unavailable, which nothing chooses;
 * and the bar over it while any is chosen, its count, its acts, and Clear.
 * Then cards of the app's own under two heads, chosen the same way across
 * both in one region, each with the box at its start that the pointer
 * chooses it by, shown under the pointer and on every card while any is
 * chosen, and X choosing the card in hand. Last, a list of mail whose
 * head says how many are chosen in its name's place, led by a box choosing
 * every row or none, its acts as glyphs, each row's box coming in over its
 * unread dot under the pointer, as the Inbox's list draws it.
 */

const TASKS = [
  { id: "sign-in", title: "Fix the sign-in loop", status: "Working" },
  { id: "release", title: "Ship the spring release", status: "Ready" },
  { id: "inbox", title: "Move the Inbox to one list", status: "Ready" },
  { id: "workers", title: "Name the workers", status: "Done" },
  { id: "deleting", title: "Old onboarding notes", status: "Deleting" },
  { id: "folds", title: "Remember the Inbox's folds", status: "Ready" },
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
              <Card key={task.id} className="ps-select-gutter">
                <CardPress
                  selectKey={task.id}
                  selectBox={SELECT_BOX_PLACE.GUTTER}
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

const MAIL = [
  { id: "threshold", task: "Billing alerts", title: "Alert at 80%?", unread: true },
  { id: "expiry", task: "Team invites", title: "Expire after 7 days?", unread: false },
  { id: "retry", task: "Billing alerts", title: "How is a failed email retried?", unread: true },
] as const;

function ChoosingMail(): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["expiry"]));
  const clear = () => setSelected(new Set());
  const count = selected.size;
  return (
    <div className="catalog-column">
      <Toolbar
        lead={
          count === 0 ? null : (
            <Checkbox
              label="Select all"
              checked={count === MAIL.length}
              mixed={count < MAIL.length}
              onChange={(all) => setSelected(new Set(all ? MAIL.map((item) => item.id) : []))}
            />
          )
        }
        title={count === 0 ? "Inbox" : `${count} selected`}
        titleReplayUnmasked
        actions={
          <SelectionToolbar
            count={count}
            onClear={clear}
            controls="selection-mail-list"
            acts={[
              { label: "Mark as read", icon: <GLYPH.DONE />, onAct: clear },
              {
                label: "Remind me",
                icon: <GLYPH.TIME />,
                menu: [[{ label: "Tomorrow", onSelect: clear }]],
              },
            ]}
          />
        }
      />
      <List id="selection-mail-list" label="Inbox" selection={{ selected, onChange: setSelected }}>
        {MAIL.map((item) => (
          <ListRow
            key={item.id}
            selectKey={item.id}
            selectBox
            leading={<UnreadMark unread={item.unread} />}
            lead={{ icon: <GLYPH.TASK />, label: item.task }}
            leadAt={LIST_ROW_LEAD.ABOVE}
            title={item.title}
            description="The agent asks before it goes on."
            unread={item.unread}
            meta="3m"
            metaAt={LIST_ROW_META.TITLE}
            onPress={() => undefined}
          />
        ))}
      </List>
    </div>
  );
}

function Selection(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="selection-tasks" title="Rows chosen with ⌘ and ⇧, and the bar over them">
        <ChoosingTasks />
      </CatalogSection>
      <CatalogSection
        id="selection-cards"
        title="Cards of the app's own, chosen across groups by their boxes, ⌘, ⇧, and X"
      >
        <ChoosingCards />
      </CatalogSection>
      <CatalogSection
        id="selection-mail"
        title="Mail chosen by the box over its dot, its head saying how many with its acts as glyphs"
      >
        <ChoosingMail />
      </CatalogSection>
    </>
  );
}

export const SELECTION_EXAMPLE: Example = {
  id: "selection",
  title: "Selection",
  Render: Selection,
};
