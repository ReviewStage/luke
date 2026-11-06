export const CLIENT = {
  DESKTOP: "desktop",
  WEB: "web",
} as const;

export type Client = (typeof CLIENT)[keyof typeof CLIENT];

export const STEP = {
  PRESS: "press",
  CLICK: "click",
  RIGHT_CLICK: "right-click",
  HOVER: "hover",
  TYPE: "type",
  WAIT_FOR_TEXT: "wait-for-text",
  SCROLL: "scroll",
} as const;

interface Target {
  readonly role: string;
  readonly name: string;
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
  readonly id: string;
  readonly place: string;
  readonly title: string;
  readonly profile: string;
  readonly steps?: readonly Step[];
  readonly phoneSteps?: readonly Step[];
  readonly sidebar?: true;
  readonly clients?: readonly Client[];
  readonly macOnly?: true;
}

const PLACE = {
  TASKS: "Tasks",
  PLAN: "Plan",
  INBOX: "Inbox",
  PERSON: "Person",
  AGENT: "Agent",
  TERMINAL: "Terminal",
  SETTINGS: "Settings",
  ADMIN: "Admin",
  AUTOMATIONS: "Automations",
  PALETTE: "⌘K",
} as const;

export const PLACES: readonly string[] = Object.values(PLACE);

const OPEN_PALETTE: Step = { kind: STEP.PRESS, keys: "ControlOrMeta+K" };

const MAIN = { role: "main" } as const;
const PHONE_TO_LIST: readonly Step[] = [
  { kind: STEP.CLICK, role: "button", name: "Activity", within: MAIN },
  { kind: STEP.CLICK, role: "button", name: "Tasks", within: MAIN },
];
const PHONE_PLACES = { role: "navigation", name: "Places" } as const;

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
const PHONE_NEW_THREAD: readonly Step[] = [
  { kind: STEP.CLICK, role: "button", name: "Inbox actions", within: MAIN },
  { kind: STEP.CLICK, role: "menuitem", name: "New thread" },
];

const WORKSPACE_MENU: Step = { kind: STEP.CLICK, role: "button", name: "Workspace:" };

const ACCOUNT_MENU: Step = { kind: STEP.CLICK, role: "button", name: "Ada Lovelace", exact: true };
const YOUR_PROFILE: Step = { kind: STEP.CLICK, role: "menuitem", name: "Your profile" };

const EXPAND_PANEL: Step = { kind: STEP.CLICK, role: "button", name: "Expand panel" };
const ANSWERED_THREAD: Step = { kind: STEP.CLICK, role: "button", name: "3 comments" };

const SIDE_PANEL = { role: "complementary", name: "Panel" } as const;
const RESOLVED: Step = { kind: STEP.CLICK, role: "button", name: "Resolved", exact: true };
const TO_RESOLVED: readonly Step[] = [
  { kind: STEP.CLICK, role: "option", name: "Comments" },
  RESOLVED,
];

const PHONE_TASK_ACTIONS: Step = {
  kind: STEP.CLICK,
  role: "button",
  name: "Task actions",
  within: MAIN,
};

const READ_BACK_UP: Step = { kind: STEP.SCROLL, role: "log", by: -600 };

const DESKTOP_ONLY: readonly Client[] = [CLIENT.DESKTOP];

function phoneFace(name: string): Step {
  return { kind: STEP.CLICK, role: "menuitemcheckbox", name };
}

export function pressedOn(keys: string, client: Client): string {
  return client === CLIENT.DESKTOP ? keys.replaceAll("ControlOrMeta", "Meta") : keys;
}

export function drawsOn(scene: Scene, client: Client): boolean {
  return (scene.clients ?? Object.values(CLIENT)).includes(client);
}

export const SCENES: readonly Scene[] = [
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
    phoneSteps: [
      ...PHONE_TO_LIST,
      { kind: STEP.CLICK, role: "button", name: "More", within: PHONE_PLACES },
      WORKSPACE_MENU,
    ],
  },
  {
    id: "plan-transcript",
    place: PLACE.PLAN,
    title: "A call's transcript",
    profile: "tasks-transcript",
  },
  {
    id: "description-comments",
    place: PLACE.PLAN,
    title: "Comment marks",
    profile: "tasks-comments",
    steps: [EXPAND_PANEL],
    phoneSteps: [],
  },
  {
    id: "description-comment-thread",
    place: PLACE.PLAN,
    title: "An open thread",
    profile: "tasks-comments",
    steps: [EXPAND_PANEL, ANSWERED_THREAD],
    phoneSteps: [ANSWERED_THREAD],
  },
  {
    id: "description-comments-resolved",
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
      { kind: STEP.PRESS, keys: "Escape" },
    ],
  },
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
    steps: [READ_BACK_UP],
    phoneSteps: [PHONE_TASK_ACTIONS, phoneFace("Agents"), READ_BACK_UP],
  },
  { id: "agent-checks", place: PLACE.AGENT, title: "Checks", profile: "agent-checks" },
  { id: "agent-files", place: PLACE.AGENT, title: "Files changed", profile: "agent-files" },
  { id: "agent-chapters", place: PLACE.AGENT, title: "Chapters", profile: "agent-chapters" },
  { id: "agent-file", place: PLACE.AGENT, title: "A file tab", profile: "agent-file" },
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
  {
    id: "agent-page",
    place: PLACE.AGENT,
    title: "A Page tab",
    profile: "agent-page",
    clients: DESKTOP_ONLY,
    macOnly: true,
  },
  { id: "settings-account", place: PLACE.SETTINGS, title: "Account", profile: "settings-account" },
  {
    id: "settings-workspace",
    place: PLACE.SETTINGS,
    title: "Workspace",
    profile: "settings-workspace",
  },
  { id: "settings-agents", place: PLACE.SETTINGS, title: "Agents", profile: "settings-agents" },
  {
    id: "settings-hosts",
    place: PLACE.SETTINGS,
    title: "Hosts",
    profile: "settings-hosts",
  },
  {
    id: "settings-integrations",
    place: PLACE.SETTINGS,
    title: "Integrations",
    profile: "settings-integrations",
  },
  { id: "settings-mcp", place: PLACE.SETTINGS, title: "MCP", profile: "settings-mcp" },
  { id: "settings-skills", place: PLACE.SETTINGS, title: "Skills", profile: "settings-skills" },
  { id: "settings-memory", place: PLACE.SETTINGS, title: "Memory", profile: "settings-memory" },
  { id: "admin", place: PLACE.ADMIN, title: "Overview", profile: "admin" },
  {
    id: "admin-users",
    place: PLACE.ADMIN,
    title: "Users",
    profile: "admin",
    steps: [{ kind: STEP.CLICK, role: "radio", name: "Users" }],
  },
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
