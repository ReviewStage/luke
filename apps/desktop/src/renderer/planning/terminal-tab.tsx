import { SHORTCUT_KEY } from "#shared/shortcuts";
import { Shortcut } from "../shortcut";
import { AgentRef, agentSubject, NOTHING_HELD } from "./agent-ref";
import { AgentGlyph } from "./tab-look";
import { TERMINAL_LOAD_FAILED } from "./terminal-bundle";
import { type TerminalAction, type TerminalBar, terminalLook } from "./terminal-model";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useTerminalSession } from "./use-terminal-session";
import { WorkingTime } from "./working-time";

/**
 * terminal-tab.tsx -- an agent's Terminal tab: a shell in the agent's own sandbox, under a bar naming the agent and where the connection stands.
 *
 * The tab is the File tab's frame: a bar across its top, here naming the
 * agent whose sandbox it is (`AgentRef`, which hangs the agent's card and
 * opens its tab), "sandbox", and the connection in a word or two; then the
 * terminal's screen (`terminal/`), which fills the rest. A state with
 * something to do lays one slim bar over the screen with one text action
 * and its key, and the terminal prints a state with nothing to do as a dim
 * line at the end of its own scrollback (`terminal-model.ts`). The tab
 * connects only while it is shown (`use-terminal-session.ts`).
 *
 * The whole tab is left out of the screen recording, because the shell's
 * own words are drawn on a canvas the text masking cannot reach, and a
 * shell prints whatever its commands print.
 */

/** The slim bar over the screen: its words, a count or a note, and its one action with its key. */
function StateBar({
  bar,
  onAction,
}: {
  bar: TerminalBar;
  onAction: (action: TerminalAction) => void;
}): React.JSX.Element {
  const { action } = bar;
  return (
    <div className="terminal-bar" role="status" data-late={String(bar.late)}>
      {bar.busy ? (
        <span className="terminal-bar-busy" aria-hidden="true">
          ⋯
        </span>
      ) : null}
      <span className="terminal-bar-words">{bar.words}</span>
      <span className="terminal-bar-end">
        {bar.since === undefined ? null : (
          <WorkingTime startedAt={bar.since} className="terminal-bar-note" />
        )}
        {bar.note === undefined ? null : <span className="terminal-bar-note">{bar.note}</span>}
        {action === undefined ? null : (
          <button
            type="button"
            className="terminal-bar-action"
            onClick={() => onAction(action.kind)}
          >
            {action.label}
            <Shortcut
              chord={{ key: SHORTCUT_KEY.ENTER, bare: true }}
              className="terminal-bar-key"
            />
          </button>
        )}
      </span>
    </div>
  );
}

export function TerminalTab({
  agentId,
  agents,
  shown,
  onOpenAgent,
  onClose,
}: {
  agentId: string;
  agents: CodingAgentsControl;
  /** Whether the tab is on screen, the one moment it holds a connection. */
  shown: boolean;
  /** Opens the agent's own tab in the plan's column. */
  onOpenAgent: () => void;
  /** Closes the tab, as an archived agent's does. */
  onClose: () => void;
}): React.JSX.Element {
  const subject = agentSubject(agents, agentId, NOTHING_HELD, false);
  const session = useTerminalSession(agentId, shown, onClose);
  const look = terminalLook(session.state);
  return (
    <div className="terminal-tab file-view ph-no-capture" data-state={session.state.kind}>
      <header className="file-view-bar">
        <span className="terminal-tab-title">
          <AgentRef subject={subject} models={agents.models} onOpen={onOpenAgent}>
            <AgentGlyph agent={subject.agent} />
            <span className="agent-ref-name terminal-tab-agent">{subject.name}</span>
          </AgentRef>
          <span className="terminal-tab-standing">· sandbox · {look.words}</span>
        </span>
      </header>
      <div className="terminal-tab-body">
        {look.bar === undefined ? null : <StateBar bar={look.bar} onAction={session.onAction} />}
        {session.failed ? (
          <p className="terminal-tab-failed">{TERMINAL_LOAD_FAILED}</p>
        ) : (
          <div ref={session.screen} className="terminal-tab-screen" data-dim={String(look.dim)} />
        )}
      </div>
    </div>
  );
}
