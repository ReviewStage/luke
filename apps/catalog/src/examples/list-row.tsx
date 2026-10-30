import {
  IconButton,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  LIST_ROW_TITLE_LINES,
  LIST_VARIANT,
  List,
  type ListDensity,
  ListRow,
  ListRowCount,
  type MenuEntry,
  MoreButton,
  PencilIcon,
  Switch,
  TrashIcon,
  UserIcon,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * list-row.tsx -- a list's rows with their metadata and acts lined up, the
 * one open now, unread rows, what a row belongs to on a line of its own,
 * rows that open nothing, rows in a card,
 * a row a finger's height on a coarse pointer, compact and dense, rows whose
 * acts show on hover, rows that go deeper, rows nested under a row that
 * folds them, rows whose menu their ⋯, a right-click, and the menu key
 * open, a rail's rows counting what each holds on their last line, and
 * long words in a narrow column.
 */

const MEMBERS = [
  { id: "ada", name: "Ada Lovelace", email: "ada@example.com", role: "Owner" },
  { id: "grace", name: "Grace Hopper", email: "grace@example.com", role: "Admin" },
  { id: "alan", name: "Alan Turing", email: "alan@example.com", role: "Member" },
] as const;

function Members(): React.JSX.Element {
  const [open, setOpen] = useState<string>("grace");
  return (
    <List label="Members">
      {MEMBERS.map((member) => (
        <ListRow
          key={member.id}
          leading={<UserIcon />}
          title={member.name}
          description={member.email}
          meta={member.role}
          current={open === member.id ? LIST_ROW_CURRENT.ITEM : undefined}
          onPress={() => setOpen(member.id)}
          actions={<MoreButton thing={member.name} />}
        />
      ))}
    </List>
  );
}

const AUTOMATIONS = [
  { id: "sweep", name: "Nightly sweep", trigger: "Every day at 09:00", next: "Tomorrow" },
  { id: "review", name: "Code review", trigger: "When a pull request is opened", next: "On event" },
] as const;

/** Rows edge to edge in a card, each with a switch beside its press. */
function Automations(): React.JSX.Element {
  const [on, setOn] = useState<Record<string, boolean>>({ sweep: true, review: false });
  return (
    <List label="Automations" variant={LIST_VARIANT.CARD}>
      {AUTOMATIONS.map((automation) => (
        <ListRow
          key={automation.id}
          title={automation.name}
          description={automation.trigger}
          meta={on[automation.id] === true ? automation.next : "Off"}
          onPress={() => undefined}
          actions={
            <Switch
              checked={on[automation.id] === true}
              label={`Turn on ${automation.name}`}
              onChange={(checked) => setOn((all) => ({ ...all, [automation.id]: checked }))}
            />
          }
        />
      ))}
    </List>
  );
}

const ignore = (): void => undefined;

/** One task's menu, which its row's ⋯, right-click, and menu key all open. */
function taskMenu(name: string): readonly (readonly MenuEntry[])[] {
  return [
    [{ label: `Rename ${name}`, icon: <PencilIcon />, onSelect: ignore }],
    [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: ignore }],
  ];
}

const TASKS = [
  { id: "sign-in", name: "Fix the sign-in loop", updated: "2h" },
  { id: "release", name: "Ship the spring release", updated: "1d" },
] as const;

/** Rows whose menu is one definition, opened by its ⋯, a right-click, or the menu key. */
function TaskRows({ density }: { density: ListDensity }): React.JSX.Element {
  return (
    <List label="Tasks" density={density}>
      {TASKS.map((task) => (
        <ListRow
          key={task.id}
          title={task.name}
          meta={task.updated}
          onPress={ignore}
          menu={{ thing: "Task", groups: taskMenu(task.name) }}
        />
      ))}
    </List>
  );
}

/** A task and the child tasks nested under it, two levels deep, each level folded until opened. */
const NESTED = [
  { id: "launch", name: "Launch child tasks", parent: undefined, updated: "1h" },
  { id: "schema", name: "Tasks gain a parent", parent: "launch", updated: "2h" },
  { id: "store", name: "Read a task's children", parent: "schema", updated: "3h" },
  { id: "sidebar", name: "Nest them in the sidebar", parent: "launch", updated: "4h" },
] as const;

/** Rows nested under the rows that fold them, opened and folded as their chevrons are pressed. */
function NestedRows(): React.JSX.Element {
  const [opened, setOpened] = useState<readonly string[]>(["launch"]);
  const depthOf = (parent: string | undefined): number =>
    parent === undefined ? 0 : 1 + depthOf(NESTED.find((task) => task.id === parent)?.parent);
  const shown = (parent: string | undefined): boolean =>
    parent === undefined ||
    (opened.includes(parent) && shown(NESTED.find((task) => task.id === parent)?.parent));
  return (
    <List label="Tasks" density={LIST_DENSITY.DENSE}>
      {NESTED.filter((task) => shown(task.parent)).map((task) => {
        const folds = NESTED.some((child) => child.parent === task.id);
        return (
          <ListRow
            key={task.id}
            leading={<GLYPH.TIME />}
            title={task.name}
            meta={
              <>
                {folds ? (
                  <ListRowCount
                    settled={task.id === "launch" ? 1 : 0}
                    total={NESTED.filter((child) => child.parent === task.id).length}
                    label={`Child tasks of ${task.name}, partly finished`}
                  />
                ) : null}
                {task.updated}
              </>
            }
            ink={LIST_ROW_INK.SIDEBAR}
            depth={depthOf(task.parent)}
            fold={
              folds
                ? {
                    open: opened.includes(task.id),
                    onOpenChange: (open) =>
                      setOpened((was) =>
                        open ? [...was, task.id] : was.filter((each) => each !== task.id),
                      ),
                    label: `Child tasks of ${task.name}`,
                  }
                : undefined
            }
            onPress={ignore}
          />
        );
      })}
    </List>
  );
}

/** Rows as an Inbox beside its page draws them: the open one, an unread one, a done one, and a plain one. */
const INBOX_TINT_ROWS = [
  {
    title: "Review the migration plan",
    lead: "Revert agent to the previous layout",
    description: "Merge / Request changes",
    meta: "1h",
    current: true,
    unread: false,
    muted: false,
  },
  {
    title: "Approve the release notes",
    lead: "Board card overflow fix",
    description: "Approve / Request changes",
    meta: "5m",
    current: false,
    unread: true,
    muted: false,
  },
  {
    title: "Pick a name for the workspace",
    lead: "Onboarding copy",
    description: "Merged",
    meta: "2d",
    current: false,
    unread: false,
    muted: true,
  },
  {
    title: "Rename the staging bucket",
    lead: "Infra cleanup",
    description: "Working",
    meta: "3d",
    current: false,
    unread: false,
    muted: false,
  },
] as const;

function ListRows(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="list-row-rows" title="Rows that open, with their acts">
        <div className="catalog-column">
          <Members />
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-unread" title="Unread rows beside read ones">
        <div className="catalog-column">
          <List label="Inbox items">
            <ListRow title="Approve the release notes" meta="5m" unread onPress={() => undefined} />
            <ListRow
              title="Review the migration plan"
              meta="1h"
              current={LIST_ROW_CURRENT.PAGE}
              unread
              onPress={() => undefined}
            />
            <ListRow title="Pick a name for the workspace" meta="2d" onPress={() => undefined} />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection
        id="list-row-lead-above"
        title="What a row belongs to, on a line of its own over its title"
      >
        <div className="catalog-column">
          <List label="Inbox items">
            <ListRow
              title="PR: remove the leftover Call tab code"
              lead={{ icon: <UserIcon />, label: "Revert agent to the previous layout" }}
              leadAt={LIST_ROW_LEAD.ABOVE}
              description="Merge / Request changes"
              meta="1h"
              metaAt={LIST_ROW_META.TITLE}
              ink={LIST_ROW_INK.SIDEBAR}
              unread
              onPress={() => undefined}
              menu={{
                thing: "Inbox item",
                groups: [[{ label: "Mark as read", onSelect: ignore }]],
              }}
            />
            <ListRow
              title="Board cards wrap and hover per part"
              lead={{ icon: <UserIcon />, label: "Board card overflow fix" }}
              leadAt={LIST_ROW_LEAD.ABOVE}
              description="Approve / Request changes"
              meta="2h"
              metaAt={LIST_ROW_META.TITLE}
              ink={LIST_ROW_INK.SIDEBAR}
              onPress={() => undefined}
              menu={{
                thing: "Inbox item",
                groups: [[{ label: "Mark as unread", onSelect: ignore }]],
              }}
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection
        id="list-row-current-tint"
        title="The open row filled with the accent's tint, beside unread, done, and plain rows"
      >
        <div className="catalog-column">
          <List label="Inbox items">
            {INBOX_TINT_ROWS.map((row) => (
              <ListRow
                key={row.title}
                title={row.title}
                lead={{ icon: <UserIcon />, label: row.lead }}
                leadAt={LIST_ROW_LEAD.ABOVE}
                description={row.description}
                meta={row.meta}
                metaAt={LIST_ROW_META.TITLE}
                ink={LIST_ROW_INK.SIDEBAR}
                current={row.current ? LIST_ROW_CURRENT.PAGE : undefined}
                currentLook={LIST_ROW_CURRENT_LOOK.TINT}
                unread={row.unread}
                muted={row.muted}
                onPress={() => undefined}
              />
            ))}
          </List>
        </div>
      </CatalogSection>
      <CatalogSection
        id="list-row-meta-last"
        title="A rail's rows: titles on up to two lines, their counts on the last line, the open row tinted"
      >
        <div className="catalog-narrow">
          <List label="Chapters">
            <ListRow
              leading={<GLYPH.PULL_REQUEST_CHAPTERS />}
              title="Expose an open-question check for task finishing"
              titleLines={LIST_ROW_TITLE_LINES.TWO}
              description="+9 −0"
              meta="2 comments"
              metaAt={LIST_ROW_META.LAST}
              ink={LIST_ROW_INK.SIDEBAR}
              current={LIST_ROW_CURRENT.PAGE}
              currentLook={LIST_ROW_CURRENT_LOOK.TINT}
              onPress={() => undefined}
            />
            <ListRow
              leading={<GLYPH.PULL_REQUEST_CHAPTERS />}
              title="Refuse an agent's Done while an ask is open, and say why in the transcript"
              titleLines={LIST_ROW_TITLE_LINES.TWO}
              description="+44 −0"
              metaAt={LIST_ROW_META.LAST}
              ink={LIST_ROW_INK.SIDEBAR}
              currentLook={LIST_ROW_CURRENT_LOOK.TINT}
              muted
              onPress={() => undefined}
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection
        id="list-row-lead-inline"
        title="What a row belongs to, leading its description in plain words"
      >
        <div className="catalog-column">
          <List label="Runs" variant={LIST_VARIANT.CARD}>
            <ListRow
              leading={<GLYPH.TIME />}
              title="Fix the flaky invite expiry test"
              lead={{ icon: <GLYPH.AUTOMATION />, label: "Nightly flaky-test sweep" }}
              leadAt={LIST_ROW_LEAD.INLINE}
              description="Working"
              meta="1d"
              onPress={() => undefined}
            />
            <ListRow
              leading={<GLYPH.TIME />}
              title="Scheduled run"
              lead={{ icon: <GLYPH.AUTOMATION />, label: "Nightly flaky-test sweep" }}
              leadAt={LIST_ROW_LEAD.INLINE}
              description="Skipped: an earlier run's agent was still at work."
              meta="3d"
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-static" title="Rows that open nothing">
        <div className="catalog-column">
          <List label="Recent runs">
            <ListRow title="Nightly review" meta="2h ago" />
            <ListRow
              title="Release notes"
              description="Finished without changes"
              meta="Yesterday"
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-menu" title="Rows with a menu: ⋯, right-click, and the menu key">
        <div className="catalog-column">
          <TaskRows density={LIST_DENSITY.REGULAR} />
        </div>
        <div className="catalog-narrow">
          <TaskRows density={LIST_DENSITY.DENSE} />
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-card" title="Rows in a card">
        <div className="catalog-column">
          <Automations />
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-finger" title="A finger's height on a coarse pointer">
        <div className="catalog-column">
          <List label="Pull request" variant={LIST_VARIANT.CARD} fingerTall>
            <ListRow
              leading={<UserIcon />}
              title="#4702 · Fold the task sweep into ui"
              meta="+412 −388"
              onPress={() => undefined}
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-compact" title="Compact rows">
        <div className="catalog-narrow">
          <List label="Runs" density={LIST_DENSITY.COMPACT}>
            <ListRow
              title="Fix the flaky test"
              description="Working"
              meta="2m"
              current={LIST_ROW_CURRENT.ITEM}
            />
            <ListRow
              title="Scheduled run"
              description="Finished"
              meta="1d"
              onPress={() => undefined}
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-dense" title="Dense rows, acts on hover">
        <div className="catalog-narrow">
          <List label="Plans" density={LIST_DENSITY.DENSE}>
            <ListRow
              title="Ship the release"
              description="luke"
              meta="2h"
              current={LIST_ROW_CURRENT.ITEM}
              onPress={() => undefined}
              actionsAt={LIST_ROW_ACTIONS.HOVER}
              actions={<IconButton icon={<TrashIcon />} label="Archive Ship the release" />}
            />
            <ListRow
              title="Draw the sidebar with the shared rows"
              description="luke"
              meta="1d"
              onPress={() => undefined}
              actionsAt={LIST_ROW_ACTIONS.HOVER}
              menuOpen
              actions={
                <IconButton
                  icon={<TrashIcon />}
                  label="Archive Draw the sidebar with the shared rows"
                />
              }
            />
            <ListRow
              title="Read the release notes"
              meta="2d"
              ink={LIST_ROW_INK.SIDEBAR}
              unread
              onPress={() => undefined}
            />
            <ListRow
              title="A read plan in the sidebar's ink"
              meta="2d"
              ink={LIST_ROW_INK.SIDEBAR}
              onPress={() => undefined}
            />
            <ListRow title="Deleting a plan" meta="3d" disabled onPress={() => undefined} />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-nested" title="Rows nested under a row that folds them">
        <div className="catalog-narrow">
          <NestedRows />
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-chevron" title="Rows that go deeper">
        <div className="catalog-narrow">
          <List label="Tools" density={LIST_DENSITY.COMPACT}>
            <ListRow
              title="create_issue"
              description="Opens an issue in a repository"
              chevron
              current={LIST_ROW_CURRENT.ITEM}
              onPress={() => undefined}
            />
            <ListRow
              title="list_issues"
              description="Lists a repository's issues"
              chevron
              onPress={() => undefined}
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-dense-long" title="Dense rows cut short">
        <div className="catalog-narrow">
          <List label="Tabs" density={LIST_DENSITY.DENSE}>
            <ListRow
              leading={<UserIcon />}
              title="Draw the summary panel's tabs with a fade at their end"
              description="Agent"
              meta="2h"
              onPress={() => undefined}
            />
            <ListRow
              leading={<UserIcon />}
              title="Plan"
              description="The plan this task is talked through in, as Luke keeps it"
              onPress={() => undefined}
            />
            <ListRow leading={<UserIcon />} title="Inbox" meta="3" onPress={() => undefined} />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-narrow" title="Long words in a narrow column">
        <div className="catalog-narrow">
          <List label="Tasks">
            <ListRow
              title="Migrate the acme-corporation-engineering-platform workspace"
              description="Last edited by someone with a very long name indeed"
              meta="3d"
              onPress={() => undefined}
              actions={
                <>
                  <IconButton icon={<PencilIcon />} label="Rename" />
                  <IconButton icon={<TrashIcon />} label="Delete" />
                </>
              }
            />
          </List>
        </div>
      </CatalogSection>
    </>
  );
}

export const LIST_ROW_EXAMPLE: Example = {
  id: "list-row",
  title: "List rows",
  Render: ListRows,
};
