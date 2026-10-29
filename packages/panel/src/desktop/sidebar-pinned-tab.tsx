import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  AGENT_BOUNDS,
  type AgentPullRequest,
  type AgentSummary,
  type TasklessAgent,
} from "@luke/features/agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_SIZE,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  IconButton,
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  RowHint,
  RowHintOptions,
  Tooltip,
  VisuallyHidden,
} from "@luke/ui";
import { isAgentTab, isChangesTab, isFileTab, pullRequestLabelOf } from "@luke/ui/tab-strip-model";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect, useRef } from "react";
import { askAct } from "../act.js";
import { commandAction, commandHead, PANEL_COMMAND } from "../command-items.js";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { agentName, RENAME_FAILED } from "../tasks/agent-model.js";
import { agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { peopleOf } from "../tasks/pull-request-card.js";
import type { PullRequestMarked } from "../tasks/pull-request-mark.js";
import { pullRequestOfTab } from "../tasks/pull-request-number.js";
import { PlanGlyph, TAB_KIND, type TabSubject, tabLook } from "../tasks/tab-look.js";
import { isAgentPin, type SidebarPin } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type MenuAction, type MenuEntry, rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { tabCard } from "./tab-card.js";
import { PullRequestLine, RepositoryDetail } from "./task-card.js";

/**
 * sidebar-pinned-tab.tsx -- a tab pinned to the sidebar, or an agent on a task pinned as its tab: its row under Pinned, its Unpin, and its menu.
 *
 * A fixed tab, a file's, or an agent's Changes pinned from its menu in a
 * task's side panel, or in an agent's own page's, and an agent on a task
 * the reader pinned on the account, from its tab's menu in the task's
 * column or anywhere else the agent is drawn, stands under Pinned beside
 * the pinned tasks, as a row in the task rows' own shape: the tab's glyph,
 * an agent's its harness's mark wearing where it stands as its tab does,
 * and its name on one line, cut short with a fade as a tab is. Its hover card
 * is a task card (`task-card.tsx`), drawn from its rows: the tab's whole
 * name after its glyph, then what it is pinned on, the task or the agent,
 * which opens it, and its repository, which opens on GitHub, and for an agent's pin or
 * its Changes' the pull request it opened, which opens in its Pull request tab where the window lists it and on GitHub otherwise, once the one read of
 * it the card makes as it opens lands. A Changes pin on the open task, whose
 * agent it still holds, hangs the Changes tab's own card instead (`tabCard`),
 * from the pull request the tab reads, and keeps the card above only for the
 * pins that cannot read it. A press opens what it is pinned on, the task
 * where it is not the open one or the agent's own page, and the tab in its
 * column: an agent's in the task's column, any other in the side panel,
 * opening either where it is closed. The row it opened from is
 * then the one the sidebar marks, in its task's row's place, for as long
 * as the task stays open, whichever of the task's tabs is shown, until the
 * task's own row is pressed or another task opens. Its Unpin stands at the row's end while it is hovered or
 * reached from the keyboard, in the task rows' Pin and Archive style, and
 * part of the row to its card, as theirs are, and
 * a menu, opened by its ⋯, a right-click, or the menu key, offers Unpin, the
 * pin's own keeping, first, as a tab's keeping leads its tab's menu, then,
 * for an agent's pin, the agent's one menu (`agent-actions.tsx`'s
 * `agentMenuGroups`): the whole of it while its task is open, whose agents
 * the window reads, Copy link, the transcript's two copies, Rename, which
 * turns the row into its name's field, Archive, and Permanently delete, and
 * Copy link alone for another task's, whose agent the window reads only as
 * far as its task's row names it.
 *
 * A pin outlives what it opens only on the open task's word: an agent the
 * task's agents no longer hold, or its Changes, leaves the row dimmed,
 * opening nothing, with a quiet note on its
 * card, until it is unpinned. Another task's pins are never gone, since
 * nothing of that task is read but its row; a pin is named as its tab is
 * now, from that row where it is another task's (`namedPin`), and by the
 * label it was pinned under where nothing the window reads names it.
 */

/** What a pin's Unpin button says and wears, as the pin's menu does. */
const UNPIN = commandHead(PANEL_COMMAND.UNPIN_TAB);

/** What a pin's card says once its task no longer holds what it opens. */
const GONE_NOTE = "No longer on this task";

/** What a pin's row stands on: the task it is of, or the agent with no task whose own page it was pinned on. */
export type PinnedOn = { readonly task: TaskSummary } | { readonly agent: TasklessAgent };

/** The task a pin is of; none for a tab pinned on an agent's own page. */
function pinTaskId(pin: SidebarPin): string | undefined {
  return "task" in pin ? pin.task : undefined;
}

/** Whether the open task has said the pin's agent, or the agent of its Changes, is gone from it; another task's pins, an agent page's, a file's, and a fixed tab's never are. */
function pinGone(pin: SidebarPin, tasks: TasksControl): boolean {
  if (pinTaskId(pin) !== tasks.activeTaskId) return false;
  const agentId = pinAgentId(pin);
  if (agentId === undefined) return false;
  const { agents } = tasks.agents;
  return agents !== undefined && !agents.some((agent) => agent.id === agentId);
}

/**
 * What a pin's glyph is drawn from, as its tab's look (`tab-look.tsx`): its
 * kind, the Plan's its task's status, a file's path, or an agent's as its
 * tab wears it, where it stands included, wherever the window last read the
 * agent (`agent`), and otherwise at rest in the harness it ran in when it
 * was pinned. A Changes pin wears its pull request's mark for where the
 * task's row last read it (`pullRequest`), and a grey icon only where the
 * row holds none.
 */
function pinSubject(
  pin: SidebarPin,
  on: PinnedOn,
  agent: TaskAgentLine | undefined,
  pullRequest: PinnedPullRequest | undefined,
): TabSubject {
  if (isAgentPin(pin)) {
    return { kind: TAB_KIND.AGENT, name: pin.label, agent: agent ?? { model: pin.model } };
  }
  const { tab } = pin;
  if (isChangesTab(tab)) return { kind: TAB_KIND.CHANGES, pullRequest };
  if (isFileTab(tab)) return { kind: TAB_KIND.FILE, path: tab.file };
  const plan = "task" in on ? { name: on.task.name, status: on.task.status } : undefined;
  return { kind: TAB_KIND.PANEL, tab, plan };
}

/** What a pin's pull request is drawn and named from: its number, title, and where it stands. */
type PinnedPullRequest = PullRequestMarked & Pick<AgentPullRequest, "title">;

/** The repository a pull request's address names, without its number: what two pull requests of one repository share. */
function repositoryOfLine(line: TaskPullRequestLine): string | undefined {
  return line.url?.replace(/\/pull\/\d+.*$/u, "");
}

/**
 * The pull request a pin of an agent's Changes shows, as the open task's
 * agents last read it: the very read the Changes tab draws from
 * (`pullRequestOfTab`), a numbered tab's included. Nothing for any other pin,
 * or for a pin of another task, whose agents the window does not read.
 */
function openPullRequestOf(pin: SidebarPin, tasks: TasksControl): AgentPullRequest | undefined {
  const { tab } = pin;
  if (!isChangesTab(tab) || pinTaskId(pin) !== tasks.activeTaskId) return undefined;
  return pullRequestOfTab(tasks.agents, tab);
}

/**
 * The pull request a pin of an agent's Changes shows, as the window last
 * read it from GitHub: the open task's own read where the pin is on it, else
 * the task's row's line naming the agent. A numbered tab names another pull
 * request of its agent's repository, which the row's lines identify by number
 * alone, so one is taken from the row only where all its lines stand in one
 * repository. An agent's own page's pin reads the agent's row, which names
 * its newest pull request alone. Nothing for any other pin, or where the
 * window cannot tell which pull request the pin is of; the pin then keeps
 * the label and the grey icon it was pinned with.
 */
function pinPullRequest(
  pin: SidebarPin,
  on: PinnedOn,
  tasks: TasksControl,
): PinnedPullRequest | undefined {
  const { tab } = pin;
  if (!isChangesTab(tab)) return undefined;
  if ("agent" in on) {
    const { pullRequest } = on.agent;
    return tab.changes === on.agent.id && tab.number === undefined ? pullRequest : undefined;
  }
  const own = openPullRequestOf(pin, tasks);
  if (own !== undefined) return own;
  const lines = on.task.agents?.pullRequests ?? [];
  if (tab.number !== undefined) {
    const sameRepository = new Set(lines.map(repositoryOfLine)).size <= 1;
    return sameRepository ? lines.find((line) => line.number === tab.number) : undefined;
  }
  return lines.find((line) => line.agentId === tab.changes);
}

/**
 * A pin as the sidebar names it, as the tab itself is named now: an
 * agent's by the agent's name where the window reads the agent
 * (`pinAgent`), and a Changes tab's by its pull request's number and
 * title. Note that the label it was pinned under is what it falls back to,
 * because another task's agents are read only as far as its row's agent
 * lines name them.
 */
function namedPin<Pin extends SidebarPin>(
  pin: Pin,
  agent: TaskAgentLine | undefined,
  pullRequest: PinnedPullRequest | undefined,
  models: readonly CatalogModel[] | undefined,
): Pin {
  if (agent !== undefined) return { ...pin, label: agentName(agent, models) };
  return pullRequest === undefined ? pin : { ...pin, label: pullRequestLabelOf(pullRequest) };
}

/** The agent a pin of an agent's tab or of its Changes is of; none for any other pin. */
function pinAgentId({ tab }: SidebarPin): string | undefined {
  if (isAgentTab(tab)) return tab.agent;
  return isChangesTab(tab) ? tab.changes : undefined;
}

/** Unpin, the pin's own keeping, which leads its menu as a tab's keeping leads a tab's. */
function unpinItem(onUnpin: () => void): MenuAction {
  return commandAction(PANEL_COMMAND.UNPIN_TAB, onUnpin, false);
}

/**
 * The agent an agent's pin opens, as the open task's own agents read it,
 * whose whole menu the pin then offers; none for another task's pin, or an
 * agent the open task no longer holds.
 */
function openAgentOf(pin: SidebarPin, tasks: TasksControl): AgentSummary | undefined {
  if (!isAgentPin(pin) || pin.task !== tasks.activeTaskId) return undefined;
  return tasks.agents.agents?.find((each) => each.id === pin.tab.agent);
}

/**
 * The agent an agent's pin opens, as the window last read it: the open
 * task's own list where the pin is on it, else the few agents its task's
 * row names. Nothing for any other pin, or an agent neither names.
 */
function pinAgent(pin: SidebarPin, on: PinnedOn, tasks: TasksControl): TaskAgentLine | undefined {
  if (!isAgentPin(pin) || !("task" in on)) return undefined;
  const open = pin.task === tasks.activeTaskId ? tasks.agents.agents : undefined;
  return (open ?? on.task.agents?.agents)?.find((agent) => agent.id === pin.tab.agent);
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
        Effect.tryPromise(() => askAct(ACT_KIND.AGENTS_PULL_REQUEST, { agentId })),
        (answer) =>
          "failure" in answer
            ? Effect.fail(answer.failure)
            : Effect.succeed<AgentPullRequest | undefined>(answer.pullRequest ?? undefined),
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
 * The card the Changes tab itself hangs (`tabCard`), for a pin of a Changes
 * tab whose agent the open task still holds and whose pull request it has
 * read; none otherwise, where the pin hangs its own card, which reads the
 * pull request as it shows. Note that a pin whose agent is gone hangs none,
 * since the open task no longer lists it.
 */
function pinChangesCard(
  pin: SidebarPin,
  tasks: TasksControl,
  gone: boolean,
  onOpenAgent: (agentId: string) => void,
): React.JSX.Element | null {
  const { tab } = pin;
  const pullRequest = openPullRequestOf(pin, tasks);
  if (gone || !isChangesTab(tab) || pullRequest === undefined) return null;
  const { agents } = tasks;
  return tabCard({
    kind: TAB_KIND.CHANGES,
    subject: agentSubject(agents, tab.changes, NOTHING_HELD, false),
    models: agents.models,
    pullRequest,
    people: peopleOf(agents.changesPeople.get(tab.changes), pullRequest),
    onOpenAgent: () => onOpenAgent(tab.changes),
  });
}

/** What a pin's card names it as pinned on: the task under its plan's glyph, or the agent under its own, as its tab wears them. */
function pinnedOnLook(on: PinnedOn, models: readonly CatalogModel[] | undefined) {
  if ("task" in on) return { glyph: <PlanGlyph status={on.task.status} />, label: on.task.name };
  const label = agentName(on.agent, models);
  return { glyph: tabLook({ kind: TAB_KIND.AGENT, name: label, agent: on.agent }).icon, label };
}

/**
 * The card a pin's row hangs, a task card's own rows: the tab's name after
 * its glyph as its row draws it, wrapped to two lines, then what it is
 * pinned on, the task or the agent, and its repository, each opening where
 * it says, a note where the task no longer holds the tab, and under a rule
 * an agent's pull request.
 */
function PinnedTabCard({
  pin,
  on,
  agent,
  pullRequest,
  gone,
  tasks,
  onOpenHolder,
}: {
  pin: SidebarPin;
  on: PinnedOn;
  agent: TaskAgentLine | undefined;
  pullRequest: PinnedPullRequest | undefined;
  gone: boolean;
  tasks: TasksControl;
  onOpenHolder: () => void;
}): React.JSX.Element {
  const agentId = pinAgentId(pin);
  const repository = "task" in on ? on.task.repository : on.agent.repository;
  const { openGitHub, pictures } = tasks.repositories;
  const holder = pinnedOnLook(on, tasks.agents.models);
  return (
    <HoverCard data-pinned-tab-card="">
      <HoverCardHead
        glyph={tabLook(pinSubject(pin, on, agent, pullRequest)).icon}
        name={pin.label}
      />
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={holder.glyph}
        label={holder.label}
        onPress={onOpenHolder}
      />
      {repository === null ? null : (
        <RepositoryDetail repository={repository} pictures={pictures} onOpenGitHub={openGitHub} />
      )}
      {gone ? <HoverCardNote>{GONE_NOTE}</HoverCardNote> : null}
      {agentId === undefined ? null : <PinPullRequest agentId={agentId} />}
    </HoverCard>
  );
}

/** What a pin's row draws, beyond its menu: its glyph and name, the card it hangs, and where it opens. */
interface PinnedRowDrawn {
  pin: SidebarPin;
  card: React.ReactNode;
  glyph: React.JSX.Element;
  /** Whether the open task no longer holds what the pin opens, which dims the row and opens nothing. */
  gone: boolean;
  current: boolean;
  inSight: boolean;
  tasks: TasksControl;
  onOpen: () => void;
  /** Takes the row out of Pinned: a tab's pin on this Mac, an agent's on the account. */
  onUnpin: () => void;
}

/**
 * A pin's row, in the task rows' own shape, with the menu given and, while a
 * Rename is open, its name's field in its title's place. Note that the row
 * only says it is unavailable rather than being disabled, because a
 * disabled button hears no right-click, and its menu's Unpin is what is
 * left to do with it.
 */
function PinnedTabRow({
  drawn,
  groups,
  editor,
  description,
  rowRef,
}: {
  drawn: PinnedRowDrawn;
  groups: readonly (readonly MenuEntry[])[];
  /** The field the row's name is edited in, in its title's place while a Rename is open. */
  editor?: React.ReactNode;
  /** What stands under the title: a refused rename's note. */
  description?: React.ReactNode;
  rowRef?: ((press: HTMLElement | null) => void) | undefined;
}): React.JSX.Element {
  const { pin, card, glyph, gone, current, inSight, tasks, onOpen, onUnpin } = drawn;
  const place = useRowPlace();
  const editing = editor !== undefined;
  return (
    <RowHintOptions card={card}>
      <ListRow
        ref={rowRef}
        density={LIST_DENSITY.DENSE}
        ink={LIST_ROW_INK.SIDEBAR}
        leading={
          <span className="sidebar-pinned-tab-glyph flex [&_.state-glyph]:[--state-glyph-size:var(--spacing-luke-16)] [&_svg]:size-luke-16">
            {glyph}
          </span>
        }
        title={
          editing ? (
            editor
          ) : gone ? (
            <span className="sidebar-pinned-tab-gone opacity-55">
              {pin.label}
              <VisuallyHidden>(unavailable)</VisuallyHidden>
            </span>
          ) : (
            pin.label
          )
        }
        description={description}
        current={current ? LIST_ROW_CURRENT.PAGE : undefined}
        hint={editing ? undefined : { Hint: RowHint, label: pin.label }}
        onPress={
          editing
            ? undefined
            : () => {
                if (!gone) onOpen();
              }
        }
        menu={
          editing
            ? undefined
            : rowMenu("Pinned tab", withRowMoves(groups, place), tasks.shown && inSight)
        }
        actionsAt={LIST_ROW_ACTIONS.HOVER}
        actions={
          editing ? null : (
            <Tooltip label={UNPIN.label}>
              <IconButton
                icon={UNPIN.icon}
                label={`${UNPIN.label} ${pin.label}`}
                size={BUTTON_SIZE.COMPACT}
                onClick={onUnpin}
              />
            </Tooltip>
          )
        }
      />
    </RowHintOptions>
  );
}

/**
 * The row of an agent's pin on the open task, whose agent the window reads
 * whole: Unpin, then the agent's one menu over the doors a row has, with the
 * transcript's two copies the pin offered before it, read whole from the
 * service under the pin's label, and no terminal, which a sidebar row has
 * none of. Its Rename turns the row into its name's field, as the sidebar's
 * agent rows do.
 */
function PinnedAgentRow({
  agent,
  drawn,
}: {
  agent: AgentSummary;
  drawn: PinnedRowDrawn;
}): React.JSX.Element {
  const { pin, tasks, onUnpin } = drawn;
  const row = useRef<HTMLElement | null>(null);
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
  }, []);
  const actions = useAgentActions(agent, tasks.agents, {
    label: pin.label,
    shown: tasks.shown,
    terminals: { onOpenTerminal: undefined },
  });
  const { rename } = actions;
  const editing = rename?.editing === true;
  const endedByKey = useRefocusAfterEdit(editing, row);
  const groups = [
    [unpinItem(onUnpin)],
    ...agentMenuGroups({ ...rowDoors(actions.doors), onCopy: actions.doors.onCopy }),
  ];
  return (
    <>
      <PinnedTabRow
        drawn={drawn}
        groups={groups}
        rowRef={hold}
        editor={
          editing && rename !== undefined ? (
            <InlineEdit
              value={rename.asked ?? pin.label}
              label="Agent name"
              maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
              editing
              onEnd={(edit) => {
                endedByKey(edit.byKey);
                rename.end(edit.value);
              }}
            />
          ) : undefined
        }
        description={rename?.refused === true ? <span>{RENAME_FAILED}</span> : undefined}
      />
      {actions.dialog}
    </>
  );
}

/** One tab pinned to the sidebar, on a task or an agent's own page the sidebar lists, or an agent on a listed task pinned as its tab. */
export function SidebarPinnedTab({
  tasks,
  pin: kept,
  on,
  current,
  inSight,
  onOpen,
  onOpenHolder,
  onUnpin,
}: {
  tasks: TasksControl;
  pin: SidebarPin;
  /** Whether the open place was opened from this pin, which the sidebar marks in its place. */
  current: boolean;
  /** What the tab is pinned on, whose name the row's card carries. */
  on: PinnedOn;
  /** Whether the sidebar is in sight: folded away, its menu stands over nothing. */
  inSight: boolean;
  onOpen: () => void;
  /** Opens what the tab is pinned on, as its own row does. */
  onOpenHolder: () => void;
  /** Takes the row out of Pinned: a tab's pin on this Mac, an agent's on the account. */
  onUnpin: () => void;
}): React.JSX.Element {
  const livePullRequest = pinPullRequest(kept, on, tasks);
  const agent = pinAgent(kept, on, tasks);
  const pin = namedPin(kept, agent, livePullRequest, tasks.agents.models);
  const gone = pinGone(pin, tasks);
  const taskId = pinTaskId(pin);
  const changesCard = pinChangesCard(pin, tasks, gone, (agentId) => {
    if (taskId !== undefined) tasks.onShowAgent(taskId, agentId);
  });
  const copyLink = useCopyLinkItem();
  const drawn: PinnedRowDrawn = {
    pin,
    card:
      changesCard !== null ? (
        changesCard
      ) : (
        <PinnedTabCard
          pin={pin}
          on={on}
          agent={agent}
          pullRequest={livePullRequest}
          gone={gone}
          tasks={tasks}
          onOpenHolder={onOpenHolder}
        />
      ),
    glyph: tabLook(pinSubject(pin, on, agent, livePullRequest)).icon,
    gone,
    current,
    inSight,
    tasks,
    onOpen,
    onUnpin,
  };
  const open = openAgentOf(pin, tasks);
  if (open !== undefined) return <PinnedAgentRow agent={open} drawn={drawn} />;
  // Another task's agent is read only as far as its task's row names it, so its pin offers its link alone beside Unpin.
  const link = isAgentPin(pin) ? copyLink(agentPlace(pin.tab.agent)) : undefined;
  return (
    <PinnedTabRow
      drawn={drawn}
      groups={[[unpinItem(onUnpin)], ...(link === undefined ? [] : [[link]])]}
    />
  );
}
