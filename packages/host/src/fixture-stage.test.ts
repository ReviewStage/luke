import assert from "node:assert/strict";
import { it } from "vitest";
import { FIXTURE_IDS, FIXTURE_PAGE, fixturePage } from "./fixture-stage.js";

/**
 * fixture-stage.test.ts -- a fixture run's page frames read the fixture's page.
 */

it("a fixture run's page frame reads every version of the fixture's page it lists, and nothing else", () => {
  const read = (version: number) =>
    fixturePage({ taskId: FIXTURE_IDS.TASK, pageId: FIXTURE_PAGE.id, version });
  const listed = Array.from({ length: FIXTURE_PAGE.version }, (_, at) => read(at + 1));

  assert.ok(
    listed.every((answer) => "page" in answer && answer.page.html.includes("Invite funnel")),
  );
  assert.ok("failure" in read(FIXTURE_PAGE.version + 1));
});
