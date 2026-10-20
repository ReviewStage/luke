/**
 * mac-command-client.test.ts -- the Mac's side of the commands its account's agents queue, as the Mac observes it.
 *
 * The live read names the kinds this Mac runs and the account it is for,
 * and reads a refused session as signed out; a claim answers the command
 * granted or nothing; a result is posted as the service reads it, and is
 * taken or not.
 *
 * Synthetic bearers, ids, and commands throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@luke/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import { LIVE_SIGNED_OUT } from "./live-wire.js";
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

it.effect(
  "the live read names the kinds and the account it is for, and one the service refuses as no session is signed out",
  () =>
    Effect.gen(function* () {
      const sealed = {
        url: "wss://realtime.example/v1",
        queries: {
          commands: { capability: "c", queryFingerprint: "f", expiresAt: 1_800_000_060_000 },
        },
      };
      const api = fakeCloudApi({ "GET /api/live/mac-commands": { answer: () => sealed } });
      const kinds = [MAC_COMMAND_KIND.SHELL];

      assert.deepEqual(yield* Effect.provide(client().live(kinds, "user-mac"), api.layer), sealed);
      const asked = new URL(api.requests()[0]?.url ?? BASE_URL);
      assert.equal(asked.searchParams.get("userId"), "user-mac");
      assert.equal(asked.searchParams.get("kinds"), "shell");

      const refused = fakeCloudApi({
        "GET /api/live/mac-commands": {
          answer: () => ({ error: HOSTED_API_ERROR.INVALID_TOKEN }),
          status: HTTP_STATUS.UNAUTHORIZED,
        },
      });
      assert.deepEqual(
        yield* Effect.provide(client().live(kinds, "user-mac"), refused.layer),
        LIVE_SIGNED_OUT,
      );
    }),
);

it.effect("a claim answers the command granted to this Mac, and nothing where it was not", () =>
  Effect.gen(function* () {
    const granted = fakeCloudApi({
      "POST /api/mac-commands/claim": { answer: () => ({ command: COMMAND }) },
    });
    assert.deepEqual(yield* Effect.provide(client().claim(COMMAND_ID), granted.layer), COMMAND);
    assert.deepEqual(JSON.parse(granted.requests()[0]?.body ?? ""), { id: COMMAND_ID });

    const taken = fakeCloudApi({
      "POST /api/mac-commands/claim": {
        answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });
    assert.equal(yield* Effect.provide(client().claim(COMMAND_ID), taken.layer), undefined);
  }),
);
