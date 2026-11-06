import type { AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  ArchiveIcon,
  BUTTON_SIZE,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  GROUP_HEADING,
  GroupHeader,
  IconButton,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  List,
  ListRow,
  nextRowOrHead,
  RowHint,
  RowHintOptions,
  STATUS_TONE,
  Tooltip,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { Schema } from "effect";
import { useState } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandAction, commandHead, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { useBusyPress } from "../settings/busy-press.js";
import { agentName, agentStillWriting, teammateStarter } from "../tasks/agent-model.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { keptKey, useKept } from "../use-kept.js";
import { type MenuAction, rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
import { type CountNoun, foldedCount } from "./sidebar-fold.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

export const SUMMARY_GLYPH =
  "task-summary-glyph flex flex-none text-muted-foreground [&_.state-glyph]:[--state-glyph-size:var(--spacing-control-icon)] [&_svg]:size-control-icon";

const KEPT = {
  UNFOLDED: keptKey("app.taskArchivedUnfolded", Schema.fromJsonString(Schema.Boolean)),
} as const;

const ARCHIVED_LABEL = "Archived";

const ARCHIVED_NOUN: CountNoun = { one: "archived agent", many: "archived agents" };

const UNARCHIVE = commandHead(PANEL_COMMAND.UNARCHIVE_AGENT);

const UNARCHIVING = "Unarchiving";

function archiveQuestion(name: string): DialogQuestion {
  return {
    title: `Stop and archive ${name}?`,
    body: "Its transcript and pull request are kept.",
    verb: "Stop and archive agent",
    running: "Stopping and archiving",
    loss: CONFIRM_LOSS.AFFECTS_OTHERS,
    replayUnmasked: true,
    titleReplayMasked: true,
  };
}

function useArchivePress(agents: AgentsControl) {
  const toast = useToast();
  return (agentId: string, archived: boolean) =>
    agents.onArchive(agentId, archived).then((result: ActionResult) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
      toast({
        words: result.reason,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.AGENT_ARCHIVE, cause: result, about: { agentId } },
      });
    });
}

export interface AgentArchive {
  action: MenuAction;
  reading: boolean;
  dialog: React.JSX.Element;
}

export function useAgentUnarchive(agentId: string, agents: AgentsControl): MenuAction {
  const press = useArchivePress(agents);
  return commandAction(PANEL_COMMAND.UNARCHIVE_AGENT, () => press(agentId, false), false);
}

export function useAgentArchive(
  agent: Pick<AgentSummary, "id" | "status" | "title" | "automationName" | "model" | "startedBy">,
  agents: AgentsControl,
  shown: boolean,
): AgentArchive {
  const press = useArchivePress(agents);
  const heard = useRefusalHeard(shown, {
    surface: FAILURE_SURFACE.AGENT_ARCHIVE,
    about: { agentId: agent.id },
  });
  const archiving = useMutation(agents.archiveAgent);
  const confirmAct = useConfirmAct(archiving, {
    send: () =>
      archiving.mutateAsync({ agentId: agent.id, archived: true, asked: true }).then(heard),
    answered: sameAnswer,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.AGENT_ARCHIVE, { agentId: agent.id }),
  );
  const [reading, setReading] = useState(false);
  const teammate = teammateStarter(agent.startedBy, agents.me) !== undefined;
  const archive = () => void press(agent.id, true);
  const asked = () => {
    if (reading) return;
    setReading(true);
    void agents.readAgent(agent.id).then((now) => {
      setReading(false);
      if (now === undefined || agentStillWriting(now.status)) confirm.ask();
      else return press(agent.id, true);
    });
  };
  return {
    action: commandAction(
      PANEL_COMMAND.ARCHIVE_AGENT,
      teammate ? (agentStillWriting(agent.status) ? confirm.ask : asked) : archive,
      false,
    ),
    reading,
    dialog: (
      <ConfirmDialog
        open
        confirm={confirm}
        question={archiveQuestion(agentName(agent, agents.models))}
        restoreTo={nextRowOrHead}
      />
    ),
  };
}

const ARCHIVED_THING = "Archived agent";

function ArchivedAgentRow({
  agent,
  agents,
  shown,
  onOpen,
}: {
  agent: AgentSummary;
  agents: AgentsControl;
  shown: boolean;
  onOpen: (agentId: string) => void;
}): React.JSX.Element {
  const press = useArchivePress(agents);
  const subject = agentSubject(agents, agent.id, NOTHING_HELD, false);
  const actions = useAgentActions(agent, agents, {
    label: subject.name,
    shown,
    terminals: { onOpenTerminal: undefined },
  });
  const unarchiving = useBusyPress(() => press(agent.id, false));
  const coarse = useCoarsePointer();
  return (
    <>
      <RowHintOptions card={<AgentCard subject={subject} models={agents.models} />}>
        <ListRow
          leading={
            <span className={SUMMARY_GLYPH}>
              <AgentGlyph agent={agent} />
            </span>
          }
          title={<ReplayMask>{subject.name}</ReplayMask>}
          meta={agentEndMark(agent, false)}
          muted
          hint={{ Hint: RowHint, label: subject.name }}
          onPress={() => onOpen(agent.id)}
          menu={rowMenu(ARCHIVED_THING, agentMenuGroups(rowDoors(actions.doors)), shown, true)}
          more={!coarse}
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          actions={
            coarse ? null : (
              <Tooltip label={UNARCHIVE.label}>
                <IconButton
                  icon={UNARCHIVE.icon}
                  label={UNARCHIVE.label}
                  size={BUTTON_SIZE.COMPACT}
                  busy={unarchiving.busy}
                  busyLabel={UNARCHIVING}
                  onClick={unarchiving.onPress}
                />
              </Tooltip>
            )
          }
        />
      </RowHintOptions>
      {actions.dialog}
    </>
  );
}

export function ArchivedAgents({
  agents,
  shown,
  onOpen,
}: {
  agents: AgentsControl;
  shown: boolean;
  onOpen: (agentId: string) => void;
}): React.JSX.Element | null {
  const [unfolded, setUnfolded] = useKept(KEPT.UNFOLDED, false);
  const archived = agents.archived ?? [];
  if (archived.length === 0) return null;
  return (
    <div className="task-summary-archived mt-list-gap">
      <ReplayUnmask>
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          glyph={<ArchiveIcon />}
          label={ARCHIVED_LABEL}
          fold={{ open: unfolded, onOpenChange: setUnfolded }}
          count={foldedCount(!unfolded, archived.length, ARCHIVED_NOUN)}
        >
          <List label="Archived agents" density={LIST_DENSITY.DENSE}>
            {archived.map((agent) => (
              <ArchivedAgentRow
                key={agent.id}
                agent={agent}
                agents={agents}
                shown={shown}
                onOpen={onOpen}
              />
            ))}
          </List>
        </GroupHeader>
      </ReplayUnmask>
    </div>
  );
}
