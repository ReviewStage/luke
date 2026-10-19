import { useAtomValue } from "@effect/atom-react";
import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { TERMINAL_STATE, type TerminalState } from "@luke/features/terminal-model";
import { sandboxRead } from "@luke/features/terminal-store";
import {
  SANDBOX_STATE,
  type TerminalSummary,
  type TerminalsAnswer,
} from "@luke/features/terminal-wire";
import {
  CloseIcon,
  ConfirmDialog,
  ErrorState,
  IconButton,
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  PlusIcon,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { PencilIcon, TerminalIcon, Trash2Icon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { ActionMenu } from "../desktop/action-menu.js";
import type { FloatingBox } from "../desktop/hover-pane.js";
import { Tooltip } from "../tooltip.js";
import { AgentRef, type AgentSubject } from "./agent-ref.js";
import { agentStillWriting } from "./coding-agent-model.js";
import { AgentGlyph } from "./tab-look.js";
import type { TerminalSession } from "./use-terminal-session.js";

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

/** What the list says to a reader while the shells are first read. */
const READING_SHELLS = "Reading the shells…";

/** What the list says where the shells could not be read; the screen's bar beside it holds Retry. */
const SHELLS_UNREAD = "The shells could not be read.";

/** The rows standing in for shells while they are read: a name's and a folder's widths each, as a list of a few reads. */
const SKELETON_ROWS = [
  { name: "55%", detail: "35%" },
  { name: "45%", detail: "50%" },
] as const;

/** How wide a row's glyph stands while it is read: the glyph's own size. */
const SKELETON_GLYPH = "var(--luke-control-icon)";

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

/**
 * The list while the shells are first read: rows in a shell's own row, a
 * block where its glyph, its name, and its folder will stand, so the shells
 * land where the blocks stood. The rows open nothing and the region says
 * what is being read.
 */
function ShellsSkeleton(): React.JSX.Element {
  return (
    <div className="terminal-shells-wait">
      <SkeletonRegion label={READING_SHELLS}>
        <ScrollArea>
          <div className="terminal-shells-rows">
            <List label="Shell list" density={LIST_DENSITY.COMPACT}>
              {SKELETON_ROWS.map(({ name, detail }) => (
                <ListRow
                  key={name}
                  leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_GLYPH} />}
                  title={<Skeleton width={name} />}
                  description={<Skeleton width={detail} />}
                />
              ))}
            </List>
          </div>
        </ScrollArea>
      </SkeletonRegion>
    </div>
  );
}

/**
 * The list's body before a read has listed the shells: blocks while one is
 * out, none where the sandbox stopped, or the failure where the read did not
 * land, which the screen's bar offers Retry for. Note that a refused list leaves the tab unreachable
 * rather than listed, so the tab's state is what says the read failed.
 */
function UnlistedShells({ state }: { state: TerminalState }): React.JSX.Element {
  // A sandbox stopped before the list answered holds no shells until it is resumed.
  if (state.kind === TERMINAL_STATE.STOPPED)
    return <p className="terminal-shells-none">No shells.</p>;
  if (state.kind !== TERMINAL_STATE.UNREACHABLE) return <ShellsSkeleton />;
  return (
    <div className="terminal-shells-wait" data-failed="">
      <ErrorState>{SHELLS_UNREAD}</ErrorState>
    </div>
  );
}

/** The list's body once the shells are listed: a row each, or none said. */
function ListedShells({
  listed,
  session,
  surfaceOpen,
}: {
  listed: TerminalsAnswer;
  session: TerminalSession;
  surfaceOpen: boolean;
}): React.JSX.Element {
  if (listed.terminals.length === 0) return <p className="terminal-shells-none">No shells.</p>;
  return (
    <ScrollArea>
      <div className="terminal-shells-rows">
        <List label="Shell list" density={LIST_DENSITY.COMPACT}>
          {listed.terminals.map((shell) => (
            <ShellRow
              key={shell.id}
              shell={shell}
              shown={shell.id === session.shell}
              surfaceOpen={surfaceOpen}
              session={session}
            />
          ))}
        </List>
      </div>
    </ScrollArea>
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
  const row = useRef<HTMLElement | null>(null);
  const menu = useMenu(true);
  const [renaming, setRenaming] = useState(false);
  const kill = `End ${shell.title}`;
  // Ending a shell ends what runs in it, which nothing brings back, so it asks first.
  const ending = useConfirmDialog({ subject: true, surfaceOpen }, () => session.onKill(shell.id));
  return (
    <>
      <ListRow
        ref={(element) => {
          row.current = element;
        }}
        leading={<TerminalIcon />}
        title={
          renaming ? (
            <InlineEdit
              value={shell.title}
              label="Shell name"
              editing
              maxLength={TITLE_MAX}
              onEnd={({ value }) => {
                setRenaming(false);
                if (value !== undefined) session.onRename(shell.id, value);
              }}
            />
          ) : (
            shell.title
          )
        }
        description={<span className="terminal-shell-detail">{shellDetail(shell)}</span>}
        meta={
          shell.running ? (
            <span className="terminal-shell-running" role="img" aria-label="Running" />
          ) : null
        }
        current={shown ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={renaming ? undefined : () => session.onChoose(shell.id)}
        contextMenu={renaming ? undefined : menu.contextMenu(row)}
        actionsAt={LIST_ROW_ACTIONS.HOVER}
        menuOpen={menu.open !== undefined}
        actions={
          renaming ? null : (
            <Tooltip label={kill}>
              <IconButton icon={<CloseIcon />} label={kill} onClick={ending.ask} />
            </Tooltip>
          )
        }
      />
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
    </>
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
        <span className="terminal-shells-title">Shells</span>
        <Tooltip label="New shell">
          <IconButton
            icon={<PlusIcon />}
            label="New shell"
            disabled={listed?.sandbox !== SANDBOX_STATE.RUNNING}
            onClick={session.onCreate}
          />
        </Tooltip>
      </div>
      {listed === undefined ? (
        <UnlistedShells state={session.state} />
      ) : (
        <ListedShells listed={listed} session={session} surfaceOpen={surfaceOpen && !leaving} />
      )}
      <div className="terminal-shells-foot">
        <AgentRef
          subject={subject}
          models={models}
          onOpen={onOpenAgent}
          glyph={<AgentGlyph agent={subject.agent} />}
          label={standingWords(subject, listed?.sandbox)}
        />
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
