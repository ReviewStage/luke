import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, startTask } from "@repo/database/testing";
import { type Context, Effect, Option } from "effect";
import {
  recordingProductAnalytics,
  SERVER_AGENT_TOOL,
  SERVER_EVENT,
} from "../events/server-events.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { taskFilesProcedures } from "./task-files-procedures.js";

/**
 * A picture added to a description through the plan files procedures, over a real
 * dialect: the member who adds one is counted as having added a file to the
 * description, in the plan's workspace, and one who may not write the description is
 * refused and counted for nothing.
 *
 * Synthetic accounts, bearers, workspaces, and tasks throughout.
 */

const ORIGIN = "https://app.test";

/** The eight bytes every PNG begins with, as the `data:` URL the Mac sends a picture as. */
const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** What the procedures counted, across the file; a test reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );
  return id;
});

/** A picture sent to the description under the account's bearer, as its status. */
const keepAs = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    // SAFETY: the procedures yield the database, the clock and the analytics alone, which the test's own context holds.
    const services = (yield* Effect.context<never>().pipe(
      Effect.provide(ANALYTICS.layer),
    )) as Context.Context<WebServices>;
    const handle = hostedFetch({
      taskFiles: taskFilesProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
      }),
    });
    const response = yield* Effect.promise(() =>
      handle(
        new Request(new URL(`/api/plans/${taskId}/attachments`, ORIGIN), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${userId}` },
          body: JSON.stringify({ picture: PNG }),
        }),
        services,
      ),
    );
    return response.status;
  });

it.layer(getTestDB())("the plan files route", (it) => {
  it.effect(
    "a picture added to a description is counted under the member in the plan's workspace, and one refused is not",
    () =>
      Effect.gen(function* () {
        const [starter, outsider] = [yield* openAccount, yield* openAccount];
        const task = yield* startTask(starter, { name: "Teammate invitations" });

        const refused = yield* keepAs(outsider, task.id);
        const kept = yield* keepAs(starter, task.id);

        assert.equal(refused, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(kept, HOSTED_HTTP_STATUS.CREATED);
        const countedFor = (userId: string) =>
          ANALYTICS.recorded
            .filter(
              (event) => event.userId === userId && event.name === SERVER_EVENT.AGENT_TOOL_OPEN,
            )
            .map((event) => ({ workspaceId: event.workspaceId, ...event.properties }));
        assert.deepEqual(countedFor(starter), [
          { workspaceId: task.workspaceId, tool: SERVER_AGENT_TOOL.ADD_TO_DESCRIPTION },
        ]);
        assert.deepEqual(countedFor(outsider), []);
      }),
  );
});
