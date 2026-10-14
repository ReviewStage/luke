/**
 * agent-sandbox.ts -- a coding agent's sandbox as its Terminal tab reaches it: where it stands, its shells, and the developer's resume.
 *
 * The sandbox is found by the eve session the agent runs in, whose id it
 * carries as a tag (`vercel-sandbox-api.ts`). Where it stands is read and
 * never changed by a read: a stopped sandbox stays stopped until the
 * developer's resume, which wakes the same named sandbox eve resumes for the
 * agent's next turn. A shell is started, named, and ended by a short tmux
 * command run in the sandbox's running session (`tmux.ts`), and the list is
 * read back from tmux, so it is whatever the sandbox holds now. A shell
 * starts only in a running sandbox; asked of any other, the service answers
 * where the sandbox stands instead.
 */

import {
  SANDBOX_STATE,
  type SandboxState,
  type TerminalSummary,
  type TerminalsAnswer,
} from "@sidecar/features/terminal-wire";
import { Context, Effect, Layer, Result } from "effect";
import type { HttpClient } from "effect/http";
import {
  deploymentOidcToken,
  type ListedSandbox,
  type SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { killTerminal, listTerminals, renameTerminal, startTerminal, terminalsOf } from "./tmux.js";

/** Vercel's sandbox states, read as the tab reads them. */
const STATE_OF_STATUS: Readonly<Record<string, SandboxState>> = {
  running: SANDBOX_STATE.RUNNING,
  pending: SANDBOX_STATE.STARTING,
  stopping: SANDBOX_STATE.STOPPED,
  snapshotting: SANDBOX_STATE.STOPPED,
  stopped: SANDBOX_STATE.STOPPED,
  failed: SANDBOX_STATE.STOPPED,
  aborted: SANDBOX_STATE.STOPPED,
};

/** Why a shell could not be had: the sandbox is not running, as it stands, or the shell named is not there. */
export const SHELL_REFUSAL = {
  NOT_RUNNING: "not-running",
  NOT_FOUND: "not-found",
} as const;

export type ShellRefusal =
  | { readonly kind: typeof SHELL_REFUSAL.NOT_RUNNING; readonly sandbox: SandboxState }
  | { readonly kind: typeof SHELL_REFUSAL.NOT_FOUND };

type ShellEffect<A> = Effect.Effect<Result.Result<A, ShellRefusal>, SandboxUnavailable>;

export interface AgentSandboxService {
  /** The agent's shells and where its sandbox stands; none while it is not running. */
  readonly terminals: (sessionId: string) => Effect.Effect<TerminalsAnswer, SandboxUnavailable>;
  /** A new shell in the agent's running sandbox, under the id given, named where the developer named it. */
  readonly start: (
    sessionId: string,
    terminalId: string,
    title: string | undefined,
  ) => ShellEffect<TerminalSummary>;
  /** A shell named anew. */
  readonly rename: (sessionId: string, terminalId: string, title: string) => ShellEffect<void>;
  /** A shell ended, with whatever it ran. */
  readonly kill: (sessionId: string, terminalId: string) => ShellEffect<void>;
  /** The agent's sandbox resumed from its snapshot, answering where it stands after; one never opened stays starting. */
  readonly resume: (sessionId: string) => Effect.Effect<SandboxState, SandboxUnavailable>;
}

export class AgentSandbox extends Context.Service<AgentSandbox, AgentSandboxService>()(
  "AgentSandbox",
) {}

/** Where a listed sandbox stands; none listed is one the agent has not opened yet. */
function stateOf(sandbox: ListedSandbox | undefined): SandboxState {
  if (sandbox === undefined) return SANDBOX_STATE.STARTING;
  return STATE_OF_STATUS[sandbox.status ?? ""] ?? SANDBOX_STATE.STOPPED;
}

/** The service over the REST calls the API makes. */
function agentSandboxOver(api: VercelSandboxApi): AgentSandboxService {
  /** The session's sandbox, where it stands, and the running session a command goes to while it is up. */
  const standing = (sessionId: string) =>
    Effect.map(api.listTagged(sessionId), (sandboxes) => {
      const [sandbox] = sandboxes;
      const state = stateOf(sandbox);
      const running = state === SANDBOX_STATE.RUNNING ? sandbox?.currentSessionId : undefined;
      return { sandbox, state, running };
    });

  /** A command run in the running sandbox; a sandbox not running is refused as it stands. */
  const inRunning = <A>(
    sessionId: string,
    then: (running: string) => Effect.Effect<Result.Result<A, ShellRefusal>, SandboxUnavailable>,
  ): ShellEffect<A> =>
    Effect.flatMap(standing(sessionId), ({ state, running }) =>
      running === undefined
        ? Effect.succeed(Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: state }))
        : then(running),
    );

  /** A command that names one shell: its nonzero exit is a shell that is not there. */
  const onShell = (sessionId: string, ask: ReturnType<typeof renameTerminal>): ShellEffect<void> =>
    inRunning(sessionId, (running) =>
      Effect.map(api.run(running, ask), (run) =>
        run.exitCode === 0
          ? Result.succeed(undefined)
          : Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND }),
      ),
    );

  return {
    terminals: (sessionId) =>
      Effect.gen(function* () {
        const { state, running } = yield* standing(sessionId);
        if (running === undefined) return { sandbox: state, terminals: [] };
        const listed = yield* api.run(running, listTerminals());
        return { sandbox: state, terminals: terminalsOf(listed) };
      }),
    start: (sessionId, terminalId, title) =>
      inRunning(sessionId, (running) =>
        Effect.gen(function* () {
          const started = yield* api.run(running, startTerminal(terminalId, title));
          if (started.exitCode !== 0) return Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND });
          const listed = terminalsOf(yield* api.run(running, listTerminals()));
          const shell = listed.find((terminal) => terminal.id === terminalId);
          return shell === undefined
            ? Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND })
            : Result.succeed(shell);
        }),
      ),
    rename: (sessionId, terminalId, title) => onShell(sessionId, renameTerminal(terminalId, title)),
    kill: (sessionId, terminalId) => onShell(sessionId, killTerminal(terminalId)),
    resume: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, state } = yield* standing(sessionId);
        if (sandbox === undefined || state === SANDBOX_STATE.RUNNING) return state;
        return stateOf(yield* api.resume(sandbox.name));
      }),
  };
}

/** The service as the deployment runs it, on the function's own OIDC token. */
export const agentSandboxLayer: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient> =
  Layer.effect(AgentSandbox, Effect.map(vercelSandboxApi(deploymentOidcToken), agentSandboxOver));
