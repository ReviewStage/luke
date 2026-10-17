import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import {
  SANDBOX_STATE,
  terminalCreateRequestSchema,
  terminalRenameRequestSchema,
} from "@luke/features/terminal-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { type AccountResolving, reachedAgent, uuidOf } from "./agent-reach.js";
import { AgentSandbox, SHELL_REFUSAL, type ShellRefusal } from "./terminal/agent-sandbox.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * The agent terminals group: a coding agent's shells as its Terminal tab
 * lists, starts, names, and ends them, and the developer's resume of its
 * sandbox. Every path reaches the agent through the one rule every agent
 * route keeps (`packages/service/src/agents/agent-reach.ts`), so a member of the task's workspace
 * reaches its terminals as they reach its transcript, and an archived agent
 * is gone. A list never wakes a stopped sandbox; only the resume path does,
 * on the developer's click, and a shell starts only in a running sandbox,
 * answering where it stands otherwise. Nothing here reads or writes a byte
 * of what a shell printed: a list is each shell's name, foreground command,
 * and folder, read from tmux in the sandbox (`hosted/terminal/`).
 */

export const AGENT_TERMINALS_PATH = {
  /** GET lists the agent's shells and where its sandbox stands; POST starts one; the rewrite moves the path's agent id into the `id` query. */
  TERMINALS: "/api/agents/terminals",
  /** PATCH names one shell anew, DELETE ends it; the rewrite moves the agent id into `id` and the shell's into `terminal`. */
  TERMINAL: "/api/agents/terminal",
  /** POST resumes the agent's stopped sandbox; the rewrite moves the path's agent id into the `id` query. */
  SANDBOX_RESUME: "/api/agents/sandbox-resume",
} as const;

const HTTP_METHOD = { GET: "GET", POST: "POST", PATCH: "PATCH", DELETE: "DELETE" } as const;

const TERMINAL_QUERY = "terminal";

/** A shell's name and a few keys at JSON's widest escape, so a body past this names no shell. */
const MAXIMUM_TERMINAL_BODY_BYTES = 1_024;

/** What the routes may require of the function that stands them. */
export type AgentTerminalsAppServices = DatabaseServices | HttpClient.HttpClient;

export interface AgentTerminalsAppSeams extends AccountResolving {
  /** The agent's sandbox as the routes reach it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient>;
}

type TerminalsServices = DatabaseServices | AgentSandbox | HttpServerRequest.HttpServerRequest;

/** The request as the web reads it, its method checked against the ones the path takes. */
const incoming = /* @__PURE__ */ Effect.fnUntraced(function* (
  methods: readonly string[],
): Effect.fn.Return<
  { readonly method: string; readonly request: Request },
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  const server = yield* HttpServerRequest.HttpServerRequest;
  if (!methods.includes(server.method))
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  return { method: server.method, request: yield* Effect.orDie(HttpServerRequest.toWeb(server)) };
});

/**
 * The agent the path names, still standing, and the eve session its sandbox
 * is tagged with, or none where the agent has not run yet. An archived agent
 * is gone, as its tab is.
 */
const reachedSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountResolving,
  request: Request,
): Effect.fn.Return<string | undefined, HostedRefusal, DatabaseServices> {
  const { agent } = yield* reachedAgent(seams, request);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  return session?.sessionId;
});

/**
 * A sandbox Vercel could not be asked about, as the upstream's refusal a
 * caller may retry, apart from the store's own unavailable, so the tab can
 * say it was the agent's sandbox that did not answer: Vercel Sandbox's API,
 * or tmux in a sandbox that API answered for. The log names the status
 * Vercel answered, where it answered one.
 */
function sandboxOrUpstream<A, R>(
  effect: Effect.Effect<A, SandboxUnavailable, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) =>
    Effect.andThen(
      Effect.logWarning(`a terminal's sandbox call failed: ${failure.message}`),
      Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
    ),
  );
}

/** Why a shell could not be had, as the refusal the route answers. */
function shellRefusal(refusal: ShellRefusal): HostedRefusal {
  if (refusal.kind === SHELL_REFUSAL.NOT_FOUND) return HOSTED_REFUSAL.NOT_FOUND;
  return refusal.sandbox === SANDBOX_STATE.STARTING
    ? HOSTED_REFUSAL.AGENT_NOT_READY
    : HOSTED_REFUSAL.SANDBOX_STOPPED;
}

/** The agent's shells as they stand now, the answer every change returns too. */
const listed = /* @__PURE__ */ Effect.fnUntraced(function* (
  sessionId: string | undefined,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentSandbox> {
  if (sessionId === undefined) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      sandbox: SANDBOX_STATE.STARTING,
      terminals: [],
    });
  }
  const sandbox = yield* AgentSandbox;
  return hostedJsonResponse(
    HOSTED_HTTP_STATUS.OK,
    yield* sandboxOrUpstream(sandbox.terminals(sessionId)),
  );
});

/** GET lists the agent's shells and where its sandbox stands; POST starts one, under an id the service mints. */
const terminalsEndpoint = /* @__PURE__ */ Effect.fn("web/agentTerminalsEndpoint")(function* (
  seams: AccountResolving,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TerminalsServices> {
  const { method, request } = yield* incoming([HTTP_METHOD.GET, HTTP_METHOD.POST]);
  const sessionId = yield* reachedSession(seams, request);
  if (method === HTTP_METHOD.GET) return yield* listed(sessionId);
  const body = readEither(terminalCreateRequestSchema)(
    yield* readJsonBodyEffect(MAXIMUM_TERMINAL_BODY_BYTES),
  );
  if (Result.isFailure(body)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  const sandbox = yield* AgentSandbox;
  const started = yield* sandboxOrUpstream(
    sandbox.start(sessionId, randomUUID(), body.success.title),
  );
  if (Result.isFailure(started)) return yield* Effect.fail(shellRefusal(started.failure));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { terminal: started.success });
});

/** PATCH names one shell anew, DELETE ends it; either answers the shells as they stand after. */
const terminalEndpoint = /* @__PURE__ */ Effect.fn("web/agentTerminalEndpoint")(function* (
  seams: AccountResolving,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TerminalsServices> {
  const { method, request } = yield* incoming([HTTP_METHOD.PATCH, HTTP_METHOD.DELETE]);
  const terminalId = yield* uuidOf(request, TERMINAL_QUERY);
  const sessionId = yield* reachedSession(seams, request);
  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const sandbox = yield* AgentSandbox;
  if (method === HTTP_METHOD.PATCH) {
    const body = readEither(terminalRenameRequestSchema)(
      yield* readJsonBodyEffect(MAXIMUM_TERMINAL_BODY_BYTES),
    );
    if (Result.isFailure(body)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const renamed = yield* sandboxOrUpstream(
      sandbox.rename(sessionId, terminalId, body.success.title),
    );
    if (Result.isFailure(renamed)) return yield* Effect.fail(shellRefusal(renamed.failure));
    return yield* listed(sessionId);
  }
  const killed = yield* sandboxOrUpstream(sandbox.kill(sessionId, terminalId));
  if (Result.isFailure(killed)) return yield* Effect.fail(shellRefusal(killed.failure));
  return yield* listed(sessionId);
});

/** POST resumes the agent's sandbox from its snapshot, the developer's click and nothing else, answering where it stands after. */
const resumeEndpoint = /* @__PURE__ */ Effect.fn("web/agentSandboxResumeEndpoint")(function* (
  seams: AccountResolving,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TerminalsServices> {
  const { request } = yield* incoming([HTTP_METHOD.POST]);
  const sessionId = yield* reachedSession(seams, request);
  if (sessionId === undefined) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { sandbox: SANDBOX_STATE.STARTING });
  }
  const sandbox = yield* AgentSandbox;
  const resumed = yield* sandboxOrUpstream(sandbox.resume(sessionId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { sandbox: resumed });
});

/** The group: the three paths, each over the agent's sandbox the seams hand, and the hosted vocabulary's own refusal for any other. */
export function agentTerminalsApp(
  seams: AgentTerminalsAppSeams,
): WebRoutes<AgentTerminalsAppServices> {
  const route = (
    endpoint: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      HostedRefusal,
      TerminalsServices
    >,
  ) => hostedRefusing(endpoint).pipe(Effect.provide(seams.sandbox));
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, AGENT_TERMINALS_PATH.TERMINALS, route(terminalsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, AGENT_TERMINALS_PATH.TERMINAL, route(terminalEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, AGENT_TERMINALS_PATH.SANDBOX_RESUME, route(resumeEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
