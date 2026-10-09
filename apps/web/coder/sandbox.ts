import { Effect, Redacted, Result } from "effect";
import { authenticateGitHub, installCodeTooling } from "eve/extensions/code/sandbox";
import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import { CODER } from "../server/hosted/coder-host/bounds.js";
import { CheckoutRefused } from "../server/hosted/coder-host/checkout.js";
import { runWeb } from "../server/runtime.js";
import { host } from "./host.js";

/**
 * sandbox.ts -- the coding agent's sandbox: one Vercel Sandbox per eve session, with the agent's repository checked out in it.
 *
 * The sandbox opens on the first tool call that needs it and stands for the
 * session, across turns and deploys; a sandbox Vercel stopped resumes from
 * its snapshot with the checkout and the agent's changes intact. Its timeout
 * is the platform's maximum, so a long run is never cut off mid-turn, and
 * the store hook stops it the moment a turn ends rather than waiting that
 * out. The network is eve's default, open internet. As the sandbox opens,
 * the agent's repository is checked out whole at its default branch with a
 * write token at the firewall for the clone (`coder-host/checkout.ts`), and
 * the same token is then set at the firewall for the session's own `gh` and
 * `git` through eve's `authenticateGitHub`: it never enters the sandbox's
 * filesystem or environment, so no command, and no output of one, can carry
 * it. A checkout that fails fails the call that opened the sandbox, in the
 * host's own words, and the next call tries again.
 *
 * `prepare` runs once per build on the snapshot every session starts from:
 * the code extension's tooling (`gh`, signed commits, TypeScript
 * diagnostics), and the runtimes a repository's checks are likely to need,
 * which the base image carries or `prepare` installs. Node is the image's
 * own; pnpm and Python are added where absent.
 */
const PREPARE_SCRIPT = [
  "set -e",
  "git --version",
  "node --version",
  "command -v pnpm >/dev/null 2>&1 || npm install -g pnpm",
  "if ! command -v python3 >/dev/null 2>&1; then",
  '  if [ "$(id -u)" = 0 ]; then apt-get update && apt-get install -y python3; else sudo -n apt-get update && sudo -n apt-get install -y python3; fi',
  "fi",
  "pnpm --version && python3 --version",
].join("\n");

export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    await installCodeTooling(sandbox);
    const prepared = await sandbox.run({ command: PREPARE_SCRIPT });
    if (prepared.exitCode !== 0) {
      throw new Error(
        `the sandbox image could not be prepared for a coding agent: ${prepared.stderr}`,
      );
    }
  },
});

export default defineSandbox(async ({ session }) => {
  const sandbox = await environment.open({ timeout: CODER.SANDBOX_TIMEOUT_MS });
  const token = await runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(session.auth, session.id);
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
