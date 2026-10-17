import { useAtomValue } from "@effect/atom-react";
import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { sandboxRead } from "@luke/features/terminal-store";
import { SANDBOX_STATE, type SandboxState } from "@luke/features/terminal-wire";
import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { PlusIcon, SearchIcon } from "@luke/ui";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { Shortcut } from "../shortcut";
import { agentStillWriting, agentTabLabel } from "./coding-agent-model";
import { AgentGlyph } from "./tab-look";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * terminal-picker.tsx -- the palette asking which coding agent's sandbox a terminal is for, when the rules leave it to the developer.
 *
 * A terminal belongs to one agent's sandbox (`terminal-entry.ts`), and with
 * several agents on the task New terminal asks, as ⌘J does before any
 * terminal was used. It is the command palette's own dialog and rows: each
 * agent as its tab wears it, its glyph and its name, with whether it works
 * and how its sandbox stands, the agent whose terminal was used last chosen
 * to begin with and saying so. A task with no agent offers to start one.
 * How each sandbox stands is read as the picker opens, which never wakes
 * one.
 */

/** The value of the row that starts an agent, which no agent's id spells. */
const START_ROW = "start-agent";

/** What the picker's field asks. */
const PICKER_QUESTION = "New terminal in which agent’s sandbox?";

/** How a sandbox stands, said after whether its agent works. */
const SANDBOX_WORDS = {
  [SANDBOX_STATE.RUNNING]: "sandbox running",
  [SANDBOX_STATE.STOPPED]: "sandbox stopped",
  [SANDBOX_STATE.STARTING]: "no sandbox yet",
} as const satisfies Record<SandboxState, string>;

/** The row's words after the name: working or idle, the sandbox as last read, and whether it was used last. */
function rowDetail(agent: CodingAgentSummary, sandbox: SandboxState | undefined, last: boolean) {
  const words = [
    agentStillWriting(agent.status) ? "Working" : "Idle",
    sandbox === undefined ? undefined : SANDBOX_WORDS[sandbox],
    last ? "last used" : undefined,
  ];
  return words.filter((word) => word !== undefined).join(" · ");
}

/** One agent's row: its look, and its standing read from what the window last read of its sandbox. */
function AgentRow({
  agent,
  name,
  last,
  onPick,
}: {
  agent: CodingAgentSummary;
  name: string;
  last: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const sandbox = useAtomValue(sandboxRead(agent.id))?.sandbox;
  return (
    <Command.Item className="menu-item" value={agent.id} keywords={[name]} onSelect={onPick}>
      <span className="menu-item-glyph">
        <AgentGlyph agent={agent} />
      </span>
      <span className="command-palette-name">{name}</span>
      <span className="command-palette-detail">{rowDetail(agent, sandbox, last)}</span>
    </Command.Item>
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
  const [query, setQuery] = useState("");
  const open = pick !== undefined;
  // Each opening starts on the agent chosen to begin with, or the first, with
  // nothing typed, and reads how every sandbox stands.
  const [opened, setOpened] = useState(open);
  if (opened !== open) {
    setOpened(open);
    if (open) {
      setSelected(pick.chosen ?? listed[0]?.id ?? (start.available ? START_ROW : ""));
      setQuery("");
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
  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={PICKER_QUESTION}
      value={selected}
      onValueChange={setSelected}
      loop
      overlayClassName="command-palette-backdrop"
      contentClassName="command-palette terminal-picker"
      inert={!open}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="command-palette-search">
        <SearchIcon />
        <Command.Input placeholder={PICKER_QUESTION} value={query} onValueChange={setQuery} />
      </div>
      <Command.List className="command-palette-list scroll-fade" label="Coding agents">
        {read ? (
          <Command.Empty className="command-palette-empty">No agents match.</Command.Empty>
        ) : null}
        {!read ? (
          <div className="command-palette-empty">Reading the task’s agents…</div>
        ) : listed.length === 0 ? (
          <Command.Item
            className="menu-item"
            value={START_ROW}
            disabled={!start.available}
            onSelect={() => choose(onStartAgent)}
          >
            <span className="menu-item-glyph">
              <PlusIcon />
            </span>
            <span className="command-palette-name">Start a coding agent</span>
            {start.available || start.reason === undefined ? null : (
              <span className="command-palette-detail">{start.reason}</span>
            )}
          </Command.Item>
        ) : (
          <Command.Group heading="Coding agents">
            {listed.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                name={agentTabLabel(agent, agents.models)}
                last={agent.id === lastUsed}
                onPick={() => choose(() => onPick(agent.id))}
              />
            ))}
          </Command.Group>
        )}
      </Command.List>
      <div className="command-palette-footer" aria-hidden="true">
        <span className="command-palette-footer-hint">
          <span className="command-palette-footer-keys">
            <Shortcut chord={{ key: SHORTCUT_KEY.ENTER, bare: true }} />
          </span>
          Open terminal
        </span>
        <span className="command-palette-footer-hint">
          <span className="command-palette-footer-keys">
            <Shortcut chord={{ key: SHORTCUT_KEY.ESCAPE, bare: true }} />
          </span>
          Close
        </span>
      </div>
    </Command.Dialog>
  );
}
