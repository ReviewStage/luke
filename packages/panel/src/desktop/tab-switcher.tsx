import { useAtomSet } from "@effect/atom-react";
import type { TaskSummary } from "@repo/features/task-wire";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND, commandForKey, type KeyedCommand } from "@repo/settings/shortcuts";
import { DIALOG_SIZE, Dialog, TabCard, TabCards, VisuallyHidden } from "@repo/ui";
import {
  isAgentTab,
  isChangesTab,
  isCloudBrowserTab,
  isFileTab,
  isLocalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  sameTab,
  TAB_WORDS,
} from "@repo/ui/tab-strip-model";
import { TASKS_PAGE } from "@repo/ui/tasks-model";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { HouseIcon, InboxIcon, ListTodoIcon, ZapIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { overlayHoldsKeyboard, useAppCommand, useOverlayHold } from "../app-commands.js";
import { liveStepTitle, memberName, NAMED_STEP, stepTitle } from "../history-titles.js";
import { MemberDirectory, useMemberDirectory, usePerson } from "../member-directory.js";
import type { StepTitle } from "../navigation-history.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { ROUTED_PLACE } from "../route-gates.js";
import { tasklessRowSubject } from "../tasks/agent-ref.js";
import { agentEndMark, type KindLook, PlanGlyph, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { isOverviewTab, type MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { type HeldLook, heldLook, LOOK_STRIP } from "./switcher-looks.js";
import {
  forgotten,
  moved,
  STOP_KIND,
  type Stop,
  SWITCH_STEP,
  SWITCHER_LET_GO,
  SWITCHER_PLACE,
  type SwitcherPlace,
  type SwitcherState,
  type SwitchStep,
  sameStop,
  shownStop,
  stopTask,
  switcherChose,
  switcherPressed,
  switcherShown,
  switcherTarget,
} from "./tab-switcher-model.js";

const HOLD_SHOWS = "150 millis";

const STILL_SETTLES = "800 millis";

const STILLS_KEPT = 8;

const SWITCH_COMMANDS = [APP_COMMAND.NEXT_RECENT_TAB, APP_COMMAND.PREVIOUS_RECENT_TAB] as const;

const STEP_OF = {
  [APP_COMMAND.NEXT_RECENT_TAB]: SWITCH_STEP.ON,
  [APP_COMMAND.PREVIOUS_RECENT_TAB]: SWITCH_STEP.BACK,
} as const satisfies Record<(typeof SWITCH_COMMANDS)[number], SwitchStep>;

const WORK_AREA = ".desktop-main";

const PLACE_LOOK = {
  [SWITCHER_PLACE.HOME]: { icon: HouseIcon, label: "Home" },
  [SWITCHER_PLACE.INBOX]: { icon: InboxIcon, label: TAB_WORDS.INBOX },
  [SWITCHER_PLACE.BOARD]: { icon: ListTodoIcon, label: "Tasks" },
  [SWITCHER_PLACE.AUTOMATIONS]: { icon: ZapIcon, label: "Automations" },
} as const satisfies Record<SwitcherPlace, { icon: typeof HouseIcon; label: string }>;

const TASK_WORDS = "Task";

const PERSON_WORDS = "Profile";

const holdAtom = () =>
  rendererRuntime.fn(({ show }: { readonly show: () => void }) =>
    Effect.andThen(Effect.sleep(HOLD_SHOWS), Effect.sync(show)),
  );

const settleAtom = () =>
  rendererRuntime.fn(({ take }: { readonly take: () => void }) =>
    Effect.andThen(Effect.sleep(STILL_SETTLES), Effect.sync(take)),
  );

interface HeldStill {
  readonly stop: Stop;
  readonly src: string;
}

interface CardLook extends KindLook {
  readonly labelReplayUnmasked?: boolean | undefined;
  readonly detail: string | undefined;
  readonly detailIcon?: React.JSX.Element | undefined;
  readonly endMark?: React.JSX.Element | undefined;
}

function tabWordLook(tab: SidePanelTab | MainTab, task: TaskSummary | undefined): KindLook {
  if (isOverviewTab(tab)) return tabLook({ kind: TAB_KIND.OVERVIEW });
  if (typeof tab === "string") {
    const plan = task === undefined ? undefined : { name: task.name, status: task.status };
    return tabLook({ kind: TAB_KIND.PANEL, tab, plan });
  }
  if (isAgentTab(tab)) return tabLook({ kind: TAB_KIND.AGENT, name: undefined, agent: undefined });
  if (isFileTab(tab)) return tabLook({ kind: TAB_KIND.FILE, path: tab.file });
  if (isChangesTab(tab)) return tabLook({ kind: TAB_KIND.CHANGES });
  if (isTerminalTab(tab)) return tabLook({ kind: TAB_KIND.TERMINAL, agent: undefined });
  if (isLocalTab(tab)) return tabLook({ kind: TAB_KIND.LOCAL, agent: undefined });
  if (isCloudBrowserTab(tab)) {
    return tabLook({ kind: TAB_KIND.BROWSER, title: undefined });
  }
  if (isPageTab(tab)) return tabLook({ kind: TAB_KIND.PAGE, title: "Page" });
  if (isSubagentTab(tab)) {
    return tabLook({ kind: TAB_KIND.SUBAGENT, name: "Subagent", model: undefined, state: "rest" });
  }
  return tabLook({ kind: TAB_KIND.DRAFT });
}

function taskName(tasks: TasksControl, taskId: string): string | undefined {
  return tasks.tasks.find((task) => task.id === taskId)?.name;
}

function PersonStopFace({ userId, name }: { userId: string; name: string }): React.JSX.Element {
  return <ActorMark actor={usePerson({ userId, name })} size={ACTOR_SIZE.INLINE} />;
}

function cardLook(
  stop: Stop,
  tasks: TasksControl,
  title: StepTitle | undefined,
  members: readonly WorkspaceMember[] | undefined,
): CardLook {
  switch (stop.kind) {
    case STOP_KIND.TASK: {
      const task = tasks.tasks.find((each) => each.id === stop.taskId);
      const column: HeldLook | undefined =
        stop.column === undefined
          ? undefined
          : (heldLook(LOOK_STRIP.COLUMN, stop.taskId, stop.column) ??
            tabWordLook(stop.column, task));
      const panel =
        stop.panel === undefined
          ? undefined
          : (heldLook(LOOK_STRIP.PANEL, stop.taskId, stop.panel) ?? tabWordLook(stop.panel, task));
      const { taskId } = stop;
      const named = { kind: NAMED_STEP.TASK, taskId, column: stop.column, side: stop.panel };
      const live = liveStepTitle(named, title, tasks, members);
      const words = [column?.label, panel?.label].filter((word) => word !== undefined);
      return {
        icon: <PlanGlyph status={task?.status} />,
        label: live?.label ?? TASK_WORDS,
        labelReplayUnmasked: live?.label === undefined,
        detail: live?.detail ?? (words.join(" · ") || undefined),
        detailIcon: column?.icon,
        endMark: column?.endMark,
      };
    }
    case STOP_KIND.PLACE: {
      const { icon: Icon, label } = PLACE_LOOK[stop.place];
      return { icon: <Icon />, label, labelReplayUnmasked: true, detail: undefined };
    }
    case STOP_KIND.AGENT: {
      const { standing, archived } = tasks.listedAgents;
      const agent = [...standing, ...archived].find((each) => each.id === stop.agentId);
      if (agent === undefined) {
        return {
          ...tabLook({ kind: TAB_KIND.AGENT, name: undefined, agent: undefined }),
          labelReplayUnmasked: true,
          detail: undefined,
        };
      }
      const subject = tasklessRowSubject(agent, tasks.agents);
      return {
        ...tabLook({ kind: TAB_KIND.AGENT, name: subject.name, agent: subject.agent }),
        detail: undefined,
        endMark: agentEndMark(agent, false),
      };
    }
    case STOP_KIND.PERSON: {
      const known = memberName(members, stop.userId) ?? stop.name;
      const name = known ?? PERSON_WORDS;
      return {
        icon: <PersonStopFace userId={stop.userId} name={name} />,
        label: name,
        labelReplayUnmasked: known === undefined,
        detail: undefined,
      };
    }
  }
}

function StopCard({
  stop,
  tasks,
  title,
  still,
  here,
  chosen,
  onPoint,
  onPick,
}: {
  stop: Stop;
  tasks: TasksControl;
  title: StepTitle | undefined;
  still: string | undefined;
  here: boolean;
  chosen: boolean;
  onPoint: () => void;
  onPick: () => void;
}): React.JSX.Element {
  const { members } = useMemberDirectory();
  const look = cardLook(stop, tasks, title, members);
  return (
    <TabCard
      icon={look.icon}
      label={look.label}
      labelReplayUnmasked={look.labelReplayUnmasked}
      detail={look.detail}
      detailIcon={look.detailIcon}
      endMark={look.endMark}
      still={still}
      here={here}
      chosen={chosen}
      pickOnPress
      onPoint={onPoint}
      onPick={onPick}
    />
  );
}

function standingOf(tab: PanelTab, tasks: TasksControl): Stop | undefined {
  const { mainTabs, sidePanel, personView } = tasks;
  const column = mainTabs.tab;
  return shownStop({
    over: tab === PANEL_TAB.SETTINGS || tasks.adminView.open || tasks.history.open,
    inbox: tasks.inboxView.open,
    agentId: tasks.agentView.agentId,
    person:
      personView.userId === undefined
        ? undefined
        : { userId: personView.userId, name: personView.name, workspaceId: personView.workspaceId },
    board: tasks.boardView.open,
    automations: tasks.automationsView.open,
    home: tasks.page === TASKS_PAGE.HOME && !tasks.adminView.open,
    boundFor: tasks.boundFor,
    openTaskId: tasks.activeTaskId,
    column,
    panel: sidePanel.open ? sidePanel.tab : undefined,
    fullScreen: sidePanel.fullScreen,
  });
}

interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function areaOf(selector: string): Area | undefined {
  const box = document.querySelector(selector)?.getBoundingClientRect();
  if (box === undefined || box.width < 1 || box.height < 1) return undefined;
  const x = Math.max(0, Math.round(box.left));
  const y = Math.max(0, Math.round(box.top));
  return { x, y, width: Math.round(box.right) - x, height: Math.round(box.bottom) - y };
}

function claim(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

export function TabSwitcher({
  available,
  tab,
  onTabChange,
  tasks,
}: {
  available: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  tasks: TasksControl;
}): React.JSX.Element | null {
  const desktop =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;
  const answers = available && desktop;
  const { mutateAsync: sendCapture } = useMutation(actMutation(ACT_KIND.WINDOW_CAPTURE));
  const [state, setState] = useState<SwitcherState>(SWITCHER_LET_GO);
  const [, setStillsKept] = useState(0);
  const latest = useRef<SwitcherState>(SWITCHER_LET_GO);
  const stops = useRef<readonly Stop[]>([]);
  const shown = useRef<Stop | undefined>(undefined);
  const stills = useRef<readonly HeldStill[]>([]);
  const titles = useRef<readonly { readonly stop: Stop; readonly title: StepTitle }[]>([]);
  const presses = useRef(0);
  const pressesMoved = useRef(0);
  const listed = useRef(new Set<string>());
  const doors = useRef({ tab, tasks, onTabChange });
  doors.current = { tab, tasks, onTabChange };
  const [hold] = useState(holdAtom);
  const startHold = useAtomSet(hold);
  const [settle] = useState(settleAtom);
  const startSettle = useAtomSet(settle);
  useOverlayHold(state.held);
  const titleId = useId();
  const [face, setFace] = useState<SwitcherState>(state);
  if (state.held && state.shown && face !== state) setFace(state);

  const move = (next: SwitcherState) => {
    latest.current = next;
    setState(next);
  };

  const here = (): Stop | undefined => {
    const first = stops.current[0];
    const standing = shown.current;
    return first !== undefined && standing !== undefined && sameStop(standing, first)
      ? first
      : undefined;
  };

  const keep = (stop: Stop, src: string) => {
    stills.current = [
      { stop, src },
      ...stills.current.filter((held) => !sameStop(held.stop, stop)),
    ].slice(0, STILLS_KEPT);
    if (latest.current.held) setStillsKept((count) => count + 1);
  };

  const takeStill = (stop: Stop) => {
    const area = areaOf(WORK_AREA);
    if (area === undefined) return;
    sendCapture(area).then(
      (src) => {
        if (src !== null) keep(stop, src);
      },
      () => undefined,
    );
  };

  useEffect(() => {
    const heard = () => {
      presses.current += 1;
    };
    window.addEventListener("pointerdown", heard, true);
    window.addEventListener("keydown", heard, true);
    return () => {
      window.removeEventListener("pointerdown", heard, true);
      window.removeEventListener("keydown", heard, true);
    };
  }, []);

  const now = standingOf(tab, tasks);
  const title = stepTitle(tab === PANEL_TAB.SETTINGS ? ROUTED_PLACE.SETTINGS : undefined, tasks);
  useEffect(() => {
    const before = shown.current;
    shown.current = now;
    const first = stops.current[0];
    const pressed = presses.current !== pressesMoved.current;
    pressesMoved.current = presses.current;
    stops.current = moved(stops.current, before, now, pressed);
    standing();
    titles.current = [
      ...(now === undefined || title === undefined ? [] : [{ stop: now, title }]),
      ...titles.current.filter(
        (held) =>
          (now === undefined || !sameStop(held.stop, now)) &&
          stops.current.some((stop) => sameStop(stop, held.stop)),
      ),
    ];
    const settled = stops.current[0];
    if (settled === undefined || (first !== undefined && sameStop(first, settled))) return;
    startSettle({
      take: () => {
        const standingOn = here();
        if (standingOn !== undefined && sameStop(standingOn, settled)) takeStill(settled);
      },
    });
  });

  const go = (stop: Stop) => {
    const { tasks: control, onTabChange: changeTab } = doors.current;
    control.leaveGuard.guard(() => {
      changeTab(PANEL_TAB.TASKS);
      switch (stop.kind) {
        case STOP_KIND.TASK:
          showTask(control, stop);
          break;
        case STOP_KIND.AGENT:
          control.agentView.onOpen(stop.agentId);
          break;
        case STOP_KIND.PERSON:
          control.personView.onOpen(stop.userId, stop.name, stop.workspaceId);
          break;
        case STOP_KIND.PLACE:
          openPlace(control, stop.place);
          break;
      }
      stops.current = [stop, ...stops.current.filter((each) => !sameStop(each, stop))];
    })();
  };

  const standing = (): readonly Stop[] => {
    const control = doors.current.tasks;
    const open = control.activeTaskId;
    stops.current = forgotten(stops.current, (stop) => {
      const taskId = stopTask(stop);
      if (taskId === undefined) return false;
      if (taskName(control, taskId) !== undefined) listed.current.add(taskId);
      const awaited = taskId === open && !listed.current.has(taskId);
      if (control.listRead && !awaited && taskName(control, taskId) === undefined) return true;
      const standingOn = shown.current;
      if (taskId !== open || standingOn === undefined || stopTask(standingOn) !== open)
        return false;
      if (stop.kind !== STOP_KIND.TASK) return false;
      const { panel, column } = stop;
      if (panel !== undefined && !control.sidePanel.strip.some((each) => sameTab(each, panel))) {
        return true;
      }
      if (column === undefined) return false;
      const { openAgents, tabs } = control.mainTabs;
      if (isAgentTab(column)) return openAgents !== undefined && !openAgents.includes(column.agent);
      return !tabs.some((each) => sameTab(each, column));
    });
    return stops.current;
  };

  const press = (step: SwitchStep) => {
    const before = latest.current;
    const next = switcherPressed(before, { stops: standing(), here: here(), step });
    if (!next.held) return;
    if (!before.held) {
      const leaving = here();
      if (leaving !== undefined) takeStill(leaving);
      startHold({ show: () => move(switcherShown(latest.current)) });
    }
    move(next);
  };

  const letGo = (going: boolean) => {
    const target = going ? switcherTarget(latest.current) : undefined;
    startHold(Atom.Interrupt);
    move(SWITCHER_LET_GO);
    if (target !== undefined) go(target);
  };

  const tap = (step: SwitchStep) => () => {
    if (latest.current.held || overlayHoldsKeyboard()) return;
    const target = switcherTarget(
      switcherPressed(SWITCHER_LET_GO, { stops: standing(), here: here(), step }),
    );
    if (target !== undefined) go(target);
  };
  useAppCommand(APP_COMMAND.NEXT_RECENT_TAB, answers ? tap(SWITCH_STEP.ON) : undefined);
  useAppCommand(APP_COMMAND.PREVIOUS_RECENT_TAB, answers ? tap(SWITCH_STEP.BACK) : undefined);

  const keys = useRef({ press, letGo });
  keys.current = { press, letGo };
  useEffect(() => {
    if (!answers) return undefined;
    const down = (event: KeyboardEvent) => {
      const command = commandForKey(SWITCH_COMMANDS as readonly KeyedCommand[], event);
      if (command === APP_COMMAND.NEXT_RECENT_TAB || command === APP_COMMAND.PREVIOUS_RECENT_TAB) {
        if (!latest.current.held && overlayHoldsKeyboard()) return;
        claim(event);
        keys.current.press(STEP_OF[command]);
        return;
      }
      const held = latest.current;
      if (!held.held) return;
      if (!event.ctrlKey && event.key !== "Control") {
        keys.current.letGo(true);
        return;
      }
      claim(event);
      if (event.key === "Escape") keys.current.letGo(false);
      else if (event.key === "Enter") keys.current.letGo(true);
      else if (event.key === "ArrowRight") keys.current.press(SWITCH_STEP.ON);
      else if (event.key === "ArrowLeft") keys.current.press(SWITCH_STEP.BACK);
    };
    const up = (event: KeyboardEvent) => {
      if (!latest.current.held || (event.key !== "Control" && event.ctrlKey)) return;
      claim(event);
      keys.current.letGo(true);
    };
    const moved = (event: PointerEvent) => {
      if (latest.current.held && !event.ctrlKey) keys.current.letGo(true);
    };
    const left = () => {
      if (latest.current.held) keys.current.letGo(true);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointermove", moved, true);
    window.addEventListener("blur", left);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointermove", moved, true);
      window.removeEventListener("blur", left);
    };
  }, [answers]);

  if (!face.held || !face.shown) return null;
  const { cards, chosen } = face;
  return (
    <Dialog
      open={state.held && state.shown}
      size={DIALOG_SIZE.MEDIA}
      labelledBy={titleId}
      onDismiss={() => letGo(false)}
    >
      <VisuallyHidden id={titleId}>Recent tabs</VisuallyHidden>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <TabCards label="Recent tabs">
          {cards.map((stop, at) => (
            <StopCard
              key={at}
              stop={stop}
              tasks={tasks}
              title={titles.current.find((held) => sameStop(held.stop, stop))?.title}
              still={stills.current.find((held) => sameStop(held.stop, stop))?.src}
              here={face.here && at === 0}
              chosen={at === chosen}
              onPoint={() => move(switcherChose(latest.current, at))}
              onPick={() => {
                move(switcherChose(latest.current, at));
                letGo(true);
              }}
            />
          ))}
        </TabCards>
      </MemberDirectory>
    </Dialog>
  );
}

function showTask(tasks: TasksControl, stop: Extract<Stop, { kind: typeof STOP_KIND.TASK }>): void {
  const { taskId, column, panel, fullScreen } = stop;
  const { sidePanel, mainTabs } = tasks;
  const columnShown = column !== undefined && !fullScreen;
  if (columnShown) tasks.onShowColumnTab(taskId, column);
  if (panel !== undefined) {
    if (columnShown) sidePanel.onShow(taskId, panel);
    else tasks.onShowPanelTab(taskId, panel);
  } else {
    if (!columnShown) tasks.onRestoreTask(taskId);
    if (sidePanel.open) sidePanel.onSetOpen(false);
  }
  if (column !== undefined && fullScreen) mainTabs.onShow(taskId, column);
  const filling = columnShown || !sidePanel.open ? false : sidePanel.fullScreen;
  if (panel !== undefined && !sidePanel.fullScreenOnly && fullScreen !== filling) {
    sidePanel.onToggleFullScreen();
  }
}

function openPlace(tasks: TasksControl, place: SwitcherPlace): void {
  switch (place) {
    case SWITCHER_PLACE.HOME:
      tasks.onGoHome();
      return;
    case SWITCHER_PLACE.INBOX:
      tasks.inboxView.onOpen();
      return;
    case SWITCHER_PLACE.BOARD:
      tasks.boardView.onOpen();
      return;
    case SWITCHER_PLACE.AUTOMATIONS:
      tasks.automationsView.onOpen();
      return;
  }
}
