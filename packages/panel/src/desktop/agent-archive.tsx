import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  ArchiveIcon,
  BUTTON_SIZE,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  GAP,
  GROUP_HEADING,
  GroupHeader,
  IconButton,
  LAYOUT_ELEMENT,
  OneLine,
  STATUS_TONE,
  Stack,
  Tooltip,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useRef, useState } from "react";
import { commandAction, commandHead, PANEL_COMMAND } from "../command-items.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { agentName, agentStillWriting, teammateStarter } from "../tasks/coding-agent-model.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { foldedCount } from "./sidebar-fold.js";
import type { CountNoun } from "./sidebar-group-header.js";

/**
 * agent-archive.tsx -- a coding agent's Archive, asked first while the agent still works, and the task's archived agents folded under Archived at the foot of its summary's Coding agents, each with its Unarchive.
 *
 * Archive stands in an agent's tab menu and in the menu of its row in
 * the task's summary, and for an agent with no task in its page's ⋯ and its
 * sidebar row's menu, whose Unarchive stands in its place once archived
 * (`useAgentUnarchive`). An agent at rest is archived at once; one still
 * working asks first, since archiving it stops the turn it is on, and a
 * stopped turn is not given back. Note that an agent drawn at rest is read
 * again before it is archived unasked, because nothing follows an agent
 * whose tab is not shown, and a turn begun since, by Luke or another
 * window, is asked about first like any other. Archived, the agent leaves its tab, the
 * summary, the "+" menu, and the sidebar's card and marks, while its
 * transcript and its pull request are kept, ⌘K still finds it, saying it is
 * archived and opening its own page, and a toast offers Undo
 * (`use-coding-agents.ts`).
 *
 * The archived agents are folded away behind the header every group of the
 * window folds under (`GroupHeader`), an archive box that gives way to the fold's
 * chevron while hovered or reached from the keyboard, and folded, the count
 * after its name, the rows unrolling as they fade in and fading out as it
 * folds.
 * Unfolded, each archived agent is a muted row in the summary's own shape, a failed one's mark at
 * its end as a standing row's, whose Unarchive stands in the mark's place
 * while it is hovered or reached from the keyboard, as the sidebar task
 * rows' Pin and Archive do: at rest it takes no room, the name running the
 * row's full width, and shown, the name is cut where it begins and fades
 * out there. A screen with no hover shows it at rest. Its right-click offers the same. The
 * row hangs the agent's card beside it as a standing row does, saying it
 * was archived and when (`agent-ref.tsx`), though no press opens it,
 * since its tab is gone. It draws nothing while no agent is archived, and
 * starts folded.
 */

/** What the archived agents' fold says. */
const ARCHIVED_LABEL = "Archived";

/** What the fold's count is read as while folded. */
const ARCHIVED_NOUN: CountNoun = { one: "archived agent", many: "archived agents" };

/** What an archived agent's one action says, in an archived task's words. */
const UNARCHIVE = commandHead(PANEL_COMMAND.UNARCHIVE_AGENT);

/**
 * What asking to archive a working agent says. Unarchive brings the agent
 * back, so the act is never red: it asks in the accent, as an act that
 * reaches someone else where the agent is a teammate's, whose turn it stops.
 */
function archiveQuestion(name: string, teammate: string | undefined): DialogQuestion {
  return {
    title: `Stop and archive ${name}?`,
    body: "Its transcript and pull request are kept.",
    verb: "Stop and archive",
    running: "Archiving…",
    loss: teammate === undefined ? CONFIRM_LOSS.REVERSIBLE : CONFIRM_LOSS.AFFECTS_OTHERS,
  };
}

/** A press that archives or unarchives without a dialog, its refusal said in a toast. */
function useArchivePress(agents: CodingAgentsControl) {
  const toast = useToast();
  return (agentId: string, archived: boolean) =>
    agents.onArchive(agentId, archived).then((result: ActionResult) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
      toast({ words: result.reason, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED });
    });
}

/** An agent's Archive as a menu offers it, and the question it asks through. */
export interface AgentArchive {
  action: MenuAction;
  dialog: React.JSX.Element;
}

/** An archived agent's Unarchive as a menu offers it, its refusal said in a toast. */
export function useAgentUnarchive(agentId: string, agents: CodingAgentsControl): MenuAction {
  const press = useArchivePress(agents);
  return commandAction(PANEL_COMMAND.UNARCHIVE_AGENT, () => press(agentId, false), false);
}

/**
 * One agent's Archive as a menu offers it, and the dialog it asks through
 * while the agent still works, which the caller draws beside the menu. The
 * question goes with the surface it was asked on.
 */
export function useAgentArchive(
  agent: Pick<
    CodingAgentSummary,
    "id" | "status" | "title" | "automationName" | "model" | "startedBy"
  >,
  agents: CodingAgentsControl,
  shown: boolean,
): AgentArchive {
  const press = useArchivePress(agents);
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: shown }, () =>
    agents.onArchive(agent.id, true),
  );
  const working = agentStillWriting(agent.status);
  return {
    action: commandAction(
      PANEL_COMMAND.ARCHIVE_AGENT,
      working
        ? confirm.ask
        : () =>
            void agents.readAgent(agent.id).then((now) => {
              // A read that did not land asks first rather than stop a turn it could not see.
              if (now === undefined || agentStillWriting(now.status)) confirm.ask();
              else return press(agent.id, true);
            }),
      false,
    ),
    dialog: (
      <ConfirmDialog
        confirm={confirm}
        question={archiveQuestion(
          agentName(agent, agents.models),
          teammateStarter(agent.startedBy, agents.me),
        )}
      />
    ),
  };
}

/** One archived agent: its glyph and name, muted, hanging its card, its Unarchive at its end, and its right-click offering the same. */
function ArchivedAgentRow({
  agent,
  agents,
  shown,
}: {
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
  shown: boolean;
}): React.JSX.Element {
  const press = useArchivePress(agents);
  const menu = useMenu(shown);
  const item = useRef<HTMLLIElement>(null);
  const unarchive = () => press(agent.id, false);
  const subject = agentSubject(agents, agent.id, NOTHING_HELD, false);
  return (
    <li ref={item} className="task-summary-archived-agent" {...menu.contextMenu()}>
      <Tooltip
        label={subject.name}
        card={<AgentCard subject={subject} models={agents.models} />}
        cardBeside
        cardRegion={item}
      >
        <span className="task-summary-row">
          <span className="task-summary-glyph">
            <AgentGlyph agent={agent} />
          </span>
          <OneLine className="task-summary-label">{subject.name}</OneLine>
          {agentEndMark(agent, false)}
        </span>
      </Tooltip>
      <span className="task-summary-marks">
        <Tooltip label={UNARCHIVE.label}>
          <IconButton
            icon={UNARCHIVE.icon}
            label={UNARCHIVE.label}
            size={BUTTON_SIZE.COMPACT}
            onClick={unarchive}
          />
        </Tooltip>
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Archived agent actions"
          menu={menu.drawn}
          groups={[[commandAction(PANEL_COMMAND.UNARCHIVE_AGENT, unarchive, false)]]}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

/** The task's archived agents, folded away under Archived at the foot of its Coding agents; nothing while none is archived. */
export function ArchivedAgents({
  agents,
  shown,
}: {
  agents: CodingAgentsControl;
  /** Whether the summary is on screen: off it, an archived row's menu stands over nothing. */
  shown: boolean;
}): React.JSX.Element | null {
  const [unfolded, setUnfolded] = useState(false);
  const archived = agents.archived ?? [];
  if (archived.length === 0) return null;
  return (
    <div className="task-summary-archived">
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        glyph={<ArchiveIcon />}
        label={ARCHIVED_LABEL}
        fold={{ open: unfolded, onOpenChange: setUnfolded }}
        count={foldedCount(!unfolded, archived.length, ARCHIVED_NOUN)}
      >
        <Stack
          as={LAYOUT_ELEMENT.UL}
          gap={GAP.ROW}
          className="task-summary-rows"
          aria-label="Archived agents"
        >
          {archived.map((agent) => (
            <ArchivedAgentRow key={agent.id} agent={agent} agents={agents} shown={shown} />
          ))}
        </Stack>
      </GroupHeader>
    </div>
  );
}
