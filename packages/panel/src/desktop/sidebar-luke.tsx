import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { OPERATOR_NAME } from "@luke/features/model-label";
import {
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  STATUS_TONE,
  VisuallyHidden,
  WingFace,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { agentGlyphState } from "../tasks/coding-agent-model.js";
import { agentEndMark } from "../tasks/tab-look.js";
import { markReadItem } from "../tasks/task-menu-items.js";
import { TOAST_HOLD, type ToastNotice, undoToast, useToast, useWorkingToast } from "../toast.js";
import { type MenuEntry, rowMenu } from "./action-menu.js";
import { useAgentReadMarks } from "./agent-read-marks.js";
import type { LukeOperator, OperatorAnswer } from "./luke-operator.js";
import { RowMarks } from "./task-actions.js";

/**
 * sidebar-luke.tsx -- Luke's row at the head of the sidebar's list: the account's operator in the listed workspace, always there.
 *
 * The row is an agent's row (`sidebar-agent.tsx`) in what it wears: Luke's
 * face giving way to the working mark while he works, the failed mark at its
 * end, and the unseen dot,
 * main's or one set by hand. It stands above every pin and section and in
 * none of them, so it offers neither Pin nor Move to section, and neither
 * Archive nor Permanently delete: its ⋯, right-click, and menu key offer Copy
 * link to his page, its read mark, and, last and alone, once he stands,
 * Reset, which asks nothing: it archives this Luke and opens
 * a fresh one at once, and its toast's Undo archives the fresh one and opens
 * this one again. A press opens his page. While his ensure is on its way the
 * row stands muted, and once it failed it offers a quiet retry at its end,
 * never a toast.
 */

/** What a Reset's toasts say: while it is on its way, and once it landed. */
const RESET_WORDS = {
  RUNNING: "Resetting Luke",
  DONE: "Luke reset",
} as const;

/** The toast a Reset or its Undo that did not land says its reason in. */
function refusedNotice(reason: string): ToastNotice {
  return { words: reason, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED };
}

/** Luke's glyph: his face, giving way to the working mark while he works. */
function LukeGlyph({ agent }: { agent: TasklessAgent | undefined }): React.JSX.Element {
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
  /** Whether the sidebar is on screen and in sight, which the row's menu does not outlive. */
  shown: boolean;
  /** Opens the page of the Luke named, this one or a fresh one a Reset made. */
  onOpen: (agentId: string) => void;
}): React.JSX.Element {
  const reads = useAgentReadMarks();
  const { agentId } = operator;
  const isUnread = unread || (agentId !== undefined && reads.markedUnread(agentId));
  const toast = useToast();
  const working = useWorkingToast();
  // Note that the Luke opened is the one each answer names, so the page follows the row through a Reset and its Undo.
  const opened = (result: OperatorAnswer) => {
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED && result.agentId !== undefined) {
      onOpen(result.agentId);
    }
    return result;
  };
  const undo = (retiredId: string) =>
    void operator
      .restore(retiredId)
      .then(opened)
      .then((result) => {
        if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) toast(refusedNotice(result.reason));
      });
  const reset = (retiredId: string) => {
    const settle = working(RESET_WORDS.RUNNING);
    void operator
      .reset()
      .then(opened)
      .then((result) =>
        settle(
          result.status === ACTION_RESULT_STATUS.ACCEPTED
            ? undoToast(RESET_WORDS.DONE, () => undo(retiredId))
            : refusedNotice(result.reason),
        ),
      );
  };
  const copyLink = useCopyLinkItem();
  const linkItem = agentId === undefined ? undefined : copyLink(agentPlace(agentId));
  const groups: MenuEntry[][] = [
    linkItem === undefined ? [] : [linkItem],
    agent === undefined
      ? []
      : [markReadItem({ unread: isUnread, onMark: (next) => reads.mark(agent, next) })],
    agentId === undefined
      ? []
      : [{ label: "Reset Luke", icon: <RotateCcwIcon />, onSelect: () => reset(agentId) }],
  ].filter((group) => group.length > 0);
  // Note that the retry stands at the row's end, not on hover, since a reader who cannot reach Luke should see why at once.
  const actions = operator.failed ? (
    <RowMarks
      marks={[{ key: "retry", label: "Retry", icon: <RotateCwIcon />, onSelect: operator.retry }]}
    />
  ) : null;
  return (
    <ListRow
      density={LIST_DENSITY.DENSE}
      ink={LIST_ROW_INK.SIDEBAR}
      leading={
        <span className="sidebar-agent-glyph inline-flex [--state-glyph-size:var(--spacing-luke-16)]">
          <LukeGlyph agent={agent} />
        </span>
      }
      title={
        <>
          {OPERATOR_NAME}
          {isUnread ? <VisuallyHidden>(unread)</VisuallyHidden> : null}
        </>
      }
      meta={agent === undefined ? null : agentEndMark(agent, false)}
      current={current ? LIST_ROW_CURRENT.PAGE : undefined}
      unread={isUnread}
      muted={agentId === undefined}
      onPress={() => {
        if (agentId !== undefined) onOpen(agentId);
        else if (operator.failed) operator.retry();
      }}
      menu={rowMenu(OPERATOR_NAME, groups, shown)}
      actionsAt={operator.failed ? LIST_ROW_ACTIONS.ALWAYS : LIST_ROW_ACTIONS.HOVER}
      actions={actions}
    />
  );
}
