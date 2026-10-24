import { useAtomValue } from "@effect/atom-react";
import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { sandboxRead } from "@luke/features/terminal-store";
import { noMatchWords, readingWords, TERM } from "@luke/features/words";
import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { PlusIcon, Shortcut } from "@luke/ui";
import { CommandDialog, type CommandGroup, type CommandItem } from "@luke/ui/command";
import { useEffect, useState } from "react";
import { AgentCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { agentName } from "./coding-agent-model.js";
import { AgentGlyph, agentEndMark } from "./tab-look.js";
import { TerminalStanding } from "./terminal-shells.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";

/**
 * terminal-picker.tsx -- the palette asking which coding agent's sandbox a terminal is for, when the rules leave it to the developer.
 *
 * A terminal belongs to one agent's sandbox (`terminal-entry.ts`), and with
 * several agents on the task New terminal asks, as ⌘J does before any
 * terminal was used. It is the command palette's own dialog and rows: each
 * agent as its tab wears it, its glyph, its name and its failed mark, its
 * card hung beside it, with how its sandbox stands in the panel's own words, the agent whose terminal was used last chosen to begin with and
 * saying so. Whether the agent works is its glyph's to say, the working mark
 * in its place, so no word repeats it. A task with no agent offers to start one.
 * How each sandbox stands is read as the picker opens, which never wakes
 * one.
 */

/** The value of the row that starts an agent, which no agent's id spells. */
const START_ROW = "start-agent";

/** The start row's words, and the key of the group that holds it. */
const START_WORDS = "Start a coding agent";

/** The key of the group of agents. */
const AGENTS_GROUP = "coding-agents";

/** What the picker's field asks. */
const PICKER_QUESTION = "New terminal in which agent’s sandbox?";

/** The row's words after the name: the sandbox as the panel's "+" says it, and whether it was used last; none where neither is known. */
function RowDetail({
  agent,
  last,
}: {
  agent: CodingAgentSummary;
  last: boolean;
}): React.JSX.Element | null {
  const listed = useAtomValue(sandboxRead(agent.id));
  if (listed === undefined && !last) return null;
  return (
    <>
      {listed === undefined ? null : <TerminalStanding agent={agent} />}
      {listed !== undefined && last ? " · " : null}
      {last ? "last used" : null}
    </>
  );
}

/** One agent's row: its look, its failed mark, and the card its hover hangs, with its standing read from what the window last read of its sandbox. */
function agentItem(
  agent: CodingAgentSummary,
  agents: CodingAgentsControl,
  last: boolean,
  onPick: () => void,
): CommandItem {
  const name = agentName(agent, agents.models);
  return {
    id: agent.id,
    words: name,
    label: name,
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
    <>
      <span aria-hidden="true">
        <Shortcut chord={{ key: SHORTCUT_KEY.ENTER, bare: true }} /> Open terminal
      </span>
      <span aria-hidden="true">
        <Shortcut chord={{ key: SHORTCUT_KEY.ESCAPE, bare: true }} /> Close
      </span>
    </>
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
  readSandbox,
  onPick,
  onStartAgent,
  start,
  onClose,
}: {
  /** What the picker stands open for, or nothing while it is shut. */
  pick: TerminalPick | undefined;
  agents: CodingAgentsControl;
  lastUsed: string | undefined;
  /** Reads how one agent's sandbox stands, into what the window last read of it. */
  readSandbox: (agentId: string) => void;
  onPick: (agentId: string) => void;
  /** Starts a coding agent on the task, the picker's offer where it has none. */
  onStartAgent: () => void;
  /** Whether a coding agent can start on the task now, and why not where it cannot. */
  start: { readonly available: boolean; readonly reason: string | undefined };
  onClose: () => void;
}): React.JSX.Element {
  // Note that a task whose agents are not read yet offers none, nor to start one.
  const read = agents.agents !== undefined;
  const listed = agents.agents ?? [];
  const [selected, setSelected] = useState("");
  const open = pick !== undefined;
  // Each opening starts on the agent chosen to begin with, or the first, and reads how every sandbox stands.
  const [opened, setOpened] = useState(open);
  if (opened !== open) {
    setOpened(open);
    if (open) {
      setSelected(pick.chosen ?? listed[0]?.id ?? (start.available ? START_ROW : ""));
    }
  }
  useEffect(() => {
    if (!open) return;
    for (const agent of listed) readSandbox(agent.id);
  }, [open, listed, readSandbox]);
  const choose = (run: () => void) => {
    onClose();
    run();
  };
  // Note that a task with no agent offers to start one, and that agents not read yet offer nothing.
  const groups: readonly CommandGroup[] =
    read && listed.length === 0
      ? [
          {
            id: START_ROW,
            items: [
              {
                id: START_ROW,
                words: START_WORDS,
                label: START_WORDS,
                icon: <PlusIcon />,
                detail: start.available ? undefined : start.reason,
                disabled: !start.available,
                onSelect: () => choose(onStartAgent),
              },
            ],
          },
        ]
      : [
          {
            id: AGENTS_GROUP,
            label: "Coding agents",
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
      groups={groups}
      selected={selected}
      onSelectedChange={setSelected}
      empty={noMatchWords(TERM.AGENT)}
      {...(read ? {} : { loading: readingWords(`the task’s ${TERM.AGENT.many}`) })}
      foot={<PickerFoot />}
    />
  );
}
