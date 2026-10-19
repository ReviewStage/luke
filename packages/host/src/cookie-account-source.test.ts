// cookie-account-source.test.ts -- a browser tab's account over the service's cookie session: read, signed into, signed out of, lost on a refused call, recovered after a launch blip, and what settings key on.
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { accountCall, HOSTED_SERVICE_PATH, NO_CREDENTIAL } from "@luke/features";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@luke/gateway";
import { LIVE_VOICE } from "@luke/live";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { EXPERIMENT } from "@luke/settings";
import { scriptedOpenSocket } from "@luke/voice/testing";
import { ACTION_RESULT_STATUS, HTTP_METHOD, isRecord } from "@luke/wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";
import type { AccountSourceHost } from "./account-source.js";
import { composeAccount } from "./compose-account.js";
import { composeSettings } from "./compose-settings.js";
import {
  type CookieSessionDoor,
  CookieSessionFailed,
  cookieAccountSourceLayer,
} from "./cookie-account-source.js";
import { HostKernelTag } from "./effect/kernel.js";
import { AccountSource, AppIdentity, Environment } from "./effect/seams.js";
import { EXPERIMENT_ACCOUNT_CHANGED } from "./experiment-write.js";
import { hostKernelOver } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";
import { SettingsStore } from "./settings-store.js";
import { fixedAccountSource } from "./testing/fixed-account-source.js";

/**
 * The cookie source over a scripted service on the tab's own origin. A
 * synthetic account throughout; no request carries an `Authorization`,
 * since the cookie is the browser's and rides the request on its own.
 */

const ORIGIN = "https://luke.example.test";
const ACCOUNT_BASE_URL = `${ORIGIN}/api/auth`;
const PROVIDER_CONSENT = "https://github.com/login/oauth/authorize?state=state-1";
/** A hosted route the account reaches, which refuses a request with no session behind it. */
const HOSTED_ROUTE = HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE;
const CONTEXT = { client: { clientId: "browser", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

const USER = {
  id: "user-1",
  email: "dev@example.com",
  name: "Dev",
  image: "https://avatars.githubusercontent.com/u/1?v=4",
  lastLoginMethod: ACCOUNT_PROVIDER.GITHUB,
} as const;

interface ServiceState {
  user: Record<string, string> | undefined;
  /** How many session reads answer as an outage before the service answers again. */
  outages: number;
  experiments: Record<string, boolean>;
  /** The preferences the account saved, and when; none for an account that saved none. */
  preferences: Record<string, string>;
  updatedAt?: number;
  /** Whether the service's sign-out is unreachable. */
  signOutDown?: boolean;
}

/** The service's routes over `state`, answered as Better Auth and Luke's routes answer them. */
function respond(
  state: ServiceState,
  request: Pick<RecordedRequest, "method" | "pathname" | "body">,
): Response {
  switch (request.pathname) {
    case "/api/auth/get-session":
      if (state.outages > 0) {
        state.outages -= 1;
        return new Response(null, { status: 503 });
      }
      return jsonResponse(state.user ? { session: { id: "session-1" }, user: state.user } : null);
    case "/api/auth/sign-in/social":
    case "/api/auth/link-social":
      return jsonResponse({ url: PROVIDER_CONSENT, redirect: true });
    case "/api/auth/sign-out":
      if (state.signOutDown) return new Response(null, { status: 503 });
      state.user = undefined;
      return jsonResponse({ success: true });
    case HOSTED_SERVICE_PATH.ACCOUNT_DELETE:
      state.user = undefined;
      return jsonResponse({ deleted: true });
    case HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES:
      if (request.method === HTTP_METHOD.PUT) {
        const body = JSON.parse(request.body ?? "{}");
        state.experiments = { ...state.experiments, ...body.experiments };
        if (body.preferences) {
          state.preferences = body.preferences;
          state.updatedAt = 2;
        }
      }
      return jsonResponse({
        preferences: state.preferences,
        experiments: state.experiments,
        ...(state.updatedAt === undefined ? undefined : { updatedAt: state.updatedAt }),
      });
    case HOSTED_ROUTE:
      return state.user
        ? jsonResponse({ template: null })
        : jsonResponse({}, HTTP_STATUS.UNAUTHORIZED);
    default:
      return new Response(null, { status: 204 });
  }
}

/** A scripted service, the tab's door, and what the account gate was asked to do. */
function scene(initial: Partial<ServiceState> = {}) {
  const state: ServiceState = {
    user: { ...USER },
    outages: 0,
    experiments: {},
    preferences: {},
    ...initial,
  };
  const service = recordingHttpClient((request) => respond(state, request));
  const navigated: string[] = [];
  const gate: string[] = [];
  /** Held open where a test wants the gate's opening still under way. */
  let opening: Effect.Effect<void> = Effect.void;
  let revisitQueue: Queue.Queue<void> | undefined;
  const revisits = Effect.gen(function* () {
    revisitQueue ??= yield* Queue.unbounded<void>();
    return revisitQueue;
  });
  const door: CookieSessionDoor = {
    currentAddress: () => "/plan/task-1?tab=inbox",
    navigate: (url) => Effect.sync(() => void navigated.push(url)),
    revisits: Stream.unwrap(Effect.map(revisits, Stream.fromQueue)),
  };
  /** The person coming back to the tab. */
  const revisit = Effect.flatMap(revisits, (queue) => Queue.offer(queue, undefined));
  const host: AccountSourceHost = {
    // The cookie source keeps no account in the settings file, so it never reads one.
    store: {
      readAccount: () => Effect.die("the cookie source reads no stored account"),
      setAccount: () => Effect.die("the cookie source stores no account"),
      // A departure drops what the settings kept for the account.
      clearAccount: () =>
        Effect.sync(() => {
          gate.push("forget");
          return { status: ACCOUNT_STATUS.SIGNED_OUT } as const;
        }),
      accountSnapshot: () => Effect.die("the cookie source reads no stored account"),
      // An arrival settles the settings on whoever arrives.
      settleSessionAccount: (email) => Effect.sync(() => void gate.push(`settle ${email}`)),
    },
    accountBaseUrl: ACCOUNT_BASE_URL,
    hostedServiceBaseUrl: ORIGIN,
    runMode: runModeFor({ capture: false, fixture: false }),
    report: () => undefined,
    openExternal: async () => undefined,
    startCapabilities: Effect.suspend(() => opening).pipe(
      Effect.andThen(Effect.sync(() => void gate.push("open"))),
    ),
    stopCapabilities: Effect.sync(() => void gate.push("close")),
  };
  const open = Effect.gen(function* () {
    const source = yield* AccountSource;
    assert.equal(source.tokenCipher, undefined);
    return yield* source.open(host);
  }).pipe(Effect.provide(Layer.provide(cookieAccountSourceLayer(door), service.layer)));
  const sent = (pathname: string) =>
    service.requests.filter((request) => request.pathname === pathname);
  const holdOpening = (until: Effect.Effect<void>) => {
    opening = until;
  };
  return { state, service, navigated, gate, open, sent, holdOpening, revisit };
}

/** Advances the test clock a second at a time, letting each read land, until `fiber` ends. */
const runOut = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    for (let second = 0; second < 60 && fiber.pollUnsafe() === undefined; second += 1) {
      yield* Effect.promise(() => nextTurn());
      yield* TestClock.adjust("1 second");
    }
    return yield* Fiber.join(fiber);
  });

describe("the cookie account source", () => {
  it.effect("is signed in as the user get-session names", () =>
    Effect.gen(function* () {
      const { open, service, gate } = scene();
      const session = yield* open;

      const account = yield* session.initialize;

      assert.deepEqual(account, {
        status: ACCOUNT_STATUS.SIGNED_IN,
        id: USER.id,
        email: USER.email,
        name: USER.name,
        pictureUrl: USER.image,
        provider: ACCOUNT_PROVIDER.GITHUB,
      });
      assert.deepEqual(session.snapshot(), account);
      assert.deepEqual(gate, [`settle ${USER.email}`]);
      assert.equal(yield* session.token.readAccessToken(), undefined);
      assert.equal(yield* session.token.readAccountKey?.() ?? Effect.void, USER.email);
      assert.ok(service.requests.every((request) => request.authorization === undefined));
    }).pipe(Effect.scoped),
  );

  it.effect("reads a session whose last sign-in names no known provider as no account", () =>
    Effect.gen(function* () {
      const { open } = scene({ user: { ...USER, lastLoginMethod: "email" } });
      const session = yield* open;

      assert.deepEqual(yield* session.initialize, { status: ACCOUNT_STATUS.SIGNED_OUT });
    }).pipe(Effect.scoped),
  );

  it.effect("begins a sign-in at the provider, coming back to where the tab stands", () =>
    Effect.gen(function* () {
      const { open, navigated, sent } = scene({ user: undefined });
      const session = yield* open;
      yield* session.initialize;

      const account = yield* session.beginSignIn(ACCOUNT_PROVIDER.GITHUB);

      assert.deepEqual(account, { status: ACCOUNT_STATUS.SIGNING_IN });
      const [request] = sent("/api/auth/sign-in/social");
      assert.ok(request);
      assert.equal(request.method, HTTP_METHOD.POST);
      assert.deepEqual(JSON.parse(request.body ?? ""), {
        provider: ACCOUNT_PROVIDER.GITHUB,
        callbackURL: "/plan/task-1?tab=inbox",
      });
      assert.deepEqual(navigated, [PROVIDER_CONSENT]);
    }).pipe(Effect.scoped),
  );

  it.effect("signs out on the service and stands signed out", () =>
    Effect.gen(function* () {
      const { open, sent, gate } = scene();
      const session = yield* open;
      yield* session.initialize;

      const account = yield* session.signOut({ revokeRemote: true });

      assert.deepEqual(account, { status: ACCOUNT_STATUS.SIGNED_OUT });
      assert.deepEqual(session.snapshot(), account);
      assert.equal(sent("/api/auth/sign-out")[0]?.method, HTTP_METHOD.POST);
      // The settings are dropped before the gate's closing publishes them.
      assert.deepEqual(gate.slice(1), ["forget", "close"]);
      assert.equal(yield* session.token.readAccountKey?.() ?? Effect.void, undefined);
    }).pipe(Effect.scoped),
  );

  it.effect("stays signed in where the service could not end the session", () =>
    Effect.gen(function* () {
      const { open, gate } = scene({ signOutDown: true });
      const session = yield* open;
      const signedIn = yield* session.initialize;

      const failure = yield* Effect.flip(session.signOut({ revokeRemote: true }));

      assert.ok(failure instanceof CookieSessionFailed);
      assert.deepEqual(session.snapshot(), signedIn);
      assert.deepEqual(gate, [`settle ${USER.email}`]);
    }).pipe(Effect.scoped),
  );

  it.effect("settles on another person's session when the tab is revisited", () =>
    Effect.gen(function* () {
      const { open, state, gate, revisit } = scene();
      const session = yield* open;
      yield* session.initialize;

      // Another tab signs in as someone else; this one hears of it on the person's return.
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      yield* revisit;
      while (gate.at(-1) !== "open") yield* Effect.promise(() => nextTurn());

      const account = session.snapshot();
      assert.equal(account.status === ACCOUNT_STATUS.SIGNED_IN && account.id, "user-2");
      assert.deepEqual(gate.slice(1), ["forget", "settle other@example.com", "close", "open"]);
    }).pipe(Effect.scoped),
  );

  it.effect("signs out once a hosted call is refused and the session is gone", () =>
    Effect.gen(function* () {
      const { open, state, service, sent } = scene();
      const session = yield* open;
      yield* session.initialize;
      const call = accountCall({ baseUrl: ORIGIN, credential: session.credential });

      // The session ends elsewhere, such as a sign-out in another tab.
      state.user = undefined;
      const answer = yield* Effect.provide(
        call.send({ method: HTTP_METHOD.GET, path: HOSTED_ROUTE }),
        service.layer,
      );

      assert.ok("response" in answer);
      assert.equal(answer.response.status, HTTP_STATUS.UNAUTHORIZED);
      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
      // Read once at launch and once more on the refusal; the refusal was not retried.
      assert.equal(sent("/api/auth/get-session").length, 2);
      assert.equal(sent(HOSTED_ROUTE).length, 1);
      assert.ok(service.requests.every((request) => request.authorization === undefined));
    }).pipe(Effect.scoped),
  );

  it.effect("deletes the account on the service, then stands signed out", () =>
    Effect.gen(function* () {
      const { open, sent, gate } = scene();
      const session = yield* open;
      yield* session.initialize;

      const account = yield* session.deleteEverywhere();

      assert.deepEqual(account, { status: ACCOUNT_STATUS.SIGNED_OUT });
      assert.equal(sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE)[0]?.method, HTTP_METHOD.POST);
      // The account's settings are dropped and its gate closed, in that order.
      assert.deepEqual(gate.slice(1), ["forget", "close"]);
    }).pipe(Effect.scoped),
  );

  it.effect("recovers a signed-in launch whose first reads met an outage", () =>
    Effect.gen(function* () {
      const { open, gate } = scene({ outages: 2 });
      const session = yield* open;

      // The launch's read meets the outage and settles signed out.
      assert.deepEqual(yield* session.initialize, { status: ACCOUNT_STATUS.SIGNED_OUT });

      // The launch's refresh meets it once more, then reads again and lands.
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      yield* runOut(refreshed);

      assert.equal(session.snapshot().status, ACCOUNT_STATUS.SIGNED_IN);
      assert.deepEqual(gate, [`settle ${USER.email}`, "open"]);
    }).pipe(Effect.scoped),
  );

  it.effect("closes the gate for one person before opening it for another", () =>
    Effect.gen(function* () {
      const { open, state, gate } = scene();
      const session = yield* open;
      yield* session.initialize;

      // Another tab signs in as someone else.
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      yield* session.refreshOnce();

      const account = session.snapshot();
      assert.equal(account.status === ACCOUNT_STATUS.SIGNED_IN && account.id, "user-2");
      assert.deepEqual(gate.slice(1), ["forget", "settle other@example.com", "close", "open"]);
    }).pipe(Effect.scoped),
  );

  it.effect("closes the gate on a sign-out made while a refresh's opening is under way", () =>
    Effect.gen(function* () {
      const { open, state, gate, holdOpening } = scene({ user: undefined });
      const session = yield* open;
      yield* session.initialize;
      const release = yield* Deferred.make<void>();
      holdOpening(Deferred.await(release));

      // A refresh finds the session and starts opening the gate; the sign-out lands before it ends.
      state.user = { ...USER };
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      yield* Effect.promise(() => nextTurn());
      const signedOut = yield* Effect.forkChild(session.signOut({ revokeRemote: true }));
      yield* Effect.promise(() => nextTurn());
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(refreshed);
      yield* Fiber.join(signedOut);

      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
      // The held opening finishes first; the sign-out's closing comes after it, and last.
      assert.ok(gate.indexOf("open") < gate.indexOf("close"));
      assert.equal(gate.at(-1), "close");
    }).pipe(Effect.scoped),
  );

  it.effect("draws the same person anew without moving the gate", () =>
    Effect.gen(function* () {
      const { open, state, gate } = scene();
      const session = yield* open;
      yield* session.initialize;

      state.user = { ...USER, name: "Dev Renamed" };
      yield* session.refreshOnce();

      const account = session.snapshot();
      assert.equal(account.status === ACCOUNT_STATUS.SIGNED_IN && account.name, "Dev Renamed");
      // Only the launch's own arrival touched the settings or the gate.
      assert.deepEqual(gate, [`settle ${USER.email}`]);
    }).pipe(Effect.scoped),
  );
});

/**
 * Real event-loop turns until `holds`, since the settings store's file I/O is
 * real; a wait that never holds is ended by the test's own timeout.
 */
const until = (holds: () => Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    while (!(yield* holds())) yield* Effect.promise(() => nextTurn());
  });

it.effect("keys the account's preferences sync and experiments on the cookie session", () => {
  const state: ServiceState = {
    user: { ...USER },
    outages: 0,
    experiments: { [EXPERIMENT.CHAT]: true },
    // The account saved its voice before; this browser's own is another.
    preferences: { voice: LIVE_VOICE.CEDAR },
    updatedAt: 1,
  };
  /** The same scripted service behind the platform fetch, which the settings' own clients ride. */
  const service: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    return respond(state, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      body: await request.text(),
    });
  };
  return Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("luke-cookie-settings-");
    const door: CookieSessionDoor = {
      currentAddress: () => "/",
      navigate: () => Effect.void,
      revisits: Stream.never,
    };
    const machine = Layer.mergeAll(
      Layer.succeed(
        HostKernelTag,
        hostKernelOver({
          stateRoot,
          runMode: runModeFor({ capture: false, fixture: false }),
          accountBaseUrl: ACCOUNT_BASE_URL,
          now: () => 0,
          createId: () => "id",
          report: () => undefined,
          emit: () => undefined,
        }),
      ),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
      Layer.succeed(AppIdentity, { appVersion: "0.0.0-test", packaged: false }),
      Layer.provide(cookieAccountSourceLayer(door), FetchHttpClient.layer),
      NodeFileSystem.layer,
      NodePath.layer,
    );
    const settings = yield* Effect.provide(composeSettings(), machine);
    yield* Effect.orDie(settings.store.set("voice", LIVE_VOICE.ALLOY));
    const account = yield* Effect.provide(
      composeAccount({ settings, openSocket: scriptedOpenSocket([]).openSocket }),
      machine,
    );
    // Linked as the host links them.
    yield* settings.link({
      credential: account.credential,
      readAccountKey: () => account.token.readAccountKey?.() ?? Effect.succeed(undefined),
      confirmAccount: () => account.session.confirmAccount?.() ?? Effect.void,
      setVoice: () => Effect.void,
      endLiveSession: Effect.void,
    });
    yield* account.link({ startCapabilities: Effect.void, stopCapabilities: Effect.void });
    yield* account.lifetime;
    yield* settings.lifetime;
    assert.equal(account.signedIn(), true);

    // The preferences reconcile reads the service under the session's account.
    yield* settings.reconcileAccountPreferences();
    const experiments = Effect.map(
      Effect.orDie(settings.store.snapshot()),
      (snapshot) => snapshot.experiments,
    );
    const voice = Effect.orDie(settings.store.get("voice"));
    yield* until(() => Effect.map(voice, (chosen) => chosen === LIVE_VOICE.CEDAR));
    assert.equal((yield* experiments)[EXPERIMENT.CHAT], true);
    // The voice the account saved is applied here, and the service keeps it.
    assert.equal(yield* voice, LIVE_VOICE.CEDAR);
    assert.deepEqual(state.preferences, { voice: LIVE_VOICE.CEDAR });

    // An experiment's switch is written for the same account and lands.
    const set = settings.methods[GATEWAY_METHOD.EXPERIMENTS_SET];
    assert.ok(set);
    const result = yield* Effect.orDie(set({ experiment: EXPERIMENT.FACTORY, on: true }, CONTEXT));
    assert.ok(isRecord(result));
    assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal((yield* experiments)[EXPERIMENT.FACTORY], true);
    assert.equal(state.experiments[EXPERIMENT.FACTORY], true);

    // Another tab signs in as someone else; a switch pressed here for the first account is sent for no one.
    state.user = { ...USER, id: "user-2", email: "other@example.com" };
    const stale = yield* Effect.orDie(set({ experiment: EXPERIMENT.BROWSER, on: true }, CONTEXT));
    assert.ok(isRecord(stale));
    assert.equal(stale.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(stale.reason, EXPERIMENT_ACCOUNT_CHANGED);
    assert.equal(state.experiments[EXPERIMENT.BROWSER], undefined);
    assert.equal(yield* account.token.readAccountKey?.() ?? Effect.void, "other@example.com");
    // The first account's choices are no longer drawn for the one now signed in.
    assert.equal((yield* experiments)[EXPERIMENT.FACTORY], undefined);
    assert.equal(yield* voice, undefined);
  }).pipe(
    Effect.provideService(FetchHttpClient.Fetch, service),
    Effect.provide([NodeFileSystem.layer, NodePath.layer]),
  );
});

/** Who a store's session names, moved by the test. */
interface SignedIn {
  email: string | undefined;
}

describe("a settings store that keeps no account of its own", () => {
  const ADA = "ada@example.com";
  const BOB = "bob@example.com";

  /** A cipher-less store over `directory`, its session naming whoever `signedIn` holds. */
  const storeOver = (directory: string, signedIn: SignedIn) =>
    Effect.gen(function* () {
      return new SettingsStore({
        directory: () => directory,
        cipher: undefined,
        sessionAccountEmail: () => Effect.sync(() => signedIn.email),
        overrides: { voice: undefined },
        fileSystem: yield* FileSystem.FileSystem,
        path: yield* Path.Path,
      });
    });

  it.effect("keeps the session account's experiments across a reopen, for that account alone", () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-cookie-store-");
      const signedIn: SignedIn = { email: ADA };
      const store = yield* storeOver(directory, signedIn);
      assert.equal(yield* store.cacheExperiments(ADA, { [EXPERIMENT.FACTORY]: true }), true);

      const reopened = yield* storeOver(directory, signedIn);
      assert.equal((yield* reopened.snapshot()).experiments[EXPERIMENT.FACTORY], true);
      signedIn.email = BOB;
      assert.equal((yield* reopened.snapshot()).experiments[EXPERIMENT.FACTORY], undefined);
    }).pipe(Effect.orDie, Effect.provide([NodeFileSystem.layer, NodePath.layer])),
  );

  it.effect(
    "drops the preferences kept for an account once another is signed in, or it leaves",
    () =>
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped("luke-cookie-store-");
        const signedIn: SignedIn = { email: ADA };
        const store = yield* storeOver(directory, signedIn);
        yield* store.set("voice", LIVE_VOICE.CEDAR);
        yield* store.setAccountPreferencesSyncBaseline(ADA, { voice: LIVE_VOICE.CEDAR });

        // The same person keeps their choices.
        yield* store.settleSessionAccount(ADA);
        assert.deepEqual(yield* store.accountPreferences(), { voice: LIVE_VOICE.CEDAR });

        // Another person on this browser starts from none of them.
        signedIn.email = BOB;
        yield* store.settleSessionAccount(BOB);
        assert.deepEqual(yield* store.accountPreferences(), {});

        // A departure drops what was kept for the one leaving.
        yield* store.set("voice", LIVE_VOICE.ALLOY);
        yield* store.clearAccount();
        assert.deepEqual(yield* store.accountPreferences(), {});
      }).pipe(Effect.orDie, Effect.provide([NodeFileSystem.layer, NodePath.layer])),
  );
});

it.effect(
  "hydrates no other account's local preferences into an account whose arrival never settled",
  () => {
    const ADA = "ada@example.com";
    const BOB = "bob@example.com";
    const written: string[] = [];
    /** Bob's service: no saved snapshot yet, and every write kept. */
    const service: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === HTTP_METHOD.PUT) written.push(await request.text());
      return jsonResponse({ preferences: {}, experiments: {} });
    };
    return Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("luke-cookie-unsettled-");
      // The file as Ada left it: her voice, and the baseline that names her.
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fileSystem.writeFileString(
        path.join(stateRoot, "settings.json"),
        JSON.stringify({
          version: 2,
          voice: LIVE_VOICE.CEDAR,
          accountPreferencesSync: { accountEmail: ADA, preferences: { voice: LIVE_VOICE.CEDAR } },
        }),
      );
      const machine = Layer.mergeAll(
        Layer.succeed(
          HostKernelTag,
          hostKernelOver({
            stateRoot,
            runMode: runModeFor({ capture: false, fixture: false }),
            accountBaseUrl: ACCOUNT_BASE_URL,
            now: () => 0,
            createId: () => "id",
            report: () => undefined,
            emit: () => undefined,
          }),
        ),
        Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
        Layer.succeed(AppIdentity, { appVersion: "0.0.0-test", packaged: false }),
        // A source keeping no account here, whose arrival settled nothing.
        fixedAccountSource(),
        NodeFileSystem.layer,
        NodePath.layer,
      );
      const settings = yield* Effect.provide(composeSettings(), machine);
      yield* settings.link({
        credential: NO_CREDENTIAL,
        readAccountKey: () => Effect.succeed(BOB),
        confirmAccount: () => Effect.void,
        setVoice: () => Effect.void,
        endLiveSession: Effect.void,
      });
      yield* settings.lifetime;

      yield* settings.reconcileAccountPreferences();
      const baseline = Effect.orDie(settings.store.accountPreferencesSyncBaseline(BOB));
      yield* until(() => Effect.map(baseline, (kept) => kept !== undefined));

      assert.deepEqual(yield* baseline, {});
      assert.equal(yield* Effect.orDie(settings.store.get("voice")), undefined);
      assert.ok(written.every((body) => !body.includes(LIVE_VOICE.CEDAR)));
    }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, service),
      Effect.provide([NodeFileSystem.layer, NodePath.layer]),
    );
  },
);
