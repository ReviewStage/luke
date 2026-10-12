import { Duration, Effect, Redacted, Result } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { defineState } from "eve/context";
import { authenticateGitHub } from "eve/extensions/code/sandbox";
import { defineHook, type HookContext } from "eve/hooks";
import { pinnedState } from "../../server/hosted/brain-host/pinned-state.js";
import { EMPTY_RELAY_STATE, type RelayState } from "../../server/hosted/brain-host/relay.js";
import { CODER } from "../../server/hosted/coder-host/bounds.js";
import type { CheckoutFailure } from "../../server/hosted/coder-host/host.js";
import { opensSandbox } from "../../server/hosted/coder-host/tool-set.js";
import type { RepositorySandbox } from "../../server/hosted/repository-shell.js";
import { runWeb } from "../../server/runtime.js";
import { host, seams } from "../host.js";
import { environment } from "../sandbox.js";
import { type SandboxRecord, sandboxRecord, sessionPrompt } from "../session-prompt.js";

/**
 * The relay from eve's stream into the store, and the two things the
 * session's sandbox needs of the stream: every event eve records for a
 * session is read here, after eve has written it, and told to the writer as
 * the agent's own event through the relay the planning brain shares
 * (`server/hosted/brain-host/relay.ts`). A session the host does not admit
 * writes nothing. Beside the relay, the hook watches the sandbox: a call of
 * a sandbox tool, or a message received with files eve staged there, is
 * when the sandbox opened and its checkout set the repository credential
 * at the firewall, a step that starts past the credential's age renews it
 * there, and a turn's end, however it ended, writes the branch checked out
 * in the sandbox on the agent's row, which is where its pull request is
 * read from, then stops the sandbox at once
 * rather than waiting out its timeout, with its filesystem kept for a later
 * turn to resume. Note that the branch is written before the end is
 * relayed, because a tab reads the pull request the moment it hears the
 * agent ended and the service keeps that answer a while: an end relayed
 * first would be read against the row as it stood before the turn.
 * The agent's title is generated as one of its first turns completes, once
 * the relay has written the turn's answer it is named from, on a fiber of
 * its own so the hook is not held for it: the title fills in a moment after
 * the turn ends.
 */

const relayState = defineState<RelayState>("luke.coder.relay", () => EMPTY_RELAY_STATE);

/** eve's event kinds for a turn's end, each of which stops the sandbox. */
const TURN_END_EVENTS: ReadonlySet<MessageStreamEvent["type"]> = new Set([
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
]);

/** Whether the credential set at the firewall is old enough to renew: set when the sandbox opened, or when the hook last renewed it. */
function credentialIsOld(record: SandboxRecord, now: number): boolean {
  const setAt = record.credentialAt ?? record.openedAt;
  return setAt !== undefined && now - setAt >= Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH);
}

/** A refusal as a log line carries it: the checkout's reason, or a store failure's kind. */
function describeRefusal(failure: CheckoutFailure): string {
  return failure._tag === "CheckoutRefused" ? failure.reason : failure._tag;
}

/** The branch checked out as the turn ends, written on the agent's row; an admission that fails is logged, and the host logs its own failures, so the stop that follows is never skipped. */
async function recordBranch(ctx: HookContext, sandbox: RepositorySandbox): Promise<void> {
  await runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
      if (Result.isFailure(admitted)) return;
      yield* host.recordBranch(admitted.success, sandbox);
    }).pipe(
      Effect.catch((failure) =>
        Effect.logWarning(
          `The branch of session ${ctx.session.id} was not recorded: ${describeRefusal(failure)}`,
        ),
      ),
    ),
  );
}

/** A fresh token set at the firewall, where the standing one is old; a renewal that fails is logged and the next step tries again. */
async function renewCredential(
  ctx: HookContext,
  record: ReturnType<typeof pinnedState<SandboxRecord>>,
): Promise<void> {
  const now = seams.now();
  if (!credentialIsOld(record.get(), now)) return;
  const minted = await runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
      if (Result.isFailure(admitted)) return undefined;
      return yield* host.repositoryToken(admitted.success);
    }).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `The repository credential of session ${ctx.session.id} was not renewed: ${describeRefusal(failure)}`,
          ),
          undefined,
        ),
      ),
    ),
  );
  if (minted === undefined) return;
  // The sandbox under its Vercel environment, which is the handle that carries the firewall.
  const sandbox = await ctx.getSandbox(environment);
  // The token is revealed here alone, into the firewall rules eve sets for github.com.
  await authenticateGitHub(sandbox, { token: Redacted.value(minted), delivery: "firewall" });
  record.update((held) => ({ ...held, credentialAt: now }));
}

export default defineHook({
  events: {
    async "*"(event, ctx) {
      // Pinned before anything awaits, because the admission's statement can
      // hand this fiber back in another session's context, and the relay's
      // state and the prompt's hash are this session's (`server/hosted/brain-host/pinned-state.ts`).
      const state = pinnedState(relayState);
      const prompt = pinnedState(sessionPrompt);
      const sandbox = pinnedState(sandboxRecord);
      if (opensSandbox(event) && sandbox.get().openedAt === undefined) {
        sandbox.update((held) => ({ ...held, openedAt: seams.now() }));
      }
      // The sandbox a tool opened, at the turn's end: its branch is read ahead of the relay and it is stopped after.
      const ending =
        TURN_END_EVENTS.has(event.type) && sandbox.get().openedAt !== undefined
          ? await ctx.getSandbox()
          : undefined;
      if (ending !== undefined) await recordBranch(ctx, ending);
      await runWeb(
        Effect.gen(function* () {
          if (event.type === "session.started") {
            const starting = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
            if (Result.isFailure(starting)) return;
            if (!(yield* host.sessionStarted(starting.success, ctx.session.id))) return;
          }
          const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return;
          yield* host.relay(event, admitted.success, ctx.session, state, prompt.get());
          if (event.type === "turn.completed") {
            // The title is asked for off the hook's path; the fiber outlives this hook and ends on its own.
            yield* Effect.forkDetach(host.title(admitted.success));
          }
        }),
      );
      if (event.type === "step.started" && sandbox.get().openedAt !== undefined) {
        await renewCredential(ctx, sandbox);
      }
      if (ending !== undefined) await ending.stop();
    },
  },
});
