import { defineSandbox } from "eve/sandbox";
import { AGENT_ROLE } from "../server/hosted/agent-runtime/role.js";
import { environment, openSandbox } from "../server/hosted/agent-runtime/sandbox.js";

/**
 * sandbox.ts -- the planning session's sandbox: one Vercel Sandbox per eve session, where `run_in_repository` checks the plan's repository out and runs its commands.
 *
 * The planning model is offered none of eve's own sandbox tools
 * (`defaultTools: false` in `agent.ts`); the sandbox is reached through the
 * one hosted tool that reads code (`server/hosted/repository-shell.ts`),
 * which eve hands the session's sandbox as the tool runs. The sandbox is
 * opened on the first call that needs it and kept for the session across
 * turns, so the checkout the first call makes is what later calls read; a
 * sandbox Vercel stopped for idleness resumes from its snapshot with the
 * checkout intact. The network is eve's default, open internet: the
 * checkout's credential is set at the firewall for the clone alone and never
 * enters the sandbox. The worker subagent shares this sandbox
 * (`subagents/worker/sandbox.ts`), so its reads see the same checkout.
 *
 * The image and how the sandbox opens and lives are the planner's policy
 * over the one environment both roots share
 * (`server/hosted/agent-runtime/sandbox.ts`).
 */
export { environment };

export default defineSandbox(() => openSandbox(AGENT_ROLE.PLANNER));
