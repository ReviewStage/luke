/**
 * mac-command-client.test.ts -- the Mac's side of the commands its account's agents queue, as the Mac observes it.
 *
 * The held read names the kinds this Mac runs and answers the commands the
 * service claimed for it, a command of a kind this build does not know
 * read as its id and kind alone rather than spoiling the read, and it
 * outlasts the service's hold before it gives up as nothing; a result is
 * posted as the service reads it, and is taken or not.
 *
 * Synthetic bearers, ids, and commands throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  fakeCloudApi,
  HTTP_STATUS,
  type RecordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { accountBearer } from "./account-call.js";
import { HostedMacCommandClient } from "./mac-command-client.js";
import { MAC_COMMAND_KIND, type MacCommand, type MacCommandResult } from "./mac-command-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const BASE_URL = "https://luke.test";
const COMMAND_ID = "11111111-1111-4111-8111-111111111111";

const COMMAND: MacCommand = {
  id: COMMAND_ID,
  kind: MAC_COMMAND_KIND.SHELL,
  command: "git status",
  timeoutSeconds: 60,
};

const NEWER_ID = "22222222-2222-4222-8222-222222222222";

const RESULT: MacCommandResult = {
  exitCode: 0,
  stdout: "nothing to commit\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

function client(): HostedMacCommandClient {
  return new HostedMacCommandClient({
    serviceBaseUrl: BASE_URL,
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
      readAccountKey: () => Effect.succeed("account-1"),
    }),
  });
}

/** Lets the client's promise steps run until it has asked, so the deadline is armed before the clock moves. */
function untilAsked(requests: readonly RecordedRequest[]): Effect.Effect<void> {
  return Effect.gen(function* () {
    while (requests.length === 0) yield* Effect.yieldNow;
  });
}

it.effect("a held read names this Mac's kinds and answers the commands claimed for it", () =>
  Effect.gen(function* () {
    const newer = { id: NEWER_ID, kind: "hologram", timeoutSeconds: 60, beam: true };
    const api = fakeCloudApi({
      "GET /api/mac-commands": { answer: () => ({ commands: [COMMAND, newer] }) },
    });

    const kinds = [MAC_COMMAND_KIND.SHELL, MAC_COMMAND_KIND.BROWSER];
    const waiting = yield* Effect.provide(client().waiting(kinds), api.layer);

    assert.deepEqual(waiting, [COMMAND, { id: NEWER_ID, kind: "hologram" }]);
    assert.deepEqual(api.credentials(), ["token-1"]);
    assert.equal(api.requests()[0]?.searchParams.get("kinds"), "shell,browser");
  }),
);

it.effect("a held read outlasts the service's hold, then gives up as nothing", () =>
  Effect.gen(function* () {
    const silent = recordingHttpClient(() => new Promise<Response>(() => undefined));

    const read = yield* Effect.forkChild(
      Effect.provide(client().waiting([MAC_COMMAND_KIND.SHELL]), silent.layer),
    );
    yield* untilAsked(silent.requests);
    yield* TestClock.adjust("34 seconds");
    assert.equal(read.pollUnsafe(), undefined, "still held short of its deadline");
    yield* TestClock.adjust("1 second");

    assert.equal(yield* Fiber.join(read), undefined);
  }),
);

it.effect("a result is posted as the service reads it, and is taken or not", () =>
  Effect.gen(function* () {
    const taken = fakeCloudApi({ "POST /api/mac-commands": { answer: () => ({ settled: true }) } });

    assert.equal(yield* Effect.provide(client().settle(COMMAND_ID, RESULT), taken.layer), true);
    const [posted] = taken.requests();
    assert.deepEqual(JSON.parse(posted?.body ?? ""), { id: COMMAND_ID, result: RESULT });

    const unknown = fakeCloudApi({
      "POST /api/mac-commands": {
        answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });
    assert.equal(yield* Effect.provide(client().settle(COMMAND_ID, RESULT), unknown.layer), false);
  }),
);
