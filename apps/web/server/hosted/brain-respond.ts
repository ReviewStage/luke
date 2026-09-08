import {
  BRAIN_DEFAULTS,
  BRAIN_OPENAI_DEFAULTS,
  BRAIN_RESPONSES_PATH,
  brainInstructions,
  brainOutputReplayable,
  brainResponsesOutput,
  brainResponsesRequest,
  type HostedBrainRequest,
  hostedBrainRequestFromWire,
  hostedBrainV1ToolDefinitions,
  maximumHostedBrainRequestBytes,
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
import { type FetchLike, postOpenAi } from "./openai.js";
import type { HostedSpend } from "./quota.js";

/**
 * Runs one inference of Luke's brain on Luke's own key for a signed-in
 * developer with no key of their own. One HTTP request is one model call and
 * nothing more: the desktop owns the memory, the scheduling, the tool loop,
 * and every effect, and sends up the input array it would have sent OpenAI
 * itself. The service admits that array item by item against the forms it
 * replays, fixes the model, instructions, toolset, output budget, and the
 * refusal to store from its own build and the turn's authority, posts once,
 * and answers the Responses payload as it came, storing and logging none of
 * the request, the reply, or the encrypted compaction that travels in them.
 * It runs no tool, keeps no conversation, and never asks for a background
 * response; a tool call in the answer is the desktop's to validate and act on.
 */

export const HOSTED_BRAIN_DEFAULTS = {
  MODEL: BRAIN_OPENAI_DEFAULTS.MODEL,
  REASONING_EFFORT: BRAIN_OPENAI_DEFAULTS.REASONING_EFFORT,
  MAXIMUM_OUTPUT_TOKENS: BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
  /** The same ceiling the keyed client keeps: a turn that reasons over a transcript, not a runaway. */
  UPSTREAM_TIMEOUT_MS: BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
} as const;

export interface BrainRespondOptions {
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

function admittedRequest(body: string): HostedBrainRequest | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return undefined;
  }
  // SAFETY: JSON.parse returns a runtime value; hostedBrainRequestFromWire validates the wire contract.
  return hostedBrainRequestFromWire(payload as UnparsedWireValue);
}

export async function handleBrainRespond(options: BrainRespondOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  // Trimmed like the desktop's own key reads: a whitespace credential is the
  // kill switch, not a key, and a blank model override is no override at all.
  const apiKey = trimmedText(options.apiKey);
  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const body = await readBoundedBody(request, maximumHostedBrainRequestBytes);
  if (body.outcome === BODY_READ.TOO_LARGE) {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  const admitted = body.outcome === BODY_READ.READ ? admittedRequest(body.text) : undefined;
  if (!admitted) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  // Spent before the upstream call, and spent whether or not it answers: a
  // refused attempt still counts, the same convention every hosted meter keeps.
  const spend = await options.spend(userId);
  if (!spend.allowed) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
      quota: spend.quota,
    });
  }

  const response = await postOpenAi(
    BRAIN_RESPONSES_PATH,
    brainResponsesRequest(admitted.input, {
      model: trimmedText(options.model) ?? HOSTED_BRAIN_DEFAULTS.MODEL,
      instructions: brainInstructions(),
      tools: hostedBrainV1ToolDefinitions(admitted.authority),
      maximumOutputTokens: HOSTED_BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      reasoningEffort: HOSTED_BRAIN_DEFAULTS.REASONING_EFFORT,
    }),
    {
      apiKey,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? HOSTED_BRAIN_DEFAULTS.UPSTREAM_TIMEOUT_MS,
      signal: request.signal,
    },
  );
  if (!response?.ok) {
    const extra: HostedErrorFields = {};
    if (response) extra.upstreamStatus = response.status;
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR, extra);
  }

  const parsed: unknown = await response.json().catch(() => undefined);
  // SAFETY: response.json returns a runtime value; brainResponsesOutput and brainOutputReplayable validate the wire contract.
  const payload = parsed as UnparsedWireValue;
  // The payload is answered as it came, once it is known to be a Responses
  // answer the desktop's reader can act on; anything else is an upstream
  // fault worded here, never the upstream's own words.
  const output = payload === undefined ? undefined : brainResponsesOutput(payload);
  if (!output || !brainOutputReplayable(payload)) {
    // An answer carrying an item this endpoint would refuse to replay next
    // turn is not handed down: the desktop would keep it verbatim and every
    // later turn of that memory would fail here.
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
  }
  // SAFETY: brainResponsesOutput accepted the payload as a JSON record.
  return jsonResponse(HOSTED_HTTP_STATUS.OK, payload as object);
}
