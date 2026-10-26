/**
 * call-key.ts -- the key a native agent's tool call runs under, the same across its harness's retry of the call.
 *
 * eve keys a start or a message on its own id for the tool call, so a call
 * run again starts or sends once (`../coding-agent-tools.ts`'s
 * `CodingAgentCall`). A Claude Code or Codex agent's retry, after its
 * harness's timeout or the door's failure, is a fresh call of the harness's,
 * with a tool-use id and a JSON-RPC id of its own, so neither keys it to the
 * call it repeats; what is the same is the agent's conversation, the tool,
 * and the input. So the key is the one the store holds for that digest
 * within the window (`@luke/database/models/native-call-keys`): the same
 * input called again within it runs under the first call's key, and the
 * tools' own dedupe does the rest; past the window the input is a call of
 * its own again, as an agent sending one line twice an hour apart means it
 * to be.
 */

import { createHash } from "node:crypto";
import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import { nativeCallKeyOf } from "@luke/database/models/native-call-keys";
import { isRecord, type UnparsedWireValue } from "@luke/wire";
import type { Effect } from "effect";
import type { AdmittedConversation } from "../brain-host/conversation.js";

/** How long a call of the same input runs under the first call's key: past every harness's tool timeout and the retry it prompts, and short of an agent repeating itself on purpose. */
export const NATIVE_CALL_KEY_WINDOW_MS = 10 * 60_000;

/** A value with every record's keys in order, so a retry that spells the same input in another order digests the same. */
function ordered(value: UnparsedWireValue): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])]),
  );
}

/** The digest a call is keyed by: the tool's name and its input. */
function nativeCallDigest(tool: string, input: UnparsedWireValue): string {
  return createHash("sha256")
    .update(JSON.stringify([tool, ordered(input)]))
    .digest("hex");
}

/** The key the admitted agent's call of the tool on this input runs under: one call's within the window. */
export function lukeMcpCallKey(
  admitted: AdmittedConversation,
  tool: string,
  input: UnparsedWireValue,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  const { userId, conversationId } = admitted.target;
  return nativeCallKeyOf(
    userId,
    conversationId,
    nativeCallDigest(tool, input),
    NATIVE_CALL_KEY_WINDOW_MS,
  );
}
