/**
 * image-preparing.ts -- a Start or a message the service refused while the agent's sandbox image is still being prepared, asked again under the same key until it is taken.
 *
 * The first native agent after the image changed waits on the image being
 * prepared, which takes minutes. The service waits a bounded while, then
 * refuses the call by name (`agent-image-preparing`), leaving nothing
 * behind, so the same call under the same key is safe to make again. The
 * panel says the image is being prepared and asks again every
 * `RETRY_MS`, at most `MAX_TRIES` times (ten minutes), then answers the
 * refusal, which says plainly that it took too long rather than spinning.
 */

import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
} from "@luke/features/coding-agent-view";

export const IMAGE_PREPARING_RETRY = {
  /** How long the panel waits before asking again. */
  RETRY_MS: 15_000,
  /** How many times it asks in all: ten minutes of the waits above. */
  MAX_TRIES: 40,
} as const;

/** Whether an answer is the refusal of an image still being prepared. */
function preparing(answer: object): boolean {
  const failure: CodingAgentCallFailure | undefined =
    "failure" in answer ? (answer.failure as CodingAgentCallFailure) : undefined;
  return failure === CODING_AGENT_CALL_FAILURE.AGENT_IMAGE_PREPARING;
}

/**
 * The call's answer once it is no longer the image-preparing refusal, or that
 * refusal after the last try; `onPreparing` is told each time the panel waits
 * to ask again, and `wait` waits, a timer in the panel and none in a test.
 */
export async function untilImagePrepared<Answer extends object>(
  ask: () => Promise<Answer>,
  onPreparing: () => void,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
): Promise<Answer> {
  let answer = await ask();
  for (let tries = 1; tries < IMAGE_PREPARING_RETRY.MAX_TRIES && preparing(answer); tries += 1) {
    onPreparing();
    await wait(IMAGE_PREPARING_RETRY.RETRY_MS);
    answer = await ask();
  }
  return answer;
}
