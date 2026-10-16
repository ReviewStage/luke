import { defineWorkflowTool } from "eve/tools";
import { sleep } from "eve/tools/sleep";

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
 * them (`../agent-runtime/sandbox.ts`).
 */

/** The words the model is shown: what to wait on, and that a message ends the wait. */
const SLEEP_DESCRIPTION =
  "Wait for the given number of seconds without running anything, then carry on. Use it before you check again on what " +
  "takes time to change: a command bash left running in the background, a pull request's checks, or a deploy. Wait about " +
  "as long as the thing usually takes rather than checking every few seconds. Commands running in the background keep " +
  "running while you wait, and a message from the developer ends the wait early.";

/** eve's `sleep`, under the coding agent's words. */
export const SLEEP_TOOL = defineWorkflowTool({ ...sleep(), description: SLEEP_DESCRIPTION });
