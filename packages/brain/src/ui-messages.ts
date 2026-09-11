import type { ReasoningSummary, ToolInvocation } from "@sidecar/runtime/vocabulary";
import { TOOL_PART_STATE } from "@sidecar/session";
import {
  type AssistantMessageMetadata,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  type UnparsedWireValue,
  type UserMessageMetadata,
} from "@sidecar/wire";
import type {
  ReasoningUIPart,
  StepStartUIPart,
  TextUIPart,
  ToolUIPart,
  UIMessage,
  UITools,
} from "ai";
import { BRAIN_REQUEST_ORIGIN, type BrainRequestOrigin } from "./requests.js";
import { TOOL_CALL_SETTLEMENT, type ToolCallSettlement } from "./run-events.js";
import { BRAIN_TURN_TRIGGER, type BrainTurnTrigger } from "./turn.js";

/**
 * A turn's messages in the AI SDK's `UIMessage` shape, under the storage
 * vocabulary `@sidecar/wire` and `@sidecar/session` declare for a stored row:
 * the words the turn was handed as user messages, each carrying the metadata
 * its role's schema names where this build has a shape for it, and the
 * model's answer as one assistant message whose parts are its reasoning
 * summaries, its text, and its tool calls in their settled states, in the
 * order the run produced them, each inference's parts behind a `step-start`
 * part, so the row carries its step boundaries rather than leaving them to
 * be inferred from arrival order: the SDK converts an assistant row for the
 * model one step at a time, each step's reasoning and calls as one assistant
 * message followed by the tool message that answers those calls, and a
 * reasoning item that reached the record after its step's results still
 * sits inside its own step. Nothing here reads inside a provider's item:
 * the reasoning part keeps the summary and the replay data the adapter
 * lifted, under the key the AI SDK's own OpenAI provider reads them from.
 */

export const UI_PART_TYPE = {
  TEXT: "text",
  REASONING: "reasoning",
  STEP_START: "step-start",
} as const;

export const UI_PART_STATE = {
  DONE: "done",
} as const;

/** The provider key the AI SDK's OpenAI provider reads a reasoning part's replay data from. */
export const REASONING_PROVIDER_KEY = "openai";

/** How the SDK spells a tool part's type: the tool's name behind this prefix, which its own readers derive the name from. */
const TOOL_PART_TYPE_PREFIX = "tool-";

type ToolPart = ToolUIPart<UITools>;
type AssistantPart = TextUIPart | ReasoningUIPart | ToolPart | StepStartUIPart;

/** The boundary before one inference's parts, as the SDK spells it. */
export const STEP_START_PART: StepStartUIPart = { type: UI_PART_TYPE.STEP_START };

/** The SDK's own type discriminator for a tool part, spelled as it spells it. */
export function toolPartType(name: string): ToolPart["type"] {
  return `${TOOL_PART_TYPE_PREFIX}${name}`;
}

/**
 * What a user row of a turn's own words says about itself: a developer's ask
 * by the channel it arrived on, and everything the brain wrote down for
 * itself by what opened the turn. The notes the host hands a turn beside its
 * words name their own sources, below. On the desktop every ask is spoken;
 * the typed channel is the hosted brain host's, whose typed turns carry no
 * request origin.
 */
export function userMetadataOf(
  trigger: BrainTurnTrigger,
  askOrigin: BrainRequestOrigin | undefined,
): UserMessageMetadata {
  switch (trigger) {
    case BRAIN_TURN_TRIGGER.ASK:
      return {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel:
          askOrigin === BRAIN_REQUEST_ORIGIN.SPOKEN ? MESSAGE_CHANNEL.VOICE : MESSAGE_CHANNEL.TYPED,
      };
    case BRAIN_TURN_TRIGGER.WAKE:
      return { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.HOOK };
    case BRAIN_TURN_TRIGGER.ROSTER:
      return { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.ROSTER_LOOK };
    case BRAIN_TURN_TRIGGER.HOLD_RELEASED:
      return { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.HOLD_RELEASE };
    case BRAIN_TURN_TRIGGER.CHILD_TASK:
      return { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.CHILD };
    case BRAIN_TURN_TRIGGER.CHILD_COMPLETION:
      return { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.CHILD_COMPLETION };
  }
}

/** What the notes the host hands a turn beside its words say about themselves. */
export const HOSTED_WORDS_METADATA = {
  RECALLED_NOTES: { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.RECALLED_NOTES },
  ACTIVITY_NOTICES: { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.ACTIVITY_NOTICES },
} as const satisfies Record<string, UserMessageMetadata>;

/** The message a text the turn was handed amounts to: the developer's ask, an observation, a steered ask, a note. */
export function userMessage(id: string, text: string, metadata: UserMessageMetadata): UIMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    metadata,
    parts: [{ type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE }],
  };
}

const ASSISTANT_METADATA: AssistantMessageMetadata = { author: MESSAGE_AUTHOR.BRAIN };

function reasoningPart(reasoning: ReasoningSummary): ReasoningUIPart {
  return {
    type: UI_PART_TYPE.REASONING,
    id: reasoning.itemId,
    text: reasoning.summary,
    state: UI_PART_STATE.DONE,
    providerMetadata: {
      [REASONING_PROVIDER_KEY]: {
        itemId: reasoning.itemId,
        ...(reasoning.encryptedContent !== undefined
          ? { reasoningEncryptedContent: reasoning.encryptedContent }
          : undefined),
      },
    },
  };
}

/** A tool part in the state its call settled in: the answer's output, or the error's own text. */
export function settledToolPart(part: ToolPart, settlement: ToolCallSettlement): ToolPart {
  const call = { type: part.type, toolCallId: part.toolCallId };
  return settlement.state === TOOL_CALL_SETTLEMENT.OUTPUT_ERROR
    ? {
        ...call,
        state: TOOL_PART_STATE.OUTPUT_ERROR,
        input: part.input,
        errorText: settlement.errorText,
      }
    : {
        ...call,
        state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
        input: part.input,
        output: settlement.output,
      };
}

/**
 * The assistant message of one turn, gathered part by part as the run
 * reports them. Each inference opens a step, so its reasoning, text, and
 * calls stand behind one boundary; a tool call enters with its input before
 * it runs and is replaced in place by its settled state; `finish` answers
 * the message as it stands, and a turn that fails before its answer never
 * finishes one.
 */
export class AssistantMessageBuilder {
  readonly #parts: AssistantPart[] = [];
  readonly #toolParts = new Map<string, number>();

  /** One inference answered: everything it carried follows this boundary. */
  stepStart(): void {
    this.#parts.push(STEP_START_PART);
  }

  reasoning(reasoning: ReasoningSummary): void {
    this.#parts.push(reasoningPart(reasoning));
  }

  /** The words of one answer; an answer that said nothing adds no part. */
  text(text: string): void {
    if (text.length === 0) return;
    this.#parts.push({ type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE });
  }

  toolCall(invocation: ToolInvocation, input: UnparsedWireValue): void {
    this.#toolParts.set(invocation.callId, this.#parts.length);
    this.#parts.push({
      type: toolPartType(invocation.name),
      toolCallId: invocation.callId,
      state: TOOL_PART_STATE.INPUT_AVAILABLE,
      input,
    });
  }

  toolResult(callId: string, settlement: ToolCallSettlement): void {
    const index = this.#toolParts.get(callId);
    const part = index === undefined ? undefined : this.#parts[index];
    if (index === undefined || !part || !("toolCallId" in part)) return;
    this.#parts[index] = settledToolPart(part, settlement);
  }

  finish(id: string): UIMessage {
    return {
      id,
      role: MESSAGE_ROLE.ASSISTANT,
      metadata: ASSISTANT_METADATA,
      parts: [...this.#parts],
    };
  }
}
