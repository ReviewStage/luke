/**
 * The Responses input item vocabulary the brain's items are named in: the
 * item kinds, the roles, the content part types, the statuses, and the
 * phases the API writes on a message. The allowlist that once rebuilt a
 * desktop's input array field by field before the service replayed it went
 * with the relay it admitted for (LUKE-206); what is left is the names.
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

/** The execution context the API writes on a function call: the one this build replays is a call the model made itself. */
export const RESPONSES_CALLER_TYPE = {
  DIRECT: "direct",
} as const;
