/**
 * orpc-account-route.test.ts -- a revision of the account's plan template, reached at its public path through the committed table, the dispatcher and the deployed route.
 *
 * The revision's number is a path segment the committed rewrite carries on
 * whole (its row is marked oRPC), so the deployed router reads it from the
 * path: a number that reads reaches the procedure, which then refuses an
 * unsigned caller as the old group did, and one that does not is refused as
 * a request that does not read, before the caller is, as the old group read
 * the number first. The signed-in reads and writes, which need a database,
 * are `packages/service/src/accounts/account-plan-template.test.ts`'s.
 */

import assert from "node:assert/strict";
import { HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { HTTP_METHOD } from "@luke/wire";
import { afterEach, beforeEach, test, vi } from "vitest";
import { orpcRoute } from "../server/orpc-route.js";
import { disposeWebRuntime } from "../server/runtime.js";
import { dispatched } from "./support/platform-landing.js";

/** The web runtime's layer names a database; nothing here queries it, so it is never dialled (`route-effect.test.ts`). */
const PLACEHOLDER_DATABASE_URL = "postgresql://orpc:route@127.0.0.1:5432/luke";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

const ORIGIN = "https://luke.test";
const REVISIONS = `${ORIGIN}/api/account/plan-template/revisions`;

const ROUTES = new Map([
  ["account/plan-template/revision", orpcRoute],
  ["account/plan-template/restore", orpcRoute],
]);

test("a revision's public path reaches its procedure through the committed rewrite, which refuses an unsigned caller", async () => {
  for (const request of [
    new Request(`${REVISIONS}/3`),
    new Request(`${REVISIONS}/3/restore`, { method: HTTP_METHOD.POST }),
  ]) {
    const answer = await dispatched(request, ROUTES);
    assert.equal(answer.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
    assert.equal(answer.headers.get("cache-control"), null);
    assert.equal(await answer.text(), '{"error":"invalid-token"}');
  }
});

test("a revision's path whose number does not read is refused as an invalid request, before the caller is", async () => {
  const answer = await dispatched(new Request(`${REVISIONS}/abc`), ROUTES);
  assert.equal(answer.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
  assert.equal(await answer.text(), '{"error":"invalid-request"}');
});
