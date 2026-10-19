import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  fixedBearer,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  HostedFactoryWorldClient,
} from "@luke/features";
import { FACTORY_WORLD_CALL_FAILURE } from "@luke/features/factory-world-view";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@luke/gateway";
import type { WireRecord } from "@luke/wire";
import { jsonResponse, type RecordedRequest, recordingHttpClient } from "@luke/wire/testing";
import { Effect } from "effect";
import { composeFactory } from "./compose-factory.js";

/**
 * The Factory concern, through the real hosted client over an HTTP double:
 * the world is asked of the service under the account's bearer, for the
 * workspace the window named, and the window hears it whole, an empty world
 * and no world alike; a workspace the account is not in is not found, and
 * an answer the wire does not read is unanswered; behind a closed gate, or
 * on a run that sends nothing, nothing travels; params of the wrong shape
 * are refused before anything does. Synthetic ids and names.
 */

const WORKSPACE_ID = "workspace-1";
const ORIGIN = "https://tryluke.test";

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** A world with its zones alone: no agent, nothing shipped, nothing planned. */
const QUIET_WORLD = {
  snapshotAt: 1_000,
  shippedSince: 0,
  repository: { fullName: "acme/relay", defaultBranch: "main" },
  zones: [{ path: ".", label: "acme/relay", files: 1, bytes: 10, dependsOn: [] }],
  agents: [],
  shipped: [],
  planned: [],
  defects: [],
};

function subject(
  respond: (request: RecordedRequest) => Response,
  options: { signedIn?: boolean; sendsNetwork?: boolean } = {},
) {
  return Effect.gen(function* () {
    const http = recordingHttpClient(respond);
    const composer = yield* composeFactory({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: new HostedFactoryWorldClient({
        serviceBaseUrl: ORIGIN,
        credential: fixedBearer("bearer-1"),
      }),
    }).pipe(Effect.provide(http.layer));
    const world = (params: WireRecord) => {
      const handler = composer.methods[GATEWAY_METHOD.FACTORY_WORLD];
      assert.ok(handler, "no handler for the world");
      return handler(params, context);
    };
    return { world, requests: http.requests };
  });
}

it.effect(
  "the world is asked for the workspace named under the account's bearer, and heard whole, an empty world and no world alike",
  () =>
    Effect.gen(function* () {
      const answers = [{ world: QUIET_WORLD }, { world: null }];
      const { world, requests } = yield* subject(() => jsonResponse(answers.shift() ?? null));

      assert.deepEqual(yield* world({ workspaceId: WORKSPACE_ID }), { world: QUIET_WORLD });
      assert.deepEqual(yield* world({ workspaceId: WORKSPACE_ID }), { world: null });
      assert.deepEqual(
        requests.map((request) => [
          request.method,
          request.url,
          request.authorization,
          request.body,
        ]),
        Array.from({ length: 2 }, () => [
          "POST",
          `${ORIGIN}${HOSTED_SERVICE_PATH.FACTORY_WORLD}`,
          "Bearer bearer-1",
          JSON.stringify({ workspaceId: WORKSPACE_ID }),
        ]),
      );
    }),
);

it.effect(
  "a workspace the account is not in is not found, and an answer the wire does not read is unanswered",
  () =>
    Effect.gen(function* () {
      const answers = [
        jsonResponse({ error: HOSTED_API_ERROR.NOT_FOUND }, 404),
        jsonResponse({ world: { ...QUIET_WORLD, zones: "every directory" } }),
      ];
      const { world } = yield* subject(() => answers.shift() ?? jsonResponse(null));

      assert.deepEqual(yield* world({ workspaceId: WORKSPACE_ID }), {
        failure: FACTORY_WORLD_CALL_FAILURE.NOT_FOUND,
      });
      assert.deepEqual(yield* world({ workspaceId: WORKSPACE_ID }), {
        failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED,
      });
    }),
);

it.effect("behind a closed account gate, or on a run that sends nothing, nothing travels", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
      const { world, requests } = yield* subject(() => jsonResponse({ world: null }), options);

      assert.deepEqual(yield* world({ workspaceId: WORKSPACE_ID }), {
        failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(requests, []);
    }
  }),
);

it.effect("params of the wrong shape are refused before anything travels", () =>
  Effect.gen(function* () {
    const { world, requests } = yield* subject(() => jsonResponse({ world: null }));

    const unnamed = yield* Effect.flip(world({ workspace: WORKSPACE_ID }));

    assert.equal(unnamed._tag, "InvalidParamsRefusal");
    assert.deepEqual(requests, []);
  }),
);
