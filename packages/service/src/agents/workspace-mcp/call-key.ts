import { createHash } from "node:crypto";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { nativeCallKeyOf } from "@repo/database/models/native-call-keys";
import { isRecord, type UnparsedWireValue } from "@repo/wire";
import type { Effect } from "effect";
import type { AdmittedConversation } from "../eve-host/conversation.js";

export const NATIVE_CALL_KEY_WINDOW_MS = 10 * 60_000;

function ordered(value: UnparsedWireValue): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])]),
  );
}

function nativeCallDigest(tool: string, input: UnparsedWireValue): string {
  return createHash("sha256")
    .update(JSON.stringify([tool, ordered(input)]))
    .digest("hex");
}

export function workspaceMcpCallKey(
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
