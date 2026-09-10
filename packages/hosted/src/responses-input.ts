import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

/**
 * What one hosted brain turn may carry in its input array, and nothing else.
 * The array arrives from the desktop as the Responses items it holds — items
 * the API shaped and items the desktop built — and the service must replay
 * them to the API stateless, so each admitted item is rebuilt field by field
 * from an allowlist rather than forwarded as it came: a field the replay
 * needs (an item's id, a call's id and arguments, a reasoning or compaction
 * item's encrypted content, an assistant message's phase) travels exactly as
 * written, and any other field, role, or item kind refuses the whole request.
 * A request cannot therefore smuggle a system or developer message, a file or
 * image reference, a built-in tool's item, or a configuration update past
 * what the build fixes. The same reader runs on the desktop before the
 * request leaves, so an input the service would refuse never spends a call.
 */

export const RESPONSES_INPUT_ITEM_TYPE = {
  MESSAGE: "message",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  REASONING: "reasoning",
  COMPACTION: "compaction",
} as const;

export const RESPONSES_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export const RESPONSES_CONTENT_PART_TYPE = {
  INPUT_TEXT: "input_text",
  OUTPUT_TEXT: "output_text",
  REFUSAL: "refusal",
  SUMMARY_TEXT: "summary_text",
  REASONING_TEXT: "reasoning_text",
} as const;

export const RESPONSES_ITEM_STATUS = {
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  INCOMPLETE: "incomplete",
} as const;

export const RESPONSES_MESSAGE_PHASE = {
  COMMENTARY: "commentary",
  FINAL_ANSWER: "final_answer",
} as const;

/** How many input items one hosted brain turn may carry; a longer memory has compacted by then. */
export const maximumHostedBrainInputItems = 2_000;

/**
 * How many bytes one complete serialized brain request may weigh, UTF-8. The
 * desktop measures the body it is about to send against this; the service
 * measures the body as it streams in, so a request that names no length, or
 * lies about it, is cut at the same line.
 */
export const maximumHostedBrainRequestBytes = 2 * 1024 * 1024;

type StatusValue = (typeof RESPONSES_ITEM_STATUS)[keyof typeof RESPONSES_ITEM_STATUS];
type PhaseValue = (typeof RESPONSES_MESSAGE_PHASE)[keyof typeof RESPONSES_MESSAGE_PHASE];

const STATUS_VALUES: readonly string[] = Object.values(RESPONSES_ITEM_STATUS);
const PHASE_VALUES: readonly string[] = Object.values(RESPONSES_MESSAGE_PHASE);

/**
 * The fields an item of each kind may carry. A key outside its kind's set
 * refuses the item: the shape the API documents is the shape replayed, and an
 * unknown field is an override this build cannot vouch for.
 */
const ALLOWED_KEYS = {
  USER_MESSAGE: new Set(["type", "role", "content", "id", "status"]),
  ASSISTANT_MESSAGE: new Set(["type", "role", "content", "id", "status", "phase"]),
  FUNCTION_CALL: new Set([
    "type",
    "call_id",
    "name",
    "arguments",
    "id",
    "status",
    "caller",
    "async",
    "namespace",
  ]),
  FUNCTION_CALL_OUTPUT: new Set(["type", "call_id", "output", "id", "status"]),
  REASONING: new Set(["type", "id", "summary", "encrypted_content", "content", "status"]),
  COMPACTION: new Set(["type", "id", "encrypted_content", "created_by"]),
  OUTPUT_TEXT: new Set(["type", "text", "annotations", "logprobs"]),
} as const satisfies Record<string, ReadonlySet<string>>;

function keysWithin(item: WireRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(item).every((key) => allowed.has(key));
}

/** A string that must be present and non-empty, or the admission fails. */
function requiredText(value: UnparsedWireValue): string | undefined {
  return isWireString(value) && value.length > 0 ? value : undefined;
}

type Optional<Value> = { ok: true; value?: Value } | { ok: false };

const ABSENT: Optional<never> = { ok: true };
const REFUSED: Optional<never> = { ok: false };

/** A string that may be absent or null, but if present must be a string. */
function optionalText(value: UnparsedWireValue): Optional<string> {
  if (value === undefined || value === null) return ABSENT;
  return isWireString(value) ? { ok: true, value } : REFUSED;
}

function optionalMember<Member extends string>(
  value: UnparsedWireValue,
  members: readonly string[],
): Optional<Member> {
  if (value === undefined || value === null) return ABSENT;
  if (!isWireString(value) || !members.includes(value)) return REFUSED;
  // SAFETY: membership in the as-const set was just checked.
  return { ok: true, value: value as Member };
}

/**
 * A list the API writes beside output text (annotations, log probabilities),
 * read only as the empty list a turn with no built-in tools produces: absent
 * or null is dropped, empty is kept, and anything richer is refused.
 */
function emptyList(value: UnparsedWireValue): Optional<readonly never[]> {
  if (value === undefined || value === null) return ABSENT;
  return Array.isArray(value) && value.length === 0 ? { ok: true, value: [] } : REFUSED;
}

/** A list of `{ type, text }` parts of one fixed type, rebuilt part by part. */
function textParts(
  value: UnparsedWireValue,
  type: string,
  key: "text" | "refusal" = "text",
): WireRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: WireRecord[] = [];
  for (const part of value) {
    if (!isRecord(part) || part.type !== type || !isWireString(part[key])) return undefined;
    if (!Object.keys(part).every((name) => name === "type" || name === key)) return undefined;
    parts.push({ type, [key]: part[key] });
  }
  return parts;
}

function admitUserMessage(item: WireRecord): WireRecord | undefined {
  if (!keysWithin(item, ALLOWED_KEYS.USER_MESSAGE)) return undefined;
  const parts = isWireString(item.content)
    ? [{ type: RESPONSES_CONTENT_PART_TYPE.INPUT_TEXT, text: item.content }]
    : textParts(item.content, RESPONSES_CONTENT_PART_TYPE.INPUT_TEXT);
  if (!parts) return undefined;
  const id = optionalText(item.id);
  const status = optionalMember<StatusValue>(item.status, STATUS_VALUES);
  if (!id.ok || !status.ok) return undefined;
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: RESPONSES_MESSAGE_ROLE.USER,
    content: parts,
    ...(id.value !== undefined ? { id: id.value } : undefined),
    ...(status.value !== undefined ? { status: status.value } : undefined),
  };
}

/**
 * An assistant message is only ever one the API wrote and the desktop is
 * replaying, so its content is output text and refusals. Annotations and
 * log probabilities are read only as the empty lists a turn with no built-in
 * tools produces; anything richer is a shape this build has not vouched for.
 */
function admitAssistantContent(value: UnparsedWireValue): WireRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: WireRecord[] = [];
  for (const part of value) {
    if (!isRecord(part)) return undefined;
    if (part.type === RESPONSES_CONTENT_PART_TYPE.REFUSAL) {
      if (!isWireString(part.refusal)) return undefined;
      if (!Object.keys(part).every((name) => name === "type" || name === "refusal"))
        return undefined;
      parts.push({ type: RESPONSES_CONTENT_PART_TYPE.REFUSAL, refusal: part.refusal });
      continue;
    }
    if (part.type !== RESPONSES_CONTENT_PART_TYPE.OUTPUT_TEXT || !isWireString(part.text))
      return undefined;
    if (!keysWithin(part, ALLOWED_KEYS.OUTPUT_TEXT)) return undefined;
    const annotations = emptyList(part.annotations);
    const logprobs = emptyList(part.logprobs);
    if (!annotations.ok || !logprobs.ok) return undefined;
    parts.push({
      type: RESPONSES_CONTENT_PART_TYPE.OUTPUT_TEXT,
      text: part.text,
      ...(annotations.value !== undefined ? { annotations: annotations.value } : undefined),
      ...(logprobs.value !== undefined ? { logprobs: logprobs.value } : undefined),
    });
  }
  return parts;
}

function admitAssistantMessage(item: WireRecord): WireRecord | undefined {
  if (!keysWithin(item, ALLOWED_KEYS.ASSISTANT_MESSAGE)) return undefined;
  const content = admitAssistantContent(item.content);
  if (!content) return undefined;
  const id = optionalText(item.id);
  const status = optionalMember<StatusValue>(item.status, STATUS_VALUES);
  const phase = optionalMember<PhaseValue>(item.phase, PHASE_VALUES);
  if (!id.ok || !status.ok || !phase.ok) return undefined;
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: RESPONSES_MESSAGE_ROLE.ASSISTANT,
    content,
    ...(id.value !== undefined ? { id: id.value } : undefined),
    ...(status.value !== undefined ? { status: status.value } : undefined),
    ...(phase.value !== undefined ? { phase: phase.value } : undefined),
  };
}

function admitMessage(item: WireRecord): WireRecord | undefined {
  if (item.role === RESPONSES_MESSAGE_ROLE.USER) return admitUserMessage(item);
  if (item.role === RESPONSES_MESSAGE_ROLE.ASSISTANT) return admitAssistantMessage(item);
  return undefined;
}

export const RESPONSES_CALLER_TYPE = {
  DIRECT: "direct",
} as const;

/**
 * The execution context the API writes on a function call. The one this build
 * replays is the direct one, a call the model made itself: absent or null is
 * dropped, `{ type: "direct" }` is rebuilt as exactly that, and a program
 * caller (a call issued by a tool-running program) is refused, because no
 * program runs here.
 */
function directCaller(value: UnparsedWireValue): Optional<WireRecord> {
  if (value === undefined || value === null) return ABSENT;
  if (!isRecord(value) || value.type !== RESPONSES_CALLER_TYPE.DIRECT) return REFUSED;
  if (!Object.keys(value).every((key) => key === "type")) return REFUSED;
  return { ok: true, value: { type: RESPONSES_CALLER_TYPE.DIRECT } };
}

/** A flag the API writes as false on an ordinary call; true names an execution mode this build has not offered. */
function synchronousFlag(value: UnparsedWireValue): Optional<false> {
  if (value === undefined || value === null) return ABSENT;
  return value === false ? { ok: true, value: false } : REFUSED;
}

/**
 * A namespace names a tool surface (a namespaced tool family) this build
 * never configures; the only replayable value is none. Verified against the
 * fixed tool configuration: every brain tool is a plain function tool with no
 * namespace, so a namespaced call could not have been one the brain offered.
 */
function noNamespace(value: UnparsedWireValue): boolean {
  return value === undefined || value === null;
}

function admitFunctionCall(item: WireRecord): WireRecord | undefined {
  if (!keysWithin(item, ALLOWED_KEYS.FUNCTION_CALL)) return undefined;
  const callId = requiredText(item.call_id);
  const name = requiredText(item.name);
  if (!callId || !name || !isWireString(item.arguments)) return undefined;
  if (!noNamespace(item.namespace)) return undefined;
  const id = optionalText(item.id);
  const status = optionalMember<StatusValue>(item.status, STATUS_VALUES);
  const caller = directCaller(item.caller);
  const asynchronous = synchronousFlag(item.async);
  if (!id.ok || !status.ok || !caller.ok || !asynchronous.ok) return undefined;
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
    call_id: callId,
    name,
    arguments: item.arguments,
    ...(id.value !== undefined ? { id: id.value } : undefined),
    ...(status.value !== undefined ? { status: status.value } : undefined),
    ...(caller.value !== undefined ? { caller: caller.value } : undefined),
    ...(asynchronous.value !== undefined ? { async: asynchronous.value } : undefined),
  };
}

/** The desktop answers every call with a string, so an output list (which may carry files) is refused. */
function admitFunctionCallOutput(item: WireRecord): WireRecord | undefined {
  if (!keysWithin(item, ALLOWED_KEYS.FUNCTION_CALL_OUTPUT)) return undefined;
  const callId = requiredText(item.call_id);
  if (!callId || !isWireString(item.output)) return undefined;
  const id = optionalText(item.id);
  const status = optionalMember<StatusValue>(item.status, STATUS_VALUES);
  if (!id.ok || !status.ok) return undefined;
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
    call_id: callId,
    output: item.output,
    ...(id.value !== undefined ? { id: id.value } : undefined),
    ...(status.value !== undefined ? { status: status.value } : undefined),
  };
}

function admitReasoning(item: WireRecord): WireRecord | undefined {
  if (!keysWithin(item, ALLOWED_KEYS.REASONING)) return undefined;
  const id = requiredText(item.id);
  if (!id) return undefined;
  const summary = textParts(item.summary ?? [], RESPONSES_CONTENT_PART_TYPE.SUMMARY_TEXT);
  if (!summary) return undefined;
  const encrypted = optionalText(item.encrypted_content);
  const status = optionalMember<StatusValue>(item.status, STATUS_VALUES);
  if (!encrypted.ok || !status.ok) return undefined;
  const content =
    item.content === undefined || item.content === null
      ? undefined
      : textParts(item.content, RESPONSES_CONTENT_PART_TYPE.REASONING_TEXT);
  if (item.content !== undefined && item.content !== null && !content) return undefined;
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.REASONING,
    id,
    summary,
    ...(encrypted.value !== undefined ? { encrypted_content: encrypted.value } : undefined),
    ...(content !== undefined ? { content } : undefined),
    ...(status.value !== undefined ? { status: status.value } : undefined),
  };
}

/**
 * A compaction item is one an earlier build stored, from the explicit
 * compaction this build no longer asks OpenAI for; it is admitted so a memory
 * standing since then replays whole rather than being refused at the door.
 * It comes back from the API with `created_by`, the actor that produced it,
 * and goes back in without: the API's own input form omits the field. It is
 * the one field admission drops rather than refuses or keeps, because it is
 * output metadata carrying no replay content, and a request built from
 * stored output must not fail on a field the input never took.
 */
function admitCompaction(item: WireRecord): WireRecord | undefined {
  if (!keysWithin(item, ALLOWED_KEYS.COMPACTION)) return undefined;
  const encrypted = requiredText(item.encrypted_content);
  if (!encrypted) return undefined;
  const id = optionalText(item.id);
  const createdBy = optionalText(item.created_by);
  if (!id.ok || !createdBy.ok) return undefined;
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.COMPACTION,
    encrypted_content: encrypted,
    ...(id.value !== undefined ? { id: id.value } : undefined),
  };
}

/**
 * Rebuilds one input item from the fields its documented kind may carry, or
 * nothing when the item is of a kind, role, or shape this build does not
 * replay. Nothing is stripped silently: an item that cannot be admitted whole
 * is refused whole.
 */
export function admitBrainInputItem(value: UnparsedWireValue): WireRecord | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case RESPONSES_INPUT_ITEM_TYPE.MESSAGE:
      return admitMessage(value);
    case RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL:
      return admitFunctionCall(value);
    case RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT:
      return admitFunctionCallOutput(value);
    case RESPONSES_INPUT_ITEM_TYPE.REASONING:
      return admitReasoning(value);
    case RESPONSES_INPUT_ITEM_TYPE.COMPACTION:
      return admitCompaction(value);
    default:
      return undefined;
  }
}

/** Rebuilds a whole input array within the item bound, or nothing when any item is refused. */
export function admitBrainInput(value: UnparsedWireValue): WireRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0 || value.length > maximumHostedBrainInputItems) return undefined;
  const input: WireRecord[] = [];
  for (const item of value) {
    const admitted = admitBrainInputItem(item);
    if (!admitted) return undefined;
    input.push(admitted);
  }
  return input;
}

/** The UTF-8 weight of a serialized request, the measure both ends hold it to. */
export function serializedRequestBytes(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

/**
 * Whether every item a Responses answer carries is one this admission would
 * replay. The desktop appends an answer's items to durable memory verbatim, so
 * an answer with an item the hosted path cannot send back must be refused
 * before any call in it is acted on or any item of it is kept: read here by
 * the service before it answers and by the desktop before it appends. An
 * answer with no output array is not this reader's question and is not
 * refused by it.
 */
export function brainOutputReplayable(payload: UnparsedWireValue): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return true;
  return payload.output.every((item) => admitBrainInputItem(item) !== undefined);
}
