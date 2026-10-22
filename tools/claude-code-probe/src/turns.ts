/**
 * turns.ts -- the three turns the probe asks of Claude Code, each naming the words it ends on.
 *
 * The first turn is the plan's whole workflow in one: edit, a background
 * command, a wait with `ScheduleWakeup`, a commit and a push. The second is
 * a long foreground command the probe stops. The third runs in a relaunched
 * CLI resuming the session, and asks for what only the first turn knew (the
 * file it made), so its answer shows the session's history came back.
 */

import { PROBE_FILES } from "./pins.js";
import { TURN_DONE } from "./verdict.js";

/** The marker the second turn's command is recognised by in the stream. */
export const STOPPED_COMMAND = "sleep 600";

export function firstTurn(nonce: string): string {
  const branch = `luke-probe/${nonce}`;
  return [
    "This is Luke's Claude Code probe. Do each step in order, in this repository.",
    `1. Create the file \`luke-probe/${nonce}.txt\` holding the single line \`${nonce}\`.`,
    `2. Run \`bash ${PROBE_FILES.LEAK_CHECK}\` with the Bash tool and keep its output as printed.`,
    `3. Start \`sleep 45 && echo luke-probe-background-${nonce}\` with the Bash tool in the background (run_in_background).`,
    "4. Wait for it with ScheduleWakeup, delaySeconds 60, prompt `Continue Luke's probe from step 4.`, then read the background command's output.",
    `5. Create the branch \`${branch}\`, commit the file, and run \`git push -u origin ${branch}\`.`,
    `6. Once the push has succeeded, reply with the single line \`${TURN_DONE.FIRST}\`.`,
  ].join("\n");
}

export function stoppedTurn(): string {
  return `Run \`${STOPPED_COMMAND}\` with the Bash tool in the foreground, then reply \`LUKE-PROBE-TURN-2-DONE\`.`;
}

export function resumedTurn(): string {
  return [
    "Without running any command or tool, reply with the path of the file you created earlier in this session,",
    `then the single line \`${TURN_DONE.RESUMED}\`.`,
  ].join(" ");
}
