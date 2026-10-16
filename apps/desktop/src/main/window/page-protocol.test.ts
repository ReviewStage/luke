import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageVersion } from "@luke/features/page-wire";
import { TASK_CALL_FAILURE, type TasksPageParams } from "@luke/features/tasks-view";
import { Effect } from "effect";
import { pageResponse } from "./page-protocol";

/**
 * The `luke-page:` scheme as a frame meets it: the version its address names,
 * served under a policy that leaves the page no network and no reach outside
 * its sandbox, and not found for anything else. The service is a table of
 * synthetic versions.
 */

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const CHART: PageVersion = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 2,
  at: 1_800_000_000_000,
  html: "<!doctype html><script>document.body.textContent = 'sent'</script>",
};

/** The service as the host reads it for a frame: the one version above, of the one plan. */
const readPage = (page: TasksPageParams) =>
  Effect.succeed(
    page.taskId === PLAN_ID && page.pageId === CHART.id && page.version === CHART.version
      ? { page: CHART }
      : { failure: TASK_CALL_FAILURE.UNANSWERED },
  );

/** The policy's directives by name, each with its sources. */
function directivesOf(response: Response): ReadonlyMap<string, string> {
  const policy = response.headers.get("content-security-policy") ?? "";
  return new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources.join(" ")];
    }),
  );
}

it.effect(
  "a page's address answers its HTML, with its own scripts and cdnjs allowed, and no network",
  () =>
    Effect.gen(function* () {
      const response = yield* pageResponse(
        pageFrameUrl({ taskId: PLAN_ID, pageId: CHART.id, version: 2 }),
        readPage,
      );
      const policy = directivesOf(response);

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(yield* Effect.promise(() => response.text()), CHART.html);
      assert.equal(policy.get("default-src"), "'none'");
      assert.equal(policy.get("connect-src"), "'none'");
      assert.equal(policy.get("form-action"), "'none'");
      assert.equal(policy.get("sandbox"), "allow-scripts");
      assert.match(
        policy.get("script-src") ?? "",
        /'unsafe-inline'.*https:\/\/cdnjs\.cloudflare\.com/,
      );
      assert.ok(!policy.get("img-src")?.includes("https:"));
    }),
);
