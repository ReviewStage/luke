import { expect, it } from "vitest";
import { devBuildBadge } from "./dev-build.js";

it.each([
  { case: "a named instance by its name", instance: "demo", branch: "main", label: "demo" },
  { case: "the plain build by its branch", instance: undefined, branch: "main", label: "main" },
  {
    case: "a long branch by its last word",
    instance: undefined,
    branch: "feat/dock-ribbon",
    label: "ribbon",
  },
  {
    case: "a detached head by the ref near it",
    instance: undefined,
    branch: "fix/merge-queue~2",
    label: "queue",
  },
  { case: "a build with no branch as dev", instance: undefined, branch: undefined, label: "dev" },
])("labels $case", ({ instance, branch, label }) => {
  const commit = { sha: "a1b2c3d", dirty: false, ...(branch ? { branch } : undefined) };
  expect(devBuildBadge({ instance, commit }).label).toBe(label);
});

it("gives a build the same colour on every launch", () => {
  const commit = { sha: "a1b2c3d", dirty: true, branch: "feat/dock-ribbon" };
  const first = devBuildBadge({ commit });
  const again = devBuildBadge({ commit: { ...commit, sha: "f8b5406" } });
  expect(again.color).toBe(first.color);
});
