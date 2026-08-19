import assert from "node:assert/strict";
import test from "node:test";
import {
  maximumObservedWorkspaceProjects,
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  staleWorkspaceProjectDefaults,
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

test("a default naming no offered project is stale, host segment and all", () => {
  const offeredProject = project({ providerProjectId: "proj-1", providerTargetId: "local" });
  const offered = [offeredProject];

  // What an earlier build stored: the project id alone, before the host that
  // owns it joined the identity. It matches nothing offered, so it steers
  // nothing — the whole reason the row must stop showing it.
  assert.deepEqual(staleWorkspaceProjectDefaults(offered, { conductor: "proj-1" }), ["conductor"]);
  assert.deepEqual(
    staleWorkspaceProjectDefaults(offered, {
      conductor: workspaceProjectSelectionId(offeredProject),
    }),
    [],
  );
});

test("a provider offering nothing keeps the default it holds", () => {
  // Offering nothing is observing nothing — a signed-out CLI, a cold cache at
  // launch, a fixture run. A default must not be discarded on that silence.
  assert.deepEqual(staleWorkspaceProjectDefaults([], { conductor: "proj-1" }), []);
  assert.deepEqual(
    staleWorkspaceProjectDefaults([project({ providerId: "cursor" })], { conductor: "proj-1" }),
    [],
  );
});

test("each provider's default is judged against its own offer alone", () => {
  const stale = staleWorkspaceProjectDefaults(
    [
      project({ providerId: "conductor", providerProjectId: "proj-1" }),
      project({ providerId: "cursor", providerProjectId: "proj-2" }),
      project({ providerId: "superset", providerProjectId: "proj-3" }),
    ],
    { conductor: "proj-1", cursor: "gone", superset: undefined },
  );

  assert.deepEqual(stale, ["cursor"]);
  assert.deepEqual(staleWorkspaceProjectDefaults([project({})], undefined), []);
});

test("a valid default beyond the bounded display roster is not stale", () => {
  const hiddenProject = project({
    providerProjectId: "proj-z",
    repository: "repository-z",
  });
  const offered = [
    ...Array.from({ length: maximumObservedWorkspaceProjects }, (_, index) =>
      project({
        providerProjectId: `proj-${String(index).padStart(2, "0")}`,
        repository: `repository-${String(index).padStart(2, "0")}`,
      }),
    ),
    hiddenProject,
  ];
  const stored = workspaceProjectSelectionId(hiddenProject);

  assert.equal(
    normalizeObservedWorkspaceProjects(offered).some(
      (candidate) => workspaceProjectSelectionId(candidate) === stored,
    ),
    false,
  );
  assert.deepEqual(staleWorkspaceProjectDefaults(offered, { conductor: stored }), []);
  assert.equal(
    normalizeObservedWorkspaceProjects(offered, { conductor: stored }).some(
      (candidate) => workspaceProjectSelectionId(candidate) === stored,
    ),
    true,
  );
});
