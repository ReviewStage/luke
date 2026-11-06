import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { accountCall, CALL_FAULT, HOSTED_SERVICE_PATH, NO_CREDENTIAL } from "@repo/features";
import { PRODUCT_EVENT, PRODUCT_PLATFORM } from "@repo/features/analytics";
import { ProductEventSender } from "@repo/features/analytics/sender";
import { LINK_OPEN } from "@repo/features/link-open";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { EXPERIMENT } from "@repo/settings";
import { ACTION_RESULT_STATUS, HTTP_METHOD, isRecord } from "@repo/wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@repo/wire/testing";
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

const ORIGIN = "https://app.example.test";
const ACCOUNT_BASE_URL = `${ORIGIN}/api/auth`;
const PROVIDER_CONSENT = "https://github.com/login/oauth/authorize?state=state-1";
const HOSTED_ROUTE = HOSTED_SERVICE_PATH.ACCOUNT_ACCESS;
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
  impersonatedBy?: string;
  outages: number;
  experiments: Record<string, boolean>;
  preferences: Record<string, string>;
  updatedAt?: number;
  linkOpen?: string;
  signOutDown?: boolean;
  heldRead?: Promise<void> | undefined;
  heldSignIn?: Promise<void> | undefined;
}

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
        state.user
          ? {
              session: { id: "session-1", impersonatedBy: state.impersonatedBy ?? null },
              user: state.user,
            }
          : null,
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
        if (body.linkOpen) state.linkOpen = body.linkOpen;
      }
      return jsonResponse({
        preferences: state.preferences,
        experiments: state.experiments,
        ...(state.updatedAt === undefined ? undefined : { updatedAt: state.updatedAt }),
        ...(state.linkOpen === undefined ? undefined : { linkOpen: state.linkOpen }),
      });
    case HOSTED_SERVICE_PATH.EVENTS:
      return jsonResponse({}, state.user ? HTTP_STATUS.OK : HTTP_STATUS.UNAUTHORIZED);
    case HOSTED_ROUTE:
      return state.user
        ? jsonResponse({ admin: false })
        : jsonResponse({}, HTTP_STATUS.UNAUTHORIZED);
    default:
      return new Response(null, { status: 204 });
  }
}

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
  let opening: Effect.Effect<void> = Effect.void;
  let closing: Effect.Effect<void> = Effect.void;
  let forgetting: Effect.Effect<void> = Effect.void;
  let revisitQueue: Queue.Queue<void> | undefined;
  const revisits = Effect.gen(function* () {
    revisitQueue ??= yield* Queue.unbounded<void>();
    return revisitQueue;
  });
  const door: CookieSessionDoor = {
    currentAddress: () => "/plan/task-1?tab=inbox",
    navigate: (url) => Effect.sync(() => void navigated.push(url)),
    returnedFromSignIn: Effect.succeed(false),
    revisits: Stream.unwrap(Effect.map(revisits, Stream.fromQueue)),
  };
  const revisit = Effect.flatMap(revisits, (queue) => Queue.offer(queue, undefined));
  const host: AccountSourceHost = {
    store: {
      readAccount: () => Effect.die("the cookie source reads no stored account"),
      setAccount: () => Effect.die("the cookie source stores no account"),
      clearAccount: () =>
        Effect.suspend(() => forgetting).pipe(
          Effect.andThen(
            Effect.sync(() => {
              gate.push("forget");
              return { status: ACCOUNT_STATUS.SIGNED_OUT } as const;
            }),
          ),
        ),
      accountSnapshot: () => Effect.die("the cookie source reads no stored account"),
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
  const holdForgetting = (until: Effect.Effect<void>) => {
    forgetting = until;
  };
  return {
    state,
    service,
    navigated,
    gate,
    open,
    sent,
    holdOpening,
    holdClosing,
    holdForgetting,
    revisit,
  };
}

const signedInEmail = (account: AccountSnapshot) =>
  account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;

const turns = (count: number) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < count; turn += 1) yield* Effect.promise(() => nextTurn());
  });

function heldAnswer() {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

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

  it.effect(
    "says the account is a maintainer's sign-in as the user where get-session names one",
    () =>
      Effect.gen(function* () {
        const { open } = scene({ impersonatedBy: "admin-1" });
        const session = yield* open;

        const account = yield* session.initialize;

        assert.equal(account.status === ACCOUNT_STATUS.SIGNED_IN && account.impersonated, true);
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

      state.user = undefined;
      const answer = yield* Effect.provide(
        call.send({ method: HTTP_METHOD.GET, path: HOSTED_ROUTE }),
        service.layer,
      );

      assert.ok("response" in answer);
      assert.equal(answer.response.status, HTTP_STATUS.UNAUTHORIZED);
      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
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
        platform: PRODUCT_PLATFORM.DESKTOP,
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

      state.user = { ...USER };
      yield* session.refreshOnce();
      yield* sender.flush;

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

      assert.deepEqual(yield* session.initialize, { status: ACCOUNT_STATUS.SIGNED_OUT });

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

      state.user = { ...USER };
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      yield* Effect.promise(() => nextTurn());
      const signedOut = yield* Effect.forkChild(session.signOut({ revokeRemote: true }));
      yield* Effect.promise(() => nextTurn());
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(refreshed);
      yield* Fiber.join(signedOut);

      assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
      assert.ok(gate.indexOf("open") < gate.indexOf("close"));
      assert.equal(gate.at(-1), "close");
    }).pipe(Effect.scoped),
  );

  it.effect("lets no launch read answered late stand over a revisit's newer one", () =>
    Effect.gen(function* () {
      let resolveHeld: () => void = () => undefined;
      const heldRead = new Promise<void>((resolve) => {
        resolveHeld = resolve;
      });
      const { open, state, revisit, sent } = scene({ heldRead });
      const session = yield* open;

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

      state.user = { ...USER };
      yield* reread;
      assert.equal(signedInEmail(session.snapshot()), USER.email);
      state.user = undefined;
      yield* reread;
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

      const launched = yield* Effect.forkChild(session.initialize);
      while (sent("/api/auth/get-session").length === 0) yield* Effect.promise(() => nextTurn());
      state.user = { ...USER };
      yield* session.token.refreshAccount();
      yield* Effect.sync(release);

      assert.equal(signedInEmail(yield* Fiber.join(launched)), USER.email);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "opens for a person who arrives while a sign-out drops its settings only after it closed",
    () =>
      Effect.gen(function* () {
        const { open, state, gate, holdForgetting, sent } = scene();
        const session = yield* open;
        yield* session.initialize;
        const release = yield* Deferred.make<void>();
        holdForgetting(Deferred.await(release));

        const signedOut = yield* Effect.forkChild(session.signOut({ revokeRemote: true }));
        while (sent("/api/auth/sign-out").length === 0) yield* Effect.promise(() => nextTurn());
        yield* turns(5);
        assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
        state.user = { ...USER, id: "user-2", email: "other@example.com" };
        yield* session.token.refreshAccount();
        yield* turns(5);
        holdForgetting(Effect.void);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(signedOut);
        yield* turns(10);

        assert.equal(signedInEmail(session.snapshot()), "other@example.com");
        assert.deepEqual(gate.slice(1), ["forget", "close", "settle other@example.com", "open"]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "closes the gate for a session that ended elsewhere though its settings step died",
    () =>
      Effect.gen(function* () {
        const { open, state, gate, holdForgetting } = scene();
        const session = yield* open;
        yield* session.initialize;

        holdForgetting(Effect.die("the settings store broke"));
        state.user = undefined;
        yield* Effect.exit(session.token.refreshAccount());
        yield* turns(10);
        holdForgetting(Effect.void);
        assert.deepEqual(session.snapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
        assert.equal(gate.at(-1), "close");

        state.user = { ...USER, id: "user-2", email: "other@example.com" };
        yield* session.token.refreshAccount();
        yield* turns(10);
        assert.equal(signedInEmail(session.snapshot()), "other@example.com");
        assert.deepEqual(gate.slice(1), ["close", "settle other@example.com", "open"]);
      }).pipe(Effect.scoped),
  );

  it.effect("lets the next person arrive after a sign-out whose settings step died", () =>
    Effect.gen(function* () {
      const { open, state, gate, holdForgetting } = scene();
      const session = yield* open;
      yield* session.initialize;

      holdForgetting(Effect.die("the settings store broke"));
      const signedOut = yield* Effect.exit(session.signOut({ revokeRemote: true }));
      assert.equal(signedOut._tag, "Failure");
      holdForgetting(Effect.void);

      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      yield* session.token.refreshAccount();
      yield* turns(10);

      assert.equal(signedInEmail(session.snapshot()), "other@example.com");
      assert.deepEqual(gate.slice(1), ["close", "settle other@example.com", "open"]);
    }).pipe(Effect.scoped),
  );

  it.effect("settles on one read for returns to the tab that come together", () =>
    Effect.gen(function* () {
      const { open, state, revisit } = scene();
      const session = yield* open;
      yield* session.initialize;
      const shownAs = (email: string) =>
        Effect.gen(function* () {
          while (signedInEmail(session.snapshot()) !== email) {
            yield* Effect.promise(() => nextTurn());
          }
        });

      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      yield* revisit;
      yield* shownAs("other@example.com");

      state.user = { ...USER, id: "user-3", email: "third@example.com" };
      yield* revisit;
      yield* turns(10);
      assert.equal(signedInEmail(session.snapshot()), "other@example.com");

      yield* TestClock.adjust("2 seconds");
      yield* revisit;
      yield* shownAs("third@example.com");
    }).pipe(Effect.scoped),
  );

  it.effect("reads once, unretried, for a return to the tab during an outage", () =>
    Effect.gen(function* () {
      const { open, state, revisit } = scene();
      const session = yield* open;
      const signedIn = yield* session.initialize;

      state.outages = 1;
      state.user = { ...USER, id: "user-2", email: "other@example.com" };
      yield* revisit;
      yield* revisit;
      yield* revisit;
      for (let second = 0; second < 60; second += 1) {
        yield* turns(2);
        yield* TestClock.adjust("1 second");
      }
      yield* turns(2);

      assert.deepEqual(session.snapshot(), signedIn);

      yield* revisit;
      while (signedInEmail(session.snapshot()) !== "other@example.com") {
        yield* Effect.promise(() => nextTurn());
      }
    }).pipe(Effect.scoped),
  );

  it.effect("confirms the account with a read of its own after a sign-out overtook one", () =>
    Effect.gen(function* () {
      const { held, release } = heldAnswer();
      const { open, state, sent } = scene();
      const session = yield* open;
      yield* session.initialize;
      assert.ok(session.confirmAccount);

      state.heldRead = held;
      const refreshed = yield* Effect.forkChild(session.refreshOnce());
      while (sent("/api/auth/get-session").length < 2) yield* Effect.promise(() => nextTurn());
      yield* session.signOut({ revokeRemote: true });
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
    "keeps the tab where it is when the sign-in is canceled while the service answers",
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
      assert.deepEqual(session.snapshot(), signedIn);
      assert.deepEqual(gate, [`settle ${USER.email}`]);
    }).pipe(Effect.scoped),
  );
});

const until = (holds: () => Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    while (!(yield* holds())) yield* Effect.promise(() => nextTurn());
  });

const STILL_DOOR: CookieSessionDoor = {
  currentAddress: () => "/",
  navigate: () => Effect.void,
  returnedFromSignIn: Effect.succeed(false),
  revisits: Stream.never,
};

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
    Layer.succeed(AppIdentity, {
      appVersion: "0.2.0",
      packaged: true,
      platform: PRODUCT_PLATFORM.DESKTOP,
    }),
    accountSource,
    NodeFileSystem.layer,
    NodePath.layer,
  );

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
    const account = yield* Effect.provide(composeAccount({ settings }), machine);
    yield* settings.link({
      credential: account.credential,
      readAccountKey: () => account.token.readAccountKey?.() ?? Effect.succeed(undefined),
      confirmAccount: () => account.session.confirmAccount?.() ?? Effect.void,
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
    experiments: { [EXPERIMENT.MEMORY]: true },
    preferences: {},
    updatedAt: 1,
    linkOpen: LINK_OPEN.MAC_APP,
  };
  const service: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    return respond(state, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      body: await request.text(),
    });
  };
  return Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("cookie-settings-");
    const { settings, account } = yield* composedTab(stateRoot, (settings) =>
      Effect.orDie(settings.store.set("linkOpen", LINK_OPEN.BROWSER)),
    );
    assert.equal(account.signedIn(), true);

    const accountRead = Effect.map(
      Effect.orDie(settings.store.snapshot()),
      (snapshot) => snapshot.accountRead,
    );
    assert.equal(yield* accountRead, false);
    yield* settings.reconcileAccountPreferences();
    const experiments = Effect.map(
      Effect.orDie(settings.store.snapshot()),
      (snapshot) => snapshot.experiments,
    );
    const linkOpen = Effect.orDie(settings.store.get("linkOpen"));
    yield* until(() => accountRead);
    assert.equal(yield* linkOpen, LINK_OPEN.MAC_APP);
    assert.equal((yield* experiments)[EXPERIMENT.MEMORY], true);
    assert.equal(yield* linkOpen, LINK_OPEN.MAC_APP);
    assert.equal(state.linkOpen, LINK_OPEN.MAC_APP);

    const set = settings.methods[GATEWAY_METHOD.EXPERIMENTS_SET];
    assert.ok(set);
    const result = yield* Effect.orDie(set({ experiment: EXPERIMENT.MEMORY, on: true }, CONTEXT));
    assert.ok(isRecord(result));
    assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal((yield* experiments)[EXPERIMENT.MEMORY], true);
    assert.equal(state.experiments[EXPERIMENT.MEMORY], true);

    state.user = { ...USER, id: "user-2", email: "other@example.com" };
    const stale = yield* Effect.orDie(set({ experiment: EXPERIMENT.PILOT, on: true }, CONTEXT));
    assert.ok(isRecord(stale));
    assert.equal(stale.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(stale.reason, EXPERIMENT_ACCOUNT_CHANGED);
    assert.equal(state.experiments[EXPERIMENT.PILOT], undefined);
    assert.equal(yield* account.token.readAccountKey?.() ?? Effect.void, "other@example.com");
    assert.equal((yield* experiments)[EXPERIMENT.MEMORY], undefined);
    assert.equal(yield* linkOpen, undefined);
    assert.equal(yield* accountRead, false);
  }).pipe(
    Effect.provideService(FetchHttpClient.Fetch, service),
    Effect.provide([NodeFileSystem.layer, NodePath.layer]),
  );
});

it.effect("sends no day one person marked under the cookie another tab signed in", () => {
  const state: ServiceState = { user: { ...USER }, outages: 0, experiments: {}, preferences: {} };
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
    const stateRoot = yield* temporaryDirectoryScoped("cookie-events-");
    yield* composedTab(stateRoot);

    state.user = { ...USER, id: "user-2", email: "other@example.com" };
    while (batches.length < 1) {
      yield* Effect.promise(() => nextTurn());
      yield* TestClock.adjust("1 minute");
    }

    const [batch] = batches;
    assert.equal(batch?.user, "user-2");
    assert.ok(batch?.names.includes(PRODUCT_EVENT.APP_LAUNCH));
    assert.ok(!batch?.names.includes(PRODUCT_EVENT.APP_DAY_ACTIVE));

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

interface SignedIn {
  email: string | undefined;
}

describe("a settings store that keeps no account of its own", () => {
  const ADA = "ada@example.com";
  const BOB = "bob@example.com";

  const storeOver = (directory: string, signedIn: SignedIn) =>
    Effect.gen(function* () {
      return new SettingsStore({
        directory: () => directory,
        cipher: undefined,
        sessionAccountEmail: () => Effect.sync(() => signedIn.email),
        fileSystem: yield* FileSystem.FileSystem,
        path: yield* Path.Path,
      });
    });

  it.effect("keeps the session account's experiments across a reopen, for that account alone", () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("cookie-store-");
      const signedIn: SignedIn = { email: ADA };
      const store = yield* storeOver(directory, signedIn);
      assert.equal(yield* store.cacheExperiments(ADA, { [EXPERIMENT.MEMORY]: true }), true);

      const reopened = yield* storeOver(directory, signedIn);
      assert.equal((yield* reopened.snapshot()).experiments[EXPERIMENT.MEMORY], true);
      signedIn.email = BOB;
      assert.equal((yield* reopened.snapshot()).experiments[EXPERIMENT.MEMORY], undefined);
    }).pipe(Effect.orDie, Effect.provide([NodeFileSystem.layer, NodePath.layer])),
  );

  it.effect(
    "drops the preferences kept for an account once another is signed in, or it leaves",
    () =>
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped("cookie-store-");
        const signedIn: SignedIn = { email: ADA };
        const store = yield* storeOver(directory, signedIn);
        yield* store.set("linkOpen", LINK_OPEN.MAC_APP);
        yield* store.setAccountPreferencesSyncBaseline(ADA, { linkOpen: LINK_OPEN.MAC_APP });

        yield* store.settleSessionAccount(ADA);
        assert.deepEqual(yield* store.accountPreferences(), { linkOpen: LINK_OPEN.MAC_APP });

        signedIn.email = BOB;
        yield* store.settleSessionAccount(BOB);
        assert.deepEqual(yield* store.accountPreferences(), {});

        yield* store.set("linkOpen", LINK_OPEN.BROWSER);
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
    const service: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === HTTP_METHOD.PUT) written.push(await request.text());
      return jsonResponse({ preferences: {}, experiments: {} });
    };
    return Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("cookie-unsettled-");
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fileSystem.writeFileString(
        path.join(stateRoot, "settings.json"),
        JSON.stringify({
          version: 2,
          voice: "cedar",
          linkOpen: LINK_OPEN.MAC_APP,
          accountPreferencesSync: {
            accountEmail: ADA,
            preferences: { voice: "cedar", linkOpen: LINK_OPEN.MAC_APP },
          },
        }),
      );
      const machine = machineOver(stateRoot, fixedAccountSource());
      const settings = yield* Effect.provide(composeSettings(), machine);
      yield* settings.link({
        credential: NO_CREDENTIAL,
        readAccountKey: () => Effect.succeed(BOB),
        confirmAccount: () => Effect.void,
      });
      yield* settings.lifetime;

      yield* settings.reconcileAccountPreferences();
      const baseline = Effect.orDie(settings.store.accountPreferencesSyncBaseline(BOB));
      yield* until(() => Effect.map(baseline, (kept) => kept !== undefined));

      assert.deepEqual(yield* baseline, {});
      assert.equal(yield* Effect.orDie(settings.store.get("linkOpen")), undefined);
      assert.ok(written.every((body) => !body.includes(LINK_OPEN.MAC_APP)));
    }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, service),
      Effect.provide([NodeFileSystem.layer, NodePath.layer]),
    );
  },
);
