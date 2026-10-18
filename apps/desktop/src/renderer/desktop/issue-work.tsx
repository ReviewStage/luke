import type { Issue } from "@luke/features/issue-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { ComposeIcon, DocumentIcon, INLINE_REF_LOOK } from "@luke/ui";
import { createContext, useContext } from "react";
import { InlineRef } from "../inline-ref";
import type { MenuAction } from "./action-menu";

/**
 * issue-work.tsx -- the work an issue is taken up in: its Start task…, and the tasks started from it, as its page lists them.
 *
 * Start task… opens New task on the issue, named by its title and in its
 * workspace, and the task it starts is linked to the issue
 * (`new-task-dialog.tsx`). The issue's page lists the tasks of the listed
 * workspace started from it, newest started first, each a chip that opens
 * its task; an issue no task was started from lists none and draws no row.
 * The Issues page hands these doors down once, so a card's menu, a row's,
 * and the issue's own page offer the same ones.
 */

/** What the Issues page hands its cards, rows, and issue page to take an issue up in a task. */
export interface IssueWork {
  /** Opens New task on the issue, which the task it starts is linked to. */
  readonly onStartTask: (issue: Issue, identifier: string) => void;
  /** The listed tasks started from the issue, newest started first. */
  readonly tasksOf: (issueId: string) => readonly TaskSummary[];
  /** Opens a task. */
  readonly onOpenTask: (taskId: string) => void;
}

const IssueWorkContext = createContext<IssueWork | undefined>(undefined);

/** Hands the Issues page's doors to every card, row, and issue page under it. */
export const IssueWorkProvider = IssueWorkContext.Provider;

/** What Start task… says, on the issue's page and in its card's or row's menu. */
export const START_TASK_LABEL = "Start task…";

/** Start task… for the issue, where the page offers it; nothing outside the Issues page. */
export function useStartTaskItem(issue: Issue, identifier: string): MenuAction | undefined {
  const work = useContext(IssueWorkContext);
  if (work === undefined) return undefined;
  return {
    label: START_TASK_LABEL,
    icon: <ComposeIcon />,
    onSelect: () => work.onStartTask(issue, identifier),
  };
}

/** The tasks started from the issue, each a chip that opens it, under its status and priority; nothing while none was. */
export function IssueWorkRow({ issue }: { issue: Issue }): React.JSX.Element | null {
  const work = useContext(IssueWorkContext);
  const tasks = work?.tasksOf(issue.id) ?? [];
  if (work === undefined || tasks.length === 0) return null;
  return (
    <section className="issue-work" aria-label="Tasks">
      <span className="issue-work-label">Tasks</span>
      {tasks.map((task) => (
        <InlineRef
          key={task.id}
          look={INLINE_REF_LOOK.PILL}
          glyph={<DocumentIcon />}
          label={task.name}
          pressLabel={`Open ${task.name}`}
          onPress={() => work.onOpenTask(task.id)}
        />
      ))}
    </section>
  );
}
