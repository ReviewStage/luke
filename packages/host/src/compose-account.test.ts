// compose-account.test.ts -- session replay's answer across an account deletion and a later sign-in, over the desktop's account source.
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { OpenConsent } from "@luke/credentials";
import { ACCOUNT_PROVIDER } from "@luke/credentials/snapshot";
import { HOSTED_SERVICE_PATH, VOICE_SERVICE_PATH } from "@luke/features";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { type OpenSocket, SOCKET_OPEN_FAULT } from "@luke/voice";
import { scriptedOpenSocket } from "@luke/voice/testing";
import { HTTP_STATUS, isRecord, type WireRecord, type WireValue } from "@luke/wire";
import { jsonResponse } from "@luke/wire/testing";
import { ConfigProvider, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { composeAccount } from "./compose-account.js";
import { composeSettings } from "./compose-settings.js";
import { HostKernelTag } from "./effect/kernel.js";
import {
  AppIdentity,
  Environment,
  SecretCipher,
  ServiceOrigin,
  SignInConsent,
} from "./effect/seams.js";
import { type HostKernel, hostKernelOver } from "./host-kernel.js";
import { oauthAccountSourceLayer } from "./oauth-account-source.js";
import { runModeFor } from "./run-mode.js";

/**
 * The account concern on an ordinary run, over the real settings store and a
 * kernel whose events the test reads: what it tells the renderers about
 * recording as an account is deleted and another sign-in lands.
 */

const ACCOUNT_BASE_URL = "https://account.example.test/api/auth";
/** The hosted service's origin, which the kernel derives from the account's address. */
const SERVICE_BASE_URL = "https://account.example.test";
const CONTEXT = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** A consent the developer grants at once: the trip is the exchange itself. */
const grantingConsent: OpenConsent = (options) => ({
  signInEffect: () =>
    options.exchange({
      code: "auth-code",
      state: "state",
      redirectUri: "http://127.0.0.1:1/callback",
      codeVerifier: "verifier",
    }),
  cancel: () => undefined,
  reopen: () => undefined,
});

/** The account service, answered: the deletion, then the second sign-in's exchange and identity. */
const accountService: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.url === `${SERVICE_BASE_URL}${HOSTED_SERVICE_PATH.ACCOUNT_DELETE}`)
    return jsonResponse({ deleted: true });
  if (request.url === `${ACCOUNT_BASE_URL}/oauth2/token`)
    return jsonResponse({ access_token: "access-2", refresh_token: "refresh-2" });
  if (request.url === `${ACCOUNT_BASE_URL}/oauth2/userinfo`)
    return jsonResponse({ sub: "user-2", email: "dev@example.com" });
  throw new Error(`this test reaches no network: ${request.url}`);
};

/** Real event-loop turns until `holds`, since the store's file I/O is real. */
const until = (holds: () => boolean) =>
  Effect.promise(async () => {
    for (let turn = 0; turn < 2_000 && !holds(); turn += 1) await nextTurn();
  });

/**
 * The account concern over the real settings store, already holding a
 * signed-in account, linked and started on `machine`'s identity and whatever
 * else it adds.
 */
const signedInAccount = (input: {
  readonly kernel: HostKernel;
  readonly machine: Layer.Layer<AppIdentity>;
  readonly openSocket: OpenSocket;
}) =>
  Effect.gen(function* () {
    const machine = Layer.mergeAll(
      input.machine,
      Layer.succeed(HostKernelTag, input.kernel),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
      // The desktop's own account source. The store keeps an account only
      // where that source's cipher can encrypt one.
      Layer.provide(
        oauthAccountSourceLayer,
        Layer.merge(
          Layer.succeed(SecretCipher, {
            isAvailable: () => true,
            encrypt: (plainText) => new TextEncoder().encode(plainText),
            decrypt: (cipherText) => new TextDecoder().decode(cipherText),
          }),
          Layer.succeed(SignInConsent, { open: grantingConsent }),
        ),
      ),
      NodeFileSystem.layer,
      NodePath.layer,
    );
    // Settings' lifetime is not run, so its counted events stay disarmed and send nothing.
    const settings = yield* Effect.provide(composeSettings(), machine);
    yield* Effect.orDie(
      settings.store.setAccount({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        id: "user-1",
        email: "dev@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      }),
    );
    const account = yield* Effect.provide(
      composeAccount({ settings, openSocket: input.openSocket }),
      machine,
    );
    yield* account.link({ startCapabilities: Effect.void, stopCapabilities: Effect.void });
    yield* account.lifetime;
    return account;
  });

it.effect("a sign-in after a deletion in the same run lets session replay record again", () =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("luke-account-replay-");
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    const kernel = hostKernelOver({
      stateRoot,
      runMode: runModeFor({ capture: false, fixture: false }),
      accountBaseUrl: ACCOUNT_BASE_URL,
      now: () => 0,
      createId: () => "id",
      report: () => undefined,
      emit: (kind, payload) => {
        events.push({ kind, payload });
      },
    });
    const lastReplay = () =>
      events.findLast((event) => event.kind === GATEWAY_EVENT.SESSION_REPLAY_CHANGED)?.payload;
    const lastPermitted = () => {
      const replay = lastReplay();
      return isRecord(replay) ? replay.permitted : undefined;
    };

    const account = yield* signedInAccount({
      kernel,
      machine: Layer.succeed(AppIdentity, { appVersion: "0.0.0-test", packaged: false }),
      openSocket: scriptedOpenSocket([]).openSocket,
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = account.methods[method];
      assert.ok(handler, method);
      return Effect.orDie(handler(params, CONTEXT));
    };
    assert.deepEqual(yield* account.sessionReplayState, { permitted: true, accountId: "user-1" });

    // The deletion lands: recording is stood down, signed out, for the rest of the run so far.
    yield* call(GATEWAY_METHOD.ACCOUNT_DELETE);
    yield* until(() => lastPermitted() === false);
    assert.deepEqual(lastReplay(), { permitted: false });
    assert.deepEqual(yield* account.sessionReplayState, { permitted: false });

    // A later sign-in in the same run starts it again, filed under the account that signed in.
    yield* call(GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN, { provider: ACCOUNT_PROVIDER.GITHUB });
    assert.equal(account.signedIn(), true);
    yield* until(() => lastPermitted() === true);
    assert.deepEqual(lastReplay(), { permitted: true, accountId: "user-2" });
    assert.deepEqual(yield* account.sessionReplayState, { permitted: true, accountId: "user-2" });
  }).pipe(
    Effect.provideService(FetchHttpClient.Fetch, accountService),
    Effect.provide([NodeFileSystem.layer, NodePath.layer]),
  ),
);

it.effect("a packaged host handed a service origin opens its voice socket on that origin", () =>
  Effect.gen(function* () {
    const origin = "https://preview.example.test";
    const stateRoot = yield* temporaryDirectoryScoped("luke-account-origin-");
    const script = scriptedOpenSocket([
      () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: HTTP_STATUS.FORBIDDEN }),
    ]);
    const account = yield* signedInAccount({
      // The kernel as `hostKernelLayer` builds it over that origin.
      kernel: hostKernelOver({
        stateRoot,
        runMode: runModeFor({ capture: false, fixture: false }),
        accountBaseUrl: `${origin}/api/auth`,
        now: () => 0,
        createId: () => "id",
        report: () => undefined,
        emit: () => undefined,
      }),
      machine: Layer.merge(
        Layer.succeed(AppIdentity, { appVersion: "0.0.0-test", packaged: true }),
        Layer.succeed(ServiceOrigin, origin),
      ),
      openSocket: script.openSocket,
    });

    yield* Effect.orDie(account.voiceCapabilities.apply());
    const sessions = account.voiceCapabilities.liveSessions;
    assert.ok(sessions);
    yield* Effect.scoped(sessions.create({ sdpOffer: "v=0\r\n", taskId: "task-1" }));

    assert.equal(script.opens[0]?.url, `wss://preview.example.test${VOICE_SERVICE_PATH.SESSIONS}`);
  }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);
