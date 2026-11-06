import { PROSE_CLASS } from "../components/prose/prose.js";

export const MARKDOWN_CLASS = {
  ROOT: "ui-markdown",
  HEADING: "ui-markdown-heading",
  TASK_ITEM: "task-list-item",
  TASK_BOX: "ui-markdown-task",
} as const;

export function markdownClass(className?: string): string {
  const root = `${MARKDOWN_CLASS.ROOT} ${PROSE_CLASS}`;
  return className === undefined ? root : `${root} ${className}`;
}
