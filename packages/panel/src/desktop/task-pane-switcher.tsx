import { TASK_BOUNDS } from "@repo/features/task-wire";
import { backToWords } from "@repo/features/words";
import {
  BackButton,
  InlineEdit,
  type InlineEditEnd,
  NO_BACK_KEY,
  OneLine,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  type ToolbarPickUp,
} from "@repo/ui";
import type { AwayStep } from "../navigation-history.js";
import { isOverviewTab, type MainTab } from "../tasks/use-main-tabs.js";
import { PhoneHead } from "./phone-head.js";

export const TASK_PANE = {
  OVERVIEW: "overview",
  AGENT: "agent",
  PANEL: "panel",
} as const;

export type TaskPane = (typeof TASK_PANE)[keyof typeof TASK_PANE];

export const HOME_BACK = "Home";

const BACK = "Back";

export function taskPaneOf(input: {
  readonly open: boolean;
  readonly column: MainTab | undefined;
}): TaskPane {
  if (input.open) return TASK_PANE.PANEL;
  return isOverviewTab(input.column) ? TASK_PANE.OVERVIEW : TASK_PANE.AGENT;
}

export interface TaskHeadBack {
  readonly label: string;
  readonly name?: string | undefined;
  readonly onPress: () => void;
}

export function screenBack(label: string, onPress: () => void): TaskHeadBack {
  return { label, name: backToWords(label), onPress };
}

export function awayBack(away: AwayStep | undefined, onLeave: () => void): TaskHeadBack {
  const label = away === undefined ? HOME_BACK : (away.title?.label ?? BACK);
  return { label, onPress: onLeave };
}

interface TaskHeadRename {
  readonly editing: boolean;
  readonly onEnd: (end: InlineEditEnd) => void;
}

export function TaskHead({
  back,
  title,
  pickUp,
  rename,
  actions,
}: {
  back: TaskHeadBack;
  title: string | undefined;
  pickUp?: ToolbarPickUp | undefined;
  rename?: TaskHeadRename | undefined;
  actions: React.ReactNode;
}): React.JSX.Element {
  const named = title ?? (pickUp?.shown === true ? pickUp.name : undefined);
  return (
    <PhoneHead
      place="task"
      start={
        <BackButton
          label={back.label}
          place={back.label}
          name={back.name}
          command={NO_BACK_KEY}
          onBack={back.onPress}
        />
      }
      title={
        named === undefined ? undefined : (
          <Text
            as={TEXT_ELEMENT.H1}
            variant={TEXT_VARIANT.TOOLBAR_TITLE}
            className="ui-toolbar-title"
          >
            {rename?.editing === true ? (
              <InlineEdit
                value={named}
                label="Task name"
                maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
                editing
                onEnd={(end) => rename.onEnd(end)}
              />
            ) : (
              <OneLine>{named}</OneLine>
            )}
          </Text>
        )
      }
      end={actions}
    />
  );
}
