import assert from "node:assert/strict";
import { test } from "vitest";
import { AREA_PATH, PULL_REQUEST_AREA_BOUNDS, pullRequestAreasOf } from "./pull-request-area.js";

test("a file counts in its directory cut four deep, a shallower one in its own, and a root file at the root", () => {
  const areas = pullRequestAreasOf([
    { path: "packages/service/src/agents/x.ts", additions: 10, deletions: 2 },
    { path: "packages/service/src/agents/brain/turn.ts", additions: 5, deletions: 1 },
    { path: "apps/web/vite.config.ts", additions: 3, deletions: 0 },
    { path: "README.md", additions: 1, deletions: 1 },
  ]);

  assert.deepEqual(areas, [
    { path: "packages/service/src/agents", additions: 15, deletions: 3 },
    { path: "apps/web", additions: 3, deletions: 0 },
    { path: AREA_PATH.ROOT, additions: 1, deletions: 1 },
  ]);
});

test("areas run largest first by lines changed, equal ones by path, and a file that changed no lines still marks its directory", () => {
  const areas = pullRequestAreasOf([
    { path: "b/one.ts", additions: 2, deletions: 2 },
    { path: "c/moved.ts", additions: 0, deletions: 0 },
    { path: "a/one.ts", additions: 4, deletions: 0 },
    { path: "d/one.ts", additions: 0, deletions: 9 },
  ]);

  assert.deepEqual(
    areas.map((area) => area.path),
    ["d", "a", "b", "c"],
  );
});

test("past the bound the largest areas stand and the rest fold into one remainder, last, losing no line", () => {
  const directories = PULL_REQUEST_AREA_BOUNDS.MAX_AREAS + 4;
  const files = Array.from({ length: directories }, (_, index) => ({
    path: `zone-${String(index).padStart(2, "0")}/file.ts`,
    additions: (directories - index) * 10,
    deletions: 1,
  }));

  const areas = pullRequestAreasOf(files);

  assert.equal(areas.length, PULL_REQUEST_AREA_BOUNDS.MAX_AREAS);
  assert.deepEqual(areas.at(0), { path: "zone-00", additions: 200, deletions: 1 });
  assert.deepEqual(areas.at(-2), { path: "zone-14", additions: 60, deletions: 1 });
  // Note that zone-15 through zone-19 add 50 + 40 + 30 + 20 + 10 lines and remove one each.
  assert.deepEqual(areas.at(-1), { path: AREA_PATH.REST, additions: 150, deletions: 5 });
});

test("a pull request that changed no files touched no area", () => {
  assert.deepEqual(pullRequestAreasOf([]), []);
});
