import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";

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
 * `prepare` runs once per build on the snapshot every session starts from,
 * and holds the one thing the checkout needs of the image: git.
 */
export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    const git = await sandbox.run({ command: "git --version" });
    if (git.exitCode !== 0) {
      throw new Error(`the sandbox image carries no git, which the checkout needs: ${git.stderr}`);
    }
  },
});

export default defineSandbox(() => environment.open());
