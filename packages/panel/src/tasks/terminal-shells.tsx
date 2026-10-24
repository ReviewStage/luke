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
  CONFIRM_LOSS,
  ConfirmDialog,
  ErrorState,
  Fill,
  IconButton,
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  NOTE_LINE_LOOK,
  NoteLine,
  OVER_PANE_WIDTH,
  OverPane,
  PaneBar,
  PanePin,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  Tooltip,
  useConfirmDialog,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import type { ReactNode, RefObject } from "react";
import { rowMenu } from "../desktop/action-menu.js";
import { AgentRef, type AgentSubject } from "./agent-ref.js";
import type { PaneOver } from "./file-view.js";
import { AgentGlyph } from "./tab-look.js";
import type { TerminalSession } from "./use-terminal-session.js";

/**
 * terminal-shells.tsx -- the shells beside a Terminal tab's screen: each one in the agent's sandbox, the one shown marked, and the agent at the foot.
 *
 * A Terminal tab belongs to one agent's sandbox, and so does every shell in
 * its list: the "+" starts another in that same sandbox, and the list never
 * switches agent. A row shows its shell's name, what is running in it or
 * the folder it stands in, and a dot while a command runs there; a press
 * shows it on the screen, its × ends it, and its right-click offers
 * renaming it, a new shell, and ending it. The list folds away beside the
 * screen as a File tab's tree does, and its foot names the agent, or its
 * sandbox where that is stopped or not yet up. Whether the agent works is
 * its glyph's to say, the working mark in its place, so no word beside it
 * repeats it (`state-glyph.tsx`).
 */

/** What a shell's row says under the field it reopens when the service refused its new name. */
const RENAME_REFUSED = "The shell could not be renamed. Try again.";

/** What a Terminal tab's card says under its agent's, before the count of its shells. */
const CARD_FOOT = "Terminal in this agent’s sandbox";

/** What a shell's row is, which names its ⋯ and its menu. */
const SHELL_THING = "Shell";

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

/** What the foot says beside the agent's glyph: its sandbox where that is stopped or still starting, and the agent's name otherwise. */
function footWords(subject: AgentSubject, sandbox: string | undefined): string {
  if (sandbox === SANDBOX_STATE.STOPPED) return "Sandbox stopped";
  if (sandbox === SANDBOX_STATE.STARTING) return "Starting…";
  return subject.name;
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

/** The shells' list in its scroller, which the shells and their placeholder rows both stand in. */
function ShellList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ScrollArea>
      <div className="terminal-shells-rows">
        <List label="Shell list" density={LIST_DENSITY.COMPACT}>
          {children}
        </List>
      </div>
    </ScrollArea>
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
    <Fill className="terminal-shells-wait">
      <SkeletonRegion label={READING_SHELLS}>
        <ShellList>
          {SKELETON_ROWS.map(({ name, detail }) => (
            <ListRow
              key={name}
              leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_GLYPH} />}
              title={<Skeleton width={name} />}
              description={<Skeleton width={detail} />}
            />
          ))}
        </ShellList>
      </SkeletonRegion>
    </Fill>
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
    return (
      <NoteLine look={NOTE_LINE_LOOK.LIST} fill>
        No shells.
      </NoteLine>
    );
  if (state.kind !== TERMINAL_STATE.UNREACHABLE) return <ShellsSkeleton />;
  return (
    <Fill className="terminal-shells-wait" data-failed="">
      <ErrorState>{SHELLS_UNREAD}</ErrorState>
    </Fill>
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
  if (listed.terminals.length === 0)
    return (
      <NoteLine look={NOTE_LINE_LOOK.LIST} fill>
        No shells.
      </NoteLine>
    );
  return (
    <ShellList>
      {listed.terminals.map((shell) => (
        <ShellRow
          key={shell.id}
          shell={shell}
          shown={shell.id === session.shell}
          surfaceOpen={surfaceOpen}
          session={session}
        />
      ))}
    </ShellList>
  );
}

/** One shell's row: its press shows it, its × ends it, and its ⋯, right-click and menu key open its menu. */
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
  const rename = useInlineRename(shell.id, session.onRename);
  const renaming = rename.editing;
  const kill = `End ${shell.title}`;
  // Ending a shell ends what runs in it, which nothing brings back, so it asks first.
  const ending = useConfirmDialog({ subject: true, surfaceOpen }, () => session.onKill(shell.id));
  return (
    <>
      <ListRow
        leading={<GLYPH.TERMINAL />}
        title={
          renaming ? (
            <InlineEdit
              value={rename.asked ?? shell.title}
              label="Shell name"
              editing
              maxLength={TITLE_MAX}
              onEnd={({ value }) => void rename.end(value)}
            />
          ) : (
            shell.title
          )
        }
        description={
          rename.refused ? (
            <span>{RENAME_REFUSED}</span>
          ) : (
            <span className="terminal-shell-detail">{shellDetail(shell)}</span>
          )
        }
        meta={
          shell.running ? (
            <span className="terminal-shell-running" role="img" aria-label="Running" />
          ) : null
        }
        current={shown ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={renaming ? undefined : () => session.onChoose(shell.id)}
        actionsAt={LIST_ROW_ACTIONS.HOVER}
        actions={
          renaming ? null : (
            <Tooltip label={kill}>
              <IconButton icon={<GLYPH.CLOSE />} label={kill} onClick={ending.ask} />
            </Tooltip>
          )
        }
        menu={
          renaming
            ? undefined
            : rowMenu(SHELL_THING, [
                [
                  {
                    label: "Rename",
                    icon: <GLYPH.RENAME />,
                    onSelect: rename.begin,
                  },
                  {
                    label: "New shell",
                    icon: <GLYPH.ADD />,
                    onSelect: session.onCreate,
                  },
                ],
                [
                  {
                    label: "End shell",
                    icon: <GLYPH.DELETE />,
                    danger: true,
                    onSelect: ending.ask,
                  },
                ],
              ])
        }
      />
      <ConfirmDialog
        open
        confirm={ending}
        question={{
          title: `${kill}?`,
          verb: "End shell",
          running: "Ending the shell",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </>
  );
}

export function TerminalShells({
  subject,
  models,
  session,
  onOpenAgent,
  over,
  pane,
  leaving,
  surfaceOpen,
}: {
  subject: AgentSubject;
  models: readonly CatalogModel[] | undefined;
  session: TerminalSession;
  onOpenAgent: () => void;
  /** What the list floating over the screen is handed (`file-view.tsx`); none draws it beside the screen. */
  over: PaneOver | undefined;
  /** The list's box beside the screen, which slides in and out (`usePaneSlide`). */
  pane: RefObject<HTMLElement | null>;
  /** Whether it is on its way out beside the screen. */
  leaving: boolean;
  /** Whether the tab is on screen: a question asked from the list goes as the panel closes. */
  surfaceOpen: boolean;
}): React.JSX.Element {
  const { listed } = session;
  const body = (
    <>
      <PaneBar
        title="Shells"
        actions={
          <Tooltip label="New shell">
            <IconButton
              icon={<GLYPH.ADD />}
              label="New shell"
              disabled={listed?.sandbox !== SANDBOX_STATE.RUNNING}
              onClick={session.onCreate}
            />
          </Tooltip>
        }
      />
      {listed === undefined ? (
        <UnlistedShells state={session.state} />
      ) : (
        <ListedShells
          listed={listed}
          session={session}
          surfaceOpen={surfaceOpen && (over === undefined ? !leaving : over.open)}
        />
      )}
      <div className="terminal-shells-foot">
        <AgentRef
          subject={subject}
          models={models}
          onOpen={onOpenAgent}
          glyph={<AgentGlyph agent={subject.agent} />}
          label={footWords(subject, listed?.sandbox)}
        />
      </div>
    </>
  );
  if (over !== undefined) {
    return (
      <OverPane
        open={over.open}
        peek={over.peek}
        onClose={over.onClose}
        onPointerLeave={over.onPointerLeave}
        toggle={over.toggle}
        label="Shells"
        width={OVER_PANE_WIDTH.COLUMN}
      >
        {body}
      </OverPane>
    );
  }
  return (
    <PanePin
      ref={pane}
      className="terminal-shells"
      aria-label="Shells"
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
      onPin={undefined}
    >
      {body}
    </PanePin>
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
 * How an agent's sandbox stands, as a terminal's row in the panel's "+" says
 * it after the agent's name: its shells as the window last read them, or its
 * sandbox stopped or not yet up; nothing before the first read. Whether the
 * agent works is the row's glyph's to say.
 */
export function TerminalStanding({ agent }: { agent: CodingAgentSummary }): React.JSX.Element {
  const listed = useAtomValue(sandboxRead(agent.id));
  const sandbox =
    listed === undefined
      ? undefined
      : listed.sandbox === SANDBOX_STATE.RUNNING
        ? `${listed.terminals.length} ${listed.terminals.length === 1 ? "shell" : "shells"}`
        : listed.sandbox === SANDBOX_STATE.STOPPED
          ? "Sandbox stopped"
          : "No sandbox yet";
  return <>{sandbox}</>;
}
