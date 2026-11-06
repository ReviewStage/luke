import {
  ADDED_REPOSITORY_CHECKOUT,
  type AddedRepositoryCheckout,
  AGENT_MACHINE,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
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
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { useConfirmAct } from "../confirm-act.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { addRepositoryFailureWords } from "./agent-model.js";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "./repository-chip.js";
import { type AgentsControl, agentAddRepositoryMutation } from "./use-agents.js";

type AddedTo = Pick<AgentSummary, "id" | "archivedAt" | "machine" | "startedBy">;

type AddDoors = Pick<AgentsControl, "me" | "workspaceId" | "onUnarchive" | "addRepository">;

const NO_ADD = agentAddRepositoryMutation(() =>
  Promise.reject(new Error("This surface adds no repository.")),
);

const ADD_WORDS = {
  ITEM: "Add repository…",
  TITLE: "Add a repository to this agent",
  ACT: "Add",
  RUNNING: "Adding",
  PICK: "Choose a repository.",
  BODY: "It is checked out beside the agent's own, and the agent's GitHub token reaches it.",
} as const;

function addedWords(repository: string, checkout: AddedRepositoryCheckout | undefined): string {
  return checkout === ADDED_REPOSITORY_CHECKOUT.NOW
    ? `${repository} is checked out beside the agent.`
    : `${repository} is checked out at the agent's next turn.`;
}

function useAddOffered(agent: AddedTo, agents: AddDoors): boolean {
  const own = agent.startedBy === undefined || agent.startedBy.userId === agents.me;
  return (
    agents.addRepository !== undefined &&
    agents.onUnarchive === undefined &&
    agent.archivedAt === undefined &&
    agent.machine !== AGENT_MACHINE.DEVICE &&
    own
  );
}

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

export interface AddRepositoryDoor {
  readonly action: MenuAction | undefined;
  readonly dialog: React.JSX.Element;
}

export function useAddRepository(
  agent: AddedTo,
  agents: AddDoors,
  shown: boolean,
): AddRepositoryDoor {
  const offered = useAddOffered(agent, agents);
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const adding = useMutation(agents.addRepository ?? NO_ADD);
  const add = async (): Promise<void> => {
    if (agents.addRepository === undefined || picked === null) return;
    const answer = await adding.mutateAsync({ agentId: agent.id, repository: picked });
    if ("failure" in answer) return;
    toast({
      words: addedWords(picked, answer.addedCheckout),
      tone: STATUS_TONE.COMPLETE,
      hold: TOAST_HOLD.DONE,
    });
  };
  const addAct = useConfirmAct(adding, {
    send: add,
    answered: (answer): ActionResult =>
      "failure" in answer
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: addRepositoryFailureWords(answer) }
        : { status: ACTION_RESULT_STATUS.ACCEPTED },
    refusedFirst: () =>
      agents.addRepository === undefined || picked === null
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: ADD_WORDS.PICK }
        : undefined,
  });
  const confirm = useConfirmDialog(
    { subject: offered, surfaceOpen: shown },
    addAct,
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
