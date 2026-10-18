import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { environment, openSandbox } from "@luke/service/agents/agent-runtime/sandbox";
import { defineSandbox } from "eve/sandbox";

/**
 * sandbox.ts -- the brain's session's sandbox: one Vercel Sandbox per eve session, where `run_in_repository` checks the task's repository out and runs its commands.
 *
 * The brain is offered none of eve's own sandbox tools
 * (`defaultTools: false` in `agent.ts`); the sandbox is reached through the
 * one hosted tool that reads code (`packages/service/src/agents/repository-shell.ts`),
 * which eve hands the session's sandbox as the tool runs. The sandbox is
 * opened on the first call that needs it and kept for the session across
 * turns, so the checkout the first call makes is what later calls read; a
 * sandbox Vercel stopped at its timeout, which runs whether it is busy or
 * not, resumes from its snapshot with the checkout intact. The network is eve's default, open internet: the
 * checkout's credential is set at the firewall for the clone alone and never
 * enters the sandbox. The worker subagent shares this sandbox
 * (`subagents/worker/sandbox.ts`), so its reads see the same checkout.
 *
 * The image and how the sandbox opens and lives are the brain's policy
 * over the one environment both roots share
 * (`packages/service/src/agents/agent-runtime/sandbox.ts`).
 */
export { environment };

export default defineSandbox(() => openSandbox(AGENT_ROLE.BRAIN));
