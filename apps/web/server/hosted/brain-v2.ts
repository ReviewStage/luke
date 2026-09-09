import {
  BRAIN_DEFAULTS,
  BRAIN_EMBEDDING_MODEL,
  BRAIN_EMBEDDINGS_PATH,
  BRAIN_OPENAI_DEFAULTS,
  BRAIN_RESPONSES_COMPACT_PATH,
  BRAIN_RESPONSES_INPUT_TOKENS_PATH,
  BRAIN_RESPONSES_PATH,
  brainCompactRequest,
  brainEmbeddingsRequest,
  brainInputTokensRequest,
  brainOutputReplayable,
  brainResponsesOutput,
  brainResponsesRequest,
  type CloudFetch,
  embeddingsVectors,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  type HostedBrainCapabilities,
  type HostedBrainRequestRead,
  type HostedBrainRequestRefusal,
  hostedBrainBounds,
  hostedBrainCompactRequestFromWire,
  hostedBrainCountTokensRequestFromWire,
  hostedBrainEmbedRequestFromWire,
  hostedBrainRespondRequestFromWire,
  hostedBrainToolCatalog,
  maximumHostedBrainRequestBytes,
  REASONING_EFFORT,
  RETRY_AFTER_HEADER,
  type ResponsesFunctionTool,
  rateLimitWaitMs,
  responsesCompactedWindow,
  responsesInputTokens,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import {
  BODY_READ,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  type HostedErrorFields,
  jsonResponse,
  readBoundedBody,
} from "./http.js";
import { postOpenAi } from "./openai.js";
import type { HostedSpend } from "./quota.js";

/**
 * The hosted brain contract. One HTTP request is one model call and nothing
 * more: the desktop owns the memory, the scheduling, the tool loop, and every
 * effect. The desktop prepares the prompt, bounded to the contract's own
 * envelope, and names the tools it means to offer, each a name this service
 * registers a schema for — a caller can never upload a schema, and a name the
 * catalog does not hold refuses the request. The service fixes the model, the
 * upstream, its credential, the refusal to store, and the bounds, answers its
 * capabilities so a desktop can decide before sending anything, and posts each
 * operation once: an inference, a token count, or an explicit compaction whose
 * answered window the desktop adopts whole. It runs no tool, keeps no
 * conversation, and stores and logs none of the request, the reply, or the
 * encrypted items that travel in them.
 */

export const HOSTED_BRAIN_DEFAULTS = {
  MODEL: BRAIN_OPENAI_DEFAULTS.MODEL,
  REASONING_EFFORT: BRAIN_OPENAI_DEFAULTS.REASONING_EFFORT,
  MAXIMUM_OUTPUT_TOKENS: BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
  /** The same ceiling the keyed client keeps: a turn that reasons over a transcript, not a runaway. */
  UPSTREAM_TIMEOUT_MS: BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
} as const;

export interface BrainCapabilitiesOptions {
  request: Request;
  /** Luke's own OpenAI key, from the deployment environment; absent means the tier is off. */
  apiKey: string | undefined;
  /** A deployment-configured model override; the shared default otherwise. */
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
}

export interface BrainV2Options extends BrainCapabilitiesOptions {
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: CloudFetch;
  timeoutMs?: number;
}

/** The catalog a name selects from: the actions table's rows and the brain's own tools, fixed by the build. */
const CATALOG: ReadonlyMap<string, ResponsesFunctionTool> = hostedBrainToolCatalog();
const CATALOG_NAMES: ReadonlySet<string> = new Set(CATALOG.keys());

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

export function hostedBrainCapabilities(model: string | undefined): HostedBrainCapabilities {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: modelOf(model),
    operations: Object.values(HOSTED_BRAIN_OPERATION),
    tools: [...CATALOG.keys()],
    bounds: hostedBrainBounds(),
    reasoningEfforts: Object.values(REASONING_EFFORT),
  };
}

function modelOf(override: string | undefined): string {
  return trimmedText(override) ?? HOSTED_BRAIN_DEFAULTS.MODEL;
}

/** GET: what this service speaks, so a desktop can refuse to run against one that lacks it. */
export function handleBrainCapabilities(options: BrainCapabilitiesOptions): Promise<Response> {
  return withAccount(options, HTTP_METHOD.GET, async () =>
    jsonResponse(HOSTED_HTTP_STATUS.OK, hostedBrainCapabilities(options.model)),
  );
}

const REFUSAL_ERROR = {
  [HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED]: HOSTED_API_ERROR.INVALID_REQUEST,
  [HOSTED_BRAIN_REQUEST_REFUSAL.PROMPT_TOO_LARGE]: HOSTED_API_ERROR.PROMPT_TOO_LARGE,
  [HOSTED_BRAIN_REQUEST_REFUSAL.UNKNOWN_TOOL]: HOSTED_API_ERROR.UNKNOWN_TOOL,
  [HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS]: HOSTED_API_ERROR.INVALID_REQUEST,
} as const satisfies Record<HostedBrainRequestRefusal, string>;

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
 * switched on, and the caller signed in. The key reaches the handler
 * trimmed, the way the desktop's own key reads trim theirs, so a whitespace
 * credential is the kill switch rather than a key.
 */
async function withAccount(
  options: BrainCapabilitiesOptions,
  method: HttpMethod,
  handle: (userId: string, apiKey: string) => Promise<Response>,
): Promise<Response> {
  const { request } = options;
  if (request.method !== method) {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const apiKey = trimmedText(options.apiKey);
  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  return handle(userId, apiKey);
}

/** One operation of the contract: how its request is read, where it posts, what it posts, and what of the answer is handed down. */
interface BrainOperation<Admitted> {
  read: (payload: UnparsedWireValue) => HostedBrainRequestRead<Admitted>;
  path: string;
  body: (request: Admitted, model: string) => Parameters<typeof postOpenAi>[1];
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
  options: BrainV2Options,
  operation: BrainOperation<Admitted>,
): Promise<Response> {
  return withAccount(options, HTTP_METHOD.POST, async (userId, apiKey) => {
    const admitted = await admittedRequest(options.request, operation.read);
    if (admitted instanceof Response) return admitted;
    const spend = await options.spend(userId);
    if (!spend.allowed) {
      return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
        quota: spend.quota,
      });
    }
    const payload = await upstream(
      options,
      apiKey,
      operation.path,
      operation.body(admitted, modelOf(options.model)),
    );
    if (payload instanceof Response) return payload;
    const answer = payload === undefined ? undefined : operation.answer(payload);
    if (!answer) {
      return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
    }
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  });
}

async function admittedRequest<Admitted>(
  request: Request,
  read: (payload: UnparsedWireValue) => HostedBrainRequestRead<Admitted>,
): Promise<Admitted | Response> {
  const body = await readBoundedBody(request, maximumHostedBrainRequestBytes);
  if (body.outcome === BODY_READ.TOO_LARGE) {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  if (body.outcome !== BODY_READ.READ) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  // SAFETY: JSON.parse returns a runtime value; the contract reader validates it as wire.
  const result = read(payload as UnparsedWireValue);
  if (!result.ok) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, REFUSAL_ERROR[result.refusal]);
  }
  return result.request;
}

async function upstream(
  options: BrainV2Options,
  apiKey: string,
  path: string,
  body: Parameters<typeof postOpenAi>[1],
): Promise<UnparsedWireValue | Response> {
  const response = await postOpenAi(path, body, {
    apiKey,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? HOSTED_BRAIN_DEFAULTS.UPSTREAM_TIMEOUT_MS,
    signal: options.request.signal,
  });
  if (response?.status === HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS) {
    // The provider itself is rate limiting: the desktop cools down for the
    // bounded wait the header names, as a keyed desktop would, and never
    // mistakes it for a spent allowance. The allowance was still spent.
    const waitMs = rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER));
    const throttledResponse = errorResponse(
      HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
      HOSTED_API_ERROR.UPSTREAM_THROTTLED,
      { upstreamStatus: response.status },
    );
    throttledResponse.headers.set(RETRY_AFTER_HEADER, String(Math.ceil(waitMs / 1000)));
    return throttledResponse;
  }
  if (!response?.ok) {
    const extra: HostedErrorFields = {};
    if (response) extra.upstreamStatus = response.status;
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR, extra);
  }
  const parsed: unknown = await response.json().catch(() => undefined);
  // SAFETY: response.json returns a runtime value; every reader below validates it as wire.
  return parsed as UnparsedWireValue;
}

/** POST: one inference on the prepared prompt and the selected schemas, answered as the payload came. */
export function handleBrainRespondV2(options: BrainV2Options): Promise<Response> {
  return brainOperation(options, {
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
export function handleBrainCountTokens(options: BrainV2Options): Promise<Response> {
  return brainOperation(options, {
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
export function handleBrainEmbed(options: BrainV2Options): Promise<Response> {
  return brainOperation(options, {
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

/** POST: an explicit compaction; the whole window the upstream answers is the desktop's next context. */
export function handleBrainCompact(options: BrainV2Options): Promise<Response> {
  return brainOperation(options, {
    read: hostedBrainCompactRequestFromWire,
    path: BRAIN_RESPONSES_COMPACT_PATH,
    body: (request, model) =>
      brainCompactRequest(request.input, { model, instructions: request.prompt }),
    answer: (payload) => {
      const window = responsesCompactedWindow(payload);
      return window && brainOutputReplayable(payload) ? { output: window } : undefined;
    },
  });
}
