import {
  ADDED_REPOSITORY_CHECKOUT,
  type AddedRepositoryCheckout,
  AGENT_MACHINE,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { EXPERIMENT } from "@repo/settings";
import {
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogConfirm,
  ErrorState,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useConfirmDialog,
} from "@repo/ui";
import { CONFIRM_STAGE, confirmAsked } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { useExperiment } from "../use-app-state.js";
import { addRepositoryFailureWords } from "./agent-model.js";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "./repository-chip.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * add-repository.tsx -- Add repository… on an agent's ⋯: a repository the GitHub App reaches, added beside the ones the agent works in.
 *
 * The item opens a dialog holding the repository chooser every task's
 * repository is picked with (`repository-chip.tsx`'s searchable menu),
 * offering only what the workspace's GitHub App reaches, since one App
 * token reaches all of an agent's repositories; Add sends the pick, and the
 * service appends it, checks it out, and tells the agent
 * (`agent-repository-add.ts`). A toast then says whether it was checked out
 * beside the agent now or will be at its next turn, where no place of the
 * agent's ran, which tells the agent nothing so an idle one is not woken. A
 * refusal keeps the dialog up saying why under the chooser. It stands only while Several repositories is on, on
 * an agent the reader started that runs in the cloud and is not archived,
 * under nothing archived, where the control can add one; the service still
 * refuses an agent in no repository and a repository already among its
 * own, which the row cannot tell, since it lists no repositories.
 */

/** The agent Add repository… is offered on, as the item reads it. */
type AddedTo = Pick<AgentSummary, "id" | "archivedAt" | "machine" | "startedBy">;

/** What the item reads of the control: the reader, where the agents' workspace is known, and the door the add goes through. */
type AddDoors = Pick<AgentsControl, "me" | "workspaceId" | "onUnarchive" | "onAddRepository">;

/** The item's words, the dialog's, and what it says while no repository is picked. */
const ADD_WORDS = {
  ITEM: "Add repository…",
  TITLE: "Add a repository to this agent",
  ACT: "Add",
  RUNNING: "Adding",
  PICK: "Choose a repository.",
  BODY: "It is checked out beside the agent's own, and the agent's GitHub token reaches it.",
} as const;

/** What a repository added says once the service took it: checked out beside the agent now, or at its next turn, which a service that named neither is read as. */
function addedWords(repository: string, checkout: AddedRepositoryCheckout | undefined): string {
  return checkout === ADDED_REPOSITORY_CHECKOUT.NOW
    ? `${repository} is checked out beside the agent.`
    : `${repository} is checked out at the agent's next turn.`;
}

/** Whether the reader may add a repository to the agent, on the terms the header says. */
function useAddOffered(agent: AddedTo, agents: AddDoors): boolean {
  const own = agent.startedBy === undefined || agent.startedBy.userId === agents.me;
  return (
    useExperiment(EXPERIMENT.SEVERAL_REPOSITORIES) &&
    agents.onAddRepository !== undefined &&
    agents.onUnarchive === undefined &&
    agent.archivedAt === undefined &&
    agent.machine !== AGENT_MACHINE.DEVICE &&
    own
  );
}

/** The dialog over the window while the add is asked, running, or refused, and through its fade as it goes. */
function AddRepositoryCard({
  open,
  confirm,
  chooser,
  picked,
  onPick,
}: {
  open: boolean;
  confirm: DialogConfirm;
  chooser: RepositoryChooser;
  picked: string | null;
  onPick: (repository: string) => void;
}): React.JSX.Element {
  const { stage, rejection } = confirm;
  const adding = stage === CONFIRM_STAGE.ACTING;
  const cancel = useRef<HTMLButtonElement | null>(null);
  const dismiss = () => {
    if (adding) return;
    confirm.keep();
    confirm.clear();
  };
  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.CONFIRM}
      title={ADD_WORDS.TITLE}
      busy={adding}
      initialFocus={cancel}
      onDismiss={dismiss}
      actions={
        <DialogActions
          onCancel={dismiss}
          cancelRef={cancel}
          act={{
            verb: ADD_WORDS.ACT,
            tone: DIALOG_TONE.PRIMARY,
            running: ADD_WORDS.RUNNING,
            busy: adding,
            disabled: picked === null,
            onPress: () => confirm.run(),
          }}
        />
      }
    >
      <div className="add-repository-dialog flex min-h-0 flex-col gap-block-gap">
        <ReplayUnmask>
          <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.BODY} tone={TEXT_TONE.MUTED}>
            {ADD_WORDS.BODY}
          </Text>
        </ReplayUnmask>
        <RepositoryChip
          place={CHIP_PLACE.FIELD}
          value={picked}
          chooser={chooser}
          appOnly
          onChoose={onPick}
        />
        {rejection !== undefined && !adding ? (
          <ErrorState failure={rejection.failure}>
            <ReplayMask>{rejection.words}</ReplayMask>
          </ErrorState>
        ) : null}
      </div>
    </Dialog>
  );
}

/** One agent's Add repository… as its menu holds it: the item, none where it is not offered, and the dialog drawn beside the menu. */
export interface AddRepositoryDoor {
  readonly action: MenuAction | undefined;
  readonly dialog: React.JSX.Element;
}

/** One agent's Add repository…, held for whichever surface offers its menu, the question kept while the surface is shown. */
export function useAddRepository(
  agent: AddedTo,
  agents: AddDoors,
  shown: boolean,
): AddRepositoryDoor {
  const offered = useAddOffered(agent, agents);
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const add = async (): Promise<ActionResult> => {
    const { onAddRepository } = agents;
    if (onAddRepository === undefined || picked === null) {
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: ADD_WORDS.PICK };
    }
    const answer = await onAddRepository(agent.id, picked);
    if ("failure" in answer) {
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: addRepositoryFailureWords(answer) };
    }
    // Note that a repository added to an agent whose place does not run is checked out at its next turn, and the agent hears nothing now.
    toast({
      words: addedWords(picked, answer.addedCheckout),
      tone: STATUS_TONE.COMPLETE,
      hold: TOAST_HOLD.DONE,
    });
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };
  const confirm = useConfirmDialog(
    { subject: offered, surfaceOpen: shown },
    add,
    confirmFailure(FAILURE_SURFACE.AGENT_ADD_REPOSITORY, { agentId: agent.id }),
  );
  const open = confirm.standing && (confirmAsked(confirm.stage) || confirm.rejection !== undefined);
  const chooser: RepositoryChooser = {
    recent: [],
    openGitHub: (url) => appPlatform().openWeb(url),
    pictures: true,
    scope: agents.workspaceId,
    manages: false,
  };
  return {
    action: offered
      ? {
          label: ADD_WORDS.ITEM,
          icon: <GLYPH.REPOSITORY />,
          onSelect: () => {
            setPicked(null);
            confirm.ask();
          },
        }
      : undefined,
    dialog: (
      <AddRepositoryCard
        open={open}
        confirm={confirm}
        chooser={chooser}
        picked={picked}
        onPick={setPicked}
      />
    ),
  };
}
