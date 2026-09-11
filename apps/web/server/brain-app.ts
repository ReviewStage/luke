import {
  type HttpApp,
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { Effect, Redacted } from "effect";
import {
  BRAIN_DEFAULTS,
  BRAIN_EMBEDDING_MODEL,
  BRAIN_EMBEDDINGS_PATH,
  BRAIN_OPENAI_DEFAULTS,
  BRAIN_RESPONSES_INPUT_TOKENS_PATH,
  BRAIN_RESPONSES_PATH,
  brainEmbeddingsRequest,
  brainInputTokensRequest,
  brainOutputReplayable,
  brainResponsesOutput,
  brainResponsesRequest,
  embeddingsVectors,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  HOSTED_SERVICE_PATH,
  type HostedBrainCapabilities,
  type HostedBrainRequestRead,
  type HostedBrainRequestRefusal,
  hostedBrainBounds,
  hostedBrainCountTokensRequestFromWire,
  hostedBrainEmbedRequestFromWire,
  hostedBrainRespondRequestFromWire,
  hostedBrainToolCatalog,
  maximumHostedBrainRequestBytes,
  REASONING_EFFORT,
  RETRY_AFTER_HEADER,
  type ResponsesFunctionTool,
  rateLimitWaitMs,
  responsesInputTokens,
  type UnparsedWireValue,
} from "./core.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedRefusalResponse,
  hostedUpstreamErrorResponse,
  readJsonBodyEffect,
} from "./hosted/http-effect.js";
import { postOpenAiEffect } from "./hosted/openai.js";
import type { HostedSpend } from "./hosted/quota.js";

/**
 * The hosted brain contract as the one route group the brain functions serve.
 * One HTTP request is one model call and nothing more: the desktop owns the
 * memory, the scheduling, the tool loop, and every effect. The desktop
 * prepares the prompt, bounded to the contract's own envelope, and names the
 * tools it means to offer, each a name this service registers a schema for —
 * a caller can never upload a schema, and a name the catalog does not hold
 * refuses the request. The service fixes the model, the upstream, its
 * credential, the reasoning summary, and the bounds, answers its capabilities
 * so a desktop can decide before sending anything, and posts each operation
 * once: an inference, a token count, or a batch of embeddings. It runs no
 * tool, keeps no conversation, and stores and logs none of the request, the
 * reply, or the encrypted items that travel in them.
 *
 * Each of the four paths is its own Vercel function and the group declares
 * all four, so a function answers its own path and the hosted vocabulary's
 * `not-found` on any other. Every path is mounted for every method, because
 * the method a path documents is the endpoint's own refusal to answer —
 * `method-not-allowed`, which a router keyed by method would have turned into
 * a `not-found` the desktop's clients do not read.
 */

export const HOSTED_BRAIN_DEFAULTS = {
  MODEL: BRAIN_OPENAI_DEFAULTS.MODEL,
  REASONING_EFFORT: BRAIN_OPENAI_DEFAULTS.REASONING_EFFORT,
  MAXIMUM_OUTPUT_TOKENS: BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
  /** The same ceiling the keyed client keeps: a turn that reasons over a transcript, not a runaway. */
  UPSTREAM_TIMEOUT_MS: BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
} as const;

/** What the group is handed that the deployment alone can answer for. */
export interface BrainSeams {
  resolveUserId: (authorization: string | undefined) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  timeoutMs?: number | undefined;
}

/** The catalog a name selects from: the actions table's rows and the brain's own tools, fixed by the build. */
const CATALOG: ReadonlyMap<string, ResponsesFunctionTool> = hostedBrainToolCatalog();
const CATALOG_NAMES: ReadonlySet<string> = new Set(CATALOG.keys());

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

const REFUSAL_ERROR = {
  [HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED]: HOSTED_REFUSAL.INVALID_REQUEST,
  [HOSTED_BRAIN_REQUEST_REFUSAL.PROMPT_TOO_LARGE]: HOSTED_REFUSAL.PROMPT_TOO_LARGE,
  [HOSTED_BRAIN_REQUEST_REFUSAL.UNKNOWN_TOOL]: HOSTED_REFUSAL.UNKNOWN_TOOL,
  [HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS]: HOSTED_REFUSAL.INVALID_REQUEST,
} as const satisfies Record<HostedBrainRequestRefusal, HostedRefusal>;

/**
 * An answer, whichever channel it travels on. A refusal is failed with rather
 * than returned, so the gate's steps read as the early returns they are, and
 * the group merges the two channels back into the one answer it hands the
 * platform.
 */
type Answer = HttpServerResponse.HttpServerResponse;

function refuse(refusal: HostedRefusal): Effect.Effect<never, Answer> {
  return Effect.fail(hostedRefusalResponse(refusal));
}

function refusing<A, R>(effect: Effect.Effect<A, HostedRefusal, R>): Effect.Effect<A, Answer, R> {
  return Effect.mapError(effect, hostedRefusalResponse);
}

function modelOf(override: string | undefined): string {
  return override ?? HOSTED_BRAIN_DEFAULTS.MODEL;
}

function hostedBrainCapabilities(model: string | undefined): HostedBrainCapabilities {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: modelOf(model),
    operations: Object.values(HOSTED_BRAIN_OPERATION),
    tools: [...CATALOG.keys()],
    bounds: hostedBrainBounds(),
    reasoningEfforts: Object.values(REASONING_EFFORT),
  };
}

/** The registered schemas the request's names select, in the order named. */
function selectedTools(names: readonly string[]): ResponsesFunctionTool[] {
  const tools: ResponsesFunctionTool[] = [];
  for (const name of names) {
    const tool = CATALOG.get(name);
    if (tool) tools.push(tool);
  }
  return tools;
}

/**
 * The gate every operation passes before anything else: the method, the tier
 * switched on, and the caller signed in. The key arrives already trimmed of a
 * blank the environment holds, so a whitespace credential is the kill switch
 * rather than a key.
 */
function account(
  seams: BrainSeams,
  method: HttpMethod,
): Effect.Effect<
  { userId: string; apiKey: string; model: string | undefined },
  Answer,
  HttpServerRequest.HttpServerRequest | HostedEnvironment
> {
  return Effect.gen(function* () {
    yield* refusing(hostedMethod(method));
    const environment = yield* HostedEnvironment;
    if (environment.openAiKey === undefined) return yield* refuse(HOSTED_REFUSAL.UNAVAILABLE);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const userId = yield* Effect.promise(() => seams.resolveUserId(request.headers.authorization));
    if (!userId) return yield* refuse(HOSTED_REFUSAL.INVALID_TOKEN);
    return {
      userId,
      apiKey: Redacted.value(environment.openAiKey),
      model: environment.brainModel,
    };
  });
}

/** One operation of the contract: how its request is read, where it posts, what it posts, and what of the answer is handed down. */
interface BrainOperation<Admitted> {
  read: (payload: UnparsedWireValue) => HostedBrainRequestRead<Admitted>;
  path: string;
  body: (request: Admitted, model: string) => Parameters<typeof postOpenAiEffect>[1];
  /** The response body for the desktop, or nothing when the upstream's answer is not one this contract hands down. */
  answer: (payload: UnparsedWireValue) => object | undefined;
}

/**
 * The one shape every POST operation has: the body within its byte bound and
 * read whole, the request admitted by the contract's own reader, the
 * allowance spent — before the upstream call, and spent whether or not it
 * answers, the convention every hosted meter keeps — then one upstream post
 * and the answer as the operation reads it.
 */
function brainOperation<Admitted>(
  seams: BrainSeams,
  operation: BrainOperation<Admitted>,
): Effect.Effect<
  Answer,
  Answer,
  HttpServerRequest.HttpServerRequest | HostedEnvironment | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const { userId, apiKey, model } = yield* account(seams, HTTP_METHOD.POST);
    const payload = yield* refusing(readJsonBodyEffect(maximumHostedBrainRequestBytes));
    const read = operation.read(payload);
    if (!read.ok) return yield* refuse(REFUSAL_ERROR[read.refusal]);
    const spend = yield* Effect.promise(() => seams.spend(userId));
    if (!spend.allowed) {
      return yield* Effect.fail(
        hostedJsonResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, {
          error: HOSTED_API_ERROR.QUOTA_EXHAUSTED,
          quota: spend.quota,
        }),
      );
    }
    const answered = yield* upstream(
      seams,
      apiKey,
      operation.path,
      operation.body(read.request, modelOf(model)),
    );
    const body = answered === undefined ? undefined : operation.answer(answered);
    if (!body) return yield* Effect.fail(hostedUpstreamErrorResponse(undefined));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, body);
  });
}

/**
 * The upstream's answer as the wire value the operation reads, or the refusal
 * to hand down. The request is carried by the ambient `HttpClient`, whose
 * interruption is the fiber's own: a turn cancelled mid-call drops the
 * request with it, so an interrupted turn spends no more of the upstream than
 * it already had.
 */
function upstream(
  seams: BrainSeams,
  apiKey: string,
  path: string,
  body: Parameters<typeof postOpenAiEffect>[1],
): Effect.Effect<UnparsedWireValue | undefined, Answer, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const response = yield* postOpenAiEffect(path, body, {
      apiKey,
      timeoutMs: seams.timeoutMs ?? HOSTED_BRAIN_DEFAULTS.UPSTREAM_TIMEOUT_MS,
    });
    if (response?.status === HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS) {
      // The provider itself is rate limiting: the desktop cools down for the
      // bounded wait the header names, as a keyed desktop would, and never
      // mistakes it for a spent allowance. The allowance was still spent.
      const waitMs = rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER));
      return yield* Effect.fail(
        hostedJsonResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, {
          error: HOSTED_API_ERROR.UPSTREAM_THROTTLED,
          upstreamStatus: response.status,
        }).pipe(HttpServerResponse.setHeader(RETRY_AFTER_HEADER, String(Math.ceil(waitMs / 1000)))),
      );
    }
    if (!response?.ok) return yield* Effect.fail(hostedUpstreamErrorResponse(response?.status));
    const parsed: unknown = yield* Effect.promise(() => response.json().catch(() => undefined));
    // SAFETY: response.json returns a runtime value; every reader below validates it as wire.
    return parsed as UnparsedWireValue;
  });
}

/** GET: what this service speaks, so a desktop can refuse to run against one that lacks it. */
function capabilities(
  seams: BrainSeams,
): Effect.Effect<Answer, Answer, HttpServerRequest.HttpServerRequest | HostedEnvironment> {
  return Effect.map(account(seams, HTTP_METHOD.GET), ({ model }) =>
    hostedJsonResponse(HOSTED_HTTP_STATUS.OK, hostedBrainCapabilities(model)),
  );
}

/** POST: one inference on the prepared prompt and the selected schemas, answered as the payload came. */
function respond(seams: BrainSeams) {
  return brainOperation(seams, {
    read: (payload) => hostedBrainRespondRequestFromWire(payload, CATALOG_NAMES),
    path: BRAIN_RESPONSES_PATH,
    body: (request, model) =>
      brainResponsesRequest(request.input, {
        model,
        instructions: request.prompt,
        tools: selectedTools(request.tools),
        maximumOutputTokens:
          request.options.maximumOutputTokens ?? HOSTED_BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
        reasoningEffort: request.options.reasoningEffort ?? HOSTED_BRAIN_DEFAULTS.REASONING_EFFORT,
        ...(request.options.promptCacheKey !== undefined
          ? { promptCacheKey: request.options.promptCacheKey }
          : undefined),
      }),
    // SAFETY: brainResponsesOutput accepted the payload as a JSON record.
    answer: (payload) =>
      brainResponsesOutput(payload) && brainOutputReplayable(payload)
        ? (payload as object)
        : undefined,
  });
}

/** POST: how many input tokens the prepared request weighs, and nothing else of the upstream's answer. */
function countTokens(seams: BrainSeams) {
  return brainOperation(seams, {
    read: (payload) => hostedBrainCountTokensRequestFromWire(payload, CATALOG_NAMES),
    path: BRAIN_RESPONSES_INPUT_TOKENS_PATH,
    body: (request, model) =>
      brainInputTokensRequest(request.input, {
        model,
        instructions: request.prompt,
        tools: selectedTools(request.tools),
      }),
    answer: (payload) => {
      const inputTokens = responsesInputTokens(payload);
      return inputTokens === undefined ? undefined : { inputTokens };
    },
  });
}

/**
 * POST: one vector per text for the desktop's notebook index, under the
 * embedding model this build fixes. The texts are notebook chunks the
 * desktop chose to index; the service embeds them and keeps none.
 */
function embed(seams: BrainSeams) {
  return brainOperation(seams, {
    read: hostedBrainEmbedRequestFromWire,
    path: BRAIN_EMBEDDINGS_PATH,
    body: (request) => brainEmbeddingsRequest(request.texts, { model: BRAIN_EMBEDDING_MODEL }),
    answer: (payload) => {
      const answer = embeddingsVectors(payload);
      const dimensions = answer?.vectors[0]?.length;
      return answer && dimensions
        ? { model: answer.model, dimensions, vectors: answer.vectors }
        : undefined;
    },
  });
}

/** The group, which is the contract's four paths and the refusal anywhere else. */
export function brainApp(
  seams: BrainSeams,
): HttpApp.Default<never, HostedEnvironment | HttpClient.HttpClient> {
  return HttpRouter.empty.pipe(
    HttpRouter.all(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, Effect.merge(capabilities(seams))),
    HttpRouter.all(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, Effect.merge(respond(seams))),
    HttpRouter.all(HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS, Effect.merge(countTokens(seams))),
    HttpRouter.all(HOSTED_SERVICE_PATH.BRAIN_EMBED, Effect.merge(embed(seams))),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
