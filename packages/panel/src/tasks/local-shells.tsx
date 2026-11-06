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
import { useMutation } from "@tanstack/react-query";
import type { ReactNode, RefObject } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { rowMenu } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { AgentRef, type AgentSubject } from "./agent-ref.js";
import type { PaneOver } from "./file-view.js";
import { type HeldShell, localShellsHeld } from "./local-held.js";
import { AgentGlyph } from "./tab-look.js";
import type { LocalSession } from "./use-local-session.js";

const SHELL_THING = "Shell";

const END_SHELL = "End shell";

const TITLE_MAX = 60;

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

function ListedShells({
  listed,
  session,
  surfaceOpen,
}: {
  listed: readonly HeldShell[];
  session: LocalSession;
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

function ShellRow({
  shell,
  shown,
  surfaceOpen,
  session,
}: {
  shell: HeldShell;
  shown: boolean;
  surfaceOpen: boolean;
  session: Pick<LocalSession, "onChoose" | "onRename" | "onKill">;
}): React.JSX.Element {
  const rename = useInlineRename(shell.terminalId, {
    run: session.onRename,
    asked: undefined,
    refused: false,
    reset: () => undefined,
  });
  const renaming = rename.editing;
  const coarse = useCoarsePointer();
  const kill = `End ${shell.title}`;
  const closing = useMutation({ mutationFn: () => session.onKill(shell.terminalId) });
  const endingAct = useConfirmAct(closing, {
    send: () => closing.mutateAsync(),
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
              onEnd={({ value }) => rename.end(value)}
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
          titleReplayMasked: true,
        }}
      />
    </>
  );
}

export function LocalShells({
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
  session: LocalSession;
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

export function LocalStanding({ agentId }: { agentId: string }): React.JSX.Element {
  const count = useAtomValue(localShellsHeld(agentId)).length;
  return <>{count === 0 ? null : `${count} ${count === 1 ? "shell" : "shells"}`}</>;
}
