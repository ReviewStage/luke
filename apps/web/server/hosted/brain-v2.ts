import {
  BRAIN_OPENAI_DEFAULTS,
  BRAIN_RESPONSES_COMPACT_PATH,
  BRAIN_RESPONSES_INPUT_TOKENS_PATH,
  BRAIN_RESPONSES_PATH,
  brainCompactRequest,
  brainInputTokensRequest,
  brainOutputReplayable,
  brainResponsesOutput,
  brainResponsesRequest,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_BRAIN_REQUEST_REFUSAL,
  type HostedBrainCapabilities,
  type HostedBrainRequestRead,
  type HostedBrainRequestRefusal,
  hostedBrainBounds,
  hostedBrainCompactRequestFromWire,
  hostedBrainCountTokensRequestFromWire,
  hostedBrainRespondRequestFromWire,
  hostedBrainToolCatalog,
  maximumHostedBrainRequestBytes,
  REASONING_EFFORT,
  type ResponsesFunctionTool,
  responsesCompactedWindow,
  responsesInputTokens,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import { HOSTED_BRAIN_DEFAULTS, readBoundedBody } from "./brain-respond.js";
import {
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  type HostedErrorFields,
  jsonResponse,
} from "./http.js";
import { type FetchLike, postOpenAi } from "./openai.js";
import type { HostedSpend } from "./quota.js";

/**
 * The second hosted brain contract, beside the first. One HTTP request is
 * still one model call and nothing more: the desktop owns the memory, the
 * scheduling, the tool loop, and every effect. What changed is what the
 * desktop may say: it prepares the prompt, bounded to the contract's own
 * envelope, and names the tools it means to offer, each a name this service
 * registers a schema for — a caller can never upload a schema, and a name the
 * catalog does not hold refuses the request. The service still fixes the
 * model, the upstream, its credential, the refusal to store, and the bounds,
 * answers its capabilities so a desktop can decide before sending anything,
 * and posts each operation once: an inference, a token count, or an explicit
 * compaction whose answered window the desktop adopts whole. It runs no
 * tool, keeps no conversation, and stores and logs none of the request, the
 * reply, or the encrypted items that travel in them.
 */

export interface BrainV2Options {
  request: Request;
  /** Luke's own OpenAI key, from the deployment environment; absent means the tier is off. */
  apiKey: string | undefined;
  /** A deployment-configured model override; the shared default otherwise. */
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** The catalog a name selects from: the acts table's rows and the brain's own tools, fixed by the build. */
export function hostedBrainCatalog(): ReadonlyMap<string, ResponsesFunctionTool> {
  return hostedBrainToolCatalog();
}

export function hostedBrainCapabilities(model: string | undefined): HostedBrainCapabilities {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: trimmedText(model) ?? HOSTED_BRAIN_DEFAULTS.MODEL,
    operations: Object.values(HOSTED_BRAIN_OPERATION),
    tools: [...hostedBrainCatalog().keys()],
    bounds: hostedBrainBounds(),
    reasoningEfforts: Object.values(REASONING_EFFORT),
  };
}

/** GET: what this service speaks, so a desktop can refuse to run against one that lacks it. */
export function handleBrainCapabilities(options: BrainV2Options): Promise<Response> {
  return withAccount(options, "GET", async () =>
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
  const catalog = hostedBrainCatalog();
  const tools: ResponsesFunctionTool[] = [];
  for (const name of names) {
    const tool = catalog.get(name);
    if (tool) tools.push(tool);
  }
  return tools;
}

/**
 * The gate every v2 operation passes: the tier switched on, the caller
 * signed in, the body within its byte bound and read whole, the request
 * admitted by the contract's own reader, and the allowance spent — before
 * the upstream call, and spent whether or not it answers, the convention
 * every hosted meter keeps.
 */
async function withAccount(
  options: BrainV2Options,
  method: "GET" | "POST",
  handle: (userId: string) => Promise<Response>,
): Promise<Response> {
  const { request } = options;
  if (request.method !== method) {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  if (!trimmedText(options.apiKey)) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  return handle(userId);
}

async function admitted<Request>(
  options: BrainV2Options,
  read: (payload: UnparsedWireValue) => HostedBrainRequestRead<Request>,
): Promise<Request | Response> {
  const body = await readBoundedBody(options.request, maximumHostedBrainRequestBytes);
  if (body.outcome === "too-large") {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  if (body.outcome !== "read") {
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
  if (!result.ok)
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, REFUSAL_ERROR[result.refusal]);
  return result.request;
}

async function spent(options: BrainV2Options, userId: string): Promise<Response | undefined> {
  const spend = await options.spend(userId);
  if (spend.allowed) return undefined;
  return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
    quota: spend.quota,
  });
}

async function upstream(
  options: BrainV2Options,
  path: string,
  body: Parameters<typeof postOpenAi>[1],
): Promise<UnparsedWireValue | Response> {
  const apiKey = trimmedText(options.apiKey);
  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  const response = await postOpenAi(path, body, {
    apiKey,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? HOSTED_BRAIN_DEFAULTS.UPSTREAM_TIMEOUT_MS,
    signal: options.request.signal,
  });
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
  return withAccount(options, "POST", async (userId) => {
    const request = await admitted(options, (payload) =>
      hostedBrainRespondRequestFromWire(payload, new Set(hostedBrainCatalog().keys())),
    );
    if (request instanceof Response) return request;
    const refused = await spent(options, userId);
    if (refused) return refused;
    const payload = await upstream(
      options,
      BRAIN_RESPONSES_PATH,
      brainResponsesRequest(request.input, {
        model: trimmedText(options.model) ?? HOSTED_BRAIN_DEFAULTS.MODEL,
        instructions: request.prompt,
        tools: selectedTools(request.tools),
        maximumOutputTokens:
          request.options.maximumOutputTokens ?? HOSTED_BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
        reasoningEffort: request.options.reasoningEffort ?? HOSTED_BRAIN_DEFAULTS.REASONING_EFFORT,
      }),
    );
    if (payload instanceof Response) return payload;
    // An answer carrying an item this endpoint would refuse to replay next
    // turn is not handed down: the desktop would keep it verbatim and every
    // later turn of that memory would fail here.
    const output = payload === undefined ? undefined : brainResponsesOutput(payload);
    if (!output || !brainOutputReplayable(payload)) {
      return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
    }
    // SAFETY: brainResponsesOutput accepted the payload as a JSON record.
    return jsonResponse(HOSTED_HTTP_STATUS.OK, payload as object);
  });
}

/** POST: how many input tokens the prepared request weighs, and nothing else of the upstream's answer. */
export function handleBrainCountTokens(options: BrainV2Options): Promise<Response> {
  return withAccount(options, "POST", async (userId) => {
    const request = await admitted(options, (payload) =>
      hostedBrainCountTokensRequestFromWire(payload, new Set(hostedBrainCatalog().keys())),
    );
    if (request instanceof Response) return request;
    const refused = await spent(options, userId);
    if (refused) return refused;
    const payload = await upstream(
      options,
      BRAIN_RESPONSES_INPUT_TOKENS_PATH,
      brainInputTokensRequest(request.input, {
        model: trimmedText(options.model) ?? HOSTED_BRAIN_DEFAULTS.MODEL,
        instructions: request.prompt,
        tools: selectedTools(request.tools),
      }),
    );
    if (payload instanceof Response) return payload;
    const inputTokens = responsesInputTokens(payload);
    if (inputTokens === undefined) {
      return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
    }
    return jsonResponse(HOSTED_HTTP_STATUS.OK, { inputTokens });
  });
}

/** POST: an explicit compaction; the whole window the upstream answers is the desktop's next context. */
export function handleBrainCompact(options: BrainV2Options): Promise<Response> {
  return withAccount(options, "POST", async (userId) => {
    const request = await admitted(options, hostedBrainCompactRequestFromWire);
    if (request instanceof Response) return request;
    const refused = await spent(options, userId);
    if (refused) return refused;
    const payload = await upstream(
      options,
      BRAIN_RESPONSES_COMPACT_PATH,
      brainCompactRequest(request.input, {
        model: trimmedText(options.model) ?? HOSTED_BRAIN_DEFAULTS.MODEL,
        instructions: request.prompt,
      }),
    );
    if (payload instanceof Response) return payload;
    const window = payload === undefined ? undefined : responsesCompactedWindow(payload);
    if (!window || !brainOutputReplayable(payload)) {
      return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
    }
    return jsonResponse(HOSTED_HTTP_STATUS.OK, { output: window });
  });
}

export { BRAIN_OPENAI_DEFAULTS };
