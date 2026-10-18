/**
 * host.test.ts -- a handler that dies refuses that one call as internal, and the defect is reported to whatever `ErrorReporter` stands; a handler's own refusal is an answer and is not.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, ErrorReporter } from "effect";
import { gatewayHost } from "./host.js";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, NotFoundRefusal } from "./protocol.js";

it.effect(
  "a handler that dies is refused as internal and reported; a refusal is answered and not",
  () => {
    const reported: string[] = [];
    const reporter = ErrorReporter.layer([
      ErrorReporter.make(({ error }) => {
        reported.push(error.message);
      }),
    ]);
    return Effect.gen(function* () {
      const host = gatewayHost({
        client: { clientId: "operator", role: GATEWAY_CLIENT_ROLE.OPERATOR },
        methods: {
          [GATEWAY_METHOD.TASKS_REFRESH]: () => Effect.die(new TypeError("board is undefined")),
          [GATEWAY_METHOD.TASKS_OPEN]: () =>
            Effect.fail(new NotFoundRefusal({ message: "No such task." })),
        },
      });
      const died = yield* host.call(GATEWAY_METHOD.TASKS_REFRESH);
      const refused = yield* host.call(GATEWAY_METHOD.TASKS_OPEN);
      assert.deepEqual(
        [died.ok ? undefined : died.error.message, refused.ok ? undefined : refused.error.message],
        ["board is undefined", "No such task."],
      );
      assert.deepEqual(reported, ["board is undefined"]);
    }).pipe(Effect.provide(reporter));
  },
);
