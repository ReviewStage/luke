import type { Task } from "@repo/features/task-wire";

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

export const DOCUMENT_TASK: Task = {
  id: "5d8e2a61-7c3b-4f0e-9b1a-2c6d4e8f0a13",
  workspaceId: "workspace-personal",
  name: DOCUMENT_NAME,
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: `${DOCUMENT_TEXT}\n`, assumptions: [] },
};
