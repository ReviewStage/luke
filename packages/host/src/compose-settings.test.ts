import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH, NO_CREDENTIAL } from "@luke/features";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { ConfigProvider, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { composeSettings } from "./compose-settings.js";
import { HostKernelTag } from "./effect/kernel.js";
import { AppIdentity, Environment } from "./effect/seams.js";
import { hostKernelOver } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";
import { fixedAccountSource } from "./testing/fixed-account-source.js";

/**
 * The settings concern's own hosted clients, built before the account is and
 * so linked to its credential late: a call goes out as the linked credential
 * would, which for a cookie session is with no header at all.
 */

const SERVICE_BASE_URL = "https://luke.example.test";

it.effect(
  "a linked credential with no authorization reaches a settings client's request with no header",
  () => {
    const requests: { readonly url: string; readonly authorization: string | null }[] = [];
    /** The service, answering every request and keeping what each carried. */
    const service: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, authorization: request.headers.get("authorization") });
      return new Response(null, { status: 204 });
    };
    return Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("luke-settings-credential-");
      const machine = Layer.mergeAll(
        Layer.succeed(
          HostKernelTag,
          hostKernelOver({
            stateRoot,
            // A run that sends, so the counted events leave on a flush.
            runMode: runModeFor({ capture: false, fixture: false }),
            accountBaseUrl: `${SERVICE_BASE_URL}/api/auth`,
            now: () => 0,
            createId: () => "id",
            report: () => undefined,
            emit: () => undefined,
          }),
        ),
        Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
        // A version the counted events allowlist reads, so the launch is counted.
        Layer.succeed(AppIdentity, { appVersion: "1.0.0", packaged: false }),
        fixedAccountSource(),
        NodeFileSystem.layer,
        NodePath.layer,
      );
      const settings = yield* Effect.provide(composeSettings(), machine);
      yield* settings.link({
        credential: NO_CREDENTIAL,
        setVoice: () => Effect.void,
        endLiveSession: Effect.void,
      });
      // The lifetime arms the counted events and counts this launch.
      yield* settings.lifetime;

      yield* settings.flushProductEvents;

      const sent = requests.filter(
        (request) => request.url === `${SERVICE_BASE_URL}${HOSTED_SERVICE_PATH.EVENTS}`,
      );
      assert.ok(sent.length > 0, "the launch's count was sent");
      for (const request of sent) assert.equal(request.authorization, null);
    }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, service),
      Effect.provide([NodeFileSystem.layer, NodePath.layer]),
    );
  },
);
