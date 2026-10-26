/**
 * tab-switcher.tsx -- ⌃Tab and ⌃⇧Tab: the screens the window stood on last, across every task, as cards to step through while ⌃ is held, as ⌘Tab steps through apps.
 *
 * The switcher keeps the window's stops most recent first
 * (`tab-switcher-model.ts`), each a whole screen as a step of Back's is: a
 * task with the tabs both its panes showed, or a place. It reads where the
 * window stands on each render: another page, or a tab chosen by a press or
 * a key, is a stop of its own, and a tab the window chose by itself takes
 * the stop standing in place, by the rule Back's trail keeps
 * (`navigation-history.ts`). A quick tap of ⌃Tab goes to the screen before
 * this one without drawing anything, so two taps flip between two. Held a
 * beat, the cards show over the window: the screen here first and dimmed,
 * the one after it chosen. Tab and → step on, ⇧Tab and ← back, wrapping
 * around; letting go of ⌃, or ⏎, goes to the card chosen, Escape goes
 * nowhere, and a press on a card goes to it. Going is the window's own:
 * both of a task's panes through the doors that show a tab on a task
 * (`onShowColumnTab`, the side panel's `onShow`), opening it where it is
 * another, and a place through its own, so the window's history records it
 * as any move.
 *
 * The keys are heard before anything under them, a terminal's or a text
 * field's, since a Control chord is otherwise theirs: a cloud Browser tab
 * and a Terminal tab hand ⌃Tab on to the window for it (`chordIsWindows`,
 * `terminal-keys.ts`). It is a desktop app's alone, since a browser keeps
 * ⌃Tab for its own tabs, and it holds off the menu bar's Back and Forward
 * while it stands, as ⌘K's palette does, and leaves ⌃Tab to a dialog over
 * the window.
 *
 * A task's card is named as Back's list names the screen
 * (`history-titles.ts`): the task's status glyph and name, then its panes'
 * tabs, "Fix token refresh · Code", the task and an agent's tab by the
 * names they go by now and a person's card by the name the workspace's
 * members give them, each falling back to what was kept as it stood, the
 * column's agent wearing its glyph as its tab drew it (`switcher-looks.ts`),
 * at work or failed as everywhere. With Channels on, the Inbox's card names
 * what its place shows, wearing the channel's glyph: the channel, "#general",
 * or "Channels" where a phone stands its list of channels.
 * Its preview is a still of the whole work area, taken once the window
 * settles on the screen and again as ⌃Tab leaves it: main takes a downscaled
 * picture of that part of the window (`window.capture`). A still is a picture
 * of the window's words, so it is kept in this window's memory alone, a few
 * at a time, never written, traced, or counted, and the session recording
 * leaves it out (`ph-no-capture`). Until a stop has one, its card shows its
 * glyph.
 */

import { useAtomSet } from "@effect/atom-react";
import type { TaskSummary } from "@luke/features/task-wire";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { APP_COMMAND, commandForKey, type KeyedCommand } from "@luke/settings/shortcuts";
import { DIALOG_SIZE, Dialog, TabCard, TabCards, VisuallyHidden } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import {
  isAgentTab,
  isChangesTab,
  isCloudBrowserTab,
  isFileTab,
  isMacTerminalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  sameTab,
  TAB_WORDS,
} from "@luke/ui/tab-strip-model";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { type HouseIcon, InboxIcon, ListTodoIcon, ZapIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { overlayHoldsKeyboard, useAppCommand, useOverlayHold } from "../app-commands.js";
import { liveStepTitle, memberName, NAMED_STEP, stepTitle } from "../history-titles.js";
import { MemberDirectory, useMemberDirectory, usePerson } from "../member-directory.js";
import type { StepTitle } from "../navigation-history.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { usePhoneRoom } from "../stage-room.js";
import { tasklessRowSubject } from "../tasks/agent-ref.js";
import { CHANNEL_SHOWN, channelShown } from "../tasks/channels-model.js";
import { agentEndMark, type KindLook, PlanGlyph, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { useChannelPlace, useChannels } from "../tasks/use-channels.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useCapability, useExperiment } from "../use-app-state.js";
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

/** How long ⌃ is held after ⌃Tab before the cards show, so a quick tap flips without drawing them. */
const HOLD_SHOWS = "150 millis";

/** How long the window stands on a stop before its still is taken, so a still is of the stop settled rather than arriving. */
const STILL_SETTLES = "800 millis";

/** How many stills the window keeps, the most recent stops': as many as the cards, and a few the cards may reach once a tab closes. */
const STILLS_KEPT = 8;

/** The two chords, each the step it takes. */
const SWITCH_COMMANDS = [APP_COMMAND.NEXT_RECENT_TAB, APP_COMMAND.PREVIOUS_RECENT_TAB] as const;

const STEP_OF = {
  [APP_COMMAND.NEXT_RECENT_TAB]: SWITCH_STEP.ON,
  [APP_COMMAND.PREVIOUS_RECENT_TAB]: SWITCH_STEP.BACK,
} as const satisfies Record<(typeof SWITCH_COMMANDS)[number], SwitchStep>;

/** The part of the window a stop's still is of: the work area beside the sidebar, both of a task's panes as they stand. */
const WORK_AREA = ".desktop-main";

/** What a place's card wears, as the sidebar's row for it does. */
const PLACE_LOOK = {
  [SWITCHER_PLACE.INBOX]: { icon: InboxIcon, label: TAB_WORDS.INBOX },
  [SWITCHER_PLACE.BOARD]: { icon: ListTodoIcon, label: "Tasks" },
  [SWITCHER_PLACE.AUTOMATIONS]: { icon: ZapIcon, label: "Automations" },
} as const satisfies Record<SwitcherPlace, { icon: typeof HouseIcon; label: string }>;

/** What a task's card is called where the window lists no name for it. */
const TASK_WORDS = "Task";

/** What a phone's list of channels is called, as its bar names it (`channel-list.tsx`). */
const CHANNELS_WORDS = "Channels";

/** What a person's page is called where the name is not known. */
const PERSON_WORDS = "Profile";

/** The hold before the cards show, as an atom whose work is the wait; handed its door inside a record, as a function handed to an atom's setter is called at once. */
const holdAtom = () =>
  rendererRuntime.fn(({ show }: { readonly show: () => void }) =>
    Effect.andThen(Effect.sleep(HOLD_SHOWS), Effect.sync(show)),
  );

/** The wait before a still is taken of the stop the window settled on. */
const settleAtom = () =>
  rendererRuntime.fn(({ take }: { readonly take: () => void }) =>
    Effect.andThen(Effect.sleep(STILL_SETTLES), Effect.sync(take)),
  );

/** A still kept of a stop. */
interface HeldStill {
  readonly stop: Stop;
  readonly src: string;
}

/** How a card wears its stop: its glyph and name, and under them the words a task's tabs are named by, its agent's glyph before them and its end mark after. */
interface CardLook extends KindLook {
  readonly detail: string | undefined;
  readonly detailIcon?: React.JSX.Element | undefined;
  readonly endMark?: React.JSX.Element | undefined;
}

/** A tab's look where its strip never drew it in this window: its kind's glyph and word, the Plan's named for its task where the window lists it. */
function tabWordLook(tab: SidePanelTab | MainTab, task: TaskSummary | undefined): KindLook {
  if (typeof tab === "string") {
    const plan = task === undefined ? undefined : { name: task.name, status: task.status };
    return tabLook({ kind: TAB_KIND.PANEL, tab, plan });
  }
  if (isAgentTab(tab)) return tabLook({ kind: TAB_KIND.AGENT, name: undefined, agent: undefined });
  if (isFileTab(tab)) return tabLook({ kind: TAB_KIND.FILE, path: tab.file });
  if (isChangesTab(tab)) return tabLook({ kind: TAB_KIND.CHANGES });
  if (isTerminalTab(tab)) return tabLook({ kind: TAB_KIND.TERMINAL, agent: undefined });
  if (isMacTerminalTab(tab)) return tabLook({ kind: TAB_KIND.MAC_TERMINAL });
  if (isCloudBrowserTab(tab)) {
    return tabLook({ kind: TAB_KIND.BROWSER, title: undefined });
  }
  if (isPageTab(tab)) return tabLook({ kind: TAB_KIND.PAGE, title: "Page" });
  if (isSubagentTab(tab)) {
    return tabLook({ kind: TAB_KIND.SUBAGENT, name: "Subagent", model: undefined, state: "rest" });
  }
  return tabLook({ kind: TAB_KIND.DRAFT });
}

/** The task's name, as the window lists it. */
function taskName(tasks: TasksControl, taskId: string): string | undefined {
  return tasks.tasks.find((task) => task.id === taskId)?.name;
}

/** A person's page stop wears their face, read against the members around it as every person is drawn. */
function PersonStopFace({ userId, name }: { userId: string; name: string }): React.JSX.Element {
  return <ActorMark actor={usePerson({ userId, name })} size={ACTOR_SIZE.INLINE} />;
}

/**
 * How a card wears its stop, from what the window holds of it now and what
 * Back's list named it while it stood: a task, its agent's tab, and a person
 * by the names they go by now, as Back's list names a step again
 * (`liveStepTitle`), and by what was kept where nothing names them now.
 */
function cardLook(
  stop: Stop,
  tasks: TasksControl,
  title: StepTitle | undefined,
  members: readonly WorkspaceMember[] | undefined,
  channels: KindLook | undefined,
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
      // The words are the tabs as their strips drew them, where nothing names the screen now or as it stood.
      const words = [column?.label, panel?.label].filter((word) => word !== undefined);
      return {
        icon: <PlanGlyph status={task?.status} />,
        label: live?.label ?? TASK_WORDS,
        detail: live?.detail ?? (words.join(" · ") || undefined),
        detailIcon: column?.icon,
        endMark: column?.endMark,
      };
    }
    case STOP_KIND.PLACE: {
      // Note that with Channels on the Inbox's place is what Channels shows, so its card is named for that.
      if (stop.place === SWITCHER_PLACE.INBOX && channels !== undefined) {
        return { ...channels, detail: undefined };
      }
      const { icon: Icon, label } = PLACE_LOOK[stop.place];
      return { icon: <Icon />, label, detail: undefined };
    }
    case STOP_KIND.AGENT: {
      const { standing, archived } = tasks.listedAgents;
      const agent = [...standing, ...archived].find((each) => each.id === stop.agentId);
      if (agent === undefined) {
        return {
          ...tabLook({ kind: TAB_KIND.AGENT, name: undefined, agent: undefined }),
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
      const name = memberName(members, stop.userId) ?? stop.name ?? PERSON_WORDS;
      return {
        icon: <PersonStopFace userId={stop.userId} name={name} />,
        label: name,
        detail: undefined,
      };
    }
  }
}

/**
 * What the Inbox's place shows with Channels on, which its card goes back
 * to: a phone's list of channels while it is asked for, as the place stands
 * it (`desktop-inbox.tsx`), and a channel's stream otherwise; none with
 * Channels off, or before the window has read its channels. Note that it
 * reads the channels the window holds rather than reading them again, as
 * the phone's bar does.
 */
function useChannelsLook(tasks: TasksControl): KindLook | undefined {
  const channelsOn = useExperiment(EXPERIMENT.CHANNELS);
  const phone = usePhoneRoom();
  const { channels } = useChannels(channelsOn ? tasks.workspace?.id : undefined, false);
  const { channelId } = useChannelPlace();
  if (channelsOn && phone && tasks.inboxView.listed) {
    return { icon: <GLYPH.CHANNEL />, label: CHANNELS_WORDS };
  }
  const shown = channelShown(channels, channelId);
  return shown.kind === CHANNEL_SHOWN.CHANNEL
    ? { icon: <GLYPH.CHANNEL />, label: `#${shown.channel.name}` }
    : undefined;
}

/** One card of a stop, named against the workspace's members around it (`cardLook`). */
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
  const channels = useChannelsLook(tasks);
  const look = cardLook(stop, tasks, title, members, channels);
  return (
    <TabCard
      icon={look.icon}
      label={look.label}
      detail={look.detail}
      detailIcon={look.detailIcon}
      endMark={look.endMark}
      still={still}
      here={here}
      chosen={chosen}
      // Note that the card is picked on the press, because ⌃ is held while it is pressed, which a Mac makes a right-click.
      pickOnPress
      onPoint={onPoint}
      onPick={onPick}
    />
  );
}

/** Where the window stands now, as the switcher reads it. */
function standingOf(tab: PanelTab, tasks: TasksControl): Stop | undefined {
  const { mainTabs, sidePanel, personView } = tasks;
  const column = mainTabs.tab;
  return shownStop({
    over: tab === PANEL_TAB.SETTINGS || tasks.history.open,
    inbox: tasks.inboxView.open,
    agentId: tasks.agentView.agentId,
    person:
      personView.userId === undefined
        ? undefined
        : { userId: personView.userId, name: personView.name, workspaceId: personView.workspaceId },
    board: tasks.boardView.open,
    automations: tasks.automationsView.open,
    boundFor: tasks.boundFor,
    openTaskId: tasks.activeTaskId,
    column,
    panel: sidePanel.open ? sidePanel.tab : undefined,
    fullScreen: sidePanel.fullScreen,
  });
}

/** A part of the window, in whole CSS pixels. */
interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where an element stands in the window, in whole CSS pixels; none where it is not drawn. */
function areaOf(selector: string): Area | undefined {
  const box = document.querySelector(selector)?.getBoundingClientRect();
  if (box === undefined || box.width < 1 || box.height < 1) return undefined;
  const x = Math.max(0, Math.round(box.left));
  const y = Math.max(0, Math.round(box.top));
  return { x, y, width: Math.round(box.right) - x, height: Math.round(box.bottom) - y };
}

/** Whether the press is the switcher's to hold while it stands: every key but ⌃ itself. */
function claim(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * The switcher, answering ⌃Tab while `available`, past the sign-in, on a
 * desktop app. It is mounted once for the window and draws nothing until
 * its cards show.
 */
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
  const desktop = useCapability(HOST_CAPABILITY.DESKTOP_APP);
  const answers = available && desktop;
  const { act } = useAct();
  const [state, setState] = useState<SwitcherState>(SWITCHER_LET_GO);
  // Counts the stills kept, so one landing while the cards show is drawn at once.
  const [, setStillsKept] = useState(0);
  // Note that these are refs, because the keys and the stills read them as they land, which no render stands between.
  const latest = useRef<SwitcherState>(SWITCHER_LET_GO);
  const stops = useRef<readonly Stop[]>([]);
  const shown = useRef<Stop | undefined>(undefined);
  const stills = useRef<readonly HeldStill[]>([]);
  // What Back's list called each stop while it stood, which its card says.
  const titles = useRef<readonly { readonly stop: Stop; readonly title: StepTitle }[]>([]);
  // How many presses and keys the window has heard, and how many it had as the stops were last moved, as Back's trail counts them.
  const presses = useRef(0);
  const pressesMoved = useRef(0);
  // The tasks the window's list has named, so a task gone from it after is one deleted rather than one not yet listed.
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

  // The stop on screen, the most recent, which the cards dim and a let-go there leaves.
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

  // A still of the work area as it is drawn now, kept once main answers; a stop no longer on screen by then keeps what it had.
  const takeStill = (stop: Stop) => {
    const area = areaOf(WORK_AREA);
    if (area === undefined) return;
    act(ACT_KIND.WINDOW_CAPTURE, area).then(
      (src) => {
        if (src !== null) keep(stop, src);
      },
      () => undefined,
    );
  };

  // A press or a key, which makes the tab it chooses a stop of its own rather than one the window chose by itself.
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

  // The window's stops follow where it stands, each render, and what Back's list calls the stop standing.
  const now = standingOf(tab, tasks);
  const title = stepTitle(tab, tasks);
  useEffect(() => {
    const before = shown.current;
    shown.current = now;
    const first = stops.current[0];
    const pressed = presses.current !== pressesMoved.current;
    pressesMoved.current = presses.current;
    stops.current = moved(stops.current, before, now, pressed);
    // A tab closed on its task's page is let go then, before a page standing in its place can hide the close.
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

  // Goes to a stop through the window's own doors, as any move there would, all of it past one ask of the leave guard, so a leave cancelled moves nothing, the stops' order included.
  const go = (stop: Stop) => {
    const { tasks: control, tab: shownTab, onTabChange: changeTab } = doors.current;
    control.leaveGuard.guard(() => {
      if (shownTab !== PANEL_TAB.TASKS) changeTab(PANEL_TAB.TASKS);
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
      // Note that the stop is the most recent now, before the window's own moves arrive, so they take it in place.
      stops.current = [stop, ...stops.current.filter((each) => !sameStop(each, stop))];
    })();
  };

  // The stops that still stand: no tab the open task no longer holds, as its strips' own state says, and no task the window no longer lists.
  const standing = (): readonly Stop[] => {
    const control = doors.current.tasks;
    const open = control.activeTaskId;
    stops.current = forgotten(stops.current, (stop) => {
      const taskId = stopTask(stop);
      if (taskId === undefined) return false;
      if (taskName(control, taskId) !== undefined) listed.current.add(taskId);
      // Note that the open task is judged by the list only once its row has reached it, because a task just made stands open before it does.
      const awaited = taskId === open && !listed.current.has(taskId);
      if (control.listRead && !awaited && taskName(control, taskId) === undefined) return true;
      // Note that only the task's own page says which of its tabs stand, because the Inbox or an agent's page standing in its place hands the panel a strip of its own.
      const standingOn = shown.current;
      if (taskId !== open || standingOn === undefined || stopTask(standingOn) !== open)
        return false;
      if (stop.kind !== STOP_KIND.TASK) return false;
      const { panel, column } = stop;
      if (panel !== undefined && !control.sidePanel.strip.some((each) => sameTab(each, panel))) {
        return true;
      }
      if (column === undefined) return false;
      // Note that an agent's tab is judged only once the task's agents are read, since none stands open before.
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
      // The stop being left is taken afresh, before the cards can cover it.
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

  // The menu bar's items, and ⌘K's rows, go at once, as a tap would: no ⌃ is held to let go of.
  const tap = (step: SwitchStep) => () => {
    if (latest.current.held || overlayHoldsKeyboard()) return;
    const target = switcherTarget(
      switcherPressed(SWITCHER_LET_GO, { stops: standing(), here: here(), step }),
    );
    if (target !== undefined) go(target);
  };
  useAppCommand(APP_COMMAND.NEXT_RECENT_TAB, answers ? tap(SWITCH_STEP.ON) : undefined);
  useAppCommand(APP_COMMAND.PREVIOUS_RECENT_TAB, answers ? tap(SWITCH_STEP.BACK) : undefined);

  // The keys, heard before anything under them; while held, every key is the switcher's.
  const keys = useRef({ press, letGo });
  keys.current = { press, letGo };
  useEffect(() => {
    if (!answers) return undefined;
    const down = (event: KeyboardEvent) => {
      const command = commandForKey(SWITCH_COMMANDS as readonly KeyedCommand[], event);
      if (command === APP_COMMAND.NEXT_RECENT_TAB || command === APP_COMMAND.PREVIOUS_RECENT_TAB) {
        // A dialog or ⌘K's palette over the window keeps its keys, so nothing moves behind it.
        if (!latest.current.held && overlayHoldsKeyboard()) return;
        claim(event);
        keys.current.press(STEP_OF[command]);
        return;
      }
      const held = latest.current;
      if (!held.held) return;
      // A press without ⌃ is one made after it was let go where the window did not hear it.
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

  // Note that the cards are held as they last showed, so the dialog fades them out as it closes rather than drawing nothing.
  if (!face.held || !face.shown) return null;
  const { cards, chosen } = face;
  return (
    <Dialog
      open={state.held && state.shown}
      size={DIALOG_SIZE.MEDIA}
      labelledBy={titleId}
      // Note that Escape and a press on the dimmed window go nowhere, as Escape does while ⌃ is held.
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

/**
 * Opens a task on the screen a stop held: its column's tab and its side
 * panel's, through the doors that show a tab on a task, opening it first
 * where it is another; the panel shut where the stop had it shut, and
 * filling the window where it did. It is run whole past the leave guard's
 * ask (`go`), so a cancelled leave changes neither pane.
 */
function showTask(tasks: TasksControl, stop: Extract<Stop, { kind: typeof STOP_KIND.TASK }>): void {
  const { taskId, column, panel, fullScreen } = stop;
  const { sidePanel, mainTabs } = tasks;
  // Note that the column's own door gives up a panel filling the window, so it is used only where the screen had the column in sight.
  const columnShown = column !== undefined && !fullScreen;
  if (columnShown) tasks.onShowColumnTab(taskId, column);
  if (panel !== undefined) {
    // Note that the panel's own door is used beside the column's, so the task is opened once.
    if (columnShown) sidePanel.onShow(taskId, panel);
    else tasks.onShowPanelTab(taskId, panel);
  } else {
    if (!columnShown) tasks.onRestoreTask(taskId);
    if (sidePanel.open) sidePanel.onSetOpen(false);
  }
  if (column !== undefined && fullScreen) mainTabs.onShow(taskId, column);
  // Note that a narrow room's panel fills the window whenever it stands, and its toggle shuts it, so it is left as it opens.
  const filling = columnShown || !sidePanel.open ? false : sidePanel.fullScreen;
  if (panel !== undefined && !sidePanel.fullScreenOnly && fullScreen !== filling) {
    sidePanel.onToggleFullScreen();
  }
}

/** Opens a place through its own door. */
function openPlace(tasks: TasksControl, place: SwitcherPlace): void {
  switch (place) {
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
