import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { task } from "@repo/database/schemas/task";
import { getTestDB, startTask } from "@repo/database/testing";
import { HTTP_METHOD } from "@repo/wire";
import { jsonResponse, recordedRequest, recordingHttpClient } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { ConfigProvider, Effect, Layer } from "effect";
import { onboardingEventsFromEnvironment, taskActivityReported } from "./onboarding-events.js";
import { WELCOME_MAIL_ENVIRONMENT } from "./welcome-mail.js";

/**
 * An account's task activity as Resend's onboarding reads it: the days it
 * started a task on, counted from its own sign-up, and the latest of them,
 * from its own tasks alone. Synthetic accounts throughout.
 */

const SIGNED_UP_AT = Date.parse("2026-11-01T09:00:00.000Z");

const HOUR_MS = 60 * 60 * 1_000;

const DAY_MS = 24 * HOUR_MS;

const openUser = (createdAt: Date) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    const email = `${userId}@app.test`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email, createdAt });
    return { userId, email };
  });

const startTaskAt = (userId: string, at: number) =>
  Effect.gen(function* () {
    const started = yield* startTask(userId, { name: "A task" });
    yield* Database.use((db) =>
      db
        .update(task)
        .set({ createdAt: new Date(at) })
        .where(eq(task.id, started.id)),
    );
  });

it.layer(getTestDB())("onboarding task activity", (it) => {
  it.effect(
    "an account's task days are counted from its own sign-up, over its own tasks alone",
    () =>
      Effect.gen(function* () {
        const ada = yield* openUser(new Date(SIGNED_UP_AT));
        const grace = yield* openUser(new Date(SIGNED_UP_AT));
        // Day 0 in its first and last hour, day 2 from its first instant, and day 8; Grace's on day 5 is not Ada's.
        yield* startTaskAt(ada.userId, SIGNED_UP_AT + HOUR_MS);
        yield* startTaskAt(ada.userId, SIGNED_UP_AT + DAY_MS - HOUR_MS);
        yield* startTaskAt(ada.userId, SIGNED_UP_AT + 2 * DAY_MS);
        yield* startTaskAt(ada.userId, SIGNED_UP_AT + 8 * DAY_MS + HOUR_MS);
        yield* startTaskAt(grace.userId, SIGNED_UP_AT + 5 * DAY_MS);

        const resend = recordingHttpClient(() => jsonResponse({ object: "contact" }));
        yield* taskActivityReported(ada.userId).pipe(
          Effect.provide(
            onboardingEventsFromEnvironment.pipe(
              Layer.provide(
                Layer.merge(
                  resend.layer,
                  ConfigProvider.layer(
                    ConfigProvider.fromUnknown({
                      [WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY]: "re_test",
                      [WELCOME_MAIL_ENVIRONMENT.FROM]: "Charles <charles@app.test>",
                    }),
                  ),
                ),
              ),
            ),
          ),
        );

        assert.equal(resend.requests.length, 1);
        const request = recordedRequest(resend.requests);
        assert.equal(request.method, HTTP_METHOD.PATCH);
        assert.equal(decodeURIComponent(request.pathname), `/contacts/${ada.email}`);
        assert.deepEqual(JSON.parse(request.body ?? "{}"), {
          properties: { has_task: 1, task_days: 3, last_task_day: 8 },
        });
      }),
  );
});
