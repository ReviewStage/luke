// compose-account.test.ts -- session replay's answer across an account deletion and a later sign-in, over the desktop's account source; and a browser tab's account steps refused rather than dying, a change during the launch's read heard, and a sign-in's count sent before the tab leaves, over the cookie source.
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { OpenConsent } from "@luke/credentials";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { HOSTED_SERVICE_PATH, VOICE_SERVICE_PATH } from "@luke/features";
import { PRODUCT_ACCOUNT_ACTION } from "@luke/features/analytics";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
  gatewayHost,
} from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { type OpenSocket, SOCKET_OPEN_FAULT } from "@luke/voice";
import { scriptedOpenSocket } from "@luke/voice/testing";
import { HTTP_STATUS, isRecord, type WireRecord, type WireValue } from "@luke/wire";
import { jsonResponse } from "@luke/wire/testing";
import { ConfigProvider, Effect, Fiber, Layer, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { composeAccount } from "./compose-account.js";
import { composeSettings } from "./compose-settings.js";
import { type CookieSessionDoor, cookieAccountSourceLayer } from "./cookie-account-source.js";
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
import { recordingReporter } from "./testing/recording-reporter.js";

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

/** The browser tab's service, on the tab's own origin, as Better Auth and Luke's routes answer it. */
const TAB_ORIGIN = "https://luke.example.test";
const BROWSER_CONTEXT = { clientId: "browser", role: GATEWAY_CLIENT_ROLE.OPERATOR };
const PROVIDER_CONSENT = "https://github.com/login/oauth/authorize?state=state-1";
const SESSION_USER = {
  id: "user-1",
  email: "dev@example.com",
  lastLoginMethod: ACCOUNT_PROVIDER.GITHUB,
} as const;

interface TabService {
  /** Whether a session stands behind the tab's cookie. */
  signedIn: boolean;
  /** Whether every account step (a sign-in, a sign-out, a deletion) meets an outage. */
  stepsDown: boolean;
  /** Holds the next session read's answer until this settles. */
  heldRead?: Promise<void> | undefined;
  /** Every request, by path, in the order sent. */
  readonly sent: string[];
  /** The bodies of every batch of counts sent. */
  readonly counts: string[];
}

const ACCOUNT_STEPS: readonly string[] = [
  "/api/auth/sign-in/social",
  "/api/auth/link-social",
  "/api/auth/sign-out",
  HOSTED_SERVICE_PATH.ACCOUNT_DELETE,
];

/** The scripted service behind the platform fetch, which the cookie source and the settings ride. */
const tabFetch =
  (service: TabService): typeof globalThis.fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    service.sent.push(path);
    if (service.stepsDown && ACCOUNT_STEPS.includes(path))
      return new Response("upstream detail", { status: 503 });
    switch (path) {
      case "/api/auth/get-session": {
        const held = service.heldRead;
        service.heldRead = undefined;
        if (held) await held;
        return jsonResponse(
          service.signedIn ? { session: { id: "session-1" }, user: SESSION_USER } : null,
        );
      }
      case "/api/auth/sign-in/social":
      case "/api/auth/link-social":
        return jsonResponse({ url: PROVIDER_CONSENT, redirect: true });
      case HOSTED_SERVICE_PATH.EVENTS:
        service.counts.push(await request.text());
        return new Response(null, { status: 204 });
      default:
        return new Response(null, { status: 204 });
    }
  };

/**
 * The account concern in a browser tab, over the cookie source and the real
 * settings store, linked as the host links them and armed to send its
 * counts. Its lifetime is forked, so a test can act while the launch reads.
 */
const browserAccount = (service: TabService) =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("luke-account-browser-");
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    /** The counts' batches already sent each time the tab left, by the address it left for. */
    const departures: { url: string; countsSent: string[] }[] = [];
    const door: CookieSessionDoor = {
      currentAddress: () => "/",
      navigate: (url) =>
        Effect.sync(() => void departures.push({ url, countsSent: [...service.counts] })),
      revisits: Stream.never,
    };
    const machine = Layer.mergeAll(
      Layer.succeed(
        HostKernelTag,
        hostKernelOver({
          stateRoot,
          runMode: runModeFor({ capture: false, fixture: false }),
          accountBaseUrl: `${TAB_ORIGIN}/api/auth`,
          now: () => 0,
          createId: () => "id",
          report: () => undefined,
          emit: (kind, payload) => {
            events.push({ kind, payload });
          },
        }),
      ),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
      // A version the counted events allowlist reads, so the counts are sent.
      Layer.succeed(AppIdentity, { appVersion: "1.0.0", packaged: false }),
      Layer.provide(cookieAccountSourceLayer(door), FetchHttpClient.layer),
      NodeFileSystem.layer,
      NodePath.layer,
    );
    const settings = yield* Effect.provide(composeSettings(), machine);
    const account = yield* Effect.provide(
      composeAccount({ settings, openSocket: scriptedOpenSocket([]).openSocket }),
      machine,
    );
    yield* settings.link({
      credential: account.credential,
      readAccountKey: () => account.token.readAccountKey?.() ?? Effect.succeed(undefined),
      confirmAccount: () => account.session.confirmAccount?.() ?? Effect.void,
      setVoice: () => Effect.void,
      endLiveSession: Effect.void,
    });
    yield* account.link({ startCapabilities: Effect.void, stopCapabilities: Effect.void });
    const launched = yield* Effect.forkScoped(account.lifetime);
    yield* settings.lifetime;
    const gateway = gatewayHost({ methods: account.methods, client: BROWSER_CONTEXT });
    return { account, gateway, events, departures, launched };
  });

/** `body` over a tab whose every request, the settings' own counts among them, reaches `service`. */
const inTab = <A, E, R>(service: TabService, body: Effect.Effect<A, E, R>) =>
  body.pipe(
    Effect.provideService(FetchHttpClient.Fetch, tabFetch(service)),
    Effect.provide([NodeFileSystem.layer, NodePath.layer]),
  );

const tabService = (initial: Partial<TabService>): TabService => ({
  signedIn: true,
  stepsDown: false,
  sent: [],
  counts: [],
  ...initial,
});

/** The signed-in person's address, and nothing for any other account. */
const signedInEmail = (payload: WireValue | AccountSnapshot | undefined) =>
  isRecord(payload) && payload.status === ACCOUNT_STATUS.SIGNED_IN ? payload.email : undefined;

it.effect(
  "in a browser, a sign-out, a sign-in again and a deletion the service could not carry are refused, reported to no one, and leave the account standing",
  () => {
    const sentry = recordingReporter();
    const service = tabService({ signedIn: true, stepsDown: true });
    return Effect.gen(function* () {
      const { account, gateway, launched } = yield* browserAccount(service);
      yield* Fiber.join(launched);
      const standing = account.snapshot();
      assert.equal(signedInEmail(standing), SESSION_USER.email);

      for (const [method, params] of [
        [GATEWAY_METHOD.ACCOUNT_SIGN_OUT, {}],
        [GATEWAY_METHOD.ACCOUNT_SIGN_IN_AGAIN, { provider: ACCOUNT_PROVIDER.GITHUB }],
        [GATEWAY_METHOD.ACCOUNT_DELETE, {}],
      ] as const) {
        const answer = yield* gateway.call(method, params);
        assert.equal(answer.ok, false, method);
        assert.equal(!answer.ok && answer.error.code, GATEWAY_ERROR.REFUSED, method);
        assert.ok(!answer.ok && !answer.error.message.includes("upstream"), method);
        assert.deepEqual(account.snapshot(), standing, method);
      }
      assert.deepEqual(sentry.reported, []);
    }).pipe(Effect.provide(sentry.layer), (body) => inTab(service, body));
  },
);

it.effect(
  "in a browser, a sign-in the service could not start is refused, reported to no one, and leaves the tab signed out",
  () => {
    const sentry = recordingReporter();
    const service = tabService({ signedIn: false, stepsDown: true });
    return Effect.gen(function* () {
      const { account, gateway, launched, departures } = yield* browserAccount(service);
      yield* Fiber.join(launched);

      for (const method of [
        GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN,
        GATEWAY_METHOD.ACCOUNT_SIGN_IN_AGAIN,
      ] as const) {
        const answer = yield* gateway.call(method, { provider: ACCOUNT_PROVIDER.GITHUB });
        assert.equal(!answer.ok && answer.error.code, GATEWAY_ERROR.REFUSED, method);
        assert.deepEqual(account.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT }, method);
      }
      assert.deepEqual(departures, []);
      assert.deepEqual(sentry.reported, []);
    }).pipe(Effect.provide(sentry.layer), (body) => inTab(service, body));
  },
);

it.effect(
  "in a browser, a session that lands while the launch reads reaches the panel as an account change",
  () => {
    let release: () => void = () => undefined;
    const service = tabService({
      signedIn: false,
      heldRead: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    return Effect.gen(function* () {
      const { account, events, launched } = yield* browserAccount(service);
      yield* until(() => service.sent.includes("/api/auth/get-session"));

      // A sign-in lands elsewhere, and a refused call's re-read settles on it while the launch's read is held.
      service.signedIn = true;
      yield* account.token.refreshAccount();
      release();
      yield* Fiber.join(launched);

      const changed = () =>
        events.some(
          (event) =>
            event.kind === GATEWAY_EVENT.ACCOUNT_CHANGED &&
            signedInEmail(event.payload) === SESSION_USER.email,
        );
      yield* until(changed);
      assert.equal(changed(), true);
    }).pipe((body) => inTab(service, body));
  },
);

it.effect(
  "in a browser, a sign-in again's count is sent before the tab leaves for the provider",
  () => {
    const service = tabService({ signedIn: true });
    return Effect.gen(function* () {
      const { gateway, launched, departures } = yield* browserAccount(service);
      yield* Fiber.join(launched);

      const answer = yield* gateway.call(GATEWAY_METHOD.ACCOUNT_SIGN_IN_AGAIN, {
        provider: ACCOUNT_PROVIDER.GITHUB,
      });

      assert.equal(answer.ok, true);
      const [departure] = departures;
      assert.equal(departure?.url, PROVIDER_CONSENT);
      assert.ok(
        departure.countsSent.some((batch) => batch.includes(PRODUCT_ACCOUNT_ACTION.SIGN_IN_START)),
        "the sign-in's start was counted before the tab left",
      );
    }).pipe((body) => inTab(service, body));
  },
);
