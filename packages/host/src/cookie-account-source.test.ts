// cookie-account-source.test.ts -- a browser tab's account over the service's cookie session: read, signed into, signed out of, switched, lost on a refused call, recovered after a launch blip, and what settings key on.
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { accountCall, CALL_FAULT, HOSTED_SERVICE_PATH, NO_CREDENTIAL } from "@luke/features";
import { PRODUCT_EVENT } from "@luke/features/analytics";
import { ProductEventSender } from "@luke/features/analytics/sender";
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
import { ConfigProvider, Deferred, Effect, Exit, Fiber, Layer, Queue, Scope, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";
import type { AccountSourceHost } from "./account-source.js";
import { composeAccount } from "./compose-account.js";
import { composeSettings, type SettingsComposer } from "./compose-settings.js";
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
  /** Holds the next session read's answer, as it stood when asked, until this settles. */
  heldRead?: Promise<void> | undefined;
  /** Holds the next social sign-in's answer until this settles. */
  heldSignIn?: Promise<void> | undefined;
}

/** The service's routes over `state`, answered as Better Auth and Luke's routes answer them. */
function respond(
  state: ServiceState,
  request: Pick<RecordedRequest, "method" | "pathname" | "body">,
): Response | Promise<Response> {
  switch (request.pathname) {
    case "/api/auth/get-session": {
      if (state.outages > 0) {
        state.outages -= 1;
        return new Response(null, { status: 503 });
      }
      const answer = jsonResponse(
        state.user ? { session: { id: "session-1" }, user: state.user } : null,
      );
      const held = state.heldRead;
      state.heldRead = undefined;
      return held === undefined ? answer : held.then(() => answer);
    }
    case "/api/auth/sign-in/social": {
      const answer = jsonResponse({ url: PROVIDER_CONSENT, redirect: true });
      const held = state.heldSignIn;
      state.heldSignIn = undefined;
      return held === undefined ? answer : held.then(() => answer);
    }
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
    case HOSTED_SERVICE_PATH.EVENTS:
      return jsonResponse({}, state.user ? HTTP_STATUS.OK : HTTP_STATUS.UNAUTHORIZED);
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
  /** Held open where a test wants the gate's closing still under way. */
  let closing: Effect.Effect<void> = Effect.void;
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
    stopCapabilities: Effect.suspend(() => closing).pipe(
      Effect.andThen(Effect.sync(() => void gate.push("close"))),
    ),
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
  const holdClosing = (until: Effect.Effect<void>) => {
    closing = until;
  };
  return { state, service, navigated, gate, open, sent, holdOpening, holdClosing, revisit };
}

/** The signed-in person's address, and nothing for any other status. */
const signedInEmail = (account: AccountSnapshot) =>
  account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;

/** Lets `count` event-loop turns pass, for forked work that should have landed by then. */
const turns = (count: number) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < count; turn += 1) yield* Effect.promise(() => nextTurn());
  });

/** A promise the test settles by hand, for an answer the service holds. */
function heldAnswer() {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
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
      assert.deepEqual(gate.slice(1), ["forget", "close", "settle other@example.com", "open"]);
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

  it.effect("sends no hosted call while no one is signed in, answering it as no credential", () =>
    Effect.gen(function* () {
      const { open, service, sent } = scene({ user: undefined });
      const session = yield* open;
      yield* session.initialize;
      const call = accountCall({ baseUrl: ORIGIN, credential: session.credential });

      const answer = yield* Effect.provide(
        call.send({ method: HTTP_METHOD.GET, path: HOSTED_ROUTE }),
        service.layer,
      );

      assert.deepEqual(answer, { fault: CALL_FAULT.NO_CREDENTIAL });
      assert.deepEqual(sent(HOSTED_ROUTE), []);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the counts made before a sign-in, and sends them once signed in", () =>
    Effect.gen(function* () {
      const { open, state, service, sent } = scene({ user: undefined });
      const session = yield* open;
      yield* session.initialize;
      const sender = yield* ProductEventSender.make({
        serviceBaseUrl: ORIGIN,
        appVersion: "0.2.0",
        packaged: false,
        sends: true,
        credential: session.credential,
        confirmAccount: session.confirmAccount,
        httpClient: service.layer,
        now: () => 0,
      });
      sender.arm();
      sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: "0.2.0" });
      sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});

      yield* sender.flush;
      assert.deepEqual(sent(HOSTED_SERVICE_PATH.EVENTS), []);

      // The sign-in lands, and the tab reads it.
      state.user = { ...USER };
      yield* session.refreshOnce();
      yield* sender.flush;

      // Every count the service received, whichever batches carried them.
      const received = sent(HOSTED_SERVICE_PATH.EVENTS).flatMap(
        (batch): { name: string }[] => JSON.parse(batch.body ?? "{}").events,
      );
      assert.deepEqual(
        received.map((event) => event.name),
        [PRODUCT_EVENT.APP_LAUNCH, PRODUCT_EVENT.ACCOUNT_SIGN_IN],
      );
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
      assert.deepEqual(gate.slice(1), ["forget", "close", "settle other@example.com", "open"]);
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

  it.effect("lets no launch read answered late stand over a revisit's newer one", () =>
    Effect.gen(function* () {
      // The service's own promise, which the test resolves; nothing is run outside the test's fiber.
      let resolveHeld: () => void = () => undefined;
      const heldRead = new Promise<void>((resolve) => {
        resolveHeld = resolve;
      });
      const { open, state, revisit, sent } = scene({ heldRead });
      const session = yield* open;

      // The launch's read is asked as the first person and held; meanwhile another tab signs in as someone else.
      const launched = yield* Effect.forkChild(session.initialize);
      while (sent("/api/auth/get-session").length === 0) yield* Effect.promise(() => nextTurn());
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      yield* revisit;
      yield* Effect.promise(() => nextTurn());
      yield* Effect.sync(() => resolveHeld());
      yield* Fiber.join(launched);
      while (sent("/api/auth/get-session").length < 2) yield* Effect.promise(() => nextTurn());
      while (signedInEmail(session.snapshot()) !== "other@example.com") {
        yield* Effect.promise(() => nextTurn());
      }

      assert.equal(signedInEmail(session.snapshot()), "other@example.com");
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

  it.effect("shows another person only once the previous person's capabilities stopped", () =>
    Effect.gen(function* () {
      const { open, state, holdClosing } = scene();
      const session = yield* open;
      yield* session.initialize;
      const closingBegan = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      holdClosing(
        Effect.andThen(Deferred.succeed(closingBegan, undefined), Deferred.await(release)),
      );

      // Another tab signs in as someone else; the previous person's capabilities are still stopping.
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      yield* Deferred.await(closingBegan);
      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(refreshed);
      assert.equal(signedInEmail(session.snapshot()), "other@example.com");
    }).pipe(Effect.scoped),
  );

  it.effect("closes the gate for a departure however many empty reads follow it", () =>
    Effect.gen(function* () {
      const { open, state, gate, holdOpening, sent } = scene({ user: undefined });
      const session = yield* open;
      yield* session.initialize;
      const release = yield* Deferred.make<void>();
      holdOpening(Deferred.await(release));
      const reads = () => sent("/api/auth/get-session").length;
      const reread = Effect.gen(function* () {
        const before = reads();
        yield* session.token.refreshAccount();
        while (reads() === before) yield* Effect.promise(() => nextTurn());
        yield* turns(5);
      });

      // The person is shown and their gate is still opening when the session ends elsewhere.
      state.user = { ...USER };
      yield* reread;
      assert.equal(signedInEmail(session.snapshot()), USER.email);
      state.user = undefined;
      yield* reread;
      // A second read finds nobody again before the closing had its turn.
      yield* reread;
      yield* Deferred.succeed(release, undefined);
      yield* turns(10);

      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
      assert.equal(gate.at(-1), "close");
    }).pipe(Effect.scoped),
  );

  it.effect(
    "closes the gate for the person a switch left even once a later read passed it over",
    () =>
      Effect.gen(function* () {
        const { open, state, gate, holdOpening, sent } = scene({ user: undefined });
        const session = yield* open;
        yield* session.initialize;
        const release = yield* Deferred.make<void>();
        holdOpening(Deferred.await(release));
        const reads = () => sent("/api/auth/get-session").length;
        const reread = Effect.gen(function* () {
          const before = reads();
          yield* session.token.refreshAccount();
          while (reads() === before) yield* Effect.promise(() => nextTurn());
          yield* turns(5);
        });

        // The first person's gate is still opening when another person's session is read, then ends.
        state.user = { ...USER };
        yield* reread;
        state.user = { ...USER, id: "user-2", email: "other@example.com" };
        yield* reread;
        state.user = undefined;
        yield* reread;
        yield* Deferred.succeed(release, undefined);
        yield* turns(10);

        assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
        assert.equal(gate.at(-1), "close");
        assert.ok(!gate.includes("settle other@example.com"));
      }).pipe(Effect.scoped),
  );

  it.effect("shows no arrival a read naming nobody overtook while the gate closed", () =>
    Effect.gen(function* () {
      const { open, state, gate, holdClosing } = scene();
      const session = yield* open;
      yield* session.initialize;
      assert.ok(session.confirmAccount);
      const closingBegan = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      holdClosing(
        Effect.andThen(Deferred.succeed(closingBegan, undefined), Deferred.await(release)),
      );

      // Another person's session is read, then ends before the previous person's capabilities stopped.
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      yield* Deferred.await(closingBegan);
      state.user = undefined;
      yield* session.confirmAccount();
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(refreshed);

      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
      assert.deepEqual(gate.slice(1), ["forget", "close"]);
    }).pipe(Effect.scoped),
  );

  it.effect("settles nothing and moves no gate once the session closed", () =>
    Effect.gen(function* () {
      const { held, release } = heldAnswer();
      const { open, state, gate, sent } = scene();
      const sessionScope = yield* Scope.make();
      const session = yield* Scope.provide(open, sessionScope);
      yield* session.initialize;

      // A read is under way for another person's session when the session closes.
      state.heldRead = held;
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      while (sent("/api/auth/get-session").length < 2) yield* Effect.promise(() => nextTurn());
      yield* Scope.close(sessionScope, Exit.void);
      yield* Effect.sync(release);
      yield* Fiber.join(refreshed);
      yield* turns(20);

      assert.deepEqual(gate, [`settle ${USER.email}`]);
    }),
  );

  it.effect("closes the first person's gate before a third person opens it", () =>
    Effect.gen(function* () {
      const { open, state, gate, holdOpening, sent } = scene({ user: undefined });
      const session = yield* open;
      yield* session.initialize;
      const release = yield* Deferred.make<void>();
      holdOpening(Deferred.await(release));
      const reads = () => sent("/api/auth/get-session").length;
      const reread = Effect.gen(function* () {
        const before = reads();
        yield* session.token.refreshAccount();
        while (reads() === before) yield* Effect.promise(() => nextTurn());
        yield* turns(5);
      });

      // The first person's gate is still opening as a second, then a third, session is read.
      state.user = { ...USER };
      yield* reread;
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      yield* reread;
      state.user = { ...USER, id: "user-3", email: "third@example.com" };
      yield* reread;
      holdOpening(Effect.void);
      yield* Deferred.succeed(release, undefined);
      while (gate.at(-1) !== "open" || !gate.includes("settle third@example.com")) {
        yield* Effect.promise(() => nextTurn());
      }

      assert.equal(signedInEmail(session.snapshot()), "third@example.com");
      const third = gate.indexOf("settle third@example.com");
      assert.equal(gate.lastIndexOf("close", third) > gate.indexOf("open"), true);
      assert.ok(!gate.includes("settle other@example.com"));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "closes the gate for a sign-out pressed while an opening ran, a later read passing it",
    () =>
      Effect.gen(function* () {
        const { open, state, gate, holdOpening, sent } = scene({ user: undefined });
        const session = yield* open;
        yield* session.initialize;
        const release = yield* Deferred.make<void>();
        holdOpening(Deferred.await(release));

        // The person's gate is still opening when they sign out, and a read then finds nobody.
        state.user = { ...USER };
        yield* session.token.refreshAccount();
        yield* turns(5);
        const signedOut = yield* Effect.forkChild(session.signOut({ revokeRemote: true }));
        while (sent("/api/auth/sign-out").length === 0) yield* Effect.promise(() => nextTurn());
        yield* turns(5);
        yield* session.token.refreshAccount();
        yield* turns(5);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(signedOut);

        assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
        assert.equal(gate.at(-1), "close");
      }).pipe(Effect.scoped),
  );

  it.effect("answers the launch with the person a re-read during it settled on", () =>
    Effect.gen(function* () {
      const { held, release } = heldAnswer();
      const { open, state, sent } = scene({ user: undefined, heldRead: held });
      const session = yield* open;

      // The launch's read is held; a refused call's re-read meanwhile finds the session.
      const launched = yield* Effect.forkChild(session.initialize);
      while (sent("/api/auth/get-session").length === 0) yield* Effect.promise(() => nextTurn());
      state.user = { ...USER };
      yield* session.token.refreshAccount();
      yield* Effect.sync(release);

      assert.equal(signedInEmail(yield* Fiber.join(launched)), USER.email);
    }).pipe(Effect.scoped),
  );

  it.effect("reads once for returns to the tab that come together, and again for a later one", () =>
    Effect.gen(function* () {
      const { open, revisit, sent } = scene();
      const session = yield* open;
      yield* session.initialize;
      const reads = () => sent("/api/auth/get-session").length;

      // The tab is shown again and focused at once: one return.
      yield* revisit;
      yield* turns(5);
      yield* revisit;
      yield* turns(5);
      assert.equal(reads(), 2);

      // A return a while later reads again.
      yield* TestClock.adjust("2 seconds");
      yield* revisit;
      yield* turns(5);
      assert.equal(reads(), 3);
    }).pipe(Effect.scoped),
  );

  it.effect("piles up no reads for returns to the tab during an outage", () =>
    Effect.gen(function* () {
      const { open, state, revisit, sent } = scene();
      const session = yield* open;
      const signedIn = yield* session.initialize;
      const reads = () => sent("/api/auth/get-session").length;

      // The service goes down; the tab is shown again and focused, then left and come back to.
      state.outages = 1000;
      yield* revisit;
      yield* revisit;
      yield* revisit;
      for (let second = 0; second < 60; second += 1) {
        yield* turns(2);
        yield* TestClock.adjust("1 second");
      }
      yield* turns(2);

      // One read for that return, unretried; the outage is no sign-out.
      assert.equal(reads(), 2);
      assert.deepEqual(session.snapshot(), signedIn);

      // A later return reads again.
      yield* revisit;
      yield* turns(5);
      assert.equal(reads(), 3);
    }).pipe(Effect.scoped),
  );

  it.effect("confirms the account with a read of its own after a sign-out overtook one", () =>
    Effect.gen(function* () {
      const { held, release } = heldAnswer();
      const { open, state, sent } = scene();
      const session = yield* open;
      yield* session.initialize;
      assert.ok(session.confirmAccount);

      // A read is under way as the first person when the sign-out is pressed.
      state.heldRead = held;
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      while (sent("/api/auth/get-session").length < 2) yield* Effect.promise(() => nextTurn());
      yield* session.signOut({ revokeRemote: true });
      // Another tab then signs in as someone else, and a write asks who is signed in.
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      const confirmed = yield* Effect.forkChild(session.confirmAccount());
      yield* turns(2);
      yield* Effect.sync(release);
      yield* Fiber.join(confirmed);
      yield* Fiber.join(refreshed);

      assert.equal(signedInEmail(session.snapshot()), "other@example.com");
    }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps the tab where it is when the sign-in is cancelled while the service answers",
    () =>
      Effect.gen(function* () {
        const { held, release } = heldAnswer();
        const { open, navigated, sent } = scene({ user: undefined, heldSignIn: held });
        const session = yield* open;
        yield* session.initialize;

        const begun = yield* Effect.forkChild(session.beginSignIn(ACCOUNT_PROVIDER.GITHUB));
        while (sent("/api/auth/sign-in/social").length === 0) {
          yield* Effect.promise(() => nextTurn());
        }
        assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNING_IN });
        session.cancelSignIn();
        yield* Effect.sync(release);

        assert.deepEqual(yield* Fiber.join(begun), { status: ACCOUNT_STATUS.SIGNED_OUT });
        assert.deepEqual(navigated, []);
      }).pipe(Effect.scoped),
  );

  it.effect("keeps leaving for the provider through a return to the tab while it asks", () =>
    Effect.gen(function* () {
      const { held, release } = heldAnswer();
      const { open, navigated, sent, revisit } = scene({ user: undefined, heldSignIn: held });
      const session = yield* open;
      yield* session.initialize;

      // The tab is focused while the service is still asked for the provider's address.
      const begun = yield* Effect.forkChild(session.beginSignIn(ACCOUNT_PROVIDER.GITHUB));
      while (sent("/api/auth/sign-in/social").length === 0) {
        yield* Effect.promise(() => nextTurn());
      }
      yield* revisit;
      while (sent("/api/auth/get-session").length < 2) yield* Effect.promise(() => nextTurn());
      yield* turns(5);
      yield* Effect.sync(release);

      assert.deepEqual(yield* Fiber.join(begun), { status: ACCOUNT_STATUS.SIGNING_IN });
      assert.deepEqual(navigated, [PROVIDER_CONSENT]);
    }).pipe(Effect.scoped),
  );

  it.effect("ends a sign-in the tab came back to unfinished, such as through the back button", () =>
    Effect.gen(function* () {
      const { open, navigated, revisit } = scene({ user: undefined });
      const session = yield* open;
      yield* session.initialize;
      yield* session.beginSignIn(ACCOUNT_PROVIDER.GITHUB);
      assert.deepEqual(navigated, [PROVIDER_CONSENT]);

      // The page is restored from the back/forward cache, with no session made.
      yield* revisit;
      yield* turns(10);

      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
    }).pipe(Effect.scoped),
  );

  it.effect("signs the same person in again by linking the provider anew", () =>
    Effect.gen(function* () {
      const { open, navigated, sent, gate } = scene();
      const session = yield* open;
      const signedIn = yield* session.initialize;

      assert.equal(yield* session.signInAgain(ACCOUNT_PROVIDER.GITHUB), false);

      const [request] = sent("/api/auth/link-social");
      assert.ok(request);
      assert.equal(request.method, HTTP_METHOD.POST);
      assert.deepEqual(JSON.parse(request.body ?? ""), {
        provider: ACCOUNT_PROVIDER.GITHUB,
        callbackURL: "/plan/task-1?tab=inbox",
      });
      assert.deepEqual(navigated, [PROVIDER_CONSENT]);
      assert.equal(sent("/api/auth/sign-in/social").length, 0);
      // The person stands as they were; nothing of the gate or the settings moved.
      assert.deepEqual(session.snapshot(), signedIn);
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

/** The tab's own address, which nobody leaves or comes back to. */
const STILL_DOOR: CookieSessionDoor = {
  currentAddress: () => "/",
  navigate: () => Effect.void,
  revisits: Stream.never,
};

/** The machine a host in a tab is composed on, its account source the one given. */
const machineOver = (stateRoot: string, accountSource: Layer.Layer<AccountSource>) =>
  Layer.mergeAll(
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
    Layer.succeed(AppIdentity, { appVersion: "0.2.0", packaged: false }),
    accountSource,
    NodeFileSystem.layer,
    NodePath.layer,
  );

/**
 * The settings and account of a tab on the cookie session over the platform
 * fetch, linked as the host links them and started; `prepare` runs on the
 * settings before the account is composed.
 */
const composedTab = (
  stateRoot: string,
  prepare: (settings: SettingsComposer) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const machine = machineOver(
      stateRoot,
      Layer.provide(cookieAccountSourceLayer(STILL_DOOR), FetchHttpClient.layer),
    );
    const settings = yield* Effect.provide(composeSettings(), machine);
    yield* prepare(settings);
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
    yield* account.lifetime;
    yield* settings.lifetime;
    return { settings, account };
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
    const { settings, account } = yield* composedTab(stateRoot, (settings) =>
      Effect.orDie(settings.store.set("voice", LIVE_VOICE.ALLOY)),
    );
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

it.effect("sends no day one person marked under the cookie another tab signed in", () => {
  const state: ServiceState = { user: { ...USER }, outages: 0, experiments: {}, preferences: {} };
  /** Every batch of counts, by who the cookie named when it arrived and the events it carried. */
  const batches: { readonly user: string | undefined; readonly names: readonly string[] }[] = [];
  const service: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    const body = await request.text();
    if (pathname === HOSTED_SERVICE_PATH.EVENTS) {
      const events: { name: string }[] = JSON.parse(body).events;
      batches.push({ user: state.user?.id, names: events.map((event) => event.name) });
    }
    return respond(state, { method: request.method, pathname, body });
  };
  return Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("luke-cookie-events-");
    // The launch counts itself and marks the day for the person signed in.
    yield* composedTab(stateRoot);

    // Another tab signs in as someone else before the minute's flush.
    state.user = { ...USER, id: "user-2", email: "other@example.com" };
    while (batches.length < 1) {
      yield* Effect.promise(() => nextTurn());
      yield* TestClock.adjust("1 minute");
    }

    const [batch] = batches;
    assert.equal(batch?.user, "user-2");
    assert.ok(batch?.names.includes(PRODUCT_EVENT.APP_LAUNCH));
    assert.ok(!batch?.names.includes(PRODUCT_EVENT.APP_DAY_ACTIVE));

    // Day marks do travel here: the next minute marks and sends the one now signed in's own.
    while (batches.length < 2) {
      yield* Effect.promise(() => nextTurn());
      yield* TestClock.adjust("1 minute");
    }
    assert.equal(batches[1]?.user, "user-2");
    assert.ok(batches[1]?.names.includes(PRODUCT_EVENT.APP_DAY_ACTIVE));
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
      // A source keeping no account here, whose arrival settled nothing.
      const machine = machineOver(stateRoot, fixedAccountSource());
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
