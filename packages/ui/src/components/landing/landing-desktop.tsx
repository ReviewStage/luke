import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import type { ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ComposeIcon,
  GearIcon,
  SearchIcon,
  SidebarIcon,
  SidePanelIcon,
} from "../../face/glyphs.js";
import { ChevronDownIcon, GLYPH, InboxIcon, ListTodoIcon, ZapIcon } from "../../icons/icons.js";
import { HarnessMark } from "../../marks/harness-mark.js";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { IconButton } from "../button/button.js";
import { GROUP_HEADING, GroupHeader } from "../group-header/group-header.js";
import {
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  List,
  ListRow,
} from "../list-row/list-row.js";
import { NAV_CURRENT, NAV_ITEM_VARIANT, NavItem } from "../nav-item/nav-item.js";
import { SidebarPlaces, SidebarRule } from "../sidebar/sidebar.js";
import { TEXT_ELEMENT, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TextButton } from "../text-button/text-button.js";
import { Time } from "../time/time.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import { MINUTE, STORY_NOW, still } from "./landing-story.js";

/**
 * landing-desktop.tsx -- the Mac app's frame as the landing's windows draw it: the title bar's controls, the sidebar, and an agent's face.
 *
 * The sidebar is the desktop's own: the title bar's sidebar toggle and way
 * back and forward over the workspace, the places, and My tasks under each
 * task's repository, with the hidden statuses' line and the account's foot
 * with its settings. Its tasks and the workspace are one made-up team's,
 * acme, building teammate invitations. Every part is a `@repo/ui` component
 * placed as the panel places it (`packages/panel/src/desktop/desktop-sidebar.tsx`).
 */

/** The page on show, which the sidebar marks among its places. */
export const DESKTOP_PLACE = {
  INBOX: "inbox",
  TASK: "task",
  AUTOMATIONS: "automations",
} as const;

export type DesktopPlace = (typeof DESKTOP_PLACE)[keyof typeof DESKTOP_PLACE];

/** One of My tasks: its status, its name, whether an agent is at work on it, and how long ago it moved. */
type SidebarTask = {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  readonly working: boolean;
  readonly ago: number;
};

/** My tasks, under the repository each works in. */
const MY_TASKS: readonly { readonly repository: string; readonly tasks: readonly SidebarTask[] }[] =
  [
    {
      repository: "relay",
      tasks: [
        {
          id: "invites",
          name: "Teammate invitations",
          status: TASK_STATUS.IN_PROGRESS,
          working: true,
          ago: 1,
        },
        {
          id: "digest",
          name: "Weekly digest email",
          status: TASK_STATUS.IN_PROGRESS,
          working: true,
          ago: 25,
        },
      ],
    },
    {
      repository: "ledger",
      tasks: [
        {
          id: "export",
          name: "Billing export",
          status: TASK_STATUS.TODO,
          working: false,
          ago: 180,
        },
      ],
    },
  ];

/** The member at the account's foot. */
export const MEMBER = "Sam Reyes";

/** An agent's face: its name on the square of the harness it runs in. */
export function agentFace(
  name: string,
  size: (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE],
): ReactNode {
  return (
    <Avatar
      name={name}
      shape={AVATAR_SHAPE.SQUARE}
      size={size}
      glyph={<HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />}
      decorative
    />
  );
}

/** The title bar's controls over the sidebar: its toggle, and the way back and forward at its end. */
function TitleBarControls(): React.JSX.Element {
  return (
    <div className="ui-landing-title-bar">
      <span className="ui-landing-title-bar-start">
        <IconButton icon={<SidebarIcon />} label="Hide sidebar" onClick={still} />
      </span>
      <span className="ui-landing-title-bar-history">
        <IconButton icon={<ArrowLeftIcon />} label="Back" onClick={still} />
        <IconButton icon={<ArrowRightIcon />} label="Forward" disabled onClick={still} />
      </span>
    </div>
  );
}

/** The window's side-panel toggle at its top right. */
export function SidePanelToggle(): React.JSX.Element {
  return (
    <span className="ui-landing-title-bar-end">
      <IconButton icon={<SidePanelIcon />} label="Hide side panel" onClick={still} />
    </span>
  );
}

/** The desktop's sidebar, `place` marked among its places and `openTask` among My tasks. */
export function DesktopSidebar({
  place,
  openTask,
}: {
  place: DesktopPlace;
  openTask?: string | undefined;
}): React.JSX.Element {
  return (
    <aside className="ui-landing-sidebar">
      <TitleBarControls />
      <div className="ui-landing-workspace">
        <NavItem variant={NAV_ITEM_VARIANT.IDENTITY} mark={<ChevronDownIcon />}>
          <span className="ui-landing-workspace-ref">
            <Avatar name="acme" size={AVATAR_SIZE.CARD} shape={AVATAR_SHAPE.TILE} decorative />
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION}>
              acme
            </Text>
          </span>
        </NavItem>
      </div>
      <SidebarPlaces label="Places">
        <NavItem icon={<ComposeIcon />}>New task</NavItem>
        <NavItem icon={<SearchIcon />}>Search</NavItem>
        <NavItem
          icon={<InboxIcon />}
          current={place === DESKTOP_PLACE.INBOX ? NAV_CURRENT.PAGE : undefined}
          count={{ value: 2, noun: "need you", tone: STATUS_TONE.ATTENTION }}
        >
          Inbox
        </NavItem>
        <NavItem icon={<ListTodoIcon />}>Tasks</NavItem>
        <NavItem
          icon={<ZapIcon />}
          current={place === DESKTOP_PLACE.AUTOMATIONS ? NAV_CURRENT.PAGE : undefined}
        >
          Automations
        </NavItem>
      </SidebarPlaces>
      <SidebarRule />
      <nav className="ui-landing-sidebar-group" aria-label="My tasks">
        <GroupHeader heading={GROUP_HEADING.NONE} label="My tasks" />
        {MY_TASKS.map((group) => (
          <div key={group.repository} className="ui-landing-repository">
            <GroupHeader
              heading={GROUP_HEADING.NONE}
              glyph={<GLYPH.REPOSITORY />}
              label={group.repository}
            />
            <List label={group.repository} density={LIST_DENSITY.DENSE}>
              {group.tasks.map((task) => (
                <ListRow
                  key={task.id}
                  motionKey={task.id}
                  density={LIST_DENSITY.DENSE}
                  ink={LIST_ROW_INK.SIDEBAR}
                  leading={<TaskStatusMark status={task.status} />}
                  title={task.name}
                  meta={
                    <span className="ui-landing-row-time">
                      {task.working ? <WorkingMark /> : null}
                      <Time at={STORY_NOW - task.ago * MINUTE} now={STORY_NOW} hint={false} />
                    </span>
                  }
                  current={task.id === openTask ? LIST_ROW_CURRENT.PAGE : undefined}
                  onPress={still}
                />
              ))}
            </List>
          </div>
        ))}
        <p className="ui-landing-hidden-statuses">
          <TextButton onClick={still}>1 more in Done</TextButton>
        </p>
      </nav>
      <div className="ui-landing-sidebar-foot">
        <NavItem
          variant={NAV_ITEM_VARIANT.IDENTITY}
          icon={<Avatar name={MEMBER} size={AVATAR_SIZE.ACCOUNT} decorative />}
        >
          {MEMBER}
        </NavItem>
        <IconButton icon={<GearIcon />} label="Settings" onClick={still} />
      </div>
    </aside>
  );
}
