/**
 * image-preparing.ts -- a Start or a message the service refused while the agent's sandbox image is still being prepared, asked again under the same key until it is taken.
 *
 * The first native agent after the image changed waits on the image being
 * prepared, which takes minutes. The service holds the call for about three
 * minutes while it waits (`agent-sandbox-image.ts`), then refuses it by name
 * (`agent-image-preparing`), leaving nothing behind, so the same call under
 * the same key is safe to make again, and is made again at once: the
 * service's own hold is the wait between tries. The panel says the image is
 * being prepared while it asks, at most `MAX_TRIES` times (about twelve
 * minutes), then answers the refusal, which says plainly that it took too
 * long rather than spinning.
 */

import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
} from "@luke/features/coding-agent-view";

export const IMAGE_PREPARING_RETRY = {
  /** How many times the panel asks in all, each held by the service for about three minutes. */
  MAX_TRIES: 4,
} as const;

/** Whether an answer is the refusal of an image still being prepared. */
function preparing(answer: object): boolean {
  const failure: unknown = "failure" in answer ? answer.failure : undefined;
  return (
    failure === (CODING_AGENT_CALL_FAILURE.AGENT_IMAGE_PREPARING satisfies CodingAgentCallFailure)
  );
}

/**
 * The call's answer once it is no longer the image-preparing refusal, or that
 * refusal after the last try; `onPreparing` is told each time the panel asks
 * again.
 */
export async function untilImagePrepared<Answer extends object>(
  ask: () => Promise<Answer>,
  onPreparing: () => void,
): Promise<Answer> {
  let answer = await ask();
  for (let tries = 1; tries < IMAGE_PREPARING_RETRY.MAX_TRIES && preparing(answer); tries += 1) {
    onPreparing();
    answer = await ask();
  }
  return answer;
}
