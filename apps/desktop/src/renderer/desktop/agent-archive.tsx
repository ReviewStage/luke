import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { ArchiveIcon, UnarchiveIcon } from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useRef, useState } from "react";
import { AgentCard, agentSubject, NOTHING_HELD } from "../planning/agent-ref";
import { agentStillWriting, agentTabLabel } from "../planning/coding-agent-model";
import { AgentGlyph, agentEndMark } from "../planning/tab-look";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { type CountNoun, SidebarGroupHeader } from "./sidebar-group-header";

/**
 * agent-archive.tsx -- a coding agent's Archive, asked first while the agent still works, and the plan's archived agents folded under Archived at the foot of its summary's Coding agents, each with its Unarchive.
 *
 * Archive agent stands in an agent's tab menu and in the menu of its row in
 * the plan's summary. An agent at rest is archived at once; one still
 * working asks first, since archiving it stops the turn it is on, and a
 * stopped turn is not given back. Note that an agent drawn at rest is read
 * again before it is archived unasked, because nothing follows an agent
 * whose tab is not shown, and a turn begun since, by Luke or another
 * window, is asked about first like any other. Archived, the agent leaves its tab, the
 * summary, the "+" menu, ⌘K, and the sidebar's card and marks, while its
 * transcript and its pull request are kept, and a toast offers Undo
 * (`use-coding-agents.ts`).
 *
 * The archived agents are folded away behind the header every group of the
 * window folds under (`sidebar-group-header.tsx`), an archive box that gives way to the fold's
 * chevron while hovered or reached from the keyboard, and folded, the count
 * after its name, the fold landing at once as the sidebar's does.
 * Unfolded, each archived agent is a muted row in the summary's own shape, a failed one's mark at
 * its end as a standing row's, whose Unarchive stands in the mark's place
 * while it is hovered or reached from the keyboard, in the sidebar
 * rows' Pin and Archive style, and whose right-click offers the same. The
 * row hangs the agent's card beside it as a standing row does, saying it
 * was archived and when (`agent-ref.tsx`), though no press opens it,
 * since its tab is gone. It draws nothing while no agent is archived, and
 * starts folded.
 */

/** What the archived agents' fold says. */
const ARCHIVED_LABEL = "Archived";

/** What the fold's count is read as while folded. */
const ARCHIVED_NOUN: CountNoun = { one: "archived agent", many: "archived agents" };

/** What an archived agent's one action says, in an archived plan's words. */
const UNARCHIVE_LABEL = "Unarchive";

/** What asking to archive a working agent says. */
function archiveQuestion(name: string): DialogQuestion {
  return {
    title: `Stop and archive ${name}?`,
    body: "Its transcript and pull request are kept.",
    verb: "Stop and archive",
    running: "Archiving…",
  };
}

/** A press that archives or unarchives without a dialog, its refusal said in a toast. */
function useArchivePress(agents: CodingAgentsControl) {
  const toast = useToast();
  return (agentId: string, archived: boolean) =>
    agents.onArchive(agentId, archived).then((result: ActionResult) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
      toast({ words: result.reason, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    });
}

/** An agent's Archive as a menu offers it, and the question it asks through. */
export interface AgentArchive {
  action: MenuAction;
  dialog: React.JSX.Element;
}

/**
 * One agent's Archive as a menu offers it, and the dialog it asks through
 * while the agent still works, which the caller draws beside the menu. The
 * question goes with the surface it was asked on.
 */
export function useAgentArchive(
  agent: CodingAgentSummary,
  agents: CodingAgentsControl,
  shown: boolean,
): AgentArchive {
  const press = useArchivePress(agents);
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: shown }, () =>
    agents.onArchive(agent.id, true),
  );
  const working = agentStillWriting(agent.status);
  return {
    action: {
      label: "Archive agent",
      icon: <ArchiveIcon />,
      onSelect: working
        ? confirm.ask
        : () =>
            void agents.readAgent(agent.id).then((now) => {
              // A read that did not land asks first rather than stop a turn it could not see.
              if (now === undefined || agentStillWriting(now.status)) confirm.ask();
              else return press(agent.id, true);
            }),
    },
    dialog: (
      <ConfirmDialog
        confirm={confirm}
        question={archiveQuestion(agentTabLabel(agent, agents.models))}
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
  const [words, clipped] = useClipped();
  const press = useArchivePress(agents);
  const menu = useActionMenu(shown);
  const item = useRef<HTMLLIElement>(null);
  const unarchive = () => press(agent.id, false);
  const subject = agentSubject(agents, agent.id, NOTHING_HELD, false);
  return (
    <li ref={item} className="plan-summary-archived-agent" onContextMenu={menu.contextMenu()}>
      <Tooltip
        label={subject.name}
        card={<AgentCard subject={subject} models={agents.models} />}
        cardBeside
        cardRegion={item}
      >
        <span className="plan-summary-row">
          <span className="plan-summary-glyph">
            <AgentGlyph agent={agent} />
          </span>
          <span ref={words} className="plan-summary-label" data-overflow={String(clipped)}>
            {subject.name}
          </span>
          {agentEndMark(agent, false)}
        </span>
      </Tooltip>
      <span className="plan-summary-marks">
        <Tooltip label={UNARCHIVE_LABEL}>
          <button
            type="button"
            className="sidebar-plan-mark"
            aria-label={UNARCHIVE_LABEL}
            onClick={unarchive}
          >
            <UnarchiveIcon />
          </button>
        </Tooltip>
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Archived agent actions"
          menu={menu.drawn}
          groups={[[{ label: UNARCHIVE_LABEL, icon: <UnarchiveIcon />, onSelect: unarchive }]]}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

/** The plan's archived agents, folded away under Archived at the foot of its Coding agents; nothing while none is archived. */
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
    <div className="plan-summary-archived">
      <SidebarGroupHeader
        glyph={<ArchiveIcon />}
        name={ARCHIVED_LABEL}
        folded={!unfolded}
        count={archived.length}
        noun={ARCHIVED_NOUN}
        onToggle={() => setUnfolded((was) => !was)}
      />
      {unfolded ? (
        <ul className="plan-summary-rows" aria-label="Archived agents">
          {archived.map((agent) => (
            <ArchivedAgentRow key={agent.id} agent={agent} agents={agents} shown={shown} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
