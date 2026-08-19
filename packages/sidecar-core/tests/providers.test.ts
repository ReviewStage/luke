import assert from "node:assert/strict";
import test from "node:test";
import {
  maximumObservedWorkspaceProjects,
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  WORKSPACE_TASK_SUPPORT,
  workspaceProjectSelectionId,
} from "../src";

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

test("workspace projects are offered alphabetically, however adapters answered", () => {
  const normalized = normalizeObservedWorkspaceProjects([
    project({ providerProjectId: "proj-z", repository: "zephyr" }),
    project({
      providerId: "cursor",
      providerName: "Cursor",
      providerProjectId: "https://github.com/acme/api",
      repository: "acme/api",
      taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
    }),
    project({ providerProjectId: "proj-l", repository: "Luke" }),
  ]);

  // Alphabetical by the repository label a person scans for — case-blind, and
  // across providers rather than grouped by whichever adapter answered first.
  assert.deepEqual(
    normalized.map((entry) => entry.repository),
    ["acme/api", "Luke", "zephyr"],
  );
});

test("labels that differ only by number sort as a person counts", () => {
  const normalized = normalizeObservedWorkspaceProjects([
    project({ providerProjectId: "proj-10", repository: "repo-10" }),
    project({ providerProjectId: "proj-2", repository: "repo-2" }),
  ]);

  assert.deepEqual(
    normalized.map((entry) => entry.repository),
    ["repo-2", "repo-10"],
  );
});

test("one repository label offered twice keeps a deterministic provider order", () => {
  const normalized = normalizeObservedWorkspaceProjects([
    project({
      providerId: "cursor",
      providerName: "Cursor",
      providerProjectId: "https://github.com/acme/luke",
    }),
    project({ providerProjectId: "proj-1" }),
  ]);

  assert.deepEqual(
    normalized.map((entry) => entry.providerName),
    ["Conductor", "Cursor"],
  );
});

test("a list past the cap keeps its alphabetical head, not an arbitrary provider's", () => {
  const overflowing = Array.from({ length: maximumObservedWorkspaceProjects + 5 }, (_, index) =>
    // Zero-padded so plain and numeric comparisons agree on the expectation.
    project({
      providerProjectId: `proj-${String(index).padStart(2, "0")}`,
      repository: `repo-${String(index).padStart(2, "0")}`,
    }),
  );

  const normalized = normalizeObservedWorkspaceProjects([...overflowing].reverse());

  assert.equal(normalized.length, maximumObservedWorkspaceProjects);
  assert.equal(normalized[0]?.repository, "repo-00");
  assert.equal(
    normalized.at(-1)?.repository,
    `repo-${String(maximumObservedWorkspaceProjects - 1).padStart(2, "0")}`,
  );
});

test("normalizing still drops blanks and duplicates before it sorts", () => {
  const normalized = normalizeObservedWorkspaceProjects([
    project({ providerProjectId: "proj-1", repository: "beta" }),
    // The same provider project again, under a different label: one row.
    project({ providerProjectId: "proj-1", repository: "alpha" }),
    project({ providerProjectId: "   ", repository: "gamma" }),
    project({ providerProjectId: "proj-2", repository: "   " }),
  ]);

  assert.deepEqual(
    normalized.map((entry) => entry.repository),
    ["beta"],
  );
});
