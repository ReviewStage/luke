import { describeWire, emitJsonSchema } from "@luke/wire/effect";
import { Duration, Schema } from "effect";
import { defineWorkflowTool } from "eve/tools";
import { sleep } from "eve/tools/sleep";
import { CODER } from "./bounds.js";

/**
 * sleep.ts -- the coding agent's pause: eve's own durable `sleep`, told what a coding agent waits on.
 *
 * A command still running after eve's half a minute keeps running in the
 * background (`shell.ts`), and the agent checks on it with a later command:
 * a pull request's checks it watches, a deploy, a slow suite. Without a way
 * to wait, each check is a model step spent finding nothing changed. eve's
 * `sleep` parks the turn durably, holding no function open, and a message
 * from the developer ends it early, as it steers any turn; the sandbox and
 * what runs in it stand while the turn does, since only a turn's end stops
 * them (`../agent-runtime/sandbox.ts`). One pause is held to
 * `CODER.SLEEP_MAX`, inside what is left of the GitHub credential its
 * background commands reach GitHub with, since only a step renews it; a
 * longer wait is several pauses, each one's end a step.
 */

/** The most seconds one pause takes. */
const SLEEP_MAX_SECONDS = Duration.toSeconds(CODER.SLEEP_MAX);

/** The words the model is shown: what to wait on, and that a message ends the wait. */
const SLEEP_DESCRIPTION =
  "Wait for the given number of seconds without running anything, then carry on. Use it before you check again on what " +
  "takes time to change: a command bash left running in the background, a pull request's checks, or a deploy. Wait about " +
  "as long as the thing usually takes rather than checking every few seconds. Commands running in the background keep " +
  "running while you wait, and a message from the developer ends the wait early. One wait is at most " +
  `${SLEEP_MAX_SECONDS / 60} minutes; to wait longer, wait again.`;

/** eve's `sleep` input, held to the bound: how many seconds to wait. */
const SLEEP_INPUT = Schema.Struct({
  seconds: describeWire(
    Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(SLEEP_MAX_SECONDS)),
    "How long to wait, in seconds.",
  ),
});

/** eve's `sleep`, under the coding agent's words. */
export const SLEEP_TOOL = defineWorkflowTool({
  ...sleep(),
  description: SLEEP_DESCRIPTION,
  inputSchema: emitJsonSchema(SLEEP_INPUT),
});
