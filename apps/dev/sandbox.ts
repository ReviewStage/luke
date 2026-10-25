import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { environment, openSandbox } from "@luke/service/agents/agent-runtime/sandbox";
import { sandboxVcpus } from "@luke/service/agents/coder-host/bounds";
import { CheckoutRefused } from "@luke/service/agents/coder-host/checkout";
import { type CheckoutFailure, describeFailure } from "@luke/service/agents/coder-host/host";
import { Effect, Result } from "effect";
import { defineSandbox } from "eve/sandbox";
import { host } from "./host.js";
import { runAgent } from "./runtime.js";

/**
 * sandbox.ts -- the coding agent's sandbox: one Vercel Sandbox per eve session, with the agent's repository checked out in it.
 *
 * The sandbox opens on the first tool call that needs it, or earlier where a
 * message carries files, which eve stages in the sandbox before the turn
 * opens: for an opening message that is before `session.started`, so the
 * open claims the conversation's record itself rather than finding it
 * claimed (`CoderHost.admitSandbox`). It stands for the session, across
 * turns and deploys; a sandbox Vercel stopped resumes from its snapshot with
 * the checkout and the agent's changes intact. The image, its timeout and
 * size, and the store hook's stop at each turn's end are the coding agent's
 * policy over the one environment both roots share, its size the one its
 * repository asks for (`coder-host/bounds.ts`'s `sandboxVcpus`), which is
 * why the conversation is admitted before the sandbox opens
 * (`packages/service/src/agents/agent-runtime/sandbox.ts`). The network is eve's default,
 * open internet. As the sandbox opens, the agent's repository is checked out
 * shallow, one commit deep, at the branch it starts from, with a read token
 * at the firewall for the clone alone (`coder-host/checkout.ts`), so a
 * sandbox opened to read the code opens fast and holds no credential. The
 * first call that writes deepens it (`host.ts`'s `deepenCheckout`), and
 * only then is a write token set at the firewall for the session's own
 * `gh` and `git`, in the shape `credentialPolicy` gives an installation's
 * token or a member's own (`terminal/agent-sandbox.ts`): it never enters the
 * sandbox's filesystem or environment, so no command, and no output of one,
 * can carry it. A checkout that fails fails the call that opened the
 * sandbox, in the host's own words, and the next call tries again. An
 * agent with no repository has no checkout and no token: its sandbox opens
 * on the same first need with an empty working folder where the checkout
 * would stand, and nothing is set at the firewall.
 */
export { environment };

/** A failure as the call that opened the sandbox fails with: the host's word for it, a store failure by its kind alone, since its message may name a statement. */
function failedWith(failure: CheckoutFailure): Error {
  return new Error(describeFailure(failure));
}

export default defineSandbox(async ({ session }) => {
  // The conversation is admitted before the sandbox opens, so it opens at its repository's size.
  const { admitted, vcpus } = await runAgent(
    Effect.gen(function* () {
      const admission = yield* host.admitSandbox(session.auth, session.id);
      if (Result.isFailure(admission)) {
        return yield* Effect.fail(new CheckoutRefused({ reason: admission.failure }));
      }
      const agent = yield* host.agent(admission.success);
      // Note that a conversation that is no agent's opens at the default size, and the checkout refuses it.
      const repository = Result.isSuccess(agent) ? agent.success.repository : null;
      return { admitted: admission.success, vcpus: sandboxVcpus(repository) };
    }).pipe(Effect.mapError(failedWith)),
  );
  const sandbox = await openSandbox(AGENT_ROLE.CODER, vcpus);
  await runAgent(host.checkOut(admitted, sandbox).pipe(Effect.mapError(failedWith)));
  return sandbox;
});
