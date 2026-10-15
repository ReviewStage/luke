import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { environment, openSandbox } from "@luke/service/agents/agent-runtime/sandbox";
import { CheckoutRefused } from "@luke/service/agents/coder-host/checkout";
import { Effect, Redacted, Result } from "effect";
import { authenticateGitHub } from "eve/extensions/code/sandbox";
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
 * policy over the one environment both roots share
 * (`packages/service/src/agents/agent-runtime/sandbox.ts`). The network is eve's default,
 * open internet. As the sandbox opens, the agent's repository is checked out
 * whole at its default branch with a write token at the firewall for the
 * clone (`coder-host/checkout.ts`), and the same token is then set at the
 * firewall for the session's own `gh` and `git` through eve's
 * `authenticateGitHub`: it never enters the sandbox's filesystem or
 * environment, so no command, and no output of one, can carry it. A checkout
 * that fails fails the call that opened the sandbox, in the host's own
 * words, and the next call tries again.
 */
export { environment };

export default defineSandbox(async ({ session }) => {
  const sandbox = await openSandbox(AGENT_ROLE.CODER);
  const token = await runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admitSandbox(session.auth, session.id);
      if (Result.isFailure(admitted)) {
        return yield* Effect.fail(new CheckoutRefused({ reason: admitted.failure }));
      }
      return yield* host.checkOut(admitted.success, sandbox);
    }).pipe(
      // The failure fails the call that opened the sandbox, in the host's word for it; a store
      // failure by its kind alone, since its message may name a statement.
      Effect.mapError(
        (failure) => new Error(failure._tag === "CheckoutRefused" ? failure.reason : failure._tag),
      ),
    ),
  );
  // The token is revealed here alone, into the firewall rules eve sets for github.com.
  await authenticateGitHub(sandbox, { token: Redacted.value(token), delivery: "firewall" });
  return sandbox;
});
