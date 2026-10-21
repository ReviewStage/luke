/**
 * tab-switcher.tsx -- ⌃Tab and ⌃⇧Tab: the tabs and places the window stood on last, across every task, as cards to step through while ⌃ is held, as ⌘Tab steps through apps.
 *
 * The switcher keeps the window's stops most recent first
 * (`tab-switcher-model.ts`), each tab of either strip on every task and each
 * place, read from where the window stands on each render, and the strip
 * that holds the keyboard, which a press or a focus in it moves to the front.
 * A quick tap of ⌃Tab goes to the stop before this one without drawing
 * anything, so two taps flip between two. Held a beat, the cards show over
 * the window: the stop here first and dimmed, the one after it chosen. Tab
 * and → step on, ⇧Tab and ← back, wrapping around; letting go of ⌃, or ⏎,
 * goes to the card chosen, Escape goes nowhere, and a press on a card goes
 * to it. Going is the window's own: a tab through the task's own doors
 * (`onShowColumnTab`, `onShowPanelTab`), opening its task where it is
 * another, and a place through its own, so the window's history records it
 * as any move.
 *
 * The keys are heard before anything under them, a terminal's or a text
 * field's, since a Control chord is otherwise theirs: a Browser tab's page
 * and a Terminal tab hand ⌃Tab on to the window for it (`browser-views.ts`,
 * `terminal-keys.ts`). It is a desktop app's alone, since a browser keeps
 * ⌃Tab for its own tabs, and it holds off the menu bar's Back and Forward
 * while it stands, as ⌘K's palette does.
 *
 * Each card wears its tab as its strip last drew it (`switcher-looks.ts`):
 * its glyph, an agent's at work or failed as everywhere, its name, and its
 * task and strip under it. Its preview is a still of the tab or the place,
 * taken once the window settles on it and again as ⌃Tab leaves it: a part
 * of the window main takes a downscaled picture of (`window.capture`), or a
 * Browser tab's own page (`browser.capture`). A still is a picture of the
 * window's words, so it is kept in this window's memory alone, a few at a
 * time, never written, traced, or counted, and the session recording
 * leaves it out (`ph-no-capture`), as it does a Browser tab's still. Until a
 * stop has one, its card shows its glyph.
 */

import { useAtomSet } from "@effect/atom-react";
import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  commandForKey,
  type KeyedCommand,
  SHORTCUT_KEY,
  type ShortcutChord,
} from "@luke/settings/shortcuts";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import {
  isAgentTab,
  isBrowserTab,
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
import {
  FactoryIcon,
  HouseIcon,
  InboxIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  UserRoundIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAct } from "../act.js";
import { overlayHoldsKeyboard, useAppCommand, useOverlayHold } from "../app-commands.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { Shortcut } from "../shortcut.js";
import { tasklessRowSubject } from "../tasks/agent-ref.js";
import { type KindLook, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useCapability } from "../use-app-state.js";
import { type HeldLook, heldLook, LOOK_STRIP } from "./switcher-looks.js";
import {
  arrived,
  forgotten,
  STOP_KIND,
  type Stop,
  SWITCH_STEP,
  SWITCHER_LET_GO,
  SWITCHER_PLACE,
  type SwitcherPlace,
  type SwitcherState,
  type SwitchStep,
  sameStop,
  shownStops,
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

/** The widest a Browser tab's still is kept, in its pixels, as main downscales the window's own (`register-desktop-ipc.ts`). */
const BROWSER_STILL_WIDTH = 480;

/** The JPEG quality a Browser tab's still is kept at, as the window's own. */
const BROWSER_STILL_QUALITY = 0.7;

/** The two chords, each the step it takes. */
const SWITCH_COMMANDS = [APP_COMMAND.NEXT_RECENT_TAB, APP_COMMAND.PREVIOUS_RECENT_TAB] as const;

const STEP_OF = {
  [APP_COMMAND.NEXT_RECENT_TAB]: SWITCH_STEP.ON,
  [APP_COMMAND.PREVIOUS_RECENT_TAB]: SWITCH_STEP.BACK,
} as const satisfies Record<(typeof SWITCH_COMMANDS)[number], SwitchStep>;

/** The part of the window each kind of stop is a still of: its strip's column, or the page in the task's place. */
const COLUMN_AREA = ".desktop-task-main";
const PANEL_AREA = ".side-panel";
const PLACE_AREA = ".desktop-main";

/** What a place's card wears, as the sidebar's row for it does. */
const PLACE_LOOK = {
  [SWITCHER_PLACE.HOME]: { icon: HouseIcon, label: "Home" },
  [SWITCHER_PLACE.INBOX]: { icon: InboxIcon, label: TAB_WORDS.INBOX },
  [SWITCHER_PLACE.CHAT]: { icon: MessagesSquareIcon, label: TAB_WORDS.CHAT },
  [SWITCHER_PLACE.BOARD]: { icon: ListTodoIcon, label: "Tasks" },
  [SWITCHER_PLACE.AUTOMATIONS]: { icon: ZapIcon, label: "Automations" },
  [SWITCHER_PLACE.FACTORY]: { icon: FactoryIcon, label: "Factory" },
} as const satisfies Record<SwitcherPlace, { icon: typeof HouseIcon; label: string }>;

/** What a card says under its name, of the strip its tab stands in. */
const STRIP_WORDS = {
  [STOP_KIND.COLUMN]: "Agents",
  [STOP_KIND.PANEL]: "Panel",
} as const;

/** What a person's page is called where the name is not known. */
const PERSON_WORDS = "Profile";

/** The keys the cards' foot names, as ⌘K's foot does. */
const FOOT_HINTS: readonly { readonly chord: ShortcutChord; readonly label: string }[] = [
  { chord: APP_SHORTCUTS[APP_COMMAND.NEXT_RECENT_TAB].chord, label: "Next" },
  { chord: APP_SHORTCUTS[APP_COMMAND.PREVIOUS_RECENT_TAB].chord, label: "Back" },
  { chord: { key: SHORTCUT_KEY.ESCAPE, bare: true }, label: "Cancel" },
];

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

/** How a card wears its stop: its glyph and name, an end mark where its tab wore one, and the words under them. */
interface CardLook extends KindLook {
  readonly endMark?: React.JSX.Element | undefined;
  readonly detail: string | undefined;
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
  if (isBrowserTab(tab) || isCloudBrowserTab(tab)) {
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
  return [...tasks.tasks, ...tasks.archived].find((task) => task.id === taskId)?.name;
}

/** How a card wears its stop, from what the window holds of it now. */
function cardLook(stop: Stop, tasks: TasksControl): CardLook {
  switch (stop.kind) {
    case STOP_KIND.COLUMN:
    case STOP_KIND.PANEL: {
      const strip = stop.kind === STOP_KIND.COLUMN ? LOOK_STRIP.COLUMN : LOOK_STRIP.PANEL;
      const task = [...tasks.tasks, ...tasks.archived].find((each) => each.id === stop.taskId);
      const held: HeldLook | KindLook =
        heldLook(strip, stop.taskId, stop.tab) ?? tabWordLook(stop.tab, task);
      const name = task?.name;
      const words = STRIP_WORDS[stop.kind];
      // The task's own tab is already named for the task, so its card says only the strip.
      const named = name === undefined || name === held.label;
      return {
        icon: held.icon,
        label: held.label,
        endMark: "endMark" in held ? held.endMark : undefined,
        detail: named ? words : `${name} · ${words}`,
      };
    }
    case STOP_KIND.TASK: {
      const task = [...tasks.tasks, ...tasks.archived].find((each) => each.id === stop.taskId);
      return {
        ...tabLook({ kind: TAB_KIND.PLAN, name: task?.name ?? "Task", status: task?.status }),
        detail: undefined,
      };
    }
    case STOP_KIND.PLACE: {
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
      };
    }
    case STOP_KIND.PERSON:
      return { icon: <UserRoundIcon />, label: stop.name ?? PERSON_WORDS, detail: undefined };
  }
}

/** Where the window stands now, as the switcher reads it. */
function standingOf(tab: PanelTab, tasks: TasksControl) {
  const { mainTabs, sidePanel, personView } = tasks;
  const column = mainTabs.tab;
  return shownStops({
    over: tab === PANEL_TAB.SETTINGS || tasks.history.open,
    chat: tasks.chatView.open,
    inbox: tasks.inboxView.open,
    agentId: tasks.agentView.agentId,
    person:
      personView.userId === undefined
        ? undefined
        : { userId: personView.userId, name: personView.name, workspaceId: personView.workspaceId },
    factory: tasks.factoryView.open,
    board: tasks.boardView.open,
    automations: tasks.automationsView.open,
    boundFor: tasks.boundFor,
    openTaskId: tasks.activeTaskId,
    column: sidePanel.fullScreen ? undefined : column,
    panel: sidePanel.open ? sidePanel.tab : undefined,
  });
}

/** The part of the window a stop's still is taken of, in whole CSS pixels; none where it is not drawn. */
function areaOf(stop: Stop): { x: number; y: number; width: number; height: number } | undefined {
  const selector =
    stop.kind === STOP_KIND.COLUMN
      ? COLUMN_AREA
      : stop.kind === STOP_KIND.PANEL
        ? PANEL_AREA
        : PLACE_AREA;
  const box = document.querySelector(selector)?.getBoundingClientRect();
  if (box === undefined || box.width < 1 || box.height < 1) return undefined;
  const x = Math.max(0, Math.round(box.left));
  const y = Math.max(0, Math.round(box.top));
  return { x, y, width: Math.round(box.right) - x, height: Math.round(box.bottom) - y };
}

/** A Browser tab's still drawn again at a card's size, as main keeps the window's own. */
async function downscaled(src: string): Promise<string> {
  const picture = new Image();
  picture.src = src;
  await picture.decode();
  const scale = Math.min(1, BROWSER_STILL_WIDTH / picture.naturalWidth);
  if (scale === 1) return src;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(picture.naturalWidth * scale);
  canvas.height = Math.round(picture.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", BROWSER_STILL_QUALITY);
}

/** Whether the press is the switcher's to hold while it stands: every key but ⌃ itself. */
function claim(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/** One card: its still or its glyph, its name, and the task and strip it stands in. */
function SwitcherCard({
  look,
  still,
  here,
  chosen,
  onPoint,
  onPick,
}: {
  look: CardLook;
  still: string | undefined;
  here: boolean;
  chosen: boolean;
  onPoint: () => void;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <div
      role="option"
      aria-selected={chosen}
      // Note that a card takes no stop of its own, because the keys stay where they were while ⌃ is held, as ⌘Tab's do.
      tabIndex={-1}
      className="tab-switcher-card"
      data-here={here}
      onPointerEnter={onPoint}
      // Note that the card is picked on the press, because ⌃ is held while it is pressed, which a Mac makes a right-click.
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        onPick();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="tab-switcher-preview ph-no-capture">
        {still === undefined ? (
          <span className="tab-switcher-glyph">{look.icon}</span>
        ) : (
          <img className="tab-switcher-still" src={still} alt="" draggable={false} />
        )}
      </div>
      <div className="tab-switcher-name">
        {look.icon}
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
          {look.label}
        </Text>
        {look.endMark}
      </div>
      <div className="tab-switcher-detail">
        {look.detail === undefined ? null : (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
            {look.detail}
          </Text>
        )}
      </div>
    </div>
  );
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
  const shown = useRef<readonly Stop[]>([]);
  const front = useRef<typeof STOP_KIND.COLUMN | typeof STOP_KIND.PANEL>(STOP_KIND.COLUMN);
  const stills = useRef<readonly HeldStill[]>([]);
  const doors = useRef({ tab, tasks, onTabChange });
  doors.current = { tab, tasks, onTabChange };
  const [hold] = useState(holdAtom);
  const startHold = useAtomSet(hold);
  const [settle] = useState(settleAtom);
  const startSettle = useAtomSet(settle);
  useOverlayHold(state.held);

  const move = (next: SwitcherState) => {
    latest.current = next;
    setState(next);
  };

  // The stop on screen that is the most recent, which the cards dim and a let-go there leaves.
  const here = (): Stop | undefined => {
    const first = stops.current[0];
    return first !== undefined && shown.current.some((stop) => sameStop(stop, first))
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

  // A still of the stop as it is drawn now, kept once main answers; a stop no longer on screen by then keeps what it had.
  const takeStill = (stop: Stop) => {
    const browser =
      stop.kind === STOP_KIND.PANEL && typeof stop.tab !== "string" && isBrowserTab(stop.tab)
        ? stop.tab.browser
        : undefined;
    const area = areaOf(stop);
    if (browser === undefined && area === undefined) return;
    const taking =
      browser === undefined
        ? act(ACT_KIND.WINDOW_CAPTURE, area ?? { x: 0, y: 0, width: 0, height: 0 })
        : act(ACT_KIND.BROWSER_CAPTURE, { browserId: browser }).then((src) =>
            src === null ? null : downscaled(src),
          );
    taking.then(
      (src) => {
        if (src !== null) keep(stop, src);
      },
      () => undefined,
    );
  };

  // The window's stops follow where it stands, each render: a stop newly on screen is the most recent.
  const now = standingOf(tab, tasks);
  useEffect(() => {
    const before = shown.current;
    shown.current = now;
    const first = stops.current[0];
    stops.current = arrived(stops.current, before, now, front.current);
    // A tab closed on its task's page is let go then, before a page standing in its place can hide the close.
    standing();
    const settled = stops.current[0];
    if (settled === undefined || (first !== undefined && sameStop(first, settled))) return;
    startSettle({
      take: () => {
        const standingOn = here();
        if (standingOn !== undefined && sameStop(standingOn, settled)) takeStill(settled);
      },
    });
  });

  // The strip the keyboard goes into is the front one, its tab the most recent.
  useEffect(() => {
    const hear = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const kind = event.target.closest(PANEL_AREA)
        ? STOP_KIND.PANEL
        : event.target.closest(COLUMN_AREA)
          ? STOP_KIND.COLUMN
          : undefined;
      if (kind === undefined) return;
      front.current = kind;
      const stop = shown.current.find((each) => each.kind === kind);
      if (stop === undefined || (stops.current[0] && sameStop(stops.current[0], stop))) return;
      stops.current = [stop, ...stops.current.filter((each) => !sameStop(each, stop))];
    };
    window.addEventListener("pointerdown", hear, true);
    window.addEventListener("focusin", hear, true);
    return () => {
      window.removeEventListener("pointerdown", hear, true);
      window.removeEventListener("focusin", hear, true);
    };
  }, []);

  // Goes to a stop through the window's own doors, as any move there would.
  const go = (stop: Stop) => {
    const { tasks: control, tab: shownTab, onTabChange: changeTab } = doors.current;
    if (shownTab !== PANEL_TAB.TASKS) changeTab(PANEL_TAB.TASKS);
    if (stop.kind === STOP_KIND.COLUMN || stop.kind === STOP_KIND.PANEL) front.current = stop.kind;
    switch (stop.kind) {
      case STOP_KIND.COLUMN:
        control.onShowColumnTab(stop.taskId, stop.tab);
        break;
      case STOP_KIND.PANEL:
        control.onShowPanelTab(stop.taskId, stop.tab);
        break;
      case STOP_KIND.TASK:
        control.onRestoreTask(stop.taskId);
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
    // Note that the stop is the most recent now even where the window already showed it, as a column tab beside the panel holding the keys.
    stops.current = [stop, ...stops.current.filter((each) => !sameStop(each, stop))];
  };

  // The stops that still stand: no tab the open task no longer holds, as its strips' own state says, and no task the window no longer lists.
  const standing = (): readonly Stop[] => {
    const control = doors.current.tasks;
    const open = control.activeTaskId;
    stops.current = forgotten(stops.current, (stop) => {
      const taskId = stopTask(stop);
      if (taskId === undefined) return false;
      // Note that the open task is never judged by the list, because a task just made stands open before its row reaches it.
      if (taskId !== open && control.listRead && taskName(control, taskId) === undefined) {
        return true;
      }
      // Note that only the task's own page says which of its tabs stand, because the Inbox or an agent's page standing in its place hands the panel a strip of its own.
      if (taskId !== open || !shown.current.some((each) => stopTask(each) === open)) return false;
      if (stop.kind === STOP_KIND.PANEL) {
        return !control.sidePanel.strip.some((each) => sameTab(each, stop.tab));
      }
      if (stop.kind !== STOP_KIND.COLUMN) return false;
      // Note that an agent's tab is judged only once the task's agents are read, since none stands open before.
      const { openAgents, tabs } = control.mainTabs;
      if (isAgentTab(stop.tab))
        return openAgents !== undefined && !openAgents.includes(stop.tab.agent);
      return !tabs.some((each) => sameTab(each, stop.tab));
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

  if (!state.held || !state.shown) return null;
  const { cards, chosen } = state;
  return createPortal(
    <>
      <div className="tab-switcher-backdrop" aria-hidden="true" />
      <div className="tab-switcher" role="dialog" aria-label="Recent tabs">
        <div className="tab-switcher-cards" role="listbox" aria-label="Recent tabs">
          {cards.map((stop, at) => (
            <SwitcherCard
              key={at}
              look={cardLook(stop, tasks)}
              still={stills.current.find((held) => sameStop(held.stop, stop))?.src}
              here={state.here && at === 0}
              chosen={at === chosen}
              onPoint={() => move(switcherChose(latest.current, at))}
              onPick={() => {
                move(switcherChose(latest.current, at));
                letGo(true);
              }}
            />
          ))}
        </div>
        <div className="tab-switcher-footer" aria-hidden="true">
          {FOOT_HINTS.map((hint) => (
            <span key={hint.label} className="tab-switcher-footer-hint">
              <Shortcut chord={hint.chord} />
              {hint.label}
            </span>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Opens a place through its own door. */
function openPlace(tasks: TasksControl, place: SwitcherPlace): void {
  switch (place) {
    case SWITCHER_PLACE.HOME:
      tasks.onGoHome();
      return;
    case SWITCHER_PLACE.INBOX:
      tasks.inboxView.onOpen();
      return;
    case SWITCHER_PLACE.CHAT:
      tasks.chatView.onOpen();
      return;
    case SWITCHER_PLACE.BOARD:
      tasks.boardView.onOpen();
      return;
    case SWITCHER_PLACE.AUTOMATIONS:
      tasks.automationsView.onOpen();
      return;
    case SWITCHER_PLACE.FACTORY:
      tasks.factoryView.onOpen();
      return;
  }
}
