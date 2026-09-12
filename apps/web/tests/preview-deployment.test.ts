import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Exit, Fiber, Redacted, TestClock } from "effect";
import { test } from "vitest";
import {
  DEPLOYMENT_STATE,
  type DeploymentRecord,
  type DeploymentStatus,
  decidePreview,
  PREVIEW_STATE,
  waitForPreview,
} from "../server/preview-deployment.js";

const PREVIEW = "https://luke-abc123-stage-review.vercel.app";
const SOURCE = {
  repository: "ReviewStage/luke",
  sha: "e8dd1314fdbbb8fe5d28f7e9863a3a87e4c3c7a8",
  token: Redacted.make("ghs_token"),
};

const record = (id: number, created_at: string, environment = "Preview"): DeploymentRecord => ({
  id,
  sha: SOURCE.sha,
  environment,
  created_at,
});

const status = (
  state: DeploymentStatus["state"],
  created_at: string,
  rest: Partial<Pick<DeploymentStatus, "description" | "environment_url" | "target_url">> = {},
): DeploymentStatus => ({ state, created_at, ...rest });

test("the newest preview record's newest status decides the reading, a cancelled one waited through", () => {
  const older = record(1, "2026-09-12T08:00:00Z");
  const newer = record(2, "2026-09-12T08:05:00Z");
  const production = record(3, "2026-09-12T08:06:00Z", "Production");
  const readings = [
    decidePreview([], () => []),
    decidePreview([production], () => [status(DEPLOYMENT_STATE.SUCCESS, "2026-09-12T08:07:00Z")]),
    decidePreview([older, newer], () => []),
    decidePreview([older, newer], (which) =>
      which.id === 2 ? [status(DEPLOYMENT_STATE.IN_PROGRESS, "2026-09-12T08:05:01Z")] : [],
    ),
    decidePreview([older, newer], () => [
      status(DEPLOYMENT_STATE.PENDING, "2026-09-12T08:05:01Z"),
      status(DEPLOYMENT_STATE.SUCCESS, "2026-09-12T08:07:00Z", {
        description: "Deployment has completed",
        environment_url: PREVIEW,
      }),
    ]),
    decidePreview([newer], () => [
      status(DEPLOYMENT_STATE.SUCCESS, "2026-09-12T08:07:00Z", { target_url: PREVIEW }),
    ]),
    decidePreview([newer], () => [
      status(DEPLOYMENT_STATE.INACTIVE, "2026-09-12T08:05:01Z", {
        description: "Skipped - Not affected",
        environment_url: PREVIEW,
      }),
    ]),
    decidePreview([newer], () => [
      status(DEPLOYMENT_STATE.INACTIVE, "2026-09-12T08:05:01Z", {
        description: "Canceled from the Vercel Dashboard",
      }),
    ]),
    decidePreview([newer], () => [
      status(DEPLOYMENT_STATE.FAILURE, "2026-09-12T08:06:00Z", {
        description: "Deployment has failed",
      }),
    ]),
    decidePreview([newer], () => [status(DEPLOYMENT_STATE.SUCCESS, "2026-09-12T08:07:00Z")]),
  ];
  assert.deepEqual(readings, [
    { kind: PREVIEW_STATE.WAITING },
    { kind: PREVIEW_STATE.WAITING },
    { kind: PREVIEW_STATE.WAITING },
    { kind: PREVIEW_STATE.WAITING },
    { kind: PREVIEW_STATE.READY, id: 2, address: PREVIEW },
    { kind: PREVIEW_STATE.READY, id: 2, address: PREVIEW },
    { kind: PREVIEW_STATE.NOT_AFFECTED, id: 2 },
    { kind: PREVIEW_STATE.WAITING },
    {
      kind: PREVIEW_STATE.NOT_BUILT,
      id: 2,
      state: DEPLOYMENT_STATE.FAILURE,
      description: "Deployment has failed",
    },
    { kind: PREVIEW_STATE.NOT_BUILT, id: 2, state: DEPLOYMENT_STATE.SUCCESS, description: "" },
  ]);
});

interface GithubRead {
  readonly path: string;
  readonly sha: string | null;
  readonly authorization: string | null;
}

/** GitHub's deployment records for the head, answered from a script of statuses, one entry per list call. */
function github(script: readonly (readonly DeploymentStatus[] | undefined)[], reads: GithubRead[]) {
  return fakeHttpClientLayer((url, init) => {
    const request = new URL(url);
    reads.push({
      path: request.pathname,
      sha: request.searchParams.get("sha"),
      authorization: new Headers(init.headers).get("authorization"),
    });
    const listCalls = reads.filter((read) => read.sha !== null).length;
    const statuses = script[listCalls - 1];
    if (request.pathname === `/repos/${SOURCE.repository}/deployments`) {
      return Response.json(statuses === undefined ? [] : [record(7, "2026-09-12T08:05:00Z")]);
    }
    return Response.json(statuses ?? []);
  });
}

it.effect("the wait reads the records on its schedule until the preview's record settles", () =>
  Effect.gen(function* () {
    const reads: GithubRead[] = [];
    const layer = github(
      [
        undefined,
        [status(DEPLOYMENT_STATE.IN_PROGRESS, "2026-09-12T08:05:01Z")],
        [status(DEPLOYMENT_STATE.SUCCESS, "2026-09-12T08:06:30Z", { environment_url: PREVIEW })],
      ],
      reads,
    );
    const fiber = yield* Effect.fork(
      waitForPreview(SOURCE, { wait: { intervalMs: 15_000, attempts: 5 } }).pipe(
        Effect.provide(layer),
      ),
    );
    yield* TestClock.adjust("15 seconds");
    yield* TestClock.adjust("15 seconds");
    const reading = yield* Fiber.join(fiber);
    assert.deepEqual(reading, { kind: PREVIEW_STATE.READY, id: 7, address: PREVIEW });
    assert.deepEqual(
      reads.map((read) => read.path),
      [
        `/repos/${SOURCE.repository}/deployments`,
        `/repos/${SOURCE.repository}/deployments`,
        `/repos/${SOURCE.repository}/deployments/7/statuses`,
        `/repos/${SOURCE.repository}/deployments`,
        `/repos/${SOURCE.repository}/deployments/7/statuses`,
      ],
    );
    assert.deepEqual(
      new Set(reads.map((read) => read.authorization)),
      new Set(["Bearer ghs_token"]),
    );
    assert.deepEqual(
      new Set(reads.filter((read) => read.sha !== null).map((read) => read.sha)),
      new Set([SOURCE.sha]),
    );
  }),
);

it.effect(
  "a wait whose budget ends before the record settles fails by name rather than probing nothing",
  () =>
    Effect.gen(function* () {
      const reads: GithubRead[] = [];
      const fiber = yield* Effect.fork(
        waitForPreview(SOURCE, { wait: { intervalMs: 1_000, attempts: 2 } }).pipe(
          Effect.provide(github([], reads)),
        ),
      );
      yield* TestClock.adjust("1 second");
      yield* TestClock.adjust("1 second");
      const exit = yield* Fiber.await(fiber);
      assert.equal(Exit.isFailure(exit), true);
      if (Exit.isFailure(exit)) {
        assert.equal(exit.cause._tag, "Fail");
        if (exit.cause._tag === "Fail") assert.equal(exit.cause.error._tag, "PreviewNotReady");
      }
      assert.equal(reads.length, 3);
    }),
);
