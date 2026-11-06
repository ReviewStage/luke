import { useAtomValue } from "@effect/atom-react";
import type { CatalogModel } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
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
  Tooltip,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import type { ReactNode, RefObject } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { rowMenu } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { AgentRef, type AgentSubject } from "./agent-ref.js";
import type { PaneOver } from "./file-view.js";
import { AgentGlyph } from "./tab-look.js";
import { type HeldShell, shellsHeld } from "./terminal-held.js";
import type { TerminalSession } from "./use-terminal-session.js";

/**
 * terminal-shells.tsx -- the shells beside a Terminal tab's screen: each one this window opened on this Mac in the agent's mirror, the one shown marked, and the agent at the foot.
 *
 * A Terminal tab belongs to one agent's mirror, and so does every shell in
 * its list: the "+" opens another in that same folder, and the list never
 * switches agent. A row shows its shell's name; a press shows it on the
 * screen, its × ends it, and its right-click offers renaming it and ending
 * it. The list folds away beside the screen as a File tab's tree does, and
 * its foot names the agent. Whether the agent works is
 * its glyph's to say, the working mark in its place, so no word beside it
 * repeats it (`state-glyph.tsx`).
 */

/** What a shell's row is, which names its ⋯ and its menu. */
const SHELL_THING = "Shell";

/** What ends a shell, as its row's hover × and its menu both say it. */
const END_SHELL = "End shell";

/** The most characters of a shell's name. */
const TITLE_MAX = 60;

/** The shells' list in its scroller, which the shells and their placeholder rows both stand in. */
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

/** The list's body once the shells are listed: a row each, or none said. */
function ListedShells({
  listed,
  session,
  surfaceOpen,
}: {
  listed: readonly HeldShell[];
  session: TerminalSession;
  surfaceOpen: boolean;
}): React.JSX.Element {
  if (listed.length === 0)
    return (
      <NoteLine look={NOTE_LINE_LOOK.LIST} fill>
        No shells.
      </NoteLine>
    );
  return (
    <ShellList>
      {listed.map((shell) => (
        <ShellRow
          key={shell.terminalId}
          shell={shell}
          shown={shell.terminalId === session.shell}
          surfaceOpen={surfaceOpen}
          session={session}
        />
      ))}
    </ShellList>
  );
}

/** One shell's row: its press shows it, its × ends it, and its ⋯, right-click, long press and menu key open its menu, a finger's row keeping its × but drawing no ⋯. */
function ShellRow({
  shell,
  shown,
  surfaceOpen,
  session,
}: {
  shell: HeldShell;
  shown: boolean;
  /** Whether the tab the list stands in is on screen, which the end's question goes with. */
  surfaceOpen: boolean;
  session: Pick<TerminalSession, "onChoose" | "onRename" | "onKill">;
}): React.JSX.Element {
  const rename = useInlineRename(shell.terminalId, session.onRename);
  const renaming = rename.editing;
  const coarse = useCoarsePointer();
  const kill = `End ${shell.title}`;
  // Ending a shell ends what runs in it, which nothing brings back, so it asks first.
  const ending = useConfirmDialog(
    { subject: true, surfaceOpen },
    () => session.onKill(shell.terminalId),
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
        current={shown ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={renaming ? undefined : () => session.onChoose(shell.terminalId)}
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
          // Note that the title names the shell.
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
            <IconButton icon={<GLYPH.ADD />} label="New shell" onClick={session.onCreate} />
          </Tooltip>
        }
      />
      <ListedShells
        listed={listed}
        session={session}
        surfaceOpen={surfaceOpen && (over === undefined ? !leaving : over.open)}
      />
      <div className="terminal-shells-foot flex border-t border-border px-list-inset py-row-inset text-caption font-ui-semibold text-foreground">
        <AgentRef
          subject={subject}
          models={models}
          onOpen={onOpenAgent}
          glyph={<AgentGlyph agent={subject.agent} />}
          label={subject.name}
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

/**
 * The agent's shells, as a terminal's row in the panel's "+" says them
 * after the agent's name: how many this window holds, nothing before the
 * first. Whether the agent works is the row's glyph's to say.
 */
export function TerminalStanding({ agentId }: { agentId: string }): React.JSX.Element {
  const count = useAtomValue(shellsHeld(agentId)).length;
  return <>{count === 0 ? null : `${count} ${count === 1 ? "shell" : "shells"}`}</>;
}
