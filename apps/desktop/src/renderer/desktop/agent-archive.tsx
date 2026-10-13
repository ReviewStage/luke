import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import { ArchiveIcon, ChevronRightIcon, UnarchiveIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useState } from "react";
import { AgentGlyph, agentEndMark } from "../planning/agent-tab";
import { agentStillWriting, agentTabLabel } from "../planning/coding-agent-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { disclosureMotion, useDisclosure } from "../use-disclosure";
import { ActionMenu, atPointer, type MenuAction, useActionMenu } from "./action-menu";

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
 * The archived agents are kept the way the sidebar keeps archived plans
 * (`ArchivedPlans`): folded away behind a row of their own, an archive box
 * that gives way to the fold's chevron while hovered or reached from the
 * keyboard, and folded, the count after its name. Unfolded, each archived
 * agent is a muted row in the summary's own shape, a failed one's mark at
 * its end as a standing row's, whose Unarchive stands in the mark's place
 * while it is hovered or reached from the keyboard, in the sidebar
 * rows' Pin and Archive style, and whose right-click offers the same. It
 * draws nothing while no agent is archived, and starts folded.
 */

/** What the archived agents' fold says, as the sidebar's archived plans' does. */
const ARCHIVED_LABEL = "Archived";

/** What an archived agent's one action says, in an archived plan's words. */
const UNARCHIVE_LABEL = "Unarchive";

/** What asking to archive a working agent says. */
function archiveQuestion(name: string): DialogQuestion {
  return {
    title: `Stop and archive ${name}?`,
    body: "The agent stops the turn it is on. Its transcript and pull request are kept, and you can unarchive it from the plan's summary.",
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

/** One archived agent: its glyph and name, muted, its Unarchive at its end, and its right-click offering the same. */
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
  const unarchive = () => press(agent.id, false);
  return (
    <li
      className="plan-summary-archived-agent"
      onContextMenu={(event) => {
        event.preventDefault();
        menu.show(atPointer(event), event.currentTarget);
      }}
    >
      <span className="plan-summary-row">
        <span className="plan-summary-glyph">
          <AgentGlyph agent={agent} />
        </span>
        <span ref={words} className="plan-summary-label" data-overflow={String(clipped)}>
          {agentTabLabel(agent, agents.models)}
        </span>
        {agentEndMark(agent, false)}
      </span>
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
  const fold = useDisclosure(unfolded);
  const archived = agents.archived ?? [];
  if (archived.length === 0) return null;
  return (
    // Note that the group starts folded, so every open is a press's, and unrolls.
    <div
      className="plan-summary-archived"
      data-disclosure={disclosureMotion(unfolded, fold.leaving)}
    >
      <button
        type="button"
        className="plan-summary-row plan-summary-archived-toggle"
        aria-expanded={unfolded}
        onClick={() => setUnfolded((was) => !was)}
      >
        <span className="plan-summary-glyph plan-summary-fold">
          <ArchiveIcon />
          <ChevronRightIcon />
        </span>
        <span className="plan-summary-label">{ARCHIVED_LABEL}</span>
        {unfolded ? null : (
          <span className="plan-summary-count">
            {archived.length}
            <span className="visually-hidden">
              {archived.length === 1 ? " archived agent" : " archived agents"}
            </span>
          </span>
        )}
      </button>
      {fold.mounted ? (
        <ul
          ref={fold.ref}
          className="plan-summary-rows disclosure-body"
          inert={fold.leaving}
          aria-label="Archived agents"
        >
          {archived.map((agent) => (
            <ArchivedAgentRow key={agent.id} agent={agent} agents={agents} shown={shown} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
