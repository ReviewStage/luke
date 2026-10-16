import type { Task } from "@luke/features/task-wire";

/**
 * document-plan.ts -- a synthetic plan, as a service answers one: its text, and no assumptions beside it.
 *
 * The text has no title line, since the plan's name is its own; its
 * assumptions are a section like any other; it opens on a `#` section, and
 * a fence in it holds a line shaped like a heading, which is code.
 */

export const DOCUMENT_NAME = "Teammate invitations";

const DOCUMENT_TEXT = [
  "# Context",
  "Only an admin can add a member today.",
  "## Goal",
  "Invites land by email.",
  "## Approach",
  "```md\n## Not a section\n```",
  "## Assumptions",
  "- Links are single use.",
].join("\n\n");

/** A plan, its text as `DOCUMENT_TEXT`, nobody's save on it yet. */
export const DOCUMENT_TASK: Task = {
  id: "5d8e2a61-7c3b-4f0e-9b1a-2c6d4e8f0a13",
  workspaceId: "workspace-personal",
  name: DOCUMENT_NAME,
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: `${DOCUMENT_TEXT}\n`, assumptions: [] },
};
