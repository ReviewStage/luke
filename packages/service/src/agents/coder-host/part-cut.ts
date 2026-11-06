import { Buffer } from "node:buffer";
import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { readMessageById } from "@repo/database/models/message-reads";
import type { ConversationTarget } from "@repo/database/models/writer";
import {
  AGENT_TOOL,
  CLAUDE_CODE_TOOL,
  CODEX_TOOL,
  CONNECTION_TOOL,
  RETIRED_TOOL,
} from "@repo/features/agent-tools";
import {
  AGENT_BOUNDS,
  type AgentTranscriptMessage,
  PART_CUT_FIELD,
  type PartCut,
  type PartCutField,
} from "@repo/features/agent-wire";
import { INTEGRATION_REMOTE_TOOL } from "@repo/features/integration-wire";
import { isRecord, isWireString, type WireValue } from "@repo/wire";
import { toolPartName } from "@repo/wire/ui-messages";
import type { ToolSet } from "ai";
import { Effect, Option, type Schema } from "effect";

export const CUT_END_CHARS = Math.floor(AGENT_BOUNDS.MAX_PART_CHARS / 2);

export const CUT_TOOLS: ReadonlySet<string> = new Set([
  AGENT_TOOL.BASH,
  AGENT_TOOL.READ_FILE,
  AGENT_TOOL.GLOB,
  AGENT_TOOL.GREP,
  AGENT_TOOL.WEB_SEARCH,
  AGENT_TOOL.READ_WEB_PAGE,
  AGENT_TOOL.RUN_ON_MAC,
  RETIRED_TOOL.WEB_FETCH,
  RETIRED_TOOL.SEARCH_WEB,
  CLAUDE_CODE_TOOL.BASH,
  CLAUDE_CODE_TOOL.READ,
  CLAUDE_CODE_TOOL.GLOB,
  CLAUDE_CODE_TOOL.GREP,
  CLAUDE_CODE_TOOL.WEB_FETCH,
  CLAUDE_CODE_TOOL.WEB_SEARCH,
  CODEX_TOOL.COMMAND_EXECUTION,
  CODEX_TOOL.WEB_SEARCH,
  CONNECTION_TOOL.SEARCH,
  CONNECTION_TOOL.EXECUTE,
  ...Object.values(INTEGRATION_REMOTE_TOOL),
]);

export const REASONING_PART_TYPE = "reasoning";

interface HeavyField {
  readonly field: PartCutField;
  readonly words: string;
}

function heavyFieldOf(part: WireValue): HeavyField | undefined {
  if (!isRecord(part) || !isWireString(part.type)) return undefined;
  if (part.type === REASONING_PART_TYPE) {
    return isWireString(part.text) ? { field: PART_CUT_FIELD.TEXT, words: part.text } : undefined;
  }
  const tool = toolPartName(part.type);
  if (tool === undefined || !CUT_TOOLS.has(tool) || part.output === undefined) return undefined;
  const { output } = part;
  return {
    field: PART_CUT_FIELD.OUTPUT,
    words: isWireString(output) ? output : JSON.stringify(output),
  };
}

function cutPart(
  part: WireValue,
  index: number,
): { readonly part: WireValue; readonly cut: PartCut } | undefined {
  const heavy = heavyFieldOf(part);
  if (heavy === undefined || heavy.words.length <= AGENT_BOUNDS.MAX_PART_CHARS) {
    return undefined;
  }
  if (!isRecord(part)) return undefined;
  const { [heavy.field]: _whole, ...rest } = part;
  return {
    part: rest,
    cut: {
      index,
      field: heavy.field,
      bytes: Buffer.byteLength(heavy.words, "utf8"),
      head: heavy.words.slice(0, CUT_END_CHARS),
      tail: heavy.words.slice(-CUT_END_CHARS),
    },
  };
}

export function cutMessage(message: AgentTranscriptMessage): AgentTranscriptMessage {
  const cuts: PartCut[] = [];
  const parts = message.parts.map((part, index) => {
    const cut = cutPart(part, index);
    if (cut === undefined) return part;
    cuts.push(cut.cut);
    return cut.part;
  });
  return cuts.length === 0 ? message : { ...message, parts, cutParts: cuts };
}

export function wholePartOf(
  target: ConversationTarget,
  tools: ToolSet,
  messageId: string,
  index: number,
): Effect.Effect<Option.Option<WireValue>, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(
    readMessageById(target.userId, target.conversationId, tools, messageId),
    (read) => {
      const parts = (read.ok ? (read.value[0]?.message.parts ?? []) : []) as readonly WireValue[];
      return Option.fromNullishOr(parts[index]);
    },
  );
}
