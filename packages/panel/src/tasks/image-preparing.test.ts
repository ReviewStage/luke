import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { it } from "vitest";
import { IMAGE_PREPARING_RETRY, untilImagePrepared } from "./image-preparing.js";

/**
 * A Start or a message refused while the agent's image is being prepared is
 * asked again under its key, said as preparing each time, until the service
 * takes it; past the last try the refusal stands, so the panel says it took
 * too long rather than spinning. The service's own hold is the wait between
 * tries, so the panel keeps no timer.
 */

const PREPARING = { failure: CODING_AGENT_CALL_FAILURE.AGENT_IMAGE_PREPARING } as const;
const STARTED = { agent: { id: "agent-1" } } as const;

it("asks again while the image is being prepared, saying so, and answers the agent once the service takes it", async () => {
  const answers = [PREPARING, PREPARING, STARTED];
  let said = 0;
  const answer = await untilImagePrepared(
    async () => answers.shift() ?? STARTED,
    () => {
      said += 1;
    },
  );
  assert.deepEqual(answer, STARTED);
  assert.equal(said, 2);
});

it("stops asking after the last try and answers the refusal, and never asks again for any other answer", async () => {
  let asked = 0;
  const gaveUp = await untilImagePrepared(
    async () => {
      asked += 1;
      return PREPARING;
    },
    () => undefined,
  );
  assert.deepEqual(gaveUp, PREPARING);
  assert.equal(asked, IMAGE_PREPARING_RETRY.MAX_TRIES);

  let other = 0;
  const refused = await untilImagePrepared(
    async () => {
      other += 1;
      return { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED };
    },
    () => undefined,
  );
  assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED });
  assert.equal(other, 1);
});
