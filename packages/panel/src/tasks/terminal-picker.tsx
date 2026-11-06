import { useAtomValue } from "@effect/atom-react";
import type { AgentSummary } from "@repo/features/agent-wire";
import { noMatchWords, readingWords, TERM } from "@repo/features/words";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import { PlusIcon, Shortcut } from "@repo/ui";
import { CommandDialog, type CommandGroup, type CommandItem } from "@repo/ui/command";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useState } from "react";
import { agentName, startsOwnAgents } from "./agent-model.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { AgentGlyph, agentEndMark } from "./tab-look.js";
import { shellsHeld } from "./terminal-held.js";
import { TerminalStanding } from "./terminal-shells.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * terminal-picker.tsx -- the palette asking which coding agent a terminal is for, when the rules leave it to the developer.
 *
 * A terminal belongs to one agent (`terminal-entry.ts`), and with
 * several agents on the task New terminal asks, as ⌘J does before any
 * terminal was used. It is the command palette's own dialog and rows: each
 * agent as its tab wears it, its glyph, its name and its failed mark, its
 * card hung beside it, with how many shells this window holds for it in the
 * panel's own words, the agent whose terminal was used last chosen to begin
 * with and saying so. Whether the agent works is its glyph's to say, the
 * working mark in its place, so no word repeats it. A task with no agent
 * offers to start one.
 */

/** The value of the row that starts an agent, which no agent's id spells. */
const START_ROW = "start-agent";

/** The start row's words, and the key of the group that holds it. */
const START_WORDS = "Start an agent";

/** The key of the group of agents. */
const AGENTS_GROUP = "agents";

/** What the picker's field asks. */
const PICKER_QUESTION = "New terminal for which agent?";

/** The row's words after the name: its shells as the panel's "+" says them, and whether it was used last; none where it has neither. */
function RowDetail({
  agent,
  last,
}: {
  agent: AgentSummary;
  last: boolean;
}): React.JSX.Element | null {
  const shells = useAtomValue(shellsHeld(agent.id)).length;
  if (shells === 0 && !last) return null;
  return (
    <>
      <TerminalStanding agentId={agent.id} />
      {shells > 0 && last ? " · " : null}
      {last ? "last used" : null}
    </>
  );
}

/** One agent's row: its look, its failed mark, and the card its hover hangs, with how many shells the window holds for it. */
function agentItem(
  agent: AgentSummary,
  agents: AgentsControl,
  last: boolean,
  onPick: () => void,
): CommandItem {
  const name = agentName(agent, agents.models);
  return {
    id: agent.id,
    words: name,
    label: <ReplayMask>{name}</ReplayMask>,
    icon: <AgentGlyph agent={agent} />,
    detail: <RowDetail agent={agent} last={last} />,
    hint: agentEndMark(agent, true),
    card: (
      <AgentCard
        subject={agentSubject(agents, agent.id, NOTHING_HELD, false)}
        models={agents.models}
      />
    ),
    onSelect: onPick,
  };
}

/** The keys' hints along the foot, each its chord and then its word, which a reader is not read. */
function PickerFoot(): React.JSX.Element {
  return (
    <ReplayUnmask>
      <span aria-hidden="true">
        <Shortcut chord={{ key: SHORTCUT_KEY.ENTER, bare: true }} /> Open terminal
      </span>
      <span aria-hidden="true">
        <Shortcut chord={{ key: SHORTCUT_KEY.ESCAPE, bare: true }} /> Close
      </span>
    </ReplayUnmask>
  );
}

/** Which agent the picker was opened for: none to ask about yet, or the one chosen to begin with. */
export interface TerminalPick {
  readonly chosen: string | undefined;
}

export function TerminalPicker({
  pick,
  agents,
  lastUsed,
  onPick,
  onStartAgent,
  start,
  onClose,
}: {
  /** What the picker stands open for, or nothing while it is shut. */
  pick: TerminalPick | undefined;
  agents: AgentsControl;
  lastUsed: string | undefined;
  onPick: (agentId: string) => void;
  /** Starts a coding agent on the task, the picker's offer where it has none. */
  onStartAgent: () => void;
  /** Whether a coding agent can start on the task now. */
  start: { readonly available: boolean };
  onClose: () => void;
}): React.JSX.Element {
  // Note that a task whose agents are not read yet offers none, nor to start one.
  const read = agents.agents !== undefined;
  const listed = agents.agents ?? [];
  // A pilot task's agents are its pilot's to start, so its picker offers no Start (`startsOwnAgents`).
  const offersStart = startsOwnAgents(agents.mode);
  const [selected, setSelected] = useState("");
  const open = pick !== undefined;
  // Each opening starts on the agent chosen to begin with, or the first.
  const [opened, setOpened] = useState(open);
  if (opened !== open) {
    setOpened(open);
    if (open) {
      setSelected(
        pick.chosen ?? listed[0]?.id ?? (offersStart && start.available ? START_ROW : ""),
      );
    }
  }
  const choose = (run: () => void) => {
    onClose();
    run();
  };
  // Note that a task with no agent offers to start one, and that agents not read yet offer nothing.
  const groups: readonly CommandGroup[] =
    read && listed.length === 0
      ? !offersStart
        ? []
        : [
            {
              id: START_ROW,
              items: [
                {
                  id: START_ROW,
                  words: START_WORDS,
                  label: START_WORDS,
                  icon: <PlusIcon />,
                  disabled: !start.available,
                  onSelect: () => choose(onStartAgent),
                },
              ],
            },
          ]
      : [
          {
            id: AGENTS_GROUP,
            label: "Agents",
            items: listed.map((agent) =>
              agentItem(agent, agents, agent.id === lastUsed, () => choose(() => onPick(agent.id))),
            ),
          },
        ];
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={PICKER_QUESTION}
      placeholder={PICKER_QUESTION}
      replayUnmasked
      groups={groups}
      selected={selected}
      onSelectedChange={setSelected}
      empty={noMatchWords(TERM.AGENT)}
      {...(read ? {} : { loading: readingWords(`the task’s ${TERM.AGENT.many}`) })}
      foot={<PickerFoot />}
    />
  );
}
