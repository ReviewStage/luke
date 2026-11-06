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

/**
 * agent-archive.tsx -- a coding agent's Archive, asked first while a teammate's agent still works, and the task's archived agents folded under Archived at the foot of its summary's Coding agents, each with its Unarchive.
 *
 * Archive stands in an agent's tab menu and in the menu of its row in
 * the task's summary, and for an agent with no task in its page's ⋯ and its
 * sidebar row's menu, whose Unarchive stands in its place once archived
 * (`useAgentUnarchive`). The reader's own agent is archived at once, at
 * rest or working, since the toast's Undo brings it back with its
 * transcript, though a turn the archive stopped stays stopped. A
 * teammate's at rest is archived at once too; one still working asks
 * first, in the accent, since archiving it stops a turn that is not the
 * reader's. Note that a teammate's agent drawn at rest is read again
 * before it is archived unasked, because nothing follows an agent whose
 * tab is not shown, and a turn begun since, by the app or another window, is
 * asked about first like any other, a button that pressed it held busy while
 * the read is out. Archived, which is drawn at once, before the service
 * answers, and put back where it refuses, unless it was asked about, whose
 * dialog stands until the answer to say a refusal, the agent leaves its tab, the
 * summary, the "+" menu, and the sidebar's card and marks, while its
 * transcript and its pull request are kept, ⌘K still finds it, saying it is
 * archived and opening its own page, and a toast offers Undo
 * (`use-agents.ts`).
 *
 * The archived agents are folded away behind the header every group of the
 * window folds under (`GroupHeader`), an archive box that gives way to the fold's
 * chevron while hovered or reached from the keyboard, and folded, the count
 * after its name, the rows unrolling as they fade in and fading out as it
 * folds.
 * Unfolded, each archived agent is a muted row in the summary's own shape, a failed one's mark at
 * its end as a standing row's, whose Unarchive stands in the mark's place
 * while it is hovered or reached from the keyboard, as the sidebar task
 * rows' Pin and Archive do, a ⋯ beside it: at rest they take no room, the name running the
 * row's full width. The ⋯, a right-click, a long press, and the menu key open
 * the agent's one menu over the doors a row has (`agent-actions.tsx`): Copy link, Unarchive, and
 * Permanently delete, asked first; a finger's row draws neither the Unarchive nor the ⋯, its
 * long press offering both. The
 * row hangs the agent's card beside it as a standing row does, saying it
 * was archived and when (`agent-ref.tsx`), and a press opens the agent's
 * own page, since its tab is gone, where its transcript is read and
 * Unarchive brings it back. It draws nothing while no agent is archived, and
 * starts folded, then stands as the reader left it, kept on this Mac.
 */

/** A summary row's glyph, at a control's glyph size in the muted ink; one wearing where its work stands takes a glyph's footprint, so every row's label starts on one edge. */
export const SUMMARY_GLYPH =
  "task-summary-glyph flex flex-none text-muted-foreground [&_.state-glyph]:[--state-glyph-size:var(--spacing-control-icon)] [&_svg]:size-control-icon";

/** Whether the reader left Archived open, one choice for every task's summary, kept on this Mac. */
const KEPT = {
  UNFOLDED: keptKey("app.taskArchivedUnfolded", Schema.fromJsonString(Schema.Boolean)),
} as const;

/** What the archived agents' fold says. */
const ARCHIVED_LABEL = "Archived";

/** What the fold's count is read as while folded. */
const ARCHIVED_NOUN: CountNoun = { one: "archived agent", many: "archived agents" };

/** What an archived agent's one action says, in an archived task's words. */
const UNARCHIVE = commandHead(PANEL_COMMAND.UNARCHIVE_AGENT);

/** What the Unarchive button is named while the service answers, as the composer's own is. */
const UNARCHIVING = "Unarchiving";

/**
 * What asking to archive a teammate's working agent says. Unarchive brings
 * the agent back, so the act is never red: it asks in the accent, as an act
 * that reaches someone else, whose turn it stops.
 */
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

/** A press that archives or unarchives without a dialog, its refusal said in a toast. */
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

/** An agent's Archive as a menu offers it, and the question it asks through. */
export interface AgentArchive {
  action: MenuAction;
  /** Whether a teammate's agent at rest is being read again before it is archived, which a button drawing the action shows busy. */
  reading: boolean;
  dialog: React.JSX.Element;
}

/** An archived agent's Unarchive as a menu offers it, its refusal said in a toast. */
export function useAgentUnarchive(agentId: string, agents: AgentsControl): MenuAction {
  const press = useArchivePress(agents);
  return commandAction(PANEL_COMMAND.UNARCHIVE_AGENT, () => press(agentId, false), false);
}

/**
 * One agent's Archive as a menu offers it, and the dialog it asks through
 * while a teammate's agent still works, which the caller draws beside the
 * menu. The reader's own agent is archived at once, working or not, since
 * the toast's Undo brings it back; a teammate's is read first and asked
 * about while it works. The question goes with the surface it was asked on.
 */
export function useAgentArchive(
  agent: Pick<AgentSummary, "id" | "status" | "title" | "automationName" | "model" | "startedBy">,
  agents: AgentsControl,
  shown: boolean,
): AgentArchive {
  const press = useArchivePress(agents);
  // Note that an archive asked about is drawn at once, which may take the row the dialog stands on with it.
  const heard = useRefusalHeard(shown, {
    surface: FAILURE_SURFACE.AGENT_ARCHIVE,
    about: { agentId: agent.id },
  });
  const archiving = useMutation(agents.archiveAgent);
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    () => archiving.mutateAsync({ agentId: agent.id, archived: true, asked: true }).then(heard),
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
      // A read that did not land asks first rather than stop a turn it could not see.
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

/** What an archived agent's row is, naming its ⋯ and menu "Archived agent actions". */
const ARCHIVED_THING = "Archived agent";

/** One archived agent: its glyph and name, muted, hanging its card, opening its own page on a press, its Unarchive and its ⋯ at its end, and its right-click, long press, and the menu key opening the ⋯'s menu. */
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
  // The agent's menu over the doors a row has: an archived agent's Copy link, Unarchive, and Permanently delete.
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

/** The task's archived agents, folded away under Archived at the foot of its Coding agents; nothing while none is archived. */
export function ArchivedAgents({
  agents,
  shown,
  onOpen,
}: {
  agents: AgentsControl;
  /** Whether the summary is on screen: off it, an archived row's menu stands over nothing. */
  shown: boolean;
  /** Opens an archived agent's own page, where its transcript is read and it is brought back. */
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
