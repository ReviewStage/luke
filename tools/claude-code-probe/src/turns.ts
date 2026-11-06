import { PROBE_FILES } from "./pins.js";
import { TURN_DONE } from "./verdict.js";

export const STOPPED_COMMAND = "sleep 600";

export function firstTurn(nonce: string): string {
  const branch = `agent-probe/${nonce}`;
  return [
    "This is Vespin's Claude Code probe. Do each step in order, in this repository.",
    `1. Create the file \`agent-probe/${nonce}.txt\` holding the single line \`${nonce}\`.`,
    `2. Run \`bash ${PROBE_FILES.LEAK_CHECK}\` with the Bash tool and keep its output as printed.`,
    `3. Start \`sleep 45 && echo agent-probe-background-${nonce}\` with the Bash tool in the background (run_in_background).`,
    "4. Wait for it with ScheduleWakeup, delaySeconds 60, prompt `Continue Vespin's probe from step 4.`, then read the background command's output.",
    `5. Create the branch \`${branch}\`, commit the file, and run \`git push -u origin ${branch}\`.`,
    `6. Once the push has succeeded, reply with the single line \`${TURN_DONE.FIRST}\`.`,
  ].join("\n");
}

export function stoppedTurn(): string {
  return `Run \`${STOPPED_COMMAND}\` with the Bash tool in the foreground, then reply \`AGENT-PROBE-TURN-2-DONE\`.`;
}

export function resumedTurn(): string {
  return [
    "Without running any command or tool, reply with the path of the file you created earlier in this session,",
    `then the single line \`${TURN_DONE.RESUMED}\`.`,
  ].join(" ");
}
