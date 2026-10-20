import assert from "node:assert/strict";
import { test } from "vitest";
import { releaseTags } from "../scripts/release-meta";
import { RELEASE_META } from "../scripts/release-meta-name";

/**
 * release-meta.test.ts -- the app's page names the commit its deployment was
 * built from, which a tab open across a release reads to know it is stale;
 * no other page names it, and a build that names no commit writes nothing.
 * Synthetic commit.
 */

const COMMIT = "1111111111111111111111111111111111111111";

test("the app's page names the deployment's commit", () => {
  assert.deepEqual(releaseTags(COMMIT, "/repo/apps/web/app.html"), [
    { tag: "meta", attrs: { name: RELEASE_META, content: COMMIT }, injectTo: "head" },
  ]);
});

test("no other page names it, and a build with no commit writes nothing", () => {
  assert.deepEqual(releaseTags(COMMIT, "/repo/apps/web/index.html"), []);
  assert.deepEqual(releaseTags(COMMIT, "/repo/apps/web/admin.html"), []);
  assert.deepEqual(releaseTags("", "/repo/apps/web/app.html"), []);
});
