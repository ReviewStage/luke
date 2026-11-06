import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, vi } from "vitest";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { supportAccessCalls } from "./support-access-calls.js";
import { supportAccessProcedures } from "./support-access-procedures.js";

const ORIGIN = "https://app.test";
const NOW = new Date("2026-11-05T12:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

it.effect(
  "the member grants support access for seven days and revokes it, under their own session",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const member = `user-${randomUUID()}`;
        yield* (yield* Database)
          .insert(user)
          .values({ id: member, name: "Test User", email: `${member}@app.test` });
        const router = {
          supportAccess: supportAccessProcedures({
            resolveSessionUserId: plugin.resolveSessionUserId,
            supportAccess: supportAccessCalls(plugin.api),
          }),
        };
        const ask = (method: string, headers: Record<string, string>) =>
          Effect.flatMap(
            hostedAnswer(
              router,
              Layer.empty,
              new Request(`${ORIGIN}${HOSTED_SERVICE_PATH.ACCOUNT_SUPPORT_ACCESS}`, {
                method,
                headers,
              }),
            ),
            (response) =>
              Effect.promise(async () => {
                const body = (await response.json()) as WireBoundaryInput;
                return { status: response.status, body };
              }),
          );
        const session = { authorization: `Bearer ${yield* plugin.sessionBearerOf(member)}` };

        assert.deepEqual(yield* ask("POST", session), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { supportAccessUntil: NOW.getTime() + SEVEN_DAYS_MS },
        });
        assert.deepEqual(yield* ask("DELETE", session), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { supportAccessUntil: null },
        });
        assert.equal((yield* ask("POST", {})).status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
      }).pipe(Effect.provide(plugin.database));
    }),
);
