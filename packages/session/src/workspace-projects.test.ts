import assert from "node:assert/strict";
import {
  type ObservedWorkspaceProject,
  WORKSPACE_TASK_SUPPORT,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import { test } from "vitest";

function project(overrides: Partial<ObservedWorkspaceProject>): ObservedWorkspaceProject {
  return {
    providerId: "conductor",
    providerName: "Conductor",
    providerProjectId: "proj-1",
    repository: "luke",
    taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
    ...overrides,
  };
}

test("saved project identities distinguish the same project on two hosts", () => {
  assert.equal(workspaceProjectSelectionId(project({})), "proj-1");
  assert.notEqual(
    workspaceProjectSelectionId(project({ providerTargetId: "local" })),
    workspaceProjectSelectionId(project({ providerTargetId: "studio" })),
  );
});
