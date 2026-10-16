import { useAtomValue } from "@effect/atom-react";
import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { sandboxRead } from "@luke/features/terminal-store";
import { SANDBOX_STATE, type TerminalSummary } from "@luke/features/terminal-wire";
import { CloseIcon, PlusIcon } from "@luke/ui";
import { PencilIcon, TerminalIcon, Trash2Icon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { ActionMenu, useActionMenu } from "../desktop/action-menu";
import type { FloatingBox } from "../desktop/hover-pane";
import { TaskNameField } from "../desktop/task-name-field";
import { ConfirmDialog, useConfirmDialog } from "../settings/confirm-dialog";
import { Tooltip } from "../tooltip";
import { AgentRef, type AgentSubject } from "./agent-ref";
import { agentStillWriting } from "./coding-agent-model";
import { AgentGlyph } from "./tab-look";
import type { TerminalSession } from "./use-terminal-session";

/**
 * terminal-shells.tsx -- the shells beside a Terminal tab's screen: each one in the agent's sandbox, the one shown marked, and the agent's state at the foot.
 *
 * A Terminal tab belongs to one agent's sandbox, and so does every shell in
 * its list: the "+" starts another in that same sandbox, and the list never
 * switches agent. A row shows its shell's name, what is running in it or
 * the folder it stands in, and a dot while a command runs there; a press
 * shows it on the screen, its × ends it, and its right-click offers
 * renaming it, a new shell, and ending it. The list folds away beside the
 * screen as a File tab's tree does, and its foot names the agent and where
 * it stands.
 */

/** What a Terminal tab's card says under its agent's, before the count of its shells. */
const CARD_FOOT = "Terminal in this agent’s sandbox";

/** The most characters of a shell's name, as the service holds it. */
const TITLE_MAX = 60;

/** What the foot says of the agent: at work, or how its sandbox stands while it is not. */
function standingWords(subject: AgentSubject, sandbox: string | undefined): string {
  if (subject.agent !== undefined && agentStillWriting(subject.agent.status)) return "Working…";
  if (sandbox === SANDBOX_STATE.STOPPED) return "Sandbox stopped";
  if (sandbox === SANDBOX_STATE.STARTING) return "Starting…";
  return "Idle";
}

/** What a row says under a shell's name: what is running in it, or the folder it stands in. */
function shellDetail(shell: TerminalSummary): string {
  if (shell.running) return shell.command;
  return (
    shell.cwd
      .split("/")
      .filter((part) => part !== "")
      .at(-1) ?? shell.cwd
  );
}

/** One shell's row: its press shows it, its × ends it, and its right-click opens its menu. */
function ShellRow({
  shell,
  shown,
  surfaceOpen,
  session,
}: {
  shell: TerminalSummary;
  shown: boolean;
  /** Whether the tab the list stands in is on screen, which the end's question goes with. */
  surfaceOpen: boolean;
  session: Pick<TerminalSession, "onChoose" | "onCreate" | "onRename" | "onKill">;
}): React.JSX.Element {
  const row = useRef<HTMLButtonElement>(null);
  const menu = useActionMenu(true);
  const [renaming, setRenaming] = useState(false);
  const kill = `End ${shell.title}`;
  // Ending a shell ends what runs in it, which nothing brings back, so it asks first.
  const ending = useConfirmDialog({ subject: true, surfaceOpen }, () => session.onKill(shell.id));
  return (
    <li className="terminal-shell" aria-current={shown ? "true" : undefined}>
      <TerminalIcon className="terminal-shell-glyph" aria-hidden="true" />
      {renaming ? (
        <TaskNameField
          name={shell.title}
          className="terminal-shell-field"
          label="Shell name"
          maxLength={TITLE_MAX}
          onEnd={({ name }) => {
            setRenaming(false);
            if (name !== undefined) session.onRename(shell.id, name);
          }}
        />
      ) : (
        <button
          ref={row}
          type="button"
          className="terminal-shell-row"
          onClick={() => session.onChoose(shell.id)}
          onContextMenu={menu.contextMenu(row)}
        >
          <span className="terminal-shell-name">{shell.title}</span>
          <span className="terminal-shell-detail">{shellDetail(shell)}</span>
        </button>
      )}
      <span className="terminal-shell-mark">
        {shell.running ? (
          <span className="terminal-shell-running" role="img" aria-label="Running" />
        ) : null}
      </span>
      <Tooltip label={kill}>
        <button
          type="button"
          className="icon-button terminal-shell-kill"
          aria-label={kill}
          onClick={ending.ask}
        >
          <CloseIcon />
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={shell.title}
          menu={menu.drawn}
          onClose={menu.close}
          groups={[
            [
              {
                label: "Rename",
                icon: <PencilIcon aria-hidden="true" />,
                onSelect: () => setRenaming(true),
              },
              {
                label: "New shell",
                icon: <PlusIcon />,
                onSelect: session.onCreate,
              },
            ],
            [
              {
                label: "End shell",
                icon: <Trash2Icon aria-hidden="true" />,
                danger: true,
                onSelect: ending.ask,
              },
            ],
          ]}
        />
      )}
      <ConfirmDialog
        confirm={ending}
        question={{ title: `${kill}?`, verb: "End shell", running: "Ending the shell" }}
      />
    </li>
  );
}

export function TerminalShells({
  subject,
  models,
  session,
  onOpenAgent,
  pane,
  float,
  leaving,
  surfaceOpen,
}: {
  subject: AgentSubject;
  models: readonly CatalogModel[] | undefined;
  session: TerminalSession;
  onOpenAgent: () => void;
  /** The list's box, which slides in and out (`usePaneSlide`). */
  pane: RefObject<HTMLElement | null>;
  /** What the list answers while it may float over the screen (`hover-pane.ts`). */
  float: FloatingBox;
  leaving: boolean;
  /** Whether the tab is on screen: a question asked from the list goes as the panel closes. */
  surfaceOpen: boolean;
}): React.JSX.Element {
  const { listed } = session;
  const shells = listed?.terminals ?? [];
  return (
    <aside
      ref={pane}
      className="terminal-shells"
      aria-label="Shells"
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
      onPointerDown={float.onPointerDown}
      onPointerLeave={float.onPointerLeave}
      onKeyDown={float.onKeyDown}
    >
      <div className="terminal-shells-head">
        Shells
        <Tooltip label="New shell">
          <button
            type="button"
            className="icon-button"
            aria-label="New shell"
            disabled={listed?.sandbox !== SANDBOX_STATE.RUNNING}
            onClick={session.onCreate}
          >
            <PlusIcon />
          </button>
        </Tooltip>
      </div>
      {listed === undefined ? null : shells.length === 0 ? (
        <p className="terminal-shells-none">No shells.</p>
      ) : (
        <ul className="terminal-shells-rows">
          {shells.map((shell) => (
            <ShellRow
              key={shell.id}
              shell={shell}
              shown={shell.id === session.shell}
              surfaceOpen={surfaceOpen && !leaving}
              session={session}
            />
          ))}
        </ul>
      )}
      <div className="terminal-shells-foot">
        <AgentRef subject={subject} models={models} onOpen={onOpenAgent}>
          <AgentGlyph agent={subject.agent} />
          <span className="agent-ref-name">{standingWords(subject, listed?.sandbox)}</span>
        </AgentRef>
      </div>
    </aside>
  );
}

/**
 * The line a Terminal tab's card says under its agent's: whose sandbox the
 * shells run in, and how many there are as the tab last read them, a count
 * it says only once it has one.
 */
export function TerminalCardFoot({ agentId }: { agentId: string }): React.JSX.Element {
  const listed = useAtomValue(sandboxRead(agentId));
  const count = listed?.sandbox === SANDBOX_STATE.RUNNING ? listed.terminals.length : undefined;
  const shells = count === undefined ? "" : ` · ${count} ${count === 1 ? "shell" : "shells"}`;
  return (
    <>
      {CARD_FOOT}
      {shells}
    </>
  );
}

/**
 * How an agent and its sandbox stand, as a terminal's row in the panel's "+"
 * says it after the agent's name: at work or idle, then its shells as the
 * window last read them, or its sandbox stopped.
 */
export function TerminalStanding({ agent }: { agent: CodingAgentSummary }): React.JSX.Element {
  const listed = useAtomValue(sandboxRead(agent.id));
  const working = agentStillWriting(agent.status) ? "Working" : "Idle";
  const sandbox =
    listed === undefined
      ? undefined
      : listed.sandbox === SANDBOX_STATE.RUNNING
        ? `${listed.terminals.length} ${listed.terminals.length === 1 ? "shell" : "shells"}`
        : listed.sandbox === SANDBOX_STATE.STOPPED
          ? "Sandbox stopped"
          : "No sandbox yet";
  return <>{sandbox === undefined ? working : `${working} · ${sandbox}`}</>;
}
