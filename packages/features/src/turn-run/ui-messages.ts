import type { ReasoningSummary, ToolInvocation } from "@repo/runtime/vocabulary";
import {
  type AssistantMessageMetadata,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  type UnparsedWireValue,
  type UserMessageMetadata,
} from "@repo/wire";
import { TOOL_PART_STATE } from "@repo/wire/ui-messages";
import type {
  ReasoningUIPart,
  StepStartUIPart,
  TextUIPart,
  ToolUIPart,
  UIMessage,
  UITools,
} from "ai";
import { TOOL_CALL_SETTLEMENT, type ToolCallSettlement } from "./run-events.js";
import { TURN_TRIGGER, type TurnTrigger } from "./turn.js";

export const UI_PART_TYPE = {
  TEXT: "text",
  REASONING: "reasoning",
  STEP_START: "step-start",
} as const;

export const UI_PART_STATE = {
  DONE: "done",
} as const;

const REASONING_PROVIDER_KEY = "openai";

const TOOL_PART_TYPE_PREFIX = "tool-";

type ToolPart = ToolUIPart<UITools>;
type AssistantPart = TextUIPart | ReasoningUIPart | ToolPart | StepStartUIPart;

export const STEP_START_PART: StepStartUIPart = { type: UI_PART_TYPE.STEP_START };

export function toolPartType(name: string): ToolPart["type"] {
  return `${TOOL_PART_TYPE_PREFIX}${name}`;
}

export function userMetadataOf(trigger: TurnTrigger): UserMessageMetadata {
  switch (trigger) {
    case TURN_TRIGGER.ASK:
      return { channel: MESSAGE_CHANNEL.TYPED };
    case TURN_TRIGGER.CHILD_TASK:
      return { source: OBSERVATION_SOURCE.CHILD };
  }
}

export function userMessage(id: string, text: string, metadata: UserMessageMetadata): UIMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    metadata,
    parts: [{ type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE }],
  };
}

const ASSISTANT_METADATA: AssistantMessageMetadata = { author: MESSAGE_AUTHOR.MODEL };

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

export class AssistantMessageBuilder {
  readonly #parts: AssistantPart[] = [];
  readonly #toolParts = new Map<string, number>();

  stepStart(): void {
    this.#parts.push(STEP_START_PART);
  }

  reasoning(reasoning: ReasoningSummary): void {
    this.#parts.push(reasoningPart(reasoning));
  }

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
