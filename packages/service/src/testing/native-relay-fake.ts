/**
 * native-relay-fake.ts -- an eve app's native harnesses relayed to the web's relay route, both ends in one process over a recording harness.
 *
 * The eve end is the production relay (`nativeRelayLayer`), and the web end
 * the production route (`nativeRelayApp`) over the test's database; the
 * network between them is a fake client that hands each post to the route,
 * and the harness behind the route writes down every call it takes and
 * whom it acts for. A suite provides `layer` where an eve app's runtime
 * provides the relay, so whatever reaches a native agent from the planner's
 * or an eve agent's tools is seen arriving at the harness, or not.
 * Synthetic secrets and ids throughout.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { Context, Effect, Layer, Option, Redacted, Stream } from "effect";
import { HttpRouter } from "effect/http";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
} from "../agents/brain-host/eve-sessions.js";
import { nativeRelayLayer } from "../agents/coder-host/native-relay.js";
import { nativeRelayApp } from "../agents/coder-host/native-relay-app.js";
import { NATIVE_SESSION_PREFIX } from "../agents/coder-host/native-runtime.js";
import {
  NativeAgentSessions,
  type NativeAgentSessionsService,
  type NativeSessions,
  RUNNER_CHOICE,
} from "../agents/coder-host/runtime-sessions.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";

export const NATIVE_RELAY_FAKE = {
  SECRET: "eve-deployment-secret-1",
  ORIGIN: "https://luke.test",
} as const;

/** One call the harness behind the route took: which, on which harness, acting for whom, and what it named. */
export interface HeardCall {
  readonly call: string;
  readonly runtime: string;
  readonly account: string;
  readonly names: string;
  readonly message?: unknown;
  readonly seen?: unknown;
}

export interface NativeRelayFakeOptions {
  /** The secret the eve app's deployment presents; none opens no harness there. */
  readonly eveSecret?: string | undefined;
  /** The secret the web's deployment admits; none answers every call unavailable. */
  readonly webSecret?: string | undefined;
  /** Whether the web function provides the harness at all. */
  readonly harness?: boolean;
  /**
   * Read on the store as the harness takes an open or a send, before it
   * answers, as a launch's own writes would meet the store; what it read is
   * kept beside the call as `seen`.
   */
  readonly onLaunch?: (conversationId: string) => Effect.Effect<unknown, unknown, DatabaseServices>;
}

/** The deployment's environment, holding the eve secret given and the cohort, and nothing else. */
function environmentValues(
  secret: string | undefined,
  cohort: readonly string[],
): HostedEnvironmentValues {
  return {
    openAiKey: undefined,
    anthropicKey: undefined,
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: Redacted.make("cron-secret-1"),
    eveDeploymentSecret: secret === undefined ? undefined : Redacted.make(secret),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
    nativeAgentAccounts: cohort,
  };
}

/** The deployment's environment as a layer, as above. */
export function relayEnvironment(
  secret: string | undefined,
  cohort: readonly string[] = [],
): Layer.Layer<HostedEnvironment> {
  return Layer.succeed(HostedEnvironment, environmentValues(secret, cohort));
}

/** The harness behind the route, writing down every call and answering each as taken. */
function recordingHarness(
  heard: HeardCall[],
  onLaunch: NativeRelayFakeOptions["onLaunch"],
): NativeAgentSessionsService {
  /** What `onLaunch` reads of the conversation, on the store the route answers on; nothing without it. */
  const seenOf = (conversationId: string) =>
    Effect.gen(function* () {
      if (onLaunch === undefined) return undefined;
      // SAFETY: the route answers on the store's services (`answer` below), which the harness runs within.
      const services = (yield* Effect.context<never>()) as Context.Context<DatabaseServices>;
      return yield* onLaunch(conversationId).pipe(Effect.provideContext(services), Effect.orDie);
    });
  return {
    sessions: (runtime, account) => {
      const write = (call: string, names: string, message?: unknown, seen?: unknown) =>
        heard.push({
          call,
          runtime,
          account,
          names,
          ...(message === undefined ? {} : { message }),
          ...(seen === undefined ? {} : { seen }),
        });
      const sessions: NativeSessions = {
        open: (message) =>
          Effect.map(seenOf(message.conversationId), (seen) => {
            write("open", message.conversationId, message.message, seen);
            return {
              outcome: EVE_SEND_OUTCOME.ACCEPTED,
              sessionId: `${NATIVE_SESSION_PREFIX[runtime]}000000000001-${randomUUID()}`,
            };
          }),
        send: (sessionId, message) =>
          Effect.map(seenOf(message.conversationId), (seen) => {
            write("send", sessionId, message.message, seen);
            return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() };
          }),
        cancel: (sessionId, turnId) =>
          Effect.sync(() => {
            write("cancel", `${sessionId}:${turnId}`);
            return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED };
          }),
        reset: (sessionId) =>
          Effect.sync(() => {
            write("reset", sessionId);
            return { outcome: EVE_RESET_OUTCOME.RESET };
          }),
        stream: () => Stream.empty,
        retune: (sessionId) =>
          Effect.sync(() => {
            write("retune", sessionId);
            return RUNNER_CHOICE.WRITTEN;
          }),
      };
      return Option.some(Effect.succeed(sessions));
    },
  };
}

/** A request the eve end's client built, as the route reads it. */
function webRequest(request: HttpClientRequest.HttpClientRequest, url: URL): Request {
  const body = request.body;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    // SAFETY: the relay posts its call as text, which `HttpBody.Raw` or `Uint8Array` carries as `fetch` takes it.
    ...(body._tag === "Raw" || body._tag === "Uint8Array" ? { body: body.body as BodyInit } : {}),
  });
}

/**
 * Both ends of the relay, as above: `layer` is the eve app's relay, `heard`
 * what the harness took, `statuses` each answer the route gave, and `post`
 * a raw call to the route for a suite asking what it refuses. The route
 * answers on the calling fiber's services, its database among them, as the
 * one store a test has: PGlite's one connection would otherwise wait on a
 * transaction the caller holds open across the call. `dispose` ends the
 * route's handler.
 */
export const nativeRelayFake = (options: NativeRelayFakeOptions = {}) =>
  Effect.gen(function* () {
    const heard: HeardCall[] = [];
    const statuses: number[] = [];
    const eveSecret = "eveSecret" in options ? options.eveSecret : NATIVE_RELAY_FAKE.SECRET;
    const webSecret = "webSecret" in options ? options.webSecret : NATIVE_RELAY_FAKE.SECRET;
    const web = HttpRouter.toWebHandler(nativeRelayApp(), { disableLogger: true });
    const harness = recordingHarness(heard, options.onLaunch);
    /** The route's answer on the services given, with the web's environment and harness beside them. */
    const answer = async (request: Request, services: Context.Context<DatabaseServices>) => {
      const withEnvironment = Context.add(
        services,
        HostedEnvironment,
        environmentValues(webSecret, []),
      );
      const context =
        options.harness === false
          ? withEnvironment
          : Context.add(withEnvironment, NativeAgentSessions, harness);
      const response = await web.handler(request, context);
      statuses.push(response.status);
      return response;
    };
    const standing = yield* Effect.context<DatabaseServices>();
    const post = (request: Request) => answer(request, standing);
    const network = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request, url) =>
        Effect.gen(function* () {
          // SAFETY: the client's runner reads no service by type, but every caller of the relay runs on the store's.
          const services = (yield* Effect.context<never>()) as Context.Context<DatabaseServices>;
          const response = yield* Effect.promise(() => answer(webRequest(request, url), services));
          return HttpClientResponse.fromWeb(request, response);
        }),
      ),
    );
    const layer = nativeRelayLayer({ origin: () => NATIVE_RELAY_FAKE.ORIGIN }).pipe(
      Layer.provide(Layer.merge(network, relayEnvironment(eveSecret))),
    );
    return { layer, heard, statuses, post, dispose: () => web.dispose() };
  });
