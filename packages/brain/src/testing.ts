import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
} from "@sidecar/runtime-contracts";
import type { WireRecord } from "@sidecar/wire";
import { BRAIN_MAXIMUM_OUTPUT_TOKENS, failed } from "./model-adapter-shared.js";
import { RESPONSES_ITEM_FORMAT } from "./responses-api.js";
import { TOOL_LOOP_RUNTIME } from "./runtime.js";

/** The two things a bare transport answers: an inference, and when it is quiet. */
export interface BareResponsesModel {
  readonly model?: string;
  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse>;
  quietUntil(): number | undefined;
}

/**
 * A full model adapter over a transport that only infers, in the Responses
 * item format: it counts and compacts nothing, and says so. For a host's
 * tests, which is why it ships behind the `testing` subpath and not the
 * package's barrel.
 */
export function bareModelAdapter(bare: BareResponsesModel): ModelAdapter {
  return {
    ...(bare.model ? { model: bare.model } : undefined),
    capabilities: () =>
      Promise.resolve({
        outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
        capabilities: {
          adapter: "bare-responses",
          ...(bare.model ? { model: bare.model } : undefined),
          checkpoint: {
            runtime: TOOL_LOOP_RUNTIME.ID,
            runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
            format: RESPONSES_ITEM_FORMAT.FORMAT,
            formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
          },
          countsInputTokens: false,
          compacts: false,
          maximumOutputTokens: BRAIN_MAXIMUM_OUTPUT_TOKENS,
        },
      }),
    respond: (items, options) => bare.respond(items, options),
    countInputTokens: () =>
      Promise.resolve(failed(MODEL_FAILURE.COMPATIBILITY, "this transport does not count tokens")),
    compact: () =>
      Promise.resolve(failed(MODEL_FAILURE.COMPATIBILITY, "this transport does not compact")),
    quietUntil: () => bare.quietUntil(),
  };
}
