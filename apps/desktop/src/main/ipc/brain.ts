import type { BrainAgent } from "@sidecar/brain";
import { maximumTypedAskLength } from "@sidecar/realtime";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { BrainAskResult } from "#shared/contracts";
import { registerBridgeEntry } from "../register-bridge";

export interface BrainIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The brain as it stands now, or nothing on a run with no key to run it on. */
  brain: () => BrainAgent | undefined;
}

/**
 * What the voice says when there is no brain to ask, or the brain did not
 * answer in time. Fixed by the build and never composed with the ask, so a
 * failure can only ever be reported in these words.
 */
export const BRAIN_ASK_REFUSAL = {
  ABSENT:
    "I can't reach my judgment right now: this build thinks only on an OpenAI key, and none is connected.",
  EMPTY: "I didn't catch an ask in that.",
  TIMED_OUT: "I couldn't get to that in time. Ask me again in a moment.",
} as const;

/**
 * Answers a developer ask from the brain. Both the voice's `ask_brain` tool
 * and the ⌥L composer land here: the ask is bounded like a typed one, the
 * brain's turn runs on the main process with every act still behind its own
 * validators, and the answer is the words the voice speaks. A refusal is an
 * answer rather than a throw, because the voice has to say something.
 */
export async function askBrain(
  brain: BrainAgent | undefined,
  question: string,
): Promise<BrainAskResult> {
  const bounded = question.trim().slice(0, maximumTypedAskLength);
  if (!bounded) return { status: ACT_RESULT_STATUS.REJECTED, reason: BRAIN_ASK_REFUSAL.EMPTY };
  if (!brain) return { status: ACT_RESULT_STATUS.REJECTED, reason: BRAIN_ASK_REFUSAL.ABSENT };
  const answer = await brain.ask(bounded);
  if (!answer) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: BRAIN_ASK_REFUSAL.TIMED_OUT };
  }
  return {
    status: ACT_RESULT_STATUS.ACCEPTED,
    briefing: answer.text,
    sessionIds: answer.sessionIds,
  };
}

export function registerBrainIpc(dependencies: BrainIpcDependencies): void {
  const { ipcMain, trustedSender, brain } = dependencies;
  registerBridgeEntry(
    BRIDGE,
    BRIDGE.askBrain,
    (_context, question: string) => askBrain(brain(), question),
    { ipcMain, trustedSender },
  );
}
