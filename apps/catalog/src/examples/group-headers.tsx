import {
  FolderIcon,
  GROUP_ACTION_STATE,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GROUP_SURFACE,
  GroupAction,
  GroupHeader,
  IconButton,
  MoreButton,
  NAV_COUNT_SHOWN,
  PinIcon,
  PlusIcon,
  STATUS_TONE,
  Text,
} from "@luke/ui";
import { ListFilterIcon, SlidersHorizontalIcon } from "@luke/ui/icons";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * group-headers.tsx -- a group's head folding its rows, open and folded,
 * with its glyph, a pin, a count shown at rest or under the pointer, and
 * its actions beside the fold; a group its holder keeps; a head with no
 * glyph, whose chevron stands at rest; heads that fold nothing; a list's head
 * with a search and its buttons standing; a list's head whose buttons wait,
 * a filter that is on standing with its dot; and the count on a wide page and
 * in a narrow column.
 */

const ignore = (): void => undefined;

function Rows({ names }: { names: readonly string[] }): React.JSX.Element {
  return (
    <>
      {names.map((name) => (
        <Text key={name}>{name}</Text>
      ))}
    </>
  );
}

const TASKS = ["Fix the sign-in loop", "Ship the spring release", "Tidy the settings page"];

function Folding(): React.JSX.Element {
  return (
    <div className="catalog-narrow">
      <GroupHeader
        label="acme/web"
        glyph={<FolderIcon />}
        mark={<PinIcon />}
        count={{ value: TASKS.length, noun: "tasks", shown: NAV_COUNT_SHOWN.ON_HOVER }}
        actions={
          <>
            <MoreButton thing="acme/web" onClick={ignore} />
            <IconButton label="New task in acme/web" icon={<PlusIcon />} onClick={ignore} />
          </>
        }
        fold={{ defaultOpen: true }}
      >
        <Rows names={TASKS} />
      </GroupHeader>
      <GroupHeader
        label="Nightly review"
        glyph={<FolderIcon />}
        count={{ value: 2, noun: "need you", tone: STATUS_TONE.ATTENTION }}
        fold={{ defaultOpen: false }}
      >
        <Rows names={["Review the nightly run", "Answer the flaky test"]} />
      </GroupHeader>
      <GroupHeader label="Someday" fold={{ defaultOpen: true }}>
        <Rows names={["Write the onboarding guide"]} />
      </GroupHeader>
    </div>
  );
}

/** A group whose holder keeps whether it is folded, as the sidebar keeps it across launches. */
function Held(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="catalog-narrow">
      <GroupHeader
        label={open ? "Held open" : "Held folded"}
        glyph={<FolderIcon />}
        count={{ value: TASKS.length, noun: "tasks" }}
        fold={{ open, onOpenChange: setOpen }}
      >
        <Rows names={TASKS} />
      </GroupHeader>
    </div>
  );
}

function Still(): React.JSX.Element {
  return (
    <div className="catalog-narrow">
      <GroupHeader label="Workspace" heading={GROUP_HEADING.H3}>
        <Rows names={["General", "Members", "Billing"]} />
      </GroupHeader>
      <GroupHeader label="Agents" count={{ value: 0, noun: "agents" }} heading={GROUP_HEADING.H3}>
        <Text>No agents yet.</Text>
      </GroupHeader>
    </div>
  );
}

/** The same group on a wide page, counted always, and in a narrow column, counted only folded or under the pointer. */
function Surfaces(): React.JSX.Element {
  return (
    <div className="catalog-narrow">
      <GroupHeader
        label="Wide page"
        glyph={<FolderIcon />}
        count={{ value: TASKS.length, noun: "tasks" }}
        surface={GROUP_SURFACE.WIDE}
        fold={{ defaultOpen: true }}
      >
        <Rows names={TASKS} />
      </GroupHeader>
      <GroupHeader
        label="Narrow column"
        glyph={<FolderIcon />}
        count={{ value: TASKS.length, noun: "tasks" }}
        surface={GROUP_SURFACE.NARROW}
        fold={{ defaultOpen: true }}
      >
        <Rows names={TASKS} />
      </GroupHeader>
    </div>
  );
}

/** A list's own head: its buttons standing at rest, and a search a magnifier unfolds over its label. */
function Searched(): React.JSX.Element {
  const [query, setQuery] = useState("");
  return (
    <div className="catalog-narrow">
      <GroupHeader
        label="Tasks"
        heading={GROUP_HEADING.NONE}
        actionsShown={GROUP_ACTIONS.AT_REST}
        actions={<MoreButton thing="Tasks" onClick={ignore} />}
        search={{ label: "Search tasks", value: query, onChange: setQuery }}
      />
    </div>
  );
}

/** A list's head whose buttons wait for the pointer, as the sidebar's Tasks head's do: one with nothing filtered, and one whose Filter is on, standing at rest with its dot. */
function Filtered(): React.JSX.Element {
  const head = (label: string, filtered: boolean) => (
    <GroupHeader
      label={label}
      heading={GROUP_HEADING.NONE}
      actions={
        <>
          <GroupAction state={filtered ? GROUP_ACTION_STATE.ACTIVE : GROUP_ACTION_STATE.IDLE}>
            <IconButton icon={<ListFilterIcon />} label="Filter" onClick={ignore} />
          </GroupAction>
          <GroupAction>
            <IconButton icon={<SlidersHorizontalIcon />} label="View options" onClick={ignore} />
          </GroupAction>
        </>
      }
    />
  );
  return (
    <div className="catalog-narrow">
      {head("Tasks", false)}
      {head("Tasks, filtered", true)}
    </div>
  );
}

function GroupHeaders(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="group-header-folds" title="Groups that fold, open and folded">
        <Folding />
      </CatalogSection>
      <CatalogSection id="group-header-held" title="A group its holder keeps">
        <Held />
      </CatalogSection>
      <CatalogSection id="group-header-still" title="Heads that fold nothing">
        <Still />
      </CatalogSection>
      <CatalogSection
        id="group-header-search"
        title="A list's head, with a search and standing buttons"
      >
        <Searched />
      </CatalogSection>
      <CatalogSection
        id="group-header-filtered"
        title="A list's head whose buttons wait, a filter that is on standing"
      >
        <Filtered />
      </CatalogSection>
      <CatalogSection
        id="group-header-surfaces"
        title="Counts on a wide page and in a narrow column"
      >
        <Surfaces />
      </CatalogSection>
    </>
  );
}

export const GROUP_HEADERS_EXAMPLE: Example = {
  id: "group-headers",
  title: "Group headers",
  Render: GroupHeaders,
};
