import { TASK_BOUNDS, type Task } from "./task-wire.js";

const WHITESPACE_RUN = /\s+/gu;

const TITLE_OVERHEAD = "# ".length + TASK_BOUNDS.MAX_NAME_CHARS + "\n\n".length;

export const DESCRIPTION_MARKDOWN_MAX_CHARS = TITLE_OVERHEAD + TASK_BOUNDS.MAX_BODY_CHARS + 1;

export function descriptionMarkdown(task: Pick<Task, "name" | "document">): string {
  const body = task.document.body.trimEnd();
  const title = `# ${task.name.replace(WHITESPACE_RUN, " ").trim()}`;
  return body.length === 0 ? `${title}\n` : `${title}\n\n${body}\n`;
}
