// cookie-account-source.test.ts -- a browser tab's account over the service's cookie session: read, signed into, signed out of, lost on a refused call, recovered after a launch blip, and what settings key on.
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { accountCall, HOSTED_SERVICE_PATH } from "@luke/features";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@luke/gateway";
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
import { ConfigProvider, Effect, Fiber, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { TestClock } from "effect/testing";
import type { AccountSourceHost } from "./account-source.js";
import { composeAccount } from "./compose-account.js";
import { composeSettings } from "./compose-settings.js";
import { type CookieSessionDoor, cookieAccountSourceLayer } from "./cookie-account-source.js";
import { HostKernelTag } from "./effect/kernel.js";
import { AccountSource, AppIdentity, Environment } from "./effect/seams.js";
import { hostKernelOver } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";

/**
 * The cookie source over a scripted service on the tab's own origin. A
 * synthetic account throughout; no request carries an `Authorization`,
 * since the cookie is the browser's and rides the request on its own.
 */

const ORIGIN = "https://luke.example.test";
const ACCOUNT_BASE_URL = `${ORIGIN}/api/auth`;
const PROVIDER_CONSENT = "https://github.com/login/oauth/authorize?state=state-1";
/** A hosted route the account reaches, which refuses a request with no session behind it. */
const HOSTED_ROUTE = "/api/tasks";
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
      state.user = undefined;
      return jsonResponse({ success: true });
    case HOSTED_SERVICE_PATH.ACCOUNT_DELETE:
      state.user = undefined;
      return jsonResponse({ deleted: true });
    case HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES:
      if (request.method === HTTP_METHOD.PUT) {
        const body = JSON.parse(request.body ?? "{}");
        state.experiments = { ...state.experiments, ...body.experiments };
      }
      return jsonResponse({ preferences: {}, experiments: state.experiments });
    case HOSTED_ROUTE:
      return state.user ? jsonResponse({ tasks: [] }) : jsonResponse({}, HTTP_STATUS.UNAUTHORIZED);
    default:
      return new Response(null, { status: 204 });
  }
}

/** A scripted service, the tab's door, and what the account gate was asked to do. */
function scene(initial: Partial<ServiceState> = {}) {
  const state: ServiceState = { user: { ...USER }, outages: 0, experiments: {}, ...initial };
  const service = recordingHttpClient((request) => respond(state, request));
  const navigated: string[] = [];
  const gate: string[] = [];
  const door: CookieSessionDoor = {
    currentAddress: () => "/plan/task-1?tab=inbox",
    navigate: (url) => Effect.sync(() => void navigated.push(url)),
  };
  const host: AccountSourceHost = {
    // The cookie source keeps no account in the settings file, so it never reads one.
    store: {
      readAccount: () => Effect.die("the cookie source reads no stored account"),
      setAccount: () => Effect.die("the cookie source stores no account"),
      clearAccount: () => Effect.die("the cookie source clears no stored account"),
      accountSnapshot: () => Effect.die("the cookie source reads no stored account"),
    },
    accountBaseUrl: ACCOUNT_BASE_URL,
    hostedServiceBaseUrl: ORIGIN,
    runMode: runModeFor({ capture: false, fixture: false }),
    report: () => undefined,
    openExternal: async () => undefined,
    startCapabilities: Effect.sync(() => void gate.push("open")),
    stopCapabilities: Effect.sync(() => void gate.push("close")),
  };
  const open = Effect.gen(function* () {
    const source = yield* AccountSource;
    assert.equal(source.tokenCipher, undefined);
    return yield* source.open(host);
  }).pipe(Effect.provide(Layer.provide(cookieAccountSourceLayer(door), service.layer)));
  const sent = (pathname: string) =>
    service.requests.filter((request) => request.pathname === pathname);
  return { state, service, navigated, gate, open, sent };
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
      const { open, service } = scene();
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
      assert.deepEqual(gate, ["close"]);
      assert.equal(yield* session.token.readAccountKey?.() ?? Effect.void, undefined);
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
      const { open, sent } = scene();
      const session = yield* open;
      yield* session.initialize;

      const account = yield* session.deleteEverywhere();

      assert.deepEqual(account, { status: ACCOUNT_STATUS.SIGNED_OUT });
      assert.equal(sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE)[0]?.method, HTTP_METHOD.POST);
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
      assert.deepEqual(gate, ["open"]);
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
      assert.deepEqual(gate, ["close", "open"]);
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
      assert.deepEqual(gate, []);
    }).pipe(Effect.scoped),
  );
});

/** Real event-loop turns until `holds`, since the settings store's file I/O is real. */
const until = (holds: () => Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 2_000 && !(yield* holds()); turn += 1) {
      yield* Effect.promise(() => nextTurn());
    }
  });

it.effect("keys the account's preferences sync and experiments on the cookie session", () => {
  const state: ServiceState = {
    user: { ...USER },
    outages: 0,
    experiments: { [EXPERIMENT.CHAT]: true },
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
    const door: CookieSessionDoor = { currentAddress: () => "/", navigate: () => Effect.void };
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
    const account = yield* Effect.provide(
      composeAccount({ settings, openSocket: scriptedOpenSocket([]).openSocket }),
      machine,
    );
    // Linked as the host links them.
    yield* settings.link({
      credential: account.credential,
      readAccountKey: () => account.token.readAccountKey?.() ?? Effect.succeed(undefined),
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
    yield* until(() => Effect.map(experiments, (choices) => choices[EXPERIMENT.CHAT] === true));
    assert.equal((yield* experiments)[EXPERIMENT.CHAT], true);

    // An experiment's switch is written for the same account and lands.
    const set = settings.methods[GATEWAY_METHOD.EXPERIMENTS_SET];
    assert.ok(set);
    const result = yield* Effect.orDie(set({ experiment: EXPERIMENT.FACTORY, on: true }, CONTEXT));
    assert.ok(isRecord(result));
    assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal((yield* experiments)[EXPERIMENT.FACTORY], true);
    assert.equal(state.experiments[EXPERIMENT.FACTORY], true);
  }).pipe(
    Effect.provideService(FetchHttpClient.Fetch, service),
    Effect.provide([NodeFileSystem.layer, NodePath.layer]),
  );
});
