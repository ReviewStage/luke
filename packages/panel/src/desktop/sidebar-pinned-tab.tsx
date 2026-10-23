import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { CodingAgentPullRequest } from "@luke/features/coding-agent-wire";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_SIZE,
  CopyIcon,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  IconButton,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  RowHint,
  RowHintOptions,
  Tooltip,
  UnpinIcon,
  useMenu,
  useMinute,
  VisuallyHidden,
} from "@luke/ui";
import { isAgentTab, isChangesTab, isFileTab } from "@luke/ui/tab-strip-model";
import { shownFiles } from "@luke/voice/code-pane-model";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { ScrollTextIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { askAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { PlanGlyph, TAB_KIND, type TabSubject, tabLook } from "../tasks/tab-look.js";
import { TRANSCRIPT_COPY } from "../tasks/transcript-copy.js";
import { type PinnedTab, SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { agentTranscriptRead } from "./agent-actions.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { type TranscriptCopier, useTranscriptCopier } from "./strip-tabs.js";
import { PullRequestLine, RepositoryDetail, taskCardOf } from "./task-card.js";

/**
 * sidebar-pinned-tab.tsx -- a tab of the task's columns pinned to the sidebar: its row under Pinned, its Unpin, and its menu.
 *
 * A fixed tab, a file's, or an agent's Changes pinned from its menu in the side panel, or an
 * agent's from its menu in the task's column, stands under Pinned beside
 * the pinned tasks, as a row in the task rows' own shape: the tab's glyph,
 * an agent's its harness's mark wearing where it stands as its tab does,
 * and its name on one line, cut short with a fade as a tab is. Its hover card
 * is a task card (`task-card.tsx`), drawn from its rows: the tab's whole
 * name after its glyph, then the task it is of, which opens the task, and
 * the task's repository, which opens on GitHub, and for an agent's pin or
 * its Changes' the pull request it opened, which opens in its Pull request tab where the window lists it and on GitHub otherwise, once the one read of
 * it the card makes as it opens lands. A press opens the task, where it is not the open one, and the tab
 * in its column: an agent's in the task's column, any other in the side
 * panel, opening either where it is closed. The row it opened from is
 * then the one the sidebar marks, in its task's row's place, for as long
 * as the task stays open, whichever of the task's tabs is shown, until the
 * task's own row is pressed or another task opens. Its Unpin stands at the row's end while it is hovered or
 * reached from the keyboard, in the task rows' Pin and Archive style, and
 * part of the row to its card, as theirs are, and
 * a right-click offers Unpin, beside an agent's two copies of its
 * transcript while its task is open.
 *
 * A pin outlives what it opens only on the open task's word: an agent the
 * task's agents no longer hold, its Changes too, or a file no longer among those Luke showed
 * on it, leaves the row dimmed, opening nothing, with a quiet note on its
 * card, until it is unpinned. Another task's pins are drawn as they were kept, since
 * nothing of that task is read.
 */

/** What a pin's card says once its task no longer holds what it opens. */
const GONE_NOTE = "No longer on this task";

/** Whether the open task has said the pin's agent, the agent of its Changes, or its file is gone from it; another task's pins and a fixed tab's never are. */
function pinGone(pin: PinnedTab, tasks: TasksControl): boolean {
  const { tab } = pin;
  if (pin.task !== tasks.activeTaskId) return false;
  const agentId = pinAgentId(pin);
  if (agentId !== undefined) {
    const { agents } = tasks.agents;
    return agents !== undefined && !agents.some((agent) => agent.id === agentId);
  }
  // Note that a task Luke showed no code on says nothing of its files, because a file pinned there was browsed to rather than shown.
  if (!isFileTab(tab) || tasks.shownCode === undefined || tasks.shownCode.length === 0) {
    return false;
  }
  return !shownFiles(tasks.shownCode).some((ref) => ref.path === tab.file);
}

/**
 * What a pin's glyph is drawn from, as its tab's look (`tab-look.tsx`): its
 * kind, the Plan's its task's status, a file's path, or an agent's as its
 * tab wears it, where it stands included, wherever the window last read the
 * agent (`agent`), and otherwise at rest in the harness it ran in when it
 * was pinned.
 */
function pinSubject(
  pin: PinnedTab,
  task: TaskSummary,
  agent: TaskAgentLine | undefined,
): TabSubject {
  const { tab } = pin;
  if (isAgentTab(tab)) {
    const pinned = pin.model === undefined ? undefined : { model: pin.model };
    return { kind: TAB_KIND.AGENT, name: pin.label, agent: agent ?? pinned };
  }
  if (isChangesTab(tab)) return { kind: TAB_KIND.CHANGES };
  if (isFileTab(tab)) return { kind: TAB_KIND.FILE, path: tab.file };
  return { kind: TAB_KIND.PANEL, tab, plan: { name: task.name, status: task.status } };
}

/** A pin as the sidebar names it: by the label it was pinned under, but a Plan tab's by its task's name as it stands now, as the tab itself is named. */
function namedPin(pin: PinnedTab, task: TaskSummary): PinnedTab {
  return pin.tab === SIDE_PANEL_TAB.PLAN ? { ...pin, label: task.name } : pin;
}

/** The agent a pin of an agent's tab or of its Changes is of; none for any other pin. */
function pinAgentId({ tab }: PinnedTab): string | undefined {
  if (isAgentTab(tab)) return tab.agent;
  return isChangesTab(tab) ? tab.changes : undefined;
}

/**
 * A pin's actions in the groups a rule divides: an agent's two copies of
 * its transcript, read whole from the service, then Unpin. Note that the
 * copies stand only while the agent's task is open, because a copy heads its
 * brief as the plan or the prompt the agent was handed, which only the open
 * task's agents say.
 */
function pinActionGroups(
  pin: PinnedTab,
  tasks: TasksControl,
  copied: TranscriptCopier,
): MenuAction[][] {
  const { tab } = pin;
  const unpin: MenuAction = {
    label: "Unpin",
    icon: <UnpinIcon />,
    onSelect: () => tasks.sidePanel.onUnpin(pin.task, tab),
  };
  const agent =
    isAgentTab(tab) && pin.task === tasks.activeTaskId
      ? tasks.agents.agents?.find((each) => each.id === tab.agent)
      : undefined;
  if (agent === undefined) return [[unpin]];
  const read = agentTranscriptRead(
    tasks.agents.readTranscript,
    agent.id,
    pin.label,
    agent.brief,
    tasks.agents.chatOn,
  );
  const copy = copied(read);
  return [
    [
      {
        label: "Copy concise transcript",
        icon: <CopyIcon />,
        onSelect: () => copy(TRANSCRIPT_COPY.CONCISE),
      },
      {
        label: "Copy full transcript",
        icon: <ScrollTextIcon />,
        onSelect: () => copy(TRANSCRIPT_COPY.FULL),
      },
    ],
    [unpin],
  ];
}

/**
 * The agent an agent's pin opens, as the window last read it: the open
 * task's own list where the pin is on it, else the few agents its task's
 * row names. Nothing for any other pin, or an agent neither names.
 */
function pinAgent(
  pin: PinnedTab,
  task: TaskSummary,
  tasks: TasksControl,
): TaskAgentLine | undefined {
  const { tab } = pin;
  if (!isAgentTab(tab)) return undefined;
  const open = pin.task === tasks.activeTaskId ? tasks.agents.agents : undefined;
  return (open ?? task.agents?.agents)?.find((agent) => agent.id === tab.agent);
}

/**
 * How long an agent's pull request a pin's card read is kept once no card
 * of it stands: long enough that the pointer coming back over the pins
 * shows it at once, short enough that a card hung later reads afresh.
 */
const PIN_PULL_REQUEST_KEPT = Duration.seconds(30);

/**
 * The pull request an agent opened, as a pin's card reads it: read once as
 * the first card of the agent shows, never for a row only crossed, since a
 * card is mounted only once the pointer has rested (`@luke/ui`'s `Tooltip`), and
 * shared by every card of it while one stands and for
 * `PIN_PULL_REQUEST_KEPT` after. Note that it is the pin's own, apart from
 * the open task's pull requests (`useTaskPullRequests`), so a pin's card
 * landing an answer redraws the card alone, never the task's control and
 * the sidebar with it. A read the service refused, or did not answer, is
 * kept as the failure it is, which the next card asks again over
 * (`PinPullRequest`), so a pull request is never hidden for the read's
 * lifetime by a read that failed.
 */
const pinPullRequestAtom = Atom.family((agentId: string) =>
  Atom.setIdleTTL(
    rendererRuntime.atom(
      Effect.flatMap(
        Effect.tryPromise(() => askAct(ACT_KIND.CODING_AGENTS_PULL_REQUEST, { agentId })),
        (answer) =>
          "failure" in answer
            ? Effect.fail(answer.failure)
            : Effect.succeed<CodingAgentPullRequest | undefined>(answer.pullRequest ?? undefined),
      ),
    ),
    PIN_PULL_REQUEST_KEPT,
  ),
);

/**
 * The pull request of `agentId`, once its read has landed; nothing before,
 * where it failed, or where the agent opened none. A card that finds a
 * failed read standing as it mounts asks again, once.
 */
function PinPullRequest({ agentId }: { agentId: string }): React.JSX.Element | null {
  const atom = pinPullRequestAtom(agentId);
  const read = useAtomValue(atom);
  const retry = useAtomRefresh(atom);
  const failedAtMount = useRef(AsyncResult.isFailure(read));
  useEffect(() => {
    if (failedAtMount.current) retry();
  }, [retry]);
  const pullRequest = AsyncResult.isSuccess(read) ? read.value : undefined;
  return pullRequest === undefined ? null : (
    <>
      <HoverCardRule />
      <HoverCardList label="Pull request">
        <PullRequestLine pullRequest={pullRequest} />
      </HoverCardList>
    </>
  );
}

/**
 * The card a pin's row hangs, a task card's own rows: the tab's name after
 * its glyph as its row draws it, wrapped to two lines, then the task it is of and the task's
 * repository, each opening where it says, a note where the task no longer
 * holds the tab, and under a rule an agent's pull request.
 */
function PinnedTabCard({
  pin,
  task,
  agent,
  gone,
  tasks,
  onOpenTask,
}: {
  pin: PinnedTab;
  task: TaskSummary;
  agent: TaskAgentLine | undefined;
  gone: boolean;
  tasks: TasksControl;
  onOpenTask: () => void;
}): React.JSX.Element {
  const agentId = pinAgentId(pin);
  const { repository } = task;
  const { openGitHub, pictures } = tasks.repositories;
  return (
    <HoverCard data-pinned-tab-card="">
      <HoverCardHead glyph={tabLook(pinSubject(pin, task, agent)).icon} name={pin.label} />
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={<PlanGlyph status={task.status} />}
        label={task.name}
        onPress={onOpenTask}
      />
      {repository === null ? null : (
        <RepositoryDetail repository={repository} pictures={pictures} onOpenGitHub={openGitHub} />
      )}
      {gone ? <HoverCardNote>{GONE_NOTE}</HoverCardNote> : null}
      {agentId === undefined ? null : <PinPullRequest agentId={agentId} />}
    </HoverCard>
  );
}

/**
 * One tab pinned to the sidebar, on a task the sidebar lists. Note that the
 * row only says it is unavailable rather than being disabled, because a
 * disabled button hears no right-click, and its menu's Unpin is what is
 * left to do with it.
 */
export function SidebarPinnedTab({
  tasks,
  pin: kept,
  task,
  current,
  inSight,
  onOpen,
  onOpenTask,
}: {
  tasks: TasksControl;
  pin: PinnedTab;
  /** Whether the open task was opened from this pin, which the sidebar marks in the task's place. */
  current: boolean;
  /** The task the tab is of, whose name the row's card carries. */
  task: TaskSummary;
  /** Whether the sidebar is in sight: folded away, its menu stands over nothing. */
  inSight: boolean;
  onOpen: () => void;
  /** Opens the task the tab is of, as its own row does. */
  onOpenTask: () => void;
}): React.JSX.Element {
  const pin = namedPin(kept, task);
  const copied = useTranscriptCopier();
  const now = useMinute();
  const menu = useMenu(tasks.shown && inSight);
  const place = useRowPlace();
  const row = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control.
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
    item.current = press?.parentElement ?? null;
  }, []);
  const gone = pinGone(pin, tasks);
  const agent = pinAgent(pin, task, tasks);
  // The row is what the menu rings and hands focus back to, even when the
  // right-click lands on Unpin over its end.
  const showMenu = menu.contextMenu(row);
  return (
    <>
      <RowHintOptions
        card={
          pin.tab === SIDE_PANEL_TAB.PLAN ? (
            taskCardOf(tasks, task, now)
          ) : (
            <PinnedTabCard
              pin={pin}
              task={task}
              agent={agent}
              gone={gone}
              tasks={tasks}
              onOpenTask={onOpenTask}
            />
          )
        }
        cardBeside
        cardRegion={item}
      >
        <ListRow
          ref={hold}
          density={LIST_DENSITY.DENSE}
          ink={LIST_ROW_INK.SIDEBAR}
          leading={
            <span className="sidebar-pinned-tab-glyph">
              {tabLook(pinSubject(pin, task, agent)).icon}
            </span>
          }
          title={
            gone ? (
              <span className="sidebar-pinned-tab-gone">
                {pin.label}
                <VisuallyHidden>(unavailable)</VisuallyHidden>
              </span>
            ) : (
              pin.label
            )
          }
          current={current ? LIST_ROW_CURRENT.PAGE : undefined}
          menuOpen={menu.open !== undefined}
          hint={{ Hint: RowHint, label: pin.label }}
          onPress={() => {
            menu.close(false);
            if (!gone) onOpen();
          }}
          contextMenu={showMenu}
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          actions={
            <Tooltip label="Unpin">
              <IconButton
                icon={<UnpinIcon />}
                label={`Unpin ${pin.label}`}
                size={BUTTON_SIZE.COMPACT}
                onClick={() => tasks.sidePanel.onUnpin(pin.task, pin.tab)}
              />
            </Tooltip>
          }
        />
      </RowHintOptions>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${pin.label} actions`}
          menu={menu.drawn}
          groups={withRowMoves(pinActionGroups(pin, tasks, copied), place)}
          onClose={menu.close}
        />
      )}
    </>
  );
}
