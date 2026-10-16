import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { PrRunTarget } from "@luke/features/pr-run-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { FolderOpenIcon, PlayIcon, Trash2Icon } from "lucide-react";
import type { MenuAction } from "../desktop/action-menu";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";

/**
 * run-on-mac.tsx -- what an agent tab's menu offers to run the agent's work on this Mac: Run on this Mac, Show in Finder, and Delete Local Checkout.
 *
 * Run on this Mac opens the agent's run tab in the side panel and runs its
 * working tree there, as its sandbox holds it now, pull request or not
 * (`pr-run-tab.tsx`). Show in Finder reveals Luke's checkout of it, and
 * Delete Local Checkout deletes that checkout, asking first. A tab offers
 * them only where a side panel can draw the run and the task names a
 * repository.
 */

/** What the menu does on this Mac, each for the agent's run it is handed. */
export interface RunOnMacDoors {
  /** The workspace the agent's repository is reached through. */
  readonly workspaceId: string;
  /** The task's repository, which the agent works in. */
  readonly repository: string;
  /** Opens the agent's run tab and runs its work. */
  readonly run: (target: PrRunTarget) => void;
  readonly showInFinder: (target: PrRunTarget) => void;
  /** Deletes Luke's checkout of it, rejecting with why where it could not. */
  readonly deleteCheckout: (target: PrRunTarget) => Promise<void>;
}

/** What Delete Local Checkout asks first. */
const DELETE_CHECKOUT_QUESTION: DialogQuestion = {
  title: "Delete local checkout?",
  body: "Luke's copy of this agent's work on this Mac, and everything its runs installed there, will be deleted. The agent's sandbox and its pull request are not touched.",
  verb: "Delete",
  running: "Deleting",
};

/** The agent's menu items for running its work on this Mac, and the dialog Delete asks through, which the caller draws beside the menu. */
interface RunOnMac {
  readonly actions: readonly MenuAction[];
  readonly dialog: React.ReactNode;
}

export function useRunOnMac(
  agent: CodingAgentSummary,
  doors: RunOnMacDoors | undefined,
  shown: boolean,
): RunOnMac {
  const target: PrRunTarget | undefined =
    doors === undefined
      ? undefined
      : { workspaceId: doors.workspaceId, repository: doors.repository, agentId: agent.id };
  const deletion = useConfirmDialog(
    { subject: target !== undefined, surfaceOpen: shown },
    (): Promise<ActionResult> =>
      target === undefined || doors === undefined
        ? Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED })
        : doors.deleteCheckout(target).then(
            (): ActionResult => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
            (refused: Error): ActionResult => ({
              status: ACTION_RESULT_STATUS.REJECTED,
              reason: refused.message,
            }),
          ),
  );
  if (target === undefined || doors === undefined) return { actions: [], dialog: null };
  return {
    actions: [
      { label: "Run on this Mac", icon: <PlayIcon />, onSelect: () => doors.run(target) },
      {
        label: "Show in Finder",
        icon: <FolderOpenIcon />,
        onSelect: () => doors.showInFinder(target),
      },
      {
        label: "Delete Local Checkout",
        icon: <Trash2Icon />,
        danger: true,
        onSelect: deletion.ask,
      },
    ],
    dialog: <ConfirmDialog confirm={deletion} question={DELETE_CHECKOUT_QUESTION} />,
  };
}
