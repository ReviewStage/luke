/**
 * scenes.ts -- the polish capture's manifest: every place of the app it shoots, the fixture profile each scene opens on, and the steps that open a menu, a dialog, a card or a state over it.
 *
 * A scene is one picture's worth of the app. Its profile is a launch
 * profile (`RUN_PROFILE`, `packages/host/src/app-state.ts`), which the
 * desktop is handed as `--profile` and the web client reads off its
 * address as `?fixture=`, so both draw the same synthetic data. Its steps
 * run after the profile has drawn, in order, with the same selectors on
 * either client, since both mount the one panel. A step that finds nothing
 * is written beside the picture rather than failing the run, so a polish
 * pass still sees what the scene drew. A scene whose steps press something in
 * the sidebar says so (`sidebar`), and the runner floats the sidebar open
 * first wherever the window folds it away.
 *
 * The profile names are spelled here rather than imported, because this
 * runs as a plain node script that resolves no workspace package; a name
 * the app no longer knows opens the idle window, which the contact sheet
 * makes plain at a glance.
 */

/** Which client a scene is drawn by: the Electron app, or the web client in Chromium. */
export const CLIENT = {
  DESKTOP: "desktop",
  WEB: "web",
} as const;

export type Client = (typeof CLIENT)[keyof typeof CLIENT];

/** Which of the desktop's windows a scene shoots: the panel's, or the floating call window. */
export const WINDOW = {
  PANEL: "panel",
  CALL: "call",
} as const;

export type SceneWindow = (typeof WINDOW)[keyof typeof WINDOW];

/** What a step does. */
export const STEP = {
  /** Presses a chord, Playwright's spelling (`ControlOrMeta+K`), as the client presses it (`pressedOn`). */
  PRESS: "press",
  /** Clicks the first element of an ARIA role and accessible name. */
  CLICK: "click",
  /** Right-clicks the first element of an ARIA role and accessible name. */
  RIGHT_CLICK: "right-click",
  /** Hovers the first element of an ARIA role and accessible name, as a hover card asks. */
  HOVER: "hover",
  /** Types words into whatever holds the focus. */
  TYPE: "type",
  /** Waits until some element shows these words. */
  WAIT_FOR_TEXT: "wait-for-text",
  /** Scrolls the first element of an ARIA role by some pixels, up where negative, as a transcript read back up is. */
  SCROLL: "scroll",
} as const;

/** An element by its ARIA role and accessible name, which it holds among other words unless `exact`, looked for within a landmark where one is named. */
interface Target {
  readonly role: string;
  readonly name: string;
  /** Whether the name is the element's whole name, where another element's holds it among more words. */
  readonly exact?: true;
  readonly within?: { readonly role: string; readonly name?: string };
}

export type Step =
  | { readonly kind: typeof STEP.PRESS; readonly keys: string }
  | ({ readonly kind: typeof STEP.CLICK } & Target)
  | ({ readonly kind: typeof STEP.RIGHT_CLICK } & Target)
  | ({ readonly kind: typeof STEP.HOVER } & Target)
  | { readonly kind: typeof STEP.TYPE; readonly text: string }
  | { readonly kind: typeof STEP.WAIT_FOR_TEXT; readonly text: string }
  | { readonly kind: typeof STEP.SCROLL; readonly role: string; readonly by: number };

export interface Scene {
  /** Unique, and the folder its pictures are written to. */
  readonly id: string;
  /** The place it belongs to, which the contact sheet groups by. */
  readonly place: string;
  readonly title: string;
  /** The launch profile it opens on. */
  readonly profile: string;
  readonly steps?: readonly Step[];
  /** The steps in the phone's layout, whose sidebar is a drawer and whose places sit in a bar at the foot, which is the web's 390px and the desktop's 608 CSS px at zoom; `steps` where absent. */
  readonly phoneSteps?: readonly Step[];
  /** Whether `steps` press something in the sidebar, which a window too narrow to pin it folds away: the runner presses "Show sidebar" first there. The phone layout's drawer is `phoneSteps`' own. */
  readonly sidebar?: true;
  /** The clients that draw it; both where absent. */
  readonly clients?: readonly Client[];
  /** The desktop window it shoots; the panel's where absent. */
  readonly window?: SceneWindow;
  /** Drawn only on the Mac (the call window, the video tile, a Page tab's HTML), so skipped on Linux with a note. */
  readonly macOnly?: true;
}

// The places, in the contact sheet's order.
const PLACE = {
  TASKS: "Tasks",
  PLAN: "Plan",
  CHAT: "Chat",
  INBOX: "Inbox",
  PERSON: "Person",
  AGENT: "Agent",
  TERMINAL: "Terminal",
  CALL: "Call",
  VOICE: "Voice",
  SETTINGS: "Settings",
  ADMIN: "Admin",
  AUTOMATIONS: "Automations",
  PALETTE: "⌘K",
} as const;

export const PLACES: readonly string[] = Object.values(PLACE);

// The steps a few scenes share.
// Note that this is `ControlOrMeta`, which Playwright presses as Ctrl off a Mac, because the web client presses Command as Ctrl there (`COMMAND_KEY`, `packages/settings/src/shortcuts.ts`); the desktop presses it as Meta (`pressedOn`).
const OPEN_PALETTE: Step = { kind: STEP.PRESS, keys: "ControlOrMeta+K" };

// A phone opens on the task's panel: back to the task, then back to the Tasks list.
const MAIN = { role: "main" } as const;
const PHONE_TO_LIST: readonly Step[] = [
  { kind: STEP.CLICK, role: "button", name: "Activity", within: MAIN },
  { kind: STEP.CLICK, role: "button", name: "Tasks", within: MAIN },
];
const PHONE_PLACES = { role: "navigation", name: "Places" } as const;

// The Inbox, by the sidebar's row or a phone's places bar, and back from the item it opens on to its
// list, which a window too narrow for both shows alone; at full width Esc leaves the list as it stands.
// A phone's places bar opens it on its list already.
const OPEN_INBOX: Step = { kind: STEP.CLICK, role: "button", name: "Inbox" };
const TO_INBOX_LIST: Step = { kind: STEP.PRESS, keys: "Escape" };
const PHONE_TO_INBOX: readonly Step[] = [
  TO_INBOX_LIST,
  { kind: STEP.CLICK, role: "button", name: "Inbox", within: PHONE_PLACES },
];
const LONG_THREAD: Step = {
  kind: STEP.CLICK,
  role: "button",
  name: "What the expired invite page says",
};
const FORM_ITEM: Step = { kind: STEP.CLICK, role: "button", name: "Invite limits" };
const NEW_THREAD: Step = { kind: STEP.CLICK, role: "button", name: "New thread" };
// A phone's Inbox head has no compose button: New thread is the first row of its ⋯ menu.
const PHONE_NEW_THREAD: readonly Step[] = [
  { kind: STEP.CLICK, role: "button", name: "Inbox actions", within: MAIN },
  { kind: STEP.CLICK, role: "menuitem", name: "New thread" },
];

// The workspace switcher at the sidebar's head, named "Workspace: {name}" among more words.
const WORKSPACE_MENU: Step = { kind: STEP.CLICK, role: "button", name: "Workspace:" };

// The account's menu at the sidebar's foot, named as the workspace's switcher is named within more words.
const ACCOUNT_MENU: Step = { kind: STEP.CLICK, role: "button", name: "Ada Lovelace", exact: true };
const YOUR_PROFILE: Step = { kind: STEP.CLICK, role: "menuitem", name: "Your profile" };

// The plan's side panel widened over the task, and the count at the end of the line whose thread holds three comments, which opens it.
const EXPAND_PANEL: Step = { kind: STEP.CLICK, role: "button", name: "Expand panel" };
const ANSWERED_THREAD: Step = { kind: STEP.CLICK, role: "button", name: "3 comments" };

// The task's Comments tab, from the side panel's own "Open a tab" (a phone's Activity), on its resolved threads.
const SIDE_PANEL = { role: "complementary", name: "Panel" } as const;
const RESOLVED: Step = { kind: STEP.CLICK, role: "button", name: "Resolved", exact: true };
const TO_RESOLVED: readonly Step[] = [
  { kind: STEP.CLICK, role: "option", name: "Comments" },
  RESOLVED,
];

// A phone shows one of the open task's faces at a time, which its head's menu chooses.
const PHONE_TASK_ACTIONS: Step = {
  kind: STEP.CLICK,
  role: "button",
  name: "Task actions",
  within: MAIN,
};

// The agent's transcript read back up from its newest line.
const READ_BACK_UP: Step = { kind: STEP.SCROLL, role: "log", by: -600 };

const DESKTOP_ONLY: readonly Client[] = [CLIENT.DESKTOP];

/** The press on a phone's task head menu's face named `name`, which the task then shows. */
function phoneFace(name: string): Step {
  return { kind: STEP.CLICK, role: "menuitemcheckbox", name };
}

/**
 * The keys a press step presses on `client`. The web client presses Command
 * as its browser's system has it, which is Playwright's `ControlOrMeta` on
 * the machine shooting it; the desktop app is a Mac's alone and presses it as
 * ⌘ wherever it is shot, Linux under xvfb too, so there it is Meta.
 */
export function pressedOn(keys: string, client: Client): string {
  return client === CLIENT.DESKTOP ? keys.replaceAll("ControlOrMeta", "Meta") : keys;
}

/** Whether `client` draws `scene`: every client does where the scene names none. */
export function drawsOn(scene: Scene, client: Client): boolean {
  return (scene.clients ?? Object.values(CLIENT)).includes(client);
}

export const SCENES: readonly Scene[] = [
  // Tasks: the list, the open task, and its menus.
  { id: "tasks-open", place: PLACE.TASKS, title: "An open task", profile: "tasks" },
  {
    id: "tasks-list",
    place: PLACE.TASKS,
    title: "The Tasks list",
    profile: "tasks",
    sidebar: true,
    steps: [{ kind: STEP.CLICK, role: "button", name: "Tasks" }],
    phoneSteps: PHONE_TO_LIST,
  },
  {
    id: "tasks-new",
    place: PLACE.TASKS,
    title: "New task",
    profile: "tasks",
    sidebar: true,
    steps: [{ kind: STEP.CLICK, role: "button", name: "New task" }],
    phoneSteps: [
      ...PHONE_TO_LIST,
      { kind: STEP.CLICK, role: "button", name: "New task", within: MAIN },
    ],
  },
  {
    id: "tasks-row-menu",
    place: PLACE.TASKS,
    title: "A task row's menu",
    profile: "tasks",
    sidebar: true,
    steps: [{ kind: STEP.RIGHT_CLICK, role: "button", name: "Teammate invitations" }],
    phoneSteps: [
      ...PHONE_TO_LIST,
      { kind: STEP.CLICK, role: "button", name: "Task actions", within: MAIN },
    ],
  },
  {
    id: "tasks-view-options",
    place: PLACE.TASKS,
    title: "The sidebar's view options",
    profile: "tasks",
    sidebar: true,
    steps: [{ kind: STEP.CLICK, role: "button", name: "View options" }],
    phoneSteps: [
      ...PHONE_TO_LIST,
      { kind: STEP.CLICK, role: "button", name: "Task list actions", within: MAIN },
    ],
  },
  {
    id: "tasks-workspace-menu",
    place: PLACE.TASKS,
    title: "The workspace menu",
    profile: "tasks",
    sidebar: true,
    steps: [WORKSPACE_MENU],
    // Note that "More" only opens the drawer the switcher stands in, so the scene opens its menu too.
    phoneSteps: [
      ...PHONE_TO_LIST,
      { kind: STEP.CLICK, role: "button", name: "More", within: PHONE_PLACES },
      WORKSPACE_MENU,
    ],
  },
  // The plan's other faces.
  { id: "plan-board", place: PLACE.PLAN, title: "The whiteboard", profile: "tasks-board" },
  {
    id: "plan-transcript",
    place: PLACE.PLAN,
    title: "A call's transcript",
    profile: "tasks-transcript",
  },
  // The plan's comment threads: their marks in the words, one opened from its line's count, and the resolved one in the Comments tab.
  {
    id: "plan-comments",
    place: PLACE.PLAN,
    title: "Comment marks",
    profile: "tasks-comments",
    steps: [EXPAND_PANEL],
    phoneSteps: [],
  },
  {
    id: "plan-comment-thread",
    place: PLACE.PLAN,
    title: "An open thread",
    profile: "tasks-comments",
    steps: [EXPAND_PANEL, ANSWERED_THREAD],
    phoneSteps: [ANSWERED_THREAD],
  },
  {
    id: "plan-comments-resolved",
    place: PLACE.PLAN,
    title: "A resolved thread",
    profile: "tasks-comments",
    steps: [
      { kind: STEP.CLICK, role: "button", name: "Open a tab", within: SIDE_PANEL },
      ...TO_RESOLVED,
    ],
    phoneSteps: [
      PHONE_TASK_ACTIONS,
      phoneFace("Activity"),
      { kind: STEP.CLICK, role: "button", name: "Comments", within: MAIN },
      RESOLVED,
    ],
  },
  // Chat.
  { id: "chat", place: PLACE.CHAT, title: "For you", profile: "chat" },
  // The Inbox.
  {
    id: "inbox",
    place: PLACE.INBOX,
    title: "The Inbox",
    profile: "inbox",
    sidebar: true,
    steps: [OPEN_INBOX],
    phoneSteps: PHONE_TO_INBOX,
  },
  {
    id: "inbox-thread",
    place: PLACE.INBOX,
    title: "A long thread",
    profile: "inbox",
    sidebar: true,
    steps: [OPEN_INBOX, TO_INBOX_LIST, LONG_THREAD],
    phoneSteps: [...PHONE_TO_INBOX, LONG_THREAD],
  },
  {
    id: "inbox-form",
    place: PLACE.INBOX,
    title: "A form",
    profile: "inbox",
    sidebar: true,
    steps: [OPEN_INBOX, TO_INBOX_LIST, FORM_ITEM],
    phoneSteps: [...PHONE_TO_INBOX, FORM_ITEM],
  },
  {
    id: "inbox-new-thread",
    place: PLACE.INBOX,
    title: "New thread",
    profile: "inbox",
    sidebar: true,
    steps: [OPEN_INBOX, TO_INBOX_LIST, NEW_THREAD],
    phoneSteps: [...PHONE_TO_INBOX, ...PHONE_NEW_THREAD],
  },
  // A person's page: the account's own, from its menu at the sidebar's foot.
  {
    id: "person",
    place: PLACE.PERSON,
    title: "Your profile",
    profile: "person",
    sidebar: true,
    steps: [ACCOUNT_MENU, YOUR_PROFILE],
    phoneSteps: [
      TO_INBOX_LIST,
      { kind: STEP.CLICK, role: "button", name: "More", within: PHONE_PLACES },
      ACCOUNT_MENU,
      YOUR_PROFILE,
      // Note that the drawer stands open over the page it opened, so the scene closes it.
      { kind: STEP.PRESS, keys: "Escape" },
    ],
  },
  // A coding agent and its tabs.
  {
    id: "agent-pull-request",
    place: PLACE.AGENT,
    title: "Pull request",
    profile: "agent-pull-request",
  },
  {
    id: "agent-transcript-scrolled",
    place: PLACE.AGENT,
    title: "A long transcript, scrolled up",
    profile: "agent-transcript",
    // Note that the agent's transcript is the window's first log, and read back up it floats the way back to its newest line.
    steps: [READ_BACK_UP],
    phoneSteps: [PHONE_TASK_ACTIONS, phoneFace("Agents"), READ_BACK_UP],
  },
  { id: "agent-checks", place: PLACE.AGENT, title: "Checks", profile: "agent-checks" },
  { id: "agent-files", place: PLACE.AGENT, title: "Files changed", profile: "agent-files" },
  { id: "agent-chapters", place: PLACE.AGENT, title: "Chapters", profile: "agent-chapters" },
  { id: "agent-file", place: PLACE.AGENT, title: "A file tab", profile: "agent-file" },
  // The Terminal, one scene per state it draws.
  { id: "terminal", place: PLACE.TERMINAL, title: "Attached", profile: "agent-terminal" },
  {
    id: "terminal-connecting",
    place: PLACE.TERMINAL,
    title: "Connecting",
    profile: "agent-terminal-connecting",
  },
  {
    id: "terminal-reconnecting",
    place: PLACE.TERMINAL,
    title: "Reconnecting",
    profile: "agent-terminal-reconnecting",
  },
  { id: "terminal-idle", place: PLACE.TERMINAL, title: "Idle", profile: "agent-terminal-idle" },
  {
    id: "terminal-exited",
    place: PLACE.TERMINAL,
    title: "Exited",
    profile: "agent-terminal-exited",
  },
  {
    id: "terminal-stopped",
    place: PLACE.TERMINAL,
    title: "Stopped",
    profile: "agent-terminal-stopped",
  },
  {
    id: "terminal-starting",
    place: PLACE.TERMINAL,
    title: "Starting",
    profile: "agent-terminal-starting",
  },
  {
    id: "terminal-unreachable",
    place: PLACE.TERMINAL,
    title: "Unreachable",
    profile: "agent-terminal-unreachable",
  },
  // What only the Mac draws.
  {
    id: "agent-page",
    place: PLACE.AGENT,
    title: "A Page tab",
    profile: "agent-page",
    clients: DESKTOP_ONLY,
    macOnly: true,
  },
  {
    id: "call-panel",
    place: PLACE.CALL,
    title: "Mid-call, video off",
    profile: "agent-call",
    clients: DESKTOP_ONLY,
    macOnly: true,
  },
  {
    id: "call-window",
    place: PLACE.CALL,
    title: "The floating call window",
    profile: "agent-call",
    clients: DESKTOP_ONLY,
    window: WINDOW.CALL,
    macOnly: true,
  },
  {
    id: "call-video",
    place: PLACE.CALL,
    title: "The video tile",
    profile: "agent-call-video",
    clients: DESKTOP_ONLY,
    macOnly: true,
  },
  // The voice, as a fixture run stages it. Note that the voice profiles stage no call and no window of
  // their own: the hidden voice window draws nothing, and the call window opens only on a call profile's
  // staged call (`packages/host/src/fixture-stage.ts`). What they steer is the panel's voice notice
  // (`packages/panel/src/window-voice.tsx`), where Luke speaking, alone or over the developer, only hides
  // the failure lines, so the panel draws the idle window as it does unstaged; Output off draws the volume
  // hint over it, the one picture they give. The web client has no voice at all.
  {
    id: "voice-muted",
    place: PLACE.VOICE,
    title: "Output off: the volume hint",
    profile: "muted",
    clients: DESKTOP_ONLY,
  },
  // Settings, page by page.
  { id: "settings-account", place: PLACE.SETTINGS, title: "Account", profile: "settings-account" },
  {
    id: "settings-workspace",
    place: PLACE.SETTINGS,
    title: "Workspace",
    profile: "settings-workspace",
  },
  { id: "settings-agents", place: PLACE.SETTINGS, title: "Agents", profile: "settings-agents" },
  {
    id: "settings-integrations",
    place: PLACE.SETTINGS,
    title: "Integrations",
    profile: "settings-integrations",
  },
  { id: "settings-skills", place: PLACE.SETTINGS, title: "Skills", profile: "settings-skills" },
  { id: "settings-memory", place: PLACE.SETTINGS, title: "Memory", profile: "settings-memory" },
  // Admin.
  { id: "admin", place: PLACE.ADMIN, title: "Overview", profile: "admin" },
  // Automations.
  { id: "automations", place: PLACE.AUTOMATIONS, title: "The list", profile: "automations" },
  {
    id: "automations-editor",
    place: PLACE.AUTOMATIONS,
    title: "An automation's editor",
    profile: "automations-editor",
  },
  {
    id: "automations-runs",
    place: PLACE.AUTOMATIONS,
    title: "A failed run",
    profile: "automations-runs",
  },
  {
    id: "automations-runs-tab",
    place: PLACE.AUTOMATIONS,
    title: "Every automation's runs",
    profile: "automations",
    steps: [{ kind: STEP.CLICK, role: "radio", name: "Runs" }],
  },
  // ⌘K over a task.
  {
    id: "palette",
    place: PLACE.PALETTE,
    title: "Opened",
    profile: "tasks",
    steps: [OPEN_PALETTE],
  },
  {
    id: "palette-search",
    place: PLACE.PALETTE,
    title: "Searching",
    profile: "tasks",
    steps: [OPEN_PALETTE, { kind: STEP.TYPE, text: "theme" }],
  },
];
