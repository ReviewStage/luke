import { TASK_BOUNDS } from "@luke/features/task-wire";
import { backToWords } from "@luke/features/words";
import {
  BackButton,
  InlineEdit,
  type InlineEditEnd,
  NO_BACK_KEY,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  type ToolbarPickUp,
} from "@luke/ui";
import type { AwayStep } from "../navigation-history.js";
import { isOverviewTab, type MainTab } from "../tasks/use-main-tabs.js";
import { PhoneHead } from "./phone-head.js";

/**
 * task-pane-switcher.tsx -- how a phone heads a task: one row of the way
 * back, the title of what is on screen, and one ⋯, over a task whose
 * Overview is its one page and whose agents and tabs are screens pushed
 * over it.
 *
 * Nothing here is held apart from the column and the side panel: the
 * screens read what they already hold. Overview is the panel shut over the
 * column on its Overview, the task's plan, which leads with the task's
 * agents (`plan-agents.tsx`); an agent is the panel shut over the column on
 * its tab, a draft's among them; and a tab of the panel, opened from a link
 * or an agent's ⋯, is the panel open over either, full screen. So the tabs
 * a phone opens are the same tabs, kept the same way (`use-main-tabs.ts`,
 * `use-side-panel.ts`), and Back walks them as it did. The panel lists
 * none of its tabs here: each is reached from what opens it.
 *
 * The row is a phone's standard header and holds nothing else: the way
 * back, its glyph alone, leads out of the task on Overview, to the list the
 * task was opened from, and back a screen anywhere else, named for where it
 * goes ("Back to Overview"); the title, one line centred between the two
 * equal corners and fading where it is cut, names what is on screen, or
 * nothing on Overview until the plan's own heading scrolls away; and the ⋯
 * holds the menu of what is on screen: the task's own on Overview
 * (`task-actions.tsx`), the agent's on its screen (`agent-actions.tsx`),
 * and the tab's on one of the panel's.
 */

/** What stands on a phone's task: its Overview, an agent's screen pushed over it, or a tab of the panel pushed over either. */
export const TASK_PANE = {
  OVERVIEW: "overview",
  AGENT: "agent",
  PANEL: "panel",
} as const;

export type TaskPane = (typeof TASK_PANE)[keyof typeof TASK_PANE];

/** What the way out of a task is called where no page stands behind it, and it opens the Tasks page. */
export const TASKS_BACK = "Tasks";

/** What the way back from an agent's screen is called. */
export const OVERVIEW_BACK = "Overview";

/** What the way out of a task is called where the page behind it has no name yet. */
const BACK = "Back";

/**
 * Which screen stands: a tab of the panel while it is open; else Overview
 * while the column shows it, and an agent's on any other of its tabs.
 */
export function taskPaneOf(input: {
  readonly open: boolean;
  readonly column: MainTab | undefined;
}): TaskPane {
  if (input.open) return TASK_PANE.PANEL;
  return isOverviewTab(input.column) ? TASK_PANE.OVERVIEW : TASK_PANE.AGENT;
}

/** Where the way back goes, what it is called there, and what a reader is told it does where its glyph stands alone. */
export interface TaskHeadBack {
  readonly label: string;
  readonly name?: string | undefined;
  readonly onPress: () => void;
}

/** The way back a screen to `label`, named for it as its hint names it ("Back to Overview"). */
export function screenBack(label: string, onPress: () => void): TaskHeadBack {
  return { label, name: backToWords(label), onPress };
}

/**
 * The way out of a task, named for the page it goes back to, as the
 * window's history names that step (`WindowHistory`'s `away`): the Tasks
 * page, the Inbox, or another task; the Tasks page where none stands
 * behind it, which `onLeave` then opens.
 */
export function awayBack(away: AwayStep | undefined, onLeave: () => void): TaskHeadBack {
  const label = away === undefined ? TASKS_BACK : (away.title?.label ?? BACK);
  return { label, onPress: onLeave };
}

/** The task's name being edited in the title's place, as the ⋯'s Rename asks. */
interface TaskHeadRename {
  readonly editing: boolean;
  readonly onEnd: (end: InlineEditEnd) => void;
}

/**
 * The row heading a task on a phone; see the module's head. It is a phone's
 * header (`phone-head.tsx`): the way back at its start, the ⋯ at its end,
 * and the title centred between them, words the bar draws on one line that
 * fades where it is cut, or the task's name as a field while it is renamed.
 */
export function TaskHead({
  back,
  title,
  pickUp,
  rename,
  actions,
}: {
  back: TaskHeadBack;
  /** What is on screen: the agent's or the tab's name; none on Overview, whose plan names the task in its own heading, which the row then picks up once it scrolls away (`pickUp`). */
  title: string | undefined;
  /** The plan's heading as the row picks it up where it draws no title. */
  pickUp?: ToolbarPickUp | undefined;
  /** The task's name as a field in the title's place while it is renamed, `title` then being the task's name. */
  rename?: TaskHeadRename | undefined;
  /** The row's one ⋯ (`PlaceMore`). */
  actions: React.ReactNode;
}): React.JSX.Element {
  return (
    <PhoneHead
      place="task"
      start={
        // Note that it names no key, because the window's Back takes one history step and this leaves the task or its screen.
        <BackButton
          label={back.label}
          place={back.label}
          name={back.name}
          command={NO_BACK_KEY}
          onBack={back.onPress}
        />
      }
      pickUp={pickUp}
      title={
        title === undefined || rename?.editing !== true ? (
          title
        ) : (
          <Text
            as={TEXT_ELEMENT.H1}
            variant={TEXT_VARIANT.TOOLBAR_TITLE}
            className="luke-toolbar-title"
          >
            <InlineEdit
              value={title}
              label="Task name"
              maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
              editing
              onEnd={(end) => rename.onEnd(end)}
            />
          </Text>
        )
      }
      end={actions}
    />
  );
}
