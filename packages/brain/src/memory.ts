import { isWireString } from "@sidecar/wire";
import { RESPONSES_ITEM_TYPE, type ResponsesInputItem } from "./responses-api.js";

/**
 * Answers every `function_call` in the array that has no `function_call_output`
 * anywhere in it with the output given, so a memory restored from a checkpoint
 * taken between an act's start and its result never replays the call and
 * never hands the model a dangling one.
 */
export function pairedDanglingCalls(
  items: readonly ResponsesInputItem[],
  outputFor: (callId: string) => string,
): readonly ResponsesInputItem[] {
  const answered = new Set<string>();
  for (const item of items) {
    if (item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT && isWireString(item.call_id)) {
      answered.add(item.call_id);
    }
  }
  const dangling: ResponsesInputItem[] = [];
  for (const item of items) {
    if (item.type !== RESPONSES_ITEM_TYPE.FUNCTION_CALL || !isWireString(item.call_id)) continue;
    if (answered.has(item.call_id)) continue;
    answered.add(item.call_id);
    dangling.push({
      type: RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
      call_id: item.call_id,
      output: outputFor(item.call_id),
    });
  }
  return dangling.length === 0 ? items : [...items, ...dangling];
}
