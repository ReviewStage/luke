import { useAtomValue } from "@effect/atom-react";
import type { AgentSummary } from "@repo/features/agent-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TERMINAL_STATE, type TerminalState } from "@repo/features/terminal-model";
import { sandboxRead } from "@repo/features/terminal-store";
import {
  SANDBOX_STATE,
  type TerminalSummary,
  type TerminalsAnswer,
} from "@repo/features/terminal-wire";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
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
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode, RefObject } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { rowMenu } from "../desktop/action-menu.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { renameWrite } from "../rename-write.js";
import { AgentRef, type AgentSubject } from "./agent-ref.js";
import type { PaneOver } from "./file-view.js";
import { AgentGlyph } from "./tab-look.js";
import type { TerminalSession } from "./use-terminal-session.js";

const RENAME_REFUSED = "The shell could not be renamed. Try again.";

const CARD_FOOT = "Terminal in this agent’s sandbox";

const SHELL_THING = "Shell";

const END_SHELL = "End shell";

const TITLE_MAX = 60;

const READING_SHELLS = "Reading the shells…";

const SHELLS_UNREAD = "The shells could not be read.";

const SKELETON_ROWS = [
  { name: "55%", detail: "35%" },
  { name: "45%", detail: "50%" },
] as const;

const SKELETON_GLYPH = "var(--ui-control-icon)";

function footWords(subject: AgentSubject, sandbox: string | undefined): string {
  if (sandbox === SANDBOX_STATE.STOPPED) return "Sandbox stopped";
  if (sandbox === SANDBOX_STATE.STARTING) return "Starting…";
  return subject.name;
}

function shellDetail(shell: TerminalSummary): string {
  if (shell.running) return shell.command;
  return (
    shell.cwd
      .split("/")
      .filter((part) => part !== "")
      .at(-1) ?? shell.cwd
  );
}

function ShellList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ScrollArea>
      <div className="p-tight-gap">
        <List label="Shell list" density={LIST_DENSITY.COMPACT}>
          {children}
        </List>
      </div>
    </ScrollArea>
  );
}

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

function UnlistedShells({ state }: { state: TerminalState }): React.JSX.Element {
  if (state.kind === TERMINAL_STATE.STOPPED)
    return (
      <NoteLine look={NOTE_LINE_LOOK.LIST} fill>
        No shells.
      </NoteLine>
    );
  if (state.kind !== TERMINAL_STATE.UNREACHABLE) return <ShellsSkeleton />;
  return (
    <Fill className="terminal-shells-wait px-list-inset py-row-inset" data-failed="">
      <ErrorState failure={unreadShown(FAILURE_SURFACE.TERMINAL_SHELLS_READ)}>
        {SHELLS_UNREAD}
      </ErrorState>
    </Fill>
  );
}

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

function ShellRow({
  shell,
  shown,
  surfaceOpen,
  session,
}: {
  shell: TerminalSummary;
  shown: boolean;
  surfaceOpen: boolean;
  session: Pick<TerminalSession, "onChoose" | "rename" | "kill">;
}): React.JSX.Element {
  const renameMutation = useMutation(session.rename.options);
  const killing = useMutation(session.kill);
  const rename = useInlineRename(shell.id, renameWrite(renameMutation, session.rename));
  const renaming = rename.editing;
  const coarse = useCoarsePointer();
  const kill = `End ${shell.title}`;
  const endingAct = useConfirmAct(killing, {
    send: () => killing.mutateAsync(shell.id),
    answered: sameAnswer,
  });
  const ending = useConfirmDialog(
    { subject: true, surfaceOpen },
    endingAct,
    confirmFailure(FAILURE_SURFACE.TERMINAL_STOP),
  );
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
            <span className="terminal-shell-detail font-mono">{shellDetail(shell)}</span>
          )
        }
        meta={
          shell.running ? (
            <span
              className="terminal-shell-running me-block-gap block size-1.5 rounded-ui-full bg-working"
              role="img"
              aria-label="Running"
            />
          ) : null
        }
        current={shown ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={renaming ? undefined : () => session.onChoose(shell.id)}
        more={!coarse}
        actionsAt={LIST_ROW_ACTIONS.HOVER}
        actions={
          renaming ? null : (
            <Tooltip label={END_SHELL}>
              <IconButton icon={<GLYPH.CLOSE />} label={END_SHELL} onClick={ending.ask} />
            </Tooltip>
          )
        }
        menu={
          renaming
            ? undefined
            : rowMenu(
                SHELL_THING,
                [
                  [commandAction(PANEL_COMMAND.RENAME, rename.begin, false)],
                  [
                    {
                      label: END_SHELL,
                      icon: <GLYPH.DELETE />,
                      danger: true,
                      onSelect: ending.ask,
                    },
                  ],
                ],
                undefined,
                true,
              )
        }
      />
      <ConfirmDialog
        open
        confirm={ending}
        question={{
          title: `${kill}?`,
          body: `Whatever is running in it stops, and its output goes. ${IRREVERSIBLE_WORDS}`,
          verb: END_SHELL,
          running: "Ending the shell",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
          titleReplayMasked: true,
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
  over: PaneOver | undefined;
  pane: RefObject<HTMLElement | null>;
  leaving: boolean;
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
      <div className="terminal-shells-foot flex border-t border-border px-list-inset py-row-inset text-caption font-ui-semibold text-foreground">
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
      className="terminal-shells flex w-shells-pane min-w-0 flex-none flex-col border-l border-border bg-well data-leaving:absolute data-leaving:inset-y-0 data-leaving:right-0"
      aria-label="Shells"
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
      onPin={undefined}
    >
      {body}
    </PanePin>
  );
}

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

export function TerminalStanding({ agent }: { agent: AgentSummary }): React.JSX.Element {
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
