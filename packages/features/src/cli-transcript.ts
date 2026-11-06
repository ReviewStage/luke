import { MESSAGE_ROLE } from "@repo/wire";
import { TOOL_PART_STATE } from "@repo/wire/ui-messages";
import type { AgentTranscriptMessage } from "./agent-wire.js";

const TOOL_PART_PREFIX = "tool-";

const DYNAMIC_TOOL_PART = "dynamic-tool";

const TEXT_PART = { TYPE: "text", STREAMING: "streaming" } as const;

const MAX_SUBJECT_CHARS = 120;

const SUBJECT_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "description",
  "prompt",
] as const;

type PrintedPart =
  | { readonly words: string; readonly settled: boolean }
  | { readonly tool: string; readonly subject: string | undefined; readonly settled: boolean }
  | undefined;

function stringField(part: object, key: string): string | undefined {
  const value: unknown = Reflect.get(part, key);
  return typeof value === "string" ? value : undefined;
}

function subjectOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  for (const key of SUBJECT_KEYS) {
    const value = stringField(input, key)?.trim().split("\n")[0];
    if (value !== undefined && value.length > 0) {
      return value.length > MAX_SUBJECT_CHARS ? `${value.slice(0, MAX_SUBJECT_CHARS)}…` : value;
    }
  }
  return undefined;
}

function printedPart(part: object): PrintedPart {
  const type = stringField(part, "type") ?? "";
  const state = stringField(part, "state");
  if (type === TEXT_PART.TYPE) {
    return { words: stringField(part, "text") ?? "", settled: state !== TEXT_PART.STREAMING };
  }
  const tool =
    type === DYNAMIC_TOOL_PART
      ? stringField(part, "toolName")
      : type.startsWith(TOOL_PART_PREFIX)
        ? type.slice(TOOL_PART_PREFIX.length)
        : undefined;
  if (tool === undefined) return undefined;
  return {
    tool,
    subject: subjectOf(Reflect.get(part, "input")),
    settled: state !== TOOL_PART_STATE.INPUT_STREAMING,
  };
}

export function transcriptSpeaker(message: AgentTranscriptMessage): string {
  if (message.role === MESSAGE_ROLE.ASSISTANT) return "Agent";
  return message.sentBy?.name ?? "You";
}

export function transcriptPartLines(
  message: AgentTranscriptMessage,
  printed: number,
  ended: boolean,
): { readonly lines: readonly string[]; readonly printed: number } {
  const lines: string[] = [];
  let index = printed;
  for (; index < message.parts.length; index += 1) {
    const stored = message.parts[index];
    const part = typeof stored === "object" && stored !== null ? printedPart(stored) : undefined;
    if (part === undefined) continue;
    if (!part.settled && !ended) break;
    if ("words" in part) {
      if (part.words.trim().length > 0) lines.push(part.words.trimEnd());
    } else {
      lines.push(`  ▸ ${part.tool}${part.subject === undefined ? "" : ` ${part.subject}`}`);
    }
  }
  return { lines, printed: index };
}
