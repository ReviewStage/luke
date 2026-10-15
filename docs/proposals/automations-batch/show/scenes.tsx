// scenes.tsx -- the show's scenes: real renderer components over a scripted bridge, one per before/after shot.
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  GITHUB_TRIGGER_EVENT,
} from "@luke/features/automation-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { IDLE_PLANNING_VIEW } from "@luke/features/planning-view";
import { WINDOW_ROLE } from "@luke/gateway/window-session";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { UPDATE_STATUS } from "@luke/settings/update";
import { PLANS_PAGE } from "@luke/ui/planning-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { onRegistry } from "@testing/copy-feedback";
import { plansControl, codingAgentsControl } from "@testing/plans-control";
import { DesktopShell } from "@renderer/desktop/desktop-shell";
import { SIDEBAR_OVERLAY } from "@renderer/desktop/sidebar-collapse";
import { PANEL_TAB } from "@renderer/panel-tabs";
import { AUTOMATIONS_PAGE } from "@renderer/planning/use-plans-tab";
import { TOAST_TONE, ToastHost, useToast } from "@renderer/toast";
import { useEffect } from "react";
import { runAppCommand } from "@renderer/app-commands";
import { AutomationDirectory } from "@renderer/automation-directory";
import { APP_COMMAND } from "@shared/shortcuts";
import { OpenFeedbackProvider } from "@renderer/open-feedback";

declare const SHOW_VARIANT: "before" | "after";
const AFTER = SHOW_VARIANT === "after";
const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

// ---------------------------------------------------------------- pictures
/** A synthetic portrait: a head and shoulders on a soft ground, standing in for a sign-in photo. */
function portrait(ground: string, skin: string, hair: string, shirt: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${ground}"/><circle cx="32" cy="27" r="12" fill="${skin}"/><path d="M19 24c0-9 6-14 13-14s13 5 13 13c-3-4-8-6-13-6s-10 2-13 7z" fill="${hair}"/><path d="M10 64c2-13 11-19 22-19s20 6 22 19z" fill="${shirt}"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
const ME_PHOTO = portrait("#c9d8e8", "#e8b896", "#3b2a20", "#2f4f6f");
const STAGE_PHOTO = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#111"/><path d="M14 46 L32 14 L50 46 Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><rect x="14" y="44" width="36" height="5" fill="#ff5a36"/></svg>`,
)}`;

// ---------------------------------------------------------------- fixture
const ME = { id: "user-dean", email: "dean@example.com", name: "Dean Stratakos" };
const PERSONAL = {
  id: "workspace-personal",
  name: "Dean Stratakos",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  personal: true as const,
  pictureUrl: ME_PHOTO,
};
const STAGE = {
  id: "workspace-stage",
  name: "Stage",
  role: WORKSPACE_ROLE.OWNER,
  github: { login: "ReviewStage", installationId: 1, accountType: "Organization" },
  memberCount: 6,
  photoVersion: "v1",
};
const REPOS = ["ReviewStage/luke", "ReviewStage/stage-web", "ReviewStage/review-bot", "ReviewStage/infra"];

function automation(n: number, patch: Record<string, unknown> = {}) {
  return {
    id: `3f0e6f5c-7d1a-4f6e-9a55-${String(n).padStart(12, "0")}`,
    planId: null,
    planName: null,
    workspaceId: STAGE.id,
    name: `Automation ${n}`,
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "America/Los_Angeles" },
    action: {
      kind: AUTOMATION_ACTION.CODING_AGENT,
      prompt: "Find the flakiest test in CI this week, fix it, and open a pull request.",
      target: { kind: AUTOMATION_TARGET.NEW_AGENT, model: "anthropic/claude-opus-5.5", effort: "high", archiveOnSuccess: true },
    },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: Date.now() + 3_600_000 * 14,
    lastRun: null,
    createdAt: 1,
    repositories: ["ReviewStage/luke"],
    scope: AUTOMATION_SCOPE.PERSONAL,
    ...patch,
  };
}
const FLAKY = automation(1, { name: "Flaky test sweep" });
const REVIEW = automation(2, {
  name: "Code review",
  scope: AUTOMATION_SCOPE.WORKSPACE,
  trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED },
});
const DIGEST = automation(3, {
  name: "Morning digest",
  scope: AUTOMATION_SCOPE.WORKSPACE,
  // Note that before, a run failing again and again never pauses it: FAILURES is never written.
  ...(AFTER && /paused/.test(new URLSearchParams(location.search).get("s") ?? "") ? { pausedReason: "failures", enabled: true } : undefined),
});
const AUTOMATIONS = [FLAKY, REVIEW, DIGEST];

const minutesAgo = (m: number) => Date.now() - m * 60_000;
const RUNS = [
  {
    id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4b1",
    firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: minutesAgo(40) },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: { id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", title: "Fix flaky checkout test", status: "running" },
    firedAt: minutesAgo(40),
    settledAt: minutesAgo(40),
  },
  {
    id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4b2",
    firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: minutesAgo(1480) },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: { id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b22", title: "Stabilise retry timing in webhook test", status: "completed" },
    firedAt: minutesAgo(1480),
    settledAt: minutesAgo(1480),
  },
  {
    id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4b3",
    firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: minutesAgo(2920) },
    status: AUTOMATION_RUN_STATUS.FAILED,
    reason: "repository-unreachable",
    agent: null,
    firedAt: minutesAgo(2920),
    settledAt: minutesAgo(2920),
  },
];

const REVIEW_RUNS = [
  {
    id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4c1",
    firing: { kind: "github", event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, repository: "ReviewStage/luke", number: 2905, title: "⌘K view commands", url: "https://github.com/ReviewStage/luke/pull/2905" },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: { id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b31", title: "Review #2905: ⌘K view commands", status: "running" },
    firedAt: minutesAgo(6),
    settledAt: minutesAgo(6),
  },
  {
    id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4c2",
    firing: { kind: "github", event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, repository: "ReviewStage/luke", number: 2904, title: "Archived as a view", url: "https://github.com/ReviewStage/luke/pull/2904" },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: { id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b32", title: "Review #2904: archived tasks as a view", status: "failed", failure: "sandbox" },
    firedAt: minutesAgo(52),
    settledAt: minutesAgo(40),
  },
  {
    id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4c3",
    firing: { kind: "webhook", bytes: 812 },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: { id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b33", title: "Review requested from CI", status: "completed" },
    firedAt: minutesAgo(180),
    settledAt: minutesAgo(160),
  },
  {
    id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4c4",
    firing: { kind: "manual" },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: { id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b34", title: "Review #2899: Created by filter", status: "completed" },
    firedAt: minutesAgo(400),
    settledAt: minutesAgo(380),
  },
];

const CATALOG = [
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", provider: "anthropic", efforts: ["low", "high"] },
  { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai", efforts: ["low", "high"] },
];

const PLANS = [
  { id: "plan-1", workspaceId: STAGE.id, name: "Automations polish", createdAt: 1, updatedAt: minutesAgo(5), repository: "ReviewStage/luke" },
  { id: "plan-2", workspaceId: STAGE.id, name: "Sidebar model A", createdAt: 1, updatedAt: minutesAgo(60), repository: "ReviewStage/luke" },
  { id: "plan-3", workspaceId: STAGE.id, name: "Review bot presets", createdAt: 1, updatedAt: minutesAgo(200), repository: "ReviewStage/review-bot" },
  { id: "plan-4", workspaceId: STAGE.id, name: "Landing page refresh", createdAt: 1, updatedAt: minutesAgo(900), repository: "ReviewStage/stage-web" },
];

// ---------------------------------------------------------------- agents
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const AGENT_PAGE = {
  id: AGENT_ID,
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix flaky checkout test",
  createdAt: minutesAgo(40),
  status: "completed",
  turnId: null,
  brief: "task",
  automationId: FLAKY.id,
  workspaceId: STAGE.id,
  repository: "ReviewStage/luke",
};
const RUN_PROMPT = `${FLAKY.action.prompt}

---

Luke started this run for the automation "Flaky test sweep" because it was due at 9:00 AM.`;
let callN = 0;
const call = (tool: string, input: unknown, output: unknown) => ({
  type: `tool-${tool}`,
  toolCallId: `call-${(callN += 1)}`,
  state: "output-available",
  input,
  output,
});
const AGENT_MESSAGES = [
  { id: "m1", role: "user", parts: [{ type: "text", text: RUN_PROMPT }] },
  {
    id: "m2",
    role: "assistant",
    startedAt: minutesAgo(40),
    finishedAt: minutesAgo(31),
    parts: [
      { type: "text", text: "I'll start from this week's failed CI runs and the flaky-test issues already filed." },
      call("bash", { command: "gh run list --status failure --created '>2026-10-08' --limit 50" }, { stdout: "checkout.test.ts  failed 7 of 41 runs", exitCode: 0 }),
      call("linear_remote", { remoteTool: "list_issues", parentCallId: "call-0", input: { query: "flaky checkout", team: "STAGE" } }, { issues: [{ identifier: "STAGE-412", title: "checkout.test.ts flakes on CI" }] }),
      call("notion_remote", { remoteTool: "search", parentCallId: "call-0", input: { query: "CI flaky test policy" } }, { results: [{ title: "Flaky test policy" }] }),
      call("grep", { pattern: "waitForPayment", path: "apps/web" }, { matches: 3 }),
      call("read_file", { path: "apps/web/tests/checkout.test.ts" }, { content: "…" }),
      call("apply_patch", { patch: "*** Update File: apps/web/tests/checkout.test.ts" }, { ok: true }),
      call("sentry_remote", { remoteTool: "search_issues", parentCallId: "call-0", input: { query: "PaymentTimeout" } }, { issues: [] }),
      {
        type: "text",
        text: "**checkout.test.ts** raced the payment mock: the test asserted before the mock's promise settled, which failed 7 of 41 runs this week. I awaited the mock's settle, linked STAGE-412, and opened a pull request.",
      },
    ],
  },
];
let agentMode: "automation" | "plan" = "automation";
const { automationId: _none, ...PLAIN_PAGE } = AGENT_PAGE;
const PLAN_AGENT_PAGE = { ...PLAIN_PAGE, automationId: null, title: "Owner picker first", brief: "plan", planId: null };
const PLAN_TEXT = `# Automations polish

## Goal
The automation editor reads owner-first, and leaving a draft asks before it loses it.

## Steps
- Move the Owner row to the top of the editor.
- Draw the account's and the workspace's pictures in the Owner picker.
- Ask before leaving a new automation that has input.`;
const PLAN_AGENT_MESSAGES = [
  { id: "p1", role: "user", parts: [{ type: "text", text: PLAN_TEXT }] },
  {
    id: "p2",
    role: "assistant",
    startedAt: minutesAgo(30),
    finishedAt: minutesAgo(22),
    parts: [
      call("read_file", { path: "apps/desktop/src/renderer/desktop/automation-editor.tsx" }, { content: "…" }),
      call("apply_patch", { patch: "*** Update File: automation-editor.tsx" }, { ok: true }),
      { type: "text", text: "The Owner row now leads the editor, with your picture and the workspace's photo on its chip and in its menu." },
    ],
  },
];
const TREE = ["apps", "apps/web", "apps/web/tests", "apps/web/tests/checkout.test.ts", "apps/web/src/payment.ts", "packages", "README.md", "AGENTS.md"];

// ---------------------------------------------------------------- bridge
/** The workspace's photo as the service stores one: a PNG, drawn from the SVG above. */
let stagePng = "";
async function rasterize(): Promise<void> {
  const image = new Image();
  image.src = STAGE_PHOTO;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  canvas.getContext("2d")?.drawImage(image, 0, 0, 128, 128);
  stagePng = canvas.toDataURL("image/png").split(",")[1] ?? "";
}
function snapshot() {
  return {
    version: 1,
    run: { profile: "show", packaged: false, platform: "darwin", appVersion: "0.14.0", captureMode: false, fixtureMode: false, accountRequired: false, agentTraceEnabled: false },
    settings: appSettingsWire(settingsView({ experiments: { automations: true, factory: true } })),
    account: { status: ACCOUNT_STATUS.SIGNED_IN, provider: "github", pictureUrl: ME_PHOTO, ...ME },
    update: { status: UPDATE_STATUS.IDLE, currentVersion: "0.14.0", installSupported: true, upToDate: true },
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    hotkeys: { talkHeld: true },
    voice: {},
    planning: IDLE_PLANNING_VIEW,
    codingAgents: { unseen: [] },
    inbox: { waiting: [], plans: [], planless: [], automations: [] },
    notifications: { refused: false },
    sessionReplay: { permitted: false, halted: false },
    window: { role: WINDOW_ROLE.PANEL, fullScreen: false },
  };
}

const done = (value: unknown) => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });

let messagesRead = false;
function installBridge(): void {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => ignore,
      recordSurfaceEvent: ignore,
      onAppState: () => ignore,
      requestAppState: () => Promise.resolve(snapshot()),
      act: (request: { kind: string; payload: any }) => {
        switch (request.kind) {
          case ACT_KIND.AUTOMATIONS_LIST:
            return done({ automations: AUTOMATIONS });
          case ACT_KIND.AUTOMATIONS_RUNS:
            return done({ runs: request.payload.automationId === REVIEW.id ? REVIEW_RUNS : RUNS });
          case ACT_KIND.INTEGRATIONS_STATUS:
            return done({
              integrations: Object.fromEntries(
                INTEGRATION_PROVIDER_LIST.map((each) => [each, ["linear", "notion", "sentry", "github", "vercel"].includes(each) ? "connected" : "disconnected"]),
              ),
            });
          case ACT_KIND.CODING_AGENTS_MODELS:
            return done({ models: CATALOG });
          case ACT_KIND.CODING_AGENTS_DEFAULT_READ:
            return done({ choice: { model: "anthropic/claude-opus-5.5", effort: "high" } });
          case ACT_KIND.CODING_AGENTS_WORKSPACE_LIST:
            return done({ agents: [] });
          case ACT_KIND.CODING_AGENTS_PAGE:
            return done({ agent: agentMode === "plan" ? PLAN_AGENT_PAGE : AGENT_PAGE });
          case ACT_KIND.CODING_AGENTS_MESSAGES:
            if (messagesRead) return new Promise(() => undefined);
            messagesRead = true;
            return done({ messages: agentMode === "plan" ? PLAN_AGENT_MESSAGES : AGENT_MESSAGES, cursor: "1:0", status: "completed", title: AGENT_PAGE.title });
          case ACT_KIND.PLANNING_TREE:
            return done({ folder: { path: "", repository: "ReviewStage/luke", branch: "main", truncated: false, entries: TREE.map((name) => ({ name, kind: name.includes(".") ? "file" : "folder" })) } });
          case ACT_KIND.WORKSPACE_PHOTO_READ:
            return done({ contentType: "image/png", base64: stagePng });
          default:
            return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in the show." });
        }
      },
    },
  });
}

// ---------------------------------------------------------------- shell
const SETTINGS = {
  account: { status: ACCOUNT_STATUS.SIGNED_IN, provider: "github", pictureUrl: ME_PHOTO, ...ME },
  onSignOut: () => Promise.resolve(),
  onDeleteAccount: accepted,
  view: SETTINGS_VIEW.ACCOUNT,
  onViewChange: ignore,
  microphone: { status: MICROPHONE_STATUS.GRANTED, voiceAvailable: true, onRequest: ignore, onOpenSettings: ignore },
  notifications: { refused: false, onOpenSettings: ignore },
  updates: {
    update: { status: UPDATE_STATUS.IDLE, currentVersion: "0.14.0", installSupported: true, upToDate: true },
    build: { packaged: false },
    onCheck: () => Promise.resolve(),
    onInstall: ignore,
    onOpenLatest: ignore,
  },
  shortcuts: {
    voiceHotkeyHeld: false,
    voiceChosen: false,
    voiceOff: false,
    onVoiceHotkeyChange: accepted,
    stopChosen: false,
    stopOff: false,
    onStopHotkeyChange: accepted,
    onCapture: ignore,
  },
};

/** The chooser every repository picker reads: the workspace's repositories, as the real builder words them. */
function repositoriesIn(workspaceId: string | undefined) {
  const workspace = [PERSONAL, STAGE].find((each) => each.id === workspaceId) ?? STAGE;
  return {
    recent: ["ReviewStage/luke", "ReviewStage/review-bot"],
    read: () =>
      Promise.resolve({
        repositories: {
          installed: true,
          installationUrl: "https://github.com/apps/luke",
          repositories: REPOS.map((fullName, n) => ({
            owner: fullName.split("/")[0],
            name: fullName.split("/")[1],
            fullName,
            defaultBranch: "main",
            private: true,
            updatedAt: Date.now() - n * 86_400_000,
          })),
        },
      }),
    openGitHub: ignore,
    pictures: false,
    scope: workspace.id,
    manages: true,
    workspaceName: workspace.name,
    connected: true,
    // Note that the before tree words its heading here, in use-plans-tab.ts; the after tree drops it.
    ...(AFTER ? undefined : { source: `${STAGE.github.login} on GitHub · ${STAGE.name}` }),
  };
}

function shellPlans(overrides: Record<string, unknown> = {}) {
  const base = plansControl();
  return plansControl({
    page: PLANS_PAGE.HOME,
    plans: PLANS as never,
    workspaces: [PERSONAL, STAGE] as never,
    workspace: STAGE as never,
    repositories: repositoriesIn(STAGE.id) as never,
    newPlan: { ...base.newPlan, workspaces: [PERSONAL, STAGE] as never, workspaceId: STAGE.id, repositoriesIn: repositoriesIn as never },
    ...overrides,
  } as never);
}

function Shell({ plans }: { plans: ReturnType<typeof plansControl> }) {
  return createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, onCancelSignIn: ignore },
    tab: PANEL_TAB.PLANS,
    onTabChange: ignore,
    plans,
    history: { canGoBack: true, canGoForward: false, onBack: ignore, onForward: ignore, onLeaveVersionHistory: ignore },
    sidebar: { collapsed: false, compact: false, overlay: SIDEBAR_OVERLAY.CLOSED, width: 248, onToggle: ignore, onOverlay: ignore, onResize: ignore, staged: false },
    call: undefined,
    captions: { caption: { content: undefined, shown: false }, volumeHint: { wanted: false, text: "", onDismiss: ignore } },
    settings: SETTINGS as never,
  } as never);
}

/** The window's stage, as `app.tsx` frames the shell. */
function Stage({ children }: { children: ReactElement }) {
  return createElement(
    OpenFeedbackProvider as never,
    { value: ignore },
    createElement(
      "div",
      { className: "app-stage", "data-surface": "desktop", style: { "--sidebar-width": "248px" } },
      createElement("div", { className: "desktop-stage" }, children),
      createElement(ToastHost),
    ),
  );
}

// ---------------------------------------------------------------- scenes
type Scene = { render: () => ReactElement; then?: () => Promise<void> };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(find: () => T | null | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() > end) throw new Error("scene: never found what it waited for");
    await wait(30);
  }
}
/** Types into a React-controlled field as a keyboard would. */
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.getAttribute("aria-label") === name || each.textContent?.trim() === name,
  );

function automationShell(place: unknown) {
  return () =>
    createElement(Stage, {
      children: createElement(Shell, {
        plans: shellPlans({ automationsView: { open: true, place, onOpen: ignore, onClose: ignore } }),
      }),
    });
}

function newTaskShell() {
  return () => {
    const base = plansControl();
    return createElement(Stage, {
      children: createElement(Shell, {
        plans: shellPlans({
          newPlan: {
            ...base.newPlan,
            open: true,
            workspaces: [PERSONAL, STAGE],
            workspaceId: STAGE.id,
            repositoriesIn,
          },
        }),
      }),
    });
  };
}

function agentShell(mode: "automation" | "plan" = "automation") {
  return () => {
    agentMode = mode;
    return createElement(Stage, {
      children: createElement(AutomationDirectory as never, {
        workspace: STAGE,
        on: true,
        wanted: true,
        onOpen: ignore,
        children: createElement(Shell, {
          plans: shellPlans({ agentView: { agentId: AGENT_ID, onOpen: ignore, onClose: ignore } }),
        }),
      }),
    });
  };
}

/** Before, an origin card is shown at a plan column's reading width, where task agents stand, rather than the one-off page's full width. */
async function asInPlanColumn(): Promise<void> {
  if (AFTER) return;
  const page = await until(() => document.querySelector(".agent-page"));
  page.classList.add("desktop-agent");
}

let toasted = false;
/** Says one toast as the window would, after: what main hands the window for an agent's end or a run's failure. */
function Toasting({ words, detail, failed, children }: { words: string; detail: string; failed: boolean; children: ReactElement }) {
  const toast = useToast();
  useEffect(() => {
    if (!AFTER || toasted) return;
    toasted = true;
    toast({ words, detail, waits: true, persists: true, subject: "show", tone: failed ? TOAST_TONE.FAILED : TOAST_TONE.DONE, action: { label: "View", onPress: ignore } } as never);
  }, [toast, words, detail, failed]);
  return children;
}

function toastShell(place: unknown, words: string, detail: string, failed: boolean) {
  return () =>
    createElement(Stage, {
      children: createElement(Toasting, {
        words,
        detail,
        failed,
        children: createElement(Shell, {
          plans: shellPlans({ automationsView: { open: true, place, onOpen: ignore, onClose: ignore } }),
        }),
      }),
    });
}

const SCENES: Record<string, Scene> = {
  "editor-review": { render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: REVIEW.id }) },
  "editor-servers": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: FLAKY.id }),
    then: async () => {
      const scroller = await until(() => document.querySelector(".automations-scroll"));
      scroller.scrollTop = scroller.scrollHeight;
      const button = document.querySelector<HTMLButtonElement>(".automation-servers .agent-servers-button");
      button?.click();
    },
  },
  "list-paused": { render: automationShell({ kind: AUTOMATIONS_PAGE.LIST }) },
  "editor-paused": { render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: DIGEST.id }) },
  "agent-end": {
    render: toastShell({ kind: AUTOMATIONS_PAGE.LIST }, "Fix flaky checkout test opened #2911", "Flaky test sweep", false),
    // Note that the picture keeps one toast: the scripted window says the end once, as main hands it.
    then: async () => {
      await wait(500);
      const toasts = [...document.querySelectorAll(".toast")];
      for (const extra of toasts.slice(1)) extra.remove();
    },
  },
  "run-failed": {
    render: toastShell({ kind: AUTOMATIONS_PAGE.LIST }, "Code review failed", "Review #2904: its agent failed: the sandbox or checkout failed", true),
    // Note that the picture keeps one toast: the scripted window says the end once, as main hands it.
    then: async () => {
      await wait(500);
      const toasts = [...document.querySelectorAll(".toast")];
      for (const extra of toasts.slice(1)) extra.remove();
    },
  },
  agent: { render: agentShell() },
  "agent-tools": {
    render: agentShell(),
    then: async () => {
      const fold = await until(() => [...document.querySelectorAll<HTMLElement>("summary, button")].find((each) => /tool calls/.test(each.textContent ?? "")));
      fold.click();
    },
  },
  "agent-origin-open": {
    render: agentShell(),
    then: async () => {
      await asInPlanColumn();
      const head = await until(() => document.querySelector<HTMLElement>("[data-plan-card] summary"));
      head.click();
    },
  },
  "agent-plan": { render: agentShell("plan"), then: async () => asInPlanColumn() },
  "agent-plan-open": {
    render: agentShell("plan"),
    then: async () => {
      await asInPlanColumn();
      const head = await until(() => document.querySelector<HTMLElement>("[data-plan-card] summary"));
      head.click();
    },
  },
  "agent-find": {
    render: agentShell(),
    then: async () => {
      await until(() => document.querySelector("[role='log']"));
      await wait(200);
      runAppCommand(APP_COMMAND.FIND);
      await wait(100);
      const field = await until(() => document.querySelector<HTMLInputElement>(".find-bar input"), 1500);
      typeInto(field, "checkout");
    },
  },
  "agent-mention": {
    render: agentShell(),
    then: async () => {
      const box = await until(() => document.querySelector<HTMLElement>(".agent-composer [contenteditable='true'], .agent-composer textarea"));
      box.focus();
      document.execCommand("insertText", false, "Also check @");
      await wait(600);
      document.execCommand("insertText", false, "che");
    },
  },
  "new-task": { render: newTaskShell() },
  "new-task-workspace": {
    render: newTaskShell(),
    then: async () => {
      const chip = await until(() => document.querySelector<HTMLButtonElement>(".new-plan-dialog .new-plan-workspace button"));
      chip.click();
    },
  },
  "new-task-repo": {
    render: newTaskShell(),
    then: async () => {
      const chip = await until(() => document.querySelector<HTMLButtonElement>(".new-plan-dialog .repository-chip button"));
      chip.click();
    },
  },
  editor: { render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: FLAKY.id }) },
  "editor-owner-open": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: FLAKY.id }),
    then: async () => {
      const chip = await until(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Owner"]'));
      const scroller = document.querySelector(".automations-scroll");
      if (scroller !== null && !AFTER) scroller.scrollTop = scroller.scrollHeight;
      chip.click();
    },
  },
  "editor-new": { render: automationShell({ kind: AUTOMATIONS_PAGE.NEW }) },
  "editor-bottom": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: FLAKY.id }),
    then: async () => {
      const scroller = await until(() => document.querySelector(".automations-scroll"));
      scroller.scrollTop = scroller.scrollHeight;
    },
  },
  "editor-repo-open": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: FLAKY.id }),
    then: async () => {
      const scroller = await until(() => document.querySelector(".automations-scroll"));
      scroller.scrollTop = 520;
      const chip = await until(() => document.querySelector<HTMLButtonElement>(".repository-chip button"));
      chip.click();
    },
  },
  "editor-leave-new": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.NEW }),
    then: async () => {
      const name = await until(() => document.querySelector<HTMLInputElement>(".automation-editor-name"));
      typeInto(name, "Weekly dependency bumps");
      await wait(100);
      button("Automations")?.click();
    },
  },
  "editor-runs-resize": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: FLAKY.id }),
    then: async () => {
      localStorage.removeItem("luke.automationRunsPanel");
      const edge = await until(() => document.querySelector<HTMLElement>(".automation-runs .side-panel-resize"));
      edge.style.background = "color-mix(in srgb, var(--message-sent) 55%, transparent)";
    },
  },
  "editor-runs-hidden": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.EDIT, automationId: FLAKY.id }),
    then: async () => {
      const toggle = await until(() => button("Hide runs"));
      toggle.click();
      await wait(100);
      localStorage.removeItem("luke.automationRunsPanel");
    },
  },
  list: { render: automationShell({ kind: AUTOMATIONS_PAGE.LIST }) },
  sidebar: { render: automationShell({ kind: AUTOMATIONS_PAGE.LIST }) },
  "list-find": {
    render: automationShell({ kind: AUTOMATIONS_PAGE.LIST }),
    then: async () => {
      await until(() => document.querySelector(".automation-row"));
      runAppCommand(APP_COMMAND.FIND);
      const field = await until(() => document.querySelector<HTMLInputElement>(".find-bar input"), 1500);
      typeInto(field, "review");
    },
  },
};

// ---------------------------------------------------------------- mount
const params = new URLSearchParams(location.search);
const scene = SCENES[params.get("s") ?? ""];
localStorage.clear();
installBridge();
(window as unknown as { __showFailedRuns: number }).__showFailedRuns = AFTER && params.get("s") === "run-failed" ? 1 : 0;
(window as unknown as { __showAgents: unknown }).__showAgents = [
  { id: "a1", title: "Fix flaky checkout test", repository: "ReviewStage/luke", at: minutesAgo(31), automation: "Flaky test sweep", unread: true },
  { id: "a2", title: "Review #2905: ⌘K view commands", repository: "ReviewStage/luke", at: minutesAgo(95), automation: "Code review", unread: false },
  { id: "a3", title: "Digest of open pull requests", repository: "ReviewStage/review-bot", at: minutesAgo(700), automation: "Morning digest", unread: false },
];
const container = document.getElementById("root");
if (scene === undefined || container === null) {
  document.body.textContent = `No scene ${params.get("s")}`;
} else {
  void (async () => {
    await rasterize();
    createRoot(container).render(onRegistry(AtomRegistry.make(), scene.render()));
    await wait(400);
    try {
      await scene.then?.();
    } catch (error) {
      console.error(error);
    }
    await wait(400);
    document.body.dataset.ready = "true";
  })();
}
void button;
void codingAgentsControl;
void useState;
