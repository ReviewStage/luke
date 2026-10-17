import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { DESKTOP_VERSION_HEADER, HOSTED_API_ERROR } from "@luke/features";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { desktopVersionGate } from "./desktop-version-gate.js";
import { HOSTED_HTTP_STATUS } from "./http.js";

const ORIGIN = "https://luke.test";
const PATH = "/api/inbox";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** One request through a router whose one route answers `{ ok: true }`, behind the gate at `minimum`. */
const ask = (minimum: string | undefined, build: string | undefined) =>
  Effect.gen(function* () {
    const route = HttpRouter.add("GET", PATH, HttpServerResponse.jsonUnsafe({ ok: true }));
    const { handler, dispose } = HttpRouter.toWebHandler(
      Layer.merge(route, desktopVersionGate(minimum)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      handler(
        new Request(new URL(PATH, ORIGIN), {
          headers: build === undefined ? {} : { [DESKTOP_VERSION_HEADER]: build },
        }),
      ),
    );
    // SAFETY: both the route and the refusal answer JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

const ANSWERED: Answer = { status: HOSTED_HTTP_STATUS.OK, body: { ok: true } };
const REFUSED: Answer = {
  status: HOSTED_HTTP_STATUS.UPGRADE_REQUIRED,
  body: { error: HOSTED_API_ERROR.UPDATE_REQUIRED },
};

it.effect("a desktop older than the minimum is refused with update-required", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask("0.17.0", "0.16.9"), REFUSED);
    assert.deepEqual(yield* ask("1.0.0", "0.99.99"), REFUSED);
    assert.deepEqual(yield* ask("0.17.2", "0.17.1"), REFUSED);
  }),
);

it.effect("a desktop at or past the minimum is answered", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask("0.17.0", "0.17.0"), ANSWERED);
    assert.deepEqual(yield* ask("0.17.0", "0.17.0-beta.1"), ANSWERED);
    assert.deepEqual(yield* ask("0.17.0", "0.18.0"), ANSWERED);
    assert.deepEqual(yield* ask("0.9.0", "0.10.0"), ANSWERED);
  }),
);

it.effect("with no minimum set, no desktop is refused", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask(undefined, "0.0.1"), ANSWERED);
  }),
);

it.effect("a minimum that names no release refuses nobody", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask("latest", "0.0.1"), ANSWERED);
  }),
);

it.effect("a caller that names no build, or no release, is never refused for it", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask("0.17.0", undefined), ANSWERED);
    assert.deepEqual(yield* ask("0.17.0", "dev"), ANSWERED);
  }),
);
