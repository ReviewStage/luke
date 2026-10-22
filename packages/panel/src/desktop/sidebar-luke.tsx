import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import {
  BUTTON_SIZE,
  ConfirmDialog,
  type DialogQuestion,
  EllipsisIcon,
  IconButton,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  Tooltip,
  useConfirmDialog,
  useMenu,
  VisuallyHidden,
  WingFace,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { agentGlyphState } from "../tasks/coding-agent-model.js";
import { agentEndMark, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { markReadItem } from "../tasks/task-menu-items.js";
import { useCallingAgent } from "../use-voice-view.js";
import { ActionMenu, type MenuEntry } from "./action-menu.js";
import { useAgentReadMarks } from "./agent-read-marks.js";
import { LUKE_NAME, type LukeOperator } from "./luke-operator.js";
import { RowMarks } from "./task-actions.js";

/**
 * sidebar-luke.tsx -- Luke's row at the head of the sidebar's list: the account's operator in the listed workspace, always there.
 *
 * The row is an agent's row (`sidebar-agent.tsx`) in what it wears: Luke's
 * face giving way to the working mark while he works, the live mark while a
 * call into him stands, the failed mark at its end, and the unseen dot,
 * main's or one set by hand. It stands above every pin and section and in
 * none of them, so it offers neither Pin nor Move to section, and neither
 * Archive nor Permanently delete: its ⋯ offers its read mark and Reset,
 * asked first, which archives this Luke and opens a fresh one. A press opens
 * his page. While his ensure is on its way the row stands muted, and once it
 * failed it offers a quiet retry at its end, never a toast.
 */

/** What the row's menu is called. */
const ACTIONS_LABEL = "Luke actions";

/** What asking to reset Luke says. */
const RESET_QUESTION: DialogQuestion = {
  title: "Start a fresh Luke?",
  body: "This one is archived; your memories stay.",
  verb: "Start fresh",
  running: "Starting",
};

/** Luke's glyph: his face, giving way to the working mark while he works, or the live mark while a call into him stands. */
function LukeGlyph({
  agent,
  calling,
}: {
  agent: TasklessAgent | undefined;
  calling: boolean;
}): React.JSX.Element {
  if (calling)
    return <>{tabLook({ kind: TAB_KIND.AGENT, name: LUKE_NAME, agent, calling }).icon}</>;
  const state = agent === undefined ? GLYPH_STATE.REST : agentGlyphState(agent.status);
  return <StateGlyph glyph={<WingFace />} state={state} />;
}

/** Luke's row, for the listed workspace's operator. */
export function SidebarLuke({
  operator,
  agent,
  current,
  unread,
  shown,
  onOpen,
}: {
  operator: LukeOperator;
  /** Luke as the list holds him, which his marks read; none until the list carries him. */
  agent: TasklessAgent | undefined;
  /** Whether his page is the one standing. */
  current: boolean;
  /** Whether his turn ended while the developer was not looking: main's unseen dot. */
  unread: boolean;
  /** Whether the sidebar is on screen and in sight, which the row's menu and question do not outlive. */
  shown: boolean;
  /** Opens the page of the Luke named, this one or a fresh one a Reset made. */
  onOpen: (agentId: string) => void;
}): React.JSX.Element {
  const row = useRef<HTMLElement | null>(null);
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
  }, []);
  const menu = useMenu(shown);
  const calling = useCallingAgent();
  const reads = useAgentReadMarks();
  const { agentId } = operator;
  const isUnread = unread || (agentId !== undefined && reads.markedUnread(agentId));
  const reset = useConfirmDialog({ subject: true, surfaceOpen: shown }, () =>
    operator.reset().then((result) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED && result.agentId !== undefined) {
        onOpen(result.agentId);
      }
      return result;
    }),
  );
  const groups: MenuEntry[][] = [
    agent === undefined
      ? []
      : [markReadItem({ unread: isUnread, onMark: (next) => reads.mark(agent, next) })],
    [{ label: "Reset Luke", icon: <RotateCcwIcon />, onSelect: reset.ask }],
  ].filter((group) => group.length > 0);
  // Note that the retry stands at the row's end, not on hover, since a reader who cannot reach Luke should see why at once.
  const actions = operator.failed ? (
    <RowMarks
      marks={[{ key: "retry", label: "Retry", icon: <RotateCwIcon />, onSelect: operator.retry }]}
    />
  ) : (
    <Tooltip label={ACTIONS_LABEL}>
      <IconButton
        icon={<EllipsisIcon />}
        label={ACTIONS_LABEL}
        size={BUTTON_SIZE.COMPACT}
        {...menu.trigger()}
      />
    </Tooltip>
  );
  return (
    <>
      <ListRow
        ref={hold}
        density={LIST_DENSITY.DENSE}
        ink={LIST_ROW_INK.SIDEBAR}
        leading={
          <span className="sidebar-agent-glyph">
            <LukeGlyph agent={agent} calling={agentId !== undefined && calling === agentId} />
          </span>
        }
        title={
          <>
            {LUKE_NAME}
            {isUnread ? <VisuallyHidden>(unread)</VisuallyHidden> : null}
          </>
        }
        meta={agent === undefined ? null : agentEndMark(agent, false)}
        current={current ? LIST_ROW_CURRENT.PAGE : undefined}
        unread={isUnread}
        muted={agentId === undefined}
        menuOpen={menu.open !== undefined}
        onPress={() => {
          menu.close(false);
          if (agentId !== undefined) onOpen(agentId);
          else if (operator.failed) operator.retry();
        }}
        contextMenu={menu.contextMenu(row)}
        actionsAt={operator.failed ? LIST_ROW_ACTIONS.ALWAYS : LIST_ROW_ACTIONS.HOVER}
        actions={actions}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu label={ACTIONS_LABEL} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
      <ConfirmDialog confirm={reset} question={RESET_QUESTION} />
    </>
  );
}
