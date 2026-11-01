/**
 * agents-settings.ts -- 0.20.0 shot "Coding agents on your Claude or ChatGPT plan": Settings › Agents with Claude and Codex each connected through Dean's own subscription, the default model, and Chapters' model.
 *
 * Throwaway (`README.md`). Settings opened on Agents over the acme world; the
 * keys read answers one Claude plan and one ChatGPT plan, both verified and
 * for agents, and no Anthropic API key, so no row reads "Runs on your own key".
 */

import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { ago, daysAgo } from "./clock";
import { codingAgentAnswers, MODEL } from "./coding-agent";
import { shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { standingPlan, standingPlans } from "./board";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

export function agentsSettingsShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({ plan: standingPlan(), plans: standingPlans(), extra: { workspaces: whoWorkspaces(members.length) } }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.PROVIDER_KEYS_READ]: () => ({
        keys: [
          { provider: "openai", hint: "sk-proj-…4f2a", addedAt: daysAgo(20), status: "verified", statusAt: ago(90) },
        ],
        subscriptions: [
          {
            provider: "anthropic",
            kind: "claude_setup_token",
            hint: "sk-ant-oat01-…Qm7c",
            addedAt: daysAgo(6),
            status: "verified",
            statusAt: ago(40),
            forAgents: true,
          },
          {
            provider: "openai",
            kind: "chatgpt_oauth",
            hint: "ChatGPT",
            addedAt: daysAgo(3),
            status: "verified",
            statusAt: ago(15),
            forAgents: true,
          },
        ],
      }),
      [ACT_KIND.AGENTS_DEFAULT_READ]: () => ({ choice: { model: MODEL.OPUS, effort: "high" } }),
      [ACT_KIND.CHAPTERS_MODEL_READ]: () => ({ model: "claude-sonnet-5-5" }),
    },
    layout: { settingsView: SETTINGS_VIEW.AGENTS },
  };
}
