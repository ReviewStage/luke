import { useMemo } from "react";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * chat-surface.ts -- what the window's Chat reads of the window's tasks, kept apart from Chat itself so the shell can hand it on without loading Chat (`desktop-chat.tsx`, a chunk of its own while the Chat experiment is off).
 */

/**
 * What Chat reads of the window's tasks, and nothing else: the chat's own
 * control, the tasks and workspaces it names, how the sidebar groups them,
 * the reader, the agents' models a card names, and the doors it opens a
 * task, an agent, and a file through.
 */
export type ChatSurface = Pick<
  TasksControl,
  | "chatView"
  | "tasks"
  | "workspace"
  | "workspaces"
  | "taskSections"
  | "me"
  | "repositories"
  | "onShowAgent"
  | "onSelect"
  | "onShowFile"
  | "shown"
> & { readonly agents: Pick<TasksControl["agents"], "models"> };

/** What Chat reads of the window's tasks, the one value while none of it moves, so Chat holds (`memo`) through a delivery that moves only the rest. */
export function useChatSurface(tasks: TasksControl): ChatSurface {
  const { chatView, workspace, workspaces, taskSections, me, repositories, shown } = tasks;
  const { onShowAgent, onSelect, onShowFile } = tasks;
  const listed = tasks.tasks;
  const { models } = tasks.agents;
  return useMemo(
    () => ({
      chatView,
      tasks: listed,
      workspace,
      workspaces,
      taskSections,
      me,
      repositories,
      onShowAgent,
      onSelect,
      onShowFile,
      shown,
      agents: { models },
    }),
    [
      chatView,
      listed,
      workspace,
      workspaces,
      taskSections,
      me,
      repositories,
      onShowAgent,
      onSelect,
      onShowFile,
      shown,
      models,
    ],
  );
}
