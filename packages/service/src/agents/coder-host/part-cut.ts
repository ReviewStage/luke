/**
 * part-cut.ts -- a transcript page's heavy parts cut to their two ends, and one part read whole.
 *
 * A coding agent's journal holds every command's output and every thought
 * whole, and one call's output can run to megabytes, so a page that carried
 * them would weigh what the journal does. A page a reader asked cut
 * (`TRANSCRIPT_PARTS_QUERY`) carries, for each tool part whose output and
 * each reasoning part whose words run past `MAX_PART_CHARS`, the part
 * without that field, and beside the message the field's first and last
 * characters and its whole size (`cutParts`). The reader fetches the part
 * whole, by the message's id and the part's index, when it opens it.
 * Note that a part is cut on the page alone: the row, and every other read
 * of it, keeps it whole. Only the outputs of the tools that read something
 * and answer it as words are cut (`CUT_TOOLS`): a command's, a file's, a
 * search's, a web page's, and a connection's, under every harness's name.
 * Every other call's answer is carried whole, because the window reads it
 * for what it means, the agent a start began or the page a show made, and
 * a tool added later is carried whole until it is named here.
 */

import { Buffer } from "node:buffer";
import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { readMessageById } from "@luke/database/models/message-reads";
import type { ConversationTarget } from "@luke/database/models/writer";
import {
  AGENT_TOOL,
  CLAUDE_CODE_TOOL,
  CODEX_TOOL,
  CONNECTION_TOOL,
  RETIRED_TOOL,
} from "@luke/features/agent-tools";
import {
  CODING_AGENT_BOUNDS,
  type CodingAgentMessage,
  type CodingAgentPartCut,
  PART_CUT_FIELD,
  type PartCutField,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_REMOTE_TOOL } from "@luke/features/integration-wire";
import { isRecord, isWireString, type WireValue } from "@luke/wire";
import { toolPartName } from "@luke/wire/ui-messages";
import type { ToolSet } from "ai";
import { Effect, Option, type Schema } from "effect";

/** How many characters of a cut field a page carries at each end. */
export const CUT_END_CHARS = Math.floor(CODING_AGENT_BOUNDS.MAX_PART_CHARS / 2);

/** The tools whose output a page may cut: each reads something and answers it as words, which the window only draws. */
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

/** The part type whose words a page may cut beside the tool parts. */
export const REASONING_PART_TYPE = "reasoning";

/** A part's heavy field as words: which field, and its words, a tool's output that is no string as its JSON text. */
interface HeavyField {
  readonly field: PartCutField;
  readonly words: string;
}

/** The field of a part a page may cut, as words; none for a part that has none. */
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

/** The part without its cut field, and what the page says of the field; none for a part within the bound. */
function cutPart(
  part: WireValue,
  index: number,
): { readonly part: WireValue; readonly cut: CodingAgentPartCut } | undefined {
  const heavy = heavyFieldOf(part);
  if (heavy === undefined || heavy.words.length <= CODING_AGENT_BOUNDS.MAX_PART_CHARS) {
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

/** A message as a page asked cut carries it: each part past the bound without its field, and the cuts beside them; the message itself where none is. */
export function cutMessage(message: CodingAgentMessage): CodingAgentMessage {
  const cuts: CodingAgentPartCut[] = [];
  const parts = message.parts.map((part, index) => {
    const cut = cutPart(part, index);
    if (cut === undefined) return part;
    cuts.push(cut.cut);
    return cut.part;
  });
  return cuts.length === 0 ? message : { ...message, parts, cutParts: cuts };
}

/**
 * One part of a message of the conversation, whole, as a page of it reads
 * it: by the message's id and the part's index among the parts the read
 * answers. None where no such message stands in the conversation under the
 * account the target names, or it holds no part at the index.
 */
export function wholePartOf(
  target: ConversationTarget,
  tools: ToolSet,
  messageId: string,
  index: number,
): Effect.Effect<Option.Option<WireValue>, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(
    readMessageById(target.userId, target.conversationId, tools, messageId),
    (read) => {
      // SAFETY: every part is the JSON its row stored, which the SDK's part types only name more narrowly.
      const parts = (read.ok ? (read.value[0]?.message.parts ?? []) : []) as readonly WireValue[];
      return Option.fromNullishOr(parts[index]);
    },
  );
}
