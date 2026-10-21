/**
 * image-preparing.ts -- a Start or a message the service refused while the agent's sandbox image is still being prepared, asked again under the same key until it is taken.
 *
 * The first native agent after the image changed waits on the image being
 * prepared, which takes minutes, longer than a request may wait. The service
 * refuses the call by name at once (`agent-image-preparing`), leaving
 * nothing behind, so the same call under the same key is safe to make
 * again. The panel says the image is being prepared and asks again every
 * `RETRY_MS`, at most `MAX_TRIES` times (ten minutes), then answers the
 * refusal, which says plainly that it took too long rather than spinning. A
 * pause that is cut short, by a newer one taking its place, ends the asking.
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
  const failure: unknown = "failure" in answer ? answer.failure : undefined;
  return (
    failure === (CODING_AGENT_CALL_FAILURE.AGENT_IMAGE_PREPARING satisfies CodingAgentCallFailure)
  );
}

/**
 * The call's answer once it is no longer the image-preparing refusal, or that
 * refusal after the last try; `onPreparing` is told each time the panel
 * pauses to ask again, and `pause` waits the milliseconds it is handed.
 */
export async function untilImagePrepared<Answer extends object>(
  ask: () => Promise<Answer>,
  onPreparing: () => void,
  pause: (ms: number) => Promise<unknown>,
): Promise<Answer> {
  let answer = await ask();
  for (let tries = 1; tries < IMAGE_PREPARING_RETRY.MAX_TRIES && preparing(answer); tries += 1) {
    onPreparing();
    const paused = await pause(IMAGE_PREPARING_RETRY.RETRY_MS).then(
      () => true,
      () => false,
    );
    if (!paused) return answer;
    answer = await ask();
  }
  return answer;
}
