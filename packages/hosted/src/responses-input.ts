/**
 * The Responses input item vocabulary the brain's items are named in: the
 * item kinds, the roles, and the content part types. The allowlist that once
 * rebuilt a desktop's input array field by field before the service replayed
 * it went with the relay it admitted for (LUKE-206); what is left is the
 * names.
 */

export const RESPONSES_INPUT_ITEM_TYPE = {
  MESSAGE: "message",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  REASONING: "reasoning",
} as const;

export const RESPONSES_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export const RESPONSES_CONTENT_PART_TYPE = {
  INPUT_TEXT: "input_text",
  OUTPUT_TEXT: "output_text",
  SUMMARY_TEXT: "summary_text",
} as const;
