// compose-account.test.ts -- session replay's answer across an account deletion and a later sign-in, and the account's access across a read and a sign-out, over the desktop's account source; and a browser tab's account steps refused rather than dying, a change during the launch's read heard, and a sign-in's count sent before the tab leaves, over the cookie source.
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { OpenConsent } from "@repo/credentials";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { PRODUCT_ACCOUNT_ACTION, PRODUCT_EVENT, PRODUCT_PLATFORM } from "@repo/features/analytics";
import { SIGN_IN_FAILURE } from "@repo/features/words";
import { GATEWAY_EVENT, type GatewayEventKind, RefusedRefusal } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { isRecord, type WireValue } from "@repo/wire";
import { jsonResponse } from "@repo/wire/testing";
import { ConfigProvider, Effect, Fiber, Layer, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { vi } from "vitest";
import { composeAccount } from "./compose-account.js";
import { composeSettings } from "./compose-settings.js";
import { type CookieSessionDoor, cookieAccountSourceLayer } from "./cookie-account-source.js";
import { HostKernelTag } from "./effect/kernel.js";
import { AppIdentity, Environment, SecretCipher, SignInConsent } from "./effect/seams.js";
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
}) => desktopAccount({ ...input, consent: grantingConsent, signedIn: true });

/**
 * The account concern over the desktop's own account source and the real
 * settings store, holding a signed-in account where `signedIn` asks for one,
 * its sign-ins taken through `consent`.
 */
const desktopAccount = (input: {
  readonly kernel: HostKernel;
  readonly machine: Layer.Layer<AppIdentity>;
  readonly consent: OpenConsent;
  readonly signedIn: boolean;
  /** The host's capability gate, as `compose-host.ts` links it; none moves nothing. */
  readonly capabilities?: {
    readonly startCapabilities: Effect.Effect<void>;
    readonly stopCapabilities: Effect.Effect<void>;
  };
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
          Layer.succeed(SignInConsent, { open: input.consent }),
        ),
      ),
      NodeFileSystem.layer,
      NodePath.layer,
    );
    // Settings' lifetime is not run, so its counted events stay disarmed and send nothing.
    const settings = yield* Effect.provide(composeSettings(), machine);
    if (input.signedIn) {
      yield* Effect.orDie(
        settings.store.setAccount({
          accessToken: "access-1",
          refreshToken: "refresh-1",
          id: "user-1",
          email: "dev@example.com",
          provider: ACCOUNT_PROVIDER.GITHUB,
        }),
      );
    }
    const account = yield* Effect.provide(composeAccount({ settings }), machine);
    yield* account.link(
      input.capabilities ?? { startCapabilities: Effect.void, stopCapabilities: Effect.void },
    );
    yield* account.lifetime;
    return account;
  });

it.effect(
  "a session that stays signed in as another person, as a renewal whose identity read names someone else, stops the last person's capabilities before starting the next's, and a new address for the same person stops nothing",
  () => {
    /** Who the account service's identity read names. */
    let named = { sub: "user-1", email: "dana@example.com" };
    const identity: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url === `${ACCOUNT_BASE_URL}/oauth2/userinfo`) return jsonResponse(named);
      return accountService(input, init);
    };
    return Effect.gen(function* () {
      // Note that the identity read runs on a flight of its own, outside this test's services, so it reaches the platform's fetch.
      vi.spyOn(globalThis, "fetch").mockImplementation(identity);
      const stateRoot = yield* temporaryDirectoryScoped("account-switch-");
      const gate: string[] = [];
      const kernel = hostKernelOver({
        stateRoot,
        runMode: runModeFor({ capture: false, fixture: false }),
        accountBaseUrl: ACCOUNT_BASE_URL,
        now: () => 0,
        createId: () => "id",
        report: () => undefined,
        emit: () => undefined,
      });
      const account = yield* desktopAccount({
        kernel,
        machine: Layer.succeed(AppIdentity, {
          appVersion: "0.0.0-test",
          packaged: false,
          platform: PRODUCT_PLATFORM.DESKTOP,
        }),
        consent: grantingConsent,
        signedIn: true,
        capabilities: {
          startCapabilities: Effect.sync(() => void gate.push("start")),
          stopCapabilities: Effect.sync(() => void gate.push("stop")),
        },
      });
      const emailNow = () => {
        const now = account.session.snapshot();
        return now.status === ACCOUNT_STATUS.SIGNED_IN ? now.email : undefined;
      };

      // The identity read names the stored person at a new address, then at another.
      yield* account.session.refreshOnce();
      named = { sub: "user-1", email: "dana@new.example.com" };
      yield* account.session.refreshOnce();
      yield* until(() => emailNow() === "dana@new.example.com");
      assert.equal(emailNow(), "dana@new.example.com");
      assert.deepEqual(gate, []);

      named = { sub: "user-2", email: "eli@example.com" };
      yield* account.session.refreshOnce();
      yield* until(() => gate.length === 2);
      assert.deepEqual(gate, ["stop", "start"]);
    }).pipe(
      Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())),
      Effect.provideService(FetchHttpClient.Fetch, identity),
      Effect.provide([NodeFileSystem.layer, NodePath.layer]),
    );
  },
);

it.effect("a sign-in after a deletion in the same run lets session replay record again", () =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("account-replay-");
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
      machine: Layer.succeed(AppIdentity, {
        appVersion: "0.0.0-test",
        packaged: false,
        platform: PRODUCT_PLATFORM.DESKTOP,
      }),
    });
    assert.deepEqual(yield* account.sessionReplayState, {
      permitted: true,
      accountId: "user-1",
      email: "dev@example.com",
    });

    // The deletion lands: recording is stood down, signed out, for the rest of the run so far.
    yield* Effect.orDie(account.acts.ACCOUNT_DELETE(undefined));
    yield* until(() => lastPermitted() === false);
    assert.deepEqual(lastReplay(), { permitted: false });
    assert.deepEqual(yield* account.sessionReplayState, { permitted: false });

    // A later sign-in in the same run starts it again, filed under the account that signed in.
    yield* Effect.orDie(account.acts.ACCOUNT_BEGIN_SIGN_IN({ provider: ACCOUNT_PROVIDER.GITHUB }));
    assert.equal(account.signedIn(), true);
    yield* until(() => lastPermitted() === true);
    assert.deepEqual(lastReplay(), {
      permitted: true,
      accountId: "user-2",
      email: "dev@example.com",
    });
    assert.deepEqual(yield* account.sessionReplayState, {
      permitted: true,
      accountId: "user-2",
      email: "dev@example.com",
    });
  }).pipe(
    Effect.provideService(FetchHttpClient.Fetch, accountService),
    Effect.provide([NodeFileSystem.layer, NodePath.layer]),
  ),
);

it.effect(
  "a sign-in that ends without landing answers why as its key, and none of the consent's own words",
  () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("account-failure-");
      const reported: string[] = [];
      const kernel = hostKernelOver({
        stateRoot,
        runMode: runModeFor({ capture: false, fixture: false }),
        accountBaseUrl: ACCOUNT_BASE_URL,
        now: () => 0,
        createId: () => "id",
        report: (line) => {
          reported.push(line);
        },
        emit: () => undefined,
      });
      // A reason a provider's answer could have shaped, which must stay in the host's log.
      const reason = "callback carried code=secret-code";
      for (const failure of Object.values(SIGN_IN_FAILURE)) {
        const account = yield* desktopAccount({
          kernel,
          machine: Layer.succeed(AppIdentity, {
            appVersion: "0.0.0-test",
            packaged: false,
            platform: PRODUCT_PLATFORM.DESKTOP,
          }),
          consent: () => ({
            signInEffect: () => Effect.succeed({ reason, failure }),
            cancel: () => undefined,
            reopen: () => undefined,
          }),
          signedIn: false,
        });
        const answer = yield* Effect.orDie(
          account.acts.ACCOUNT_BEGIN_SIGN_IN({ provider: ACCOUNT_PROVIDER.GOOGLE }),
        );

        assert.deepEqual(answer, { failure }, failure);
        assert.equal(account.signedIn(), false, failure);
      }
      assert.ok(
        reported.some((line) => line.includes(reason)),
        "the reason is kept in the log",
      );
    }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, accountService),
      Effect.provide([NodeFileSystem.layer, NodePath.layer]),
    ),
);

it.effect("an admin's access reaches the windows once read, and a sign-out takes it away", () =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("account-access-");
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
    const lastAccess = () =>
      events.findLast((event) => event.kind === GATEWAY_EVENT.ACCOUNT_ACCESS_CHANGED)?.payload;
    const lastAdmin = () => {
      const access = lastAccess();
      return isRecord(access) ? access.admin : undefined;
    };

    const account = yield* signedInAccount({
      kernel,
      machine: Layer.succeed(AppIdentity, {
        appVersion: "0.0.0-test",
        packaged: false,
        platform: PRODUCT_PLATFORM.DESKTOP,
      }),
    });
    // Nothing is read until the gate opening asks, so nothing is an admin before it, and the read is owed.
    assert.deepEqual(yield* account.accessState, { admin: false, pending: true });

    yield* account.refreshAccess;
    yield* until(() => lastAdmin() === true);
    assert.deepEqual(lastAccess(), { admin: true });
    assert.deepEqual(yield* account.accessState, { admin: true });

    yield* Effect.orDie(account.acts.ACCOUNT_SIGN_OUT(undefined));
    yield* until(() => lastAdmin() === false);
    assert.deepEqual(lastAccess(), { admin: false, pending: true });
    assert.deepEqual(yield* account.accessState, { admin: false, pending: true });
  }).pipe(
    Effect.provideService(FetchHttpClient.Fetch, async (input, init) => {
      const request = new Request(input, init);
      if (request.url === `${SERVICE_BASE_URL}${HOSTED_SERVICE_PATH.ACCOUNT_ACCESS}`)
        return jsonResponse({ admin: true });
      if (request.url.startsWith(`${ACCOUNT_BASE_URL}/`)) return jsonResponse({});
      throw new Error(`this test reaches no network: ${request.url}`);
    }),
    Effect.provide([NodeFileSystem.layer, NodePath.layer]),
  ),
);

/** The browser tab's service, on the tab's own origin, as Better Auth and our routes answer it. */
const TAB_ORIGIN = "https://app.example.test";
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
  /** Whether the tab keeps that a sign-in left it, as its session storage does across the provider's pages. */
  signInLeft: boolean;
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
    const stateRoot = yield* temporaryDirectoryScoped("account-browser-");
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    /** The counts' batches already sent each time the tab left, by the address it left for. */
    const departures: { url: string; countsSent: string[] }[] = [];
    const door: CookieSessionDoor = {
      currentAddress: () => "/",
      navigate: (url, signingIn) =>
        Effect.sync(() => {
          if (signingIn) service.signInLeft = true;
          departures.push({ url, countsSent: [...service.counts] });
        }),
      returnedFromSignIn: Effect.sync(() => {
        const left = service.signInLeft;
        service.signInLeft = false;
        return left;
      }),
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
      // A version the counted events allowlist reads, and packaged as a browser tab is, so the counts are sent.
      Layer.succeed(AppIdentity, {
        appVersion: "1.0.0",
        packaged: true,
        platform: PRODUCT_PLATFORM.DESKTOP,
      }),
      Layer.provide(cookieAccountSourceLayer(door), FetchHttpClient.layer),
      NodeFileSystem.layer,
      NodePath.layer,
    );
    const settings = yield* Effect.provide(composeSettings(), machine);
    const account = yield* Effect.provide(composeAccount({ settings }), machine);
    yield* settings.link({
      credential: account.credential,
      readAccountKey: () => account.token.readAccountKey?.() ?? Effect.succeed(undefined),
      confirmAccount: () => account.session.confirmAccount?.() ?? Effect.void,
    });
    yield* account.link({ startCapabilities: Effect.void, stopCapabilities: Effect.void });
    const launched = yield* Effect.forkScoped(account.lifetime);
    yield* settings.lifetime;
    return { account, settings, events, departures, launched };
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
  signInLeft: false,
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
      const { account, launched } = yield* browserAccount(service);
      yield* Fiber.join(launched);
      const standing = account.snapshot();
      assert.equal(signedInEmail(standing), SESSION_USER.email);

      const steps: readonly (readonly [string, Effect.Effect<unknown, unknown>])[] = [
        ["sign-out", account.acts.ACCOUNT_SIGN_OUT(undefined)],
        [
          "sign-in again",
          account.acts.ACCOUNT_SIGN_IN_AGAIN({ provider: ACCOUNT_PROVIDER.GITHUB }),
        ],
        ["deletion", account.acts.ACCOUNT_DELETE(undefined)],
      ];
      for (const [step, asked] of steps) {
        const answer = yield* Effect.flip(asked);
        assert.ok(answer instanceof RefusedRefusal, step);
        assert.ok(!answer.message.includes("upstream"), step);
        assert.deepEqual(account.snapshot(), standing, step);
      }
      assert.deepEqual(sentry.reported, []);
    }).pipe(Effect.provide(sentry.layer), (body) => inTab(service, body));
  },
);

it.effect(
  "in a browser, a sign-in the service could not start answers that it did not finish, reported to no one, and leaves the tab signed out",
  () => {
    const sentry = recordingReporter();
    const service = tabService({ signedIn: false, stepsDown: true });
    return Effect.gen(function* () {
      const { account, launched, departures } = yield* browserAccount(service);
      yield* Fiber.join(launched);

      // A sign-in answers that it did not finish, in the key the gate says it in.
      const begun = yield* account.acts.ACCOUNT_BEGIN_SIGN_IN({
        provider: ACCOUNT_PROVIDER.GITHUB,
      });
      assert.deepEqual(begun, { failure: SIGN_IN_FAILURE.UNFINISHED });
      assert.deepEqual(account.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
      const again = yield* Effect.flip(
        account.acts.ACCOUNT_SIGN_IN_AGAIN({ provider: ACCOUNT_PROVIDER.GITHUB }),
      );
      assert.ok(again instanceof RefusedRefusal);
      assert.deepEqual(account.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
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
      const { account, settings, events, launched } = yield* browserAccount(service);
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
      // The session is the launch's own account, so, as for a launch that read it itself, no sign-in is counted.
      yield* settings.flushProductEvents;
      assert.ok(service.counts.length > 0, "the launch's counts were sent");
      assert.ok(service.counts.every((batch) => !batch.includes(PRODUCT_EVENT.ACCOUNT_SIGN_IN)));
    }).pipe((body) => inTab(service, body));
  },
);

it.effect(
  "in a browser, a sign-in again's count is sent before the tab leaves for the provider",
  () => {
    const service = tabService({ signedIn: true });
    return Effect.gen(function* () {
      const { account, launched, departures } = yield* browserAccount(service);
      yield* Fiber.join(launched);

      yield* Effect.orDie(
        account.acts.ACCOUNT_SIGN_IN_AGAIN({ provider: ACCOUNT_PROVIDER.GITHUB }),
      );

      const [departure] = departures;
      assert.equal(departure?.url, PROVIDER_CONSENT);
      assert.ok(
        departure.countsSent.some((batch) => batch.includes(PRODUCT_ACCOUNT_ACTION.SIGN_IN_START)),
        "the sign-in's start was counted before the tab left",
      );
    }).pipe((body) => inTab(service, body));
  },
);

it.effect(
  "in a browser, a sign-in that left the tab is counted once, its start with it, on the page it comes back to",
  () => {
    const service = tabService({ signedIn: false });
    /** How many of the counts sent so far are `name`, as a batch's body spells it. */
    const sentCounts = (name: string) =>
      service.counts.join("\n").split(JSON.stringify(name)).length - 1;
    /** One page of the tab, launched and its counts sent, closed as the tab leaves it. */
    const page = <A>(
      body: (tab: Effect.Success<ReturnType<typeof browserAccount>>) => Effect.Effect<A>,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const tab = yield* browserAccount(service);
          yield* Fiber.join(tab.launched);
          const answer = yield* body(tab);
          yield* tab.settings.flushProductEvents;
          return answer;
        }),
      );
    return Effect.gen(function* () {
      yield* page(({ account }) =>
        Effect.orDie(account.acts.ACCOUNT_BEGIN_SIGN_IN({ provider: ACCOUNT_PROVIDER.GITHUB })),
      );
      // The provider signs the person in and sends the tab back to a page of its own, which a reload follows.
      service.signedIn = true;
      yield* page(() => Effect.void);
      yield* page(() => Effect.void);

      assert.equal(sentCounts(PRODUCT_EVENT.ACCOUNT_SIGN_IN), 1);
      assert.equal(sentCounts(PRODUCT_ACCOUNT_ACTION.SIGN_IN_START), 1);
    }).pipe((body) => inTab(service, body));
  },
);
