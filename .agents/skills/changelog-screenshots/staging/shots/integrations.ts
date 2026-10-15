/**
 * integrations.ts -- shot I, "Integrations": Settings › Integrations, Linear, Notion, and Sentry connected, since a screenshot shows the state a feature is for.
 *
 * Throwaway (`README.md`). Slack is hidden in this release, so the shot
 * leaves its row out. The statuses and each provider's tools are canned
 * answers; the account under each row and the GitHub row at the head are
 * the shot's own (`integrations-page.tsx` reads them in a shot run).
 * A provider's status `disconnected` below draws its row with Connect.
 */

import type {
  IntegrationStatusesView,
  IntegrationToolsView,
} from "@luke/features/integration-view";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { SETTINGS_VIEW } from "../settings-views";
import { codingAgentAnswers } from "./coding-agent";
import { shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";

/** Each provider's tools, as its server offers them, which a row's menu may list. */
const TOOLS = {
  linear: [
    { name: "list_issues", description: "List issues in a team or project." },
    { name: "create_issue", description: "Create an issue." },
    { name: "update_issue", description: "Change an issue's status, assignee, or labels." },
  ],
  notion: [
    { name: "search", description: "Search pages and databases." },
    { name: "fetch", description: "Read a page." },
    { name: "create_pages", description: "Create pages." },
  ],
  sentry: [
    { name: "search_issues", description: "Search the organization's issues." },
    { name: "get_issue_details", description: "Read an issue with its latest event." },
  ],
  slack: [],
} as const;

export function integrationsShot(): ShotSpec {
  const statuses: IntegrationStatusesView = {
    integrations: {
      linear: "connected",
      notion: "connected",
      sentry: "connected",
      slack: "connected",
    },
  };
  return {
    tasks: shotTasksView({}),
    sidePanel: FIXTURE_CLOSED_PANEL,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.INTEGRATIONS_STATUS]: () => statuses,
      [ACT_KIND.INTEGRATIONS_TOOLS]: (payload): IntegrationToolsView => ({
        tools: TOOLS[payload.provider].map((tool) => ({ ...tool })),
      }),
    },
    integrations: {
      hidden: ["slack"],
      accounts: {
        linear: "Acme · acme.linear.app",
        notion: "Acme Engineering",
      },
      github: "acme · 3 repositories",
    },
    layout: { settingsView: SETTINGS_VIEW.INTEGRATIONS },
  };
}
