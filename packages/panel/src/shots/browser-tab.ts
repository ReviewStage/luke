/**
 * browser-tab.ts -- 0.23.0 shot "The Browser tab": the Invite emails agent's cloud browser live in a Browser tab beside the plan's, the panel filling the window, on Relay's accept page, the agent's pointer resting on Accept invite.
 *
 * Throwaway (`README.md`). The task's one browser tab is the running agent's,
 * on acme.relay.dev's accept link. Its live view comes over a port main
 * posts to the window; here the shot posts it itself, as main would, and
 * hands it the page's address and one frame (`relay-pictures.ts`'s accept
 * page). The pointer is drawn from the tab's own cursor, dated after the
 * capture so it does not fade. The side panel fills the window, so the page,
 * cut to the window's own shape, fills its tab; one step chooses the tab.
 */

import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_LIVE_PORT_CHANNEL, BROWSER_LIVE_PORT_MESSAGE } from "@luke/features/browser-live-acts";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { standingPlan, standingPlans } from "./board";
import { ago, LAUNCHED_AT } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import { RELAY_ACCEPT_JPEG } from "./relay-pictures";
import { NEVER, type ShotSpec, type ShotStep } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const TAB_ID = "e4f5a6b7-c8d9-4e0f-9a1b-2c3d4e5f6a71";

/** After the capture, so the pointer and the line saying who uses the tab stand through it. */
const STILL_ACTING = LAUNCHED_AT + 6 * 60 * 60 * 1000;

/** The page the agent's browser shows, as wide as the frame is cut. */
const PAGE = { width: 1280, height: 716 } as const;

const TAB: AgentBrowserTab = {
  id: TAB_ID,
  agentId: SHOT_ID.AGENT_2,
  address: "https://acme.relay.dev/invite/7Kq2mWx9",
  title: "Join acme on Relay",
  openedBy: { kind: "agent" },
  driver: null,
  createdAt: ago(3),
  lastActedAt: STILL_ACTING,
  cursor: { x: 640, y: 450, kind: "move", viewport: PAGE, at: STILL_ACTING },
};

/** Every port handed out, held so none is collected while its view stands. */
const ports = new Set<MessagePort>();

/** Hands the view `viewId` a port, as main posts one, and says the page and its one frame on it. */
function attach(viewId: string): void {
  const { port1, port2 } = new MessageChannel();
  ports.add(port1);
  window.postMessage({ channel: BROWSER_LIVE_PORT_CHANNEL, ticket: { viewId } }, "*", [port2]);
  const say = (message: object): void =>
    port1.postMessage({ type: BROWSER_LIVE_PORT_MESSAGE.MESSAGE, text: JSON.stringify(message) });
  say({ type: "page", address: TAB.address, title: TAB.title, loading: false });
  say({ type: "frame", data: RELAY_ACCEPT_JPEG, pageWidth: PAGE.width, pageHeight: PAGE.height });
}

/** Chooses the Browser tab once the panel lists it. */
const CHOOSE_TAB: ShotStep = {
  key: "browser-tab",
  ready: ({ plans }) =>
    plans.sidePanel.strip.some((tab) => typeof tab === "object" && "cloudBrowser" in tab && tab.cloudBrowser === TAB_ID),
  run: ({ plans }) => plans.sidePanel.onChoose({ cloudBrowser: TAB_ID }),
};

export function browserTabShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans: standingPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: { ...FIXTURE_CODE_PANEL, width: 960 },
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.TASKS_BROWSER_TABS]: (payload) =>
        "taskId" in payload && payload.taskId === SHOT_ID.PLAN ? { tabs: [TAB] } : { tabs: [] },
      [ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: () => NEVER,
      [ACT_KIND.BROWSER_LIVE_ATTACH]: (payload) => {
        attach(payload.viewId);
        return NEVER;
      },
      [ACT_KIND.BROWSER_LIVE_DETACH]: () => NEVER,
    },
    layout: { sidebarCollapsed: true, mainTab: { agent: SHOT_ID.AGENT_2 }, sidePanelFullScreen: true },
    steps: [CHOOSE_TAB],
  };
}
