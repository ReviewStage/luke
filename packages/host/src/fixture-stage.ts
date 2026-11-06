import { PAGE_SHOWER, type PageVersion } from "@repo/features/page-wire";
import {
  TASK_CALL_FAILURE,
  type TasksPageAnswer,
  type TasksPageParams,
} from "@repo/features/tasks-view";

export const FIXTURE_IDS = {
  WORKSPACE: "workspace-personal",
  TASK: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  AGENT: "4c8e2a6b-1d3f-4e5a-9b7c-2d4e6f8a0b1c",
  PAGE: "7a1c3e5b-9d2f-4a6c-8e0b-5f7a9c1e3b5d",
} as const;

export const FIXTURE_TASK_NAME = "Teammate invitations";

function funnelPage(version: number, at: string, steps: readonly (readonly [string, number])[]) {
  const rows = steps.map(([step, invites]) => `<tr><td>${step}</td><td>${invites}</td></tr>`);
  return {
    id: FIXTURE_IDS.PAGE,
    title: "Invite funnel",
    version,
    at: Date.parse(at),
    shownBy: { kind: PAGE_SHOWER.AGENT, agentId: FIXTURE_IDS.AGENT },
    html: [
      "<!doctype html><html><head><meta charset='utf-8'><title>Invite funnel</title><style>",
      "body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1f2328}",
      "table{border-collapse:collapse;margin-top:12px}td,th{padding:6px 12px;border-bottom:1px solid #d0d7de;text-align:left}",
      "td:last-child{text-align:right;font-variant-numeric:tabular-nums}",
      "</style></head><body>",
      "<h1>Invite funnel</h1>",
      "<p>Invites sent in the staging workspace over seven days, and how far each got.</p>",
      "<table><tr><th>Step</th><th>Invites</th></tr>",
      ...rows,
      "</table></body></html>",
    ].join(""),
  } satisfies PageVersion;
}

const FIXTURE_PAGE_FIRST = funnelPage(1, "2026-10-07T16:47:00Z", [
  ["Sent", 120],
  ["Opened", 94],
  ["Accepted", 71],
]);

export const FIXTURE_PAGE: PageVersion = funnelPage(2, "2026-10-07T16:51:00Z", [
  ["Sent", 120],
  ["Opened", 94],
  ["Accepted", 71],
  ["Expired", 9],
]);

const FIXTURE_PAGE_VERSIONS: readonly PageVersion[] = [FIXTURE_PAGE_FIRST, FIXTURE_PAGE];

export function fixturePage(page: TasksPageParams): TasksPageAnswer {
  const version = FIXTURE_PAGE_VERSIONS.find(
    (each) => each.id === page.pageId && each.version === page.version,
  );
  return version === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { page: version };
}
