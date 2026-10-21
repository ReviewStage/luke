import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import {
  endsTurn,
  keepsSandboxAlive,
  lapsesCredential,
  renewsCredential,
  type SandboxRecord,
  stopsAtTurnEnd,
  withdrawsCredential,
} from "@luke/service/agents/agent-runtime/sandbox";
import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { EMPTY_RELAY_STATE, type RelayState } from "@luke/service/agents/brain-host/relay";
import { deepensSandbox } from "@luke/service/agents/coder-host/deepen";
import type { CheckoutFailure } from "@luke/service/agents/coder-host/host";
import { opensSandbox } from "@luke/service/agents/coder-host/tool-set";
import { handedAfterCompaction } from "@luke/service/agents/coder-host/turn-context";
import type { RepositorySandbox } from "@luke/service/agents/repository-shell";
import { keepSessionSandboxAlive } from "@luke/service/agents/session-sandboxes";
import { credentialPolicy } from "@luke/service/agents/terminal/agent-sandbox";
import { Effect, Result } from "effect";
import { defineState } from "eve/context";
import { defineHook, type HookContext } from "eve/hooks";
import { host, seams } from "../host.js";
import { runAgent } from "../runtime.js";
import { environment } from "../sandbox.js";
import { sandboxRecord, sessionPrompt, turnHanded } from "../session-prompt.js";

/**
 * The relay from eve's stream into the store, and the two things the
 * session's sandbox needs of the stream: every event eve records for a
 * session is read here, after eve has written it, and told to the writer as
 * the agent's own event through the relay the brain shares
 * (`packages/service/src/agents/brain-host/relay.ts`). A session the host does not admit
 * writes nothing. Beside the relay, the hook watches the sandbox: a call of
 * a sandbox tool, or a message received with files eve staged there, is
 * when the sandbox opened on its shallow checkout, a call that writes is
 * when that checkout deepened and set the repository credential at the
 * firewall (`packages/service/src/agents/coder-host/deepen.ts`), a step
 * that starts past the credential's age renews it there, or, for an agent on its starter's own token, which never ages, the
 * first step of each turn sets it again, and a turn's end takes that token
 * off wherever it stops the sandbox; a step keeps the running sandbox alive
 * past its short timeout every few minutes of a turn
 * (`packages/service/src/agents/session-sandboxes.ts`); and a turn's end, however it ended,
 * writes the branch checked out
 * in the sandbox on the agent's row, which is where its pull request is
 * read from, then stops the sandbox at once rather than waiting out its
 * timeout, with its filesystem kept for a later turn to resume, unless a
 * developer's terminal holds it, when the scheduled sweep stops it once the
 * terminal's lease lapses (`sandbox-terminal-lease.ts`). Whether a
 * step renews the credential and whether a turn's end stops the sandbox are
 * the coding agent's sandbox policy (`packages/service/src/agents/agent-runtime/sandbox.ts`),
 * not this hook's. Note that the branch is written before the end is
 * relayed, because a tab reads the pull request the moment it hears the
 * agent ended and the service keeps that answer a while: an end relayed
 * first would be read against the row as it stood before the turn.
 * The agent's title is generated within the relay, as the developer's words
 * it is named from are written and again as one of its first turns
 * completes, and the hook waits for it, bounded by the call's own timeout,
 * because what a hook leaves running ends with eve's step and the function
 * instance under it.
 */

const relayState = defineState<RelayState>("luke.coder.relay", () => EMPTY_RELAY_STATE);

/** A refusal as a log line carries it: the checkout's reason, or a store failure's kind. */
function describeRefusal(failure: CheckoutFailure): string {
  return failure._tag === "CheckoutRefused" ? failure.reason : failure._tag;
}

/** The branch checked out as the turn ends, written on the agent's row; an admission that fails is logged, and the host logs its own failures, so the stop that follows is never skipped. */
async function recordBranch(ctx: HookContext, sandbox: RepositorySandbox): Promise<void> {
  await runAgent(
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

/** Whether a developer's terminal holds the sandbox as the turn ends; a session the host does not admit, and a read that fails, hold nothing. */
async function terminalHolds(ctx: HookContext): Promise<boolean> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
      if (Result.isFailure(admitted)) return false;
      return yield* host.sandboxHeld(admitted.success);
    }).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `The terminal lease of session ${ctx.session.id} was not read: ${failure._tag}`,
          ),
          false,
        ),
      ),
    ),
  );
}

/** Whether the agent's credential is its starter's own GitHub token; a session the host does not admit, and a read that fails, are not. */
async function onMemberToken(ctx: HookContext): Promise<boolean> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
      if (Result.isFailure(admitted)) return false;
      const agent = yield* host.agent(admitted.success);
      return Result.isSuccess(agent) && agent.success.githubAccess === GITHUB_ACCESS.TOKEN;
    }).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `The GitHub access of session ${ctx.session.id} was not read: ${failure._tag}`,
          ),
          false,
        ),
      ),
    ),
  );
}

/** A member's own token taken off the firewall as the turn ends, leaving the open internet; a withdrawal that fails is logged, so the stop that follows is never skipped. */
async function withdrawCredential(ctx: HookContext): Promise<void> {
  await runAgent(
    Effect.tryPromise(async () =>
      (await ctx.getSandbox(environment)).setNetworkPolicy("allow-all"),
    ).pipe(
      Effect.catch(() =>
        Effect.logWarning(`The GitHub token of session ${ctx.session.id} was not taken off`),
      ),
    ),
  );
}

/**
 * A fresh credential set at the firewall, in place of the aged or lapsed
 * one; a renewal that fails is logged and the next step tries again, and an
 * agent with no repository mints none and sets nothing. Note that a
 * sandbox opened shallow is renewed only once its deepen finished, which
 * its record says rather than the request the hook saw, since a write
 * requested may have failed before its deepen did.
 */
async function renewCredential(
  ctx: HookContext,
  record: ReturnType<typeof pinnedState<SandboxRecord>>,
  now: number,
): Promise<void> {
  // The sandbox under its Vercel environment, which is the handle that carries the firewall.
  const sandbox = await ctx.getSandbox(environment);
  const shallow = record.get().openedShallow === true;
  const minted = await runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
      if (Result.isFailure(admitted)) return undefined;
      if (shallow && !(yield* host.deepened(admitted.success, sandbox))) return undefined;
      return yield* host.repositoryCredential(admitted.success);
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
  // The token is revealed only into the firewall rules set for GitHub.
  await sandbox.setNetworkPolicy(credentialPolicy(minted));
  record.update((held) => ({
    ...held,
    credentialAt: now,
    credentialLapsed: false,
    memberToken: minted.access.kind === GITHUB_ACCESS.TOKEN,
  }));
}

export default defineHook({
  events: {
    async "*"(event, ctx) {
      // Pinned before anything awaits, because the admission's statement can
      // hand this fiber back in another session's context, and the relay's
      // state and the prompt's hash are this session's (`packages/service/src/agents/brain-host/pinned-state.ts`).
      const state = pinnedState(relayState);
      const prompt = pinnedState(sessionPrompt);
      const sandbox = pinnedState(sandboxRecord);
      // A compaction may summarise away what the turns' messages handed, so the next turn hands it again.
      if (event.type === "compaction.completed") {
        pinnedState(turnHanded).update(handedAfterCompaction);
      }
      if (opensSandbox(event) && sandbox.get().openedAt === undefined) {
        const openedAt = seams.now();
        const memberToken = await onMemberToken(ctx);
        sandbox.update((held) => ({ ...held, openedAt, openedShallow: true, memberToken }));
      }
      // The first write deepens the shallow checkout and sets the credential, which the policy renews from then on.
      if (deepensSandbox(event) && sandbox.get().deepenedAt === undefined) {
        const deepenedAt = seams.now();
        sandbox.update((held) => ({ ...held, deepenedAt }));
      }
      // The sandbox a tool opened, at the turn's end: its branch is read ahead of the relay, and the policy decides whether it is stopped after.
      const ending =
        endsTurn(event) && sandbox.get().openedAt !== undefined
          ? await ctx.getSandbox()
          : undefined;
      if (ending !== undefined) await recordBranch(ctx, ending);
      await runAgent(
        Effect.gen(function* () {
          if (event.type === "session.started") {
            const starting = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
            if (Result.isFailure(starting)) return;
            if (!(yield* host.sessionStarted(starting.success, ctx.session.id))) return;
          }
          // A fragment the store need hear nothing of is folded into the relay's state without
          // admitting the session, whose reads would otherwise run for every one of them.
          if (host.relaysQuietly(event, state)) return;
          const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return;
          yield* host.relay(event, admitted.success, ctx.session, state, prompt.get());
        }),
      );
      const now = seams.now();
      if (renewsCredential(AGENT_ROLE.CODER, event, sandbox.get(), now)) {
        await renewCredential(ctx, sandbox, now);
      }
      // Stamped before it is asked, so a keep-alive Vercel did not confirm waits the interval like one it did.
      if (keepsSandboxAlive(AGENT_ROLE.CODER, event, sandbox.get(), now)) {
        sandbox.update((held) => ({ ...held, keptAliveAt: now }));
        await runAgent(keepSessionSandboxAlive(ctx.session.id));
      }
      if (ending === undefined) return;
      // Whether a terminal holds the sandbox is read last, just before the stop, so a developer who typed during the turn's end keeps it.
      const held = await terminalHolds(ctx);
      const record = sandbox.get();
      if (withdrawsCredential(AGENT_ROLE.CODER, event, record, held)) await withdrawCredential(ctx);
      if (lapsesCredential(AGENT_ROLE.CODER, event, record)) {
        sandbox.update((standing) => ({ ...standing, credentialLapsed: true }));
      }
      if (stopsAtTurnEnd(AGENT_ROLE.CODER, event, record, held)) await ending.stop();
    },
  },
});
