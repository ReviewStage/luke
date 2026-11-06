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
 *
 * The ports a server listens on are read the same way, from the kernel's
 * socket tables in the running session (`listening-ports.ts`), and never
 * from a sandbox that is not running. Turning forwarding on is the one
 * read that wakes a stopped sandbox, the developer having asked for the
 * app, and starts the repository's run command (`run-command.ts`) where no
 * port listens in it yet.
 *
 * The GitHub credential the firewall carries for the agent is set here in
 * the shape its own session and a copy of its work set it
 * (`../sandbox-firewall.ts`): an installation token on GitHub's two hosts,
 * or a member's own classic token on the agent's one repository's git and
 * REST paths alone, which is taken off again whenever nobody is using it.
 * The swaps of a launch running there stay, since every write composes the
 * session's whole policy with them.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type {
  ForwardingStartAnswer,
  ListeningPortsAnswer,
} from "@repo/features/listening-ports-wire";
import {
  SANDBOX_STATE,
  type SandboxState,
  type TerminalSummary,
  type TerminalsAnswer,
} from "@repo/features/terminal-wire";
import { Context, Effect, Layer, Result } from "effect";
import type { HttpClient } from "effect/http";
import {
  type FirewallSession,
  type RepositoryCredential,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import { capSandboxTimeout } from "../sandbox-keep-alive.js";
import {
  deploymentOidcToken,
  type InteractiveShell,
  type ListedSandbox,
  SANDBOX_STATUS,
  SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { listeningPortsOf, readSocketTables } from "./listening-ports.js";
import { readRunConfig, runCommandOf, startRunCommand } from "./run-command.js";
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
  [SANDBOX_STATUS.RUNNING, SANDBOX_STATE.RUNNING],
  [SANDBOX_STATUS.PENDING, SANDBOX_STATE.STARTING],
  [SANDBOX_STATUS.STOPPING, SANDBOX_STATE.STOPPED],
  [SANDBOX_STATUS.SNAPSHOTTING, SANDBOX_STATE.STOPPED],
  [SANDBOX_STATUS.STOPPED, SANDBOX_STATE.STOPPED],
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

/** What an open finds: a running sandbox's PTY, minted for one connection, or where the sandbox stands instead. */
export type SandboxOpen =
  | { readonly state: typeof SANDBOX_STATE.RUNNING; readonly shell: InteractiveShell }
  | { readonly state: typeof SANDBOX_STATE.STOPPED | typeof SANDBOX_STATE.STARTING };

export interface AgentSandboxService {
  /** The agent's shells and where its sandbox stands; none while it is not running. */
  readonly terminals: (sessionId: string) => Effect.Effect<TerminalsAnswer, SandboxUnavailable>;
  /** Whether the agent's sandbox is running, and the ports a server listens on in it; none while it is not running, which a read never changes. */
  readonly listeningPorts: (
    sessionId: string,
  ) => Effect.Effect<ListeningPortsAnswer, SandboxUnavailable>;
  /** The agent's sandbox woken where it was stopped, and the repository's run command started there where no port listens. */
  readonly startForwarding: (
    sessionId: string,
  ) => Effect.Effect<ForwardingStartAnswer, SandboxUnavailable>;
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
  /** A PTY minted on the running sandbox for a command of the caller's own, or where the sandbox stands; a stopped sandbox is never woken here. */
  readonly open: (sessionId: string) => Effect.Effect<SandboxOpen, SandboxUnavailable>;
  /**
   * A fresh credential set at the running sandbox session's firewall, in the
   * shape the agent's own session sets it, so the shell reaches GitHub as
   * the agent does and never holds the token's bytes; the session is named
   * with the account whose agent it is.
   */
  readonly setCredential: (
    session: FirewallSession,
    credential: RepositoryCredential,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /** The GitHub credential taken off the running sandbox session's firewall, the swaps of a launch running there staying. */
  readonly withdrawCredential: (
    session: FirewallSession,
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

/** The service over the REST calls the API makes, and the store its firewall's launch is read from. */
function agentSandboxOver(
  api: VercelSandboxApi,
  context: Context.Context<DatabaseServices>,
): AgentSandboxService {
  const firewall = sandboxFirewall(api);
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

  /** The sandbox's running session, woken from its snapshot where it was stopped; none where it was never opened. */
  const woken = (sessionId: string) =>
    Effect.gen(function* () {
      const { sandbox, running } = yield* standing(sessionId);
      if (sandbox === undefined || running !== undefined) return running;
      // Lowered first, so the session the resume opens lives the timeout, not an old sandbox's day.
      yield* capSandboxTimeout(api, sandbox);
      return (yield* api.resume(sandbox.name)).currentSessionId;
    });

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
    listeningPorts: (sessionId) =>
      Effect.gen(function* () {
        const { running } = yield* standing(sessionId);
        if (running === undefined) return { running: false, ports: [] };
        const ports = listeningPortsOf(yield* api.run(running, readSocketTables()));
        // Tables the kernel could not be read for are an outage, never a sandbox with no servers.
        if (ports === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { running: true, ports };
      }),
    startForwarding: (sessionId) =>
      Effect.gen(function* () {
        const running = yield* woken(sessionId);
        if (running === undefined) return { started: false };
        const ports = listeningPortsOf(yield* api.run(running, readSocketTables()));
        if (ports === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        if (ports.length > 0) return { started: false };
        const command = runCommandOf(yield* api.run(running, readRunConfig()));
        if (command === undefined) return { started: false };
        yield* api.start(running, { ...startRunCommand(command), sudo: false });
        return { started: true };
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
        // A tmux that could not be started or asked is an outage the tab may retry, never a shell gone.
        if (held.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
        // The running session's own PTY, never the sandbox's: a mint on the sandbox would resume it.
        const shell = yield* api.openInteractive(running);
        return { state: SANDBOX_STATE.RUNNING, sandboxSessionId: running, shell };
      }),
    open: (sessionId) =>
      Effect.gen(function* () {
        const { state, running } = yield* standing(sessionId);
        if (running === undefined) {
          return {
            state:
              state === SANDBOX_STATE.STARTING ? SANDBOX_STATE.STARTING : SANDBOX_STATE.STOPPED,
          };
        }
        // The running session's own PTY, never the sandbox's: a mint on the sandbox would resume it.
        const shell = yield* api.openInteractive(running);
        return { state: SANDBOX_STATE.RUNNING, shell };
      }),
    setCredential: (session, credential) =>
      Effect.provideContext(firewall.write(session, { github: credential }), context),
    withdrawCredential: (session) => Effect.provideContext(firewall.write(session, {}), context),
    resume: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, state } = yield* standing(sessionId);
        if (sandbox === undefined || state === SANDBOX_STATE.RUNNING) return state;
        // Lowered first, so the session the resume opens lives the timeout, not an old sandbox's day.
        yield* capSandboxTimeout(api, sandbox);
        return stateOf(yield* api.resume(sandbox.name));
      }),
  };
}

/** The service as the deployment runs it, on the function's own OIDC token. */
export const agentSandboxLayer: Layer.Layer<
  AgentSandbox,
  never,
  HttpClient.HttpClient | DatabaseServices
> = Layer.effect(
  AgentSandbox,
  Effect.gen(function* () {
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    return agentSandboxOver(api, yield* Effect.context<DatabaseServices>());
  }),
);
