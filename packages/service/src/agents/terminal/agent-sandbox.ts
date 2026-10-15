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
} from "@luke/features/terminal-wire";
import { Context, Effect, Layer, Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import {
  deploymentOidcToken,
  type InteractiveShell,
  type ListedSandbox,
  SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import {
  holdsTerminal,
  killTerminal,
  listTerminals,
  renameTerminal,
  startTerminal,
  TMUX_EXIT,
  terminalsOf,
} from "./tmux.js";

/** Vercel's sandbox states, read as the tab reads them. */
const STATE_OF_STATUS = new Map<string, SandboxState>([
  ["running", SANDBOX_STATE.RUNNING],
  ["pending", SANDBOX_STATE.STARTING],
  ["stopping", SANDBOX_STATE.STOPPED],
  ["snapshotting", SANDBOX_STATE.STOPPED],
  ["stopped", SANDBOX_STATE.STOPPED],
  ["failed", SANDBOX_STATE.STOPPED],
  ["aborted", SANDBOX_STATE.STOPPED],
]);

/** Why a shell could not be had: the sandbox is not running, as it stands, or the shell named is not there. */
export const SHELL_REFUSAL = {
  NOT_RUNNING: "not-running",
  NOT_FOUND: "not-found",
} as const;

export type ShellRefusal =
  | { readonly kind: typeof SHELL_REFUSAL.NOT_RUNNING; readonly sandbox: SandboxState }
  | { readonly kind: typeof SHELL_REFUSAL.NOT_FOUND };

type ShellEffect<A> = Effect.Effect<Result.Result<A, ShellRefusal>, SandboxUnavailable>;

/** What an attach finds: a running sandbox's PTY, minted for one connection, where the sandbox stands instead, or no such shell in it. */
type SandboxAttach =
  | {
      readonly state: typeof SANDBOX_STATE.RUNNING;
      readonly sandboxSessionId: string;
      readonly shell: InteractiveShell;
    }
  | { readonly state: typeof SANDBOX_STATE.STOPPED | typeof SANDBOX_STATE.STARTING }
  | { readonly state: typeof SANDBOX_STATE.RUNNING; readonly gone: true };

/** The hosts the GitHub token is set on at the firewall, as eve's own `authenticateGitHub` sets it for the agent. */
const GITHUB_HOSTS = ["github.com", "api.github.com"] as const;

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
  /** A connection to the running sandbox's PTY, or where the sandbox stands; a stopped sandbox is never woken here. */
  readonly attach: (
    sessionId: string,
    terminalId: string,
  ) => Effect.Effect<SandboxAttach, SandboxUnavailable>;
  /**
   * A fresh GitHub token set at the running sandbox session's firewall, on
   * the same hosts and in the same shape eve sets the agent's, so the shell
   * reaches GitHub as the agent does and never holds the token's bytes.
   */
  readonly setGitHubToken: (
    sandboxSessionId: string,
    token: Redacted.Redacted,
  ) => Effect.Effect<void, SandboxUnavailable>;
}

export class AgentSandbox extends Context.Service<AgentSandbox, AgentSandboxService>()(
  "AgentSandbox",
) {}

/** Where a listed sandbox stands; none listed is one the agent has not opened yet. */
function stateOf(sandbox: ListedSandbox | undefined): SandboxState {
  if (sandbox === undefined) return SANDBOX_STATE.STARTING;
  return STATE_OF_STATUS.get(sandbox.status ?? "") ?? SANDBOX_STATE.STOPPED;
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
        const listed = terminalsOf(yield* api.run(running, listTerminals()));
        // A list tmux could not give is an outage, never a sandbox with no shells.
        if (listed === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { sandbox: state, terminals: listed };
      }),
    start: (sessionId, terminalId, title) =>
      inRunning(sessionId, (running) =>
        Effect.gen(function* () {
          const started = yield* api.run(running, startTerminal(terminalId, title));
          // A shell tmux could not start, or could not list once started, is an outage: the id is the service's own, so it names nothing missing.
          if (started.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
          const listed = terminalsOf(yield* api.run(running, listTerminals()));
          if (listed === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
          const shell = listed.find((terminal) => terminal.id === terminalId);
          return shell === undefined
            ? Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND })
            : Result.succeed(shell);
        }),
      ),
    rename: (sessionId, terminalId, title) => onShell(sessionId, renameTerminal(terminalId, title)),
    kill: (sessionId, terminalId) => onShell(sessionId, killTerminal(terminalId)),
    attach: (sessionId, terminalId) =>
      Effect.gen(function* () {
        const { state, running } = yield* standing(sessionId);
        if (running === undefined) {
          return {
            state:
              state === SANDBOX_STATE.STARTING ? SANDBOX_STATE.STARTING : SANDBOX_STATE.STOPPED,
          };
        }
        // A shell that is not there was ended elsewhere, or never started: no PTY is minted for it.
        const held = yield* api.run(running, holdsTerminal(terminalId));
        if (held.exitCode === TMUX_EXIT.NO_SESSION) {
          return { state: SANDBOX_STATE.RUNNING, gone: true } as const;
        }
        // A tmux that could not be installed or asked is an outage the tab may retry, never a shell gone.
        if (held.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
        // The running session's own PTY, never the sandbox's: a mint on the sandbox would resume it.
        const shell = yield* api.openInteractive(running);
        return { state: SANDBOX_STATE.RUNNING, sandboxSessionId: running, shell };
      }),
    setGitHubToken: (sandboxSessionId, token) => {
      const authorization = `Basic ${Buffer.from(`x-access-token:${Redacted.value(token)}`).toString("base64")}`;
      const transform = [{ transform: [{ headers: { authorization } }] }];
      return api.updateNetworkPolicy(sandboxSessionId, {
        allow: { "*": [], ...Object.fromEntries(GITHUB_HOSTS.map((host) => [host, transform])) },
      });
    },
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
