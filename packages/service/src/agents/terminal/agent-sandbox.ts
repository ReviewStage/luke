/**
 * agent-sandbox.ts -- a coding agent's sandbox as its Terminal tab reaches it: where it stands, its shells, and the developer's resume.
 *
 * The sandbox is found by the session the agent runs in, whose id it
 * carries as a tag (`vercel-sandbox-api.ts`). Where it stands is read and
 * never changed by a read: a stopped sandbox stays stopped until the
 * developer's resume, which opens it as the agent's next turn does, through
 * the same `getOrCreate` (`../agent-sandbox-open.ts`): the one standing under
 * its session's name is resumed, or made again on the session's drive, with
 * the tags and the size it stood with, where its snapshot is gone. One
 * opened before `getOrCreate`, under a UUID, is resumed by its own name, and
 * stays as it stands once its snapshot is gone. A shell is started, named,
 * and ended by a short tmux command run in the sandbox's running session
 * (`tmux.ts`), and the list is
 * read back from tmux, so it is whatever the sandbox holds now. A shell
 * starts only in a running sandbox; asked of any other, the service answers
 * where the sandbox stands instead.
 *
 * The ports a server listens on are read the same way, from the kernel's
 * socket tables in the running session (`listening-ports.ts`), and never
 * from a sandbox that is not running.
 *
 * The GitHub credential the firewall carries for the agent is set here in
 * the shape its own session and a copy of its work set it
 * (`../sandbox-firewall.ts`): an installation token on GitHub's two hosts,
 * or a member's own classic token on the agent's one repository's git and
 * REST paths alone. The swaps of a launch running there stay, since every write composes the
 * session's whole policy with them.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { ListeningPortsAnswer } from "@repo/features/listening-ports-wire";
import {
  SANDBOX_STATE,
  type SandboxState,
  type TerminalSummary,
  type TerminalsAnswer,
} from "@repo/features/terminal-wire";
import { Context, Effect, Layer, Result } from "effect";
import { agentSandboxName, openAgentSandbox } from "../agent-sandbox-open.js";
import { AgentImage, type AgentImageService } from "../coder-host/agent-image.js";
import {
  type FirewallSession,
  type RepositoryCredential,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import {
  deploymentOidcToken,
  type InteractiveShell,
  type ListedSandbox,
  SANDBOX_STATUS,
  type SandboxSessionApi,
  SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { listeningPortsOf, readSocketTables } from "./listening-ports.js";
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

/** What an attach finds: a running sandbox's PTY, minted for one connection, with the sandbox's name and its session, where the sandbox stands instead, or no such shell in it. */
type SandboxAttach =
  | {
      readonly state: typeof SANDBOX_STATE.RUNNING;
      readonly sandboxName: string;
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
  /** The agent's sandbox opened again, as its next turn opens it, answering where it stands after; one never opened stays starting. */
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
}

export class AgentSandbox extends Context.Service<AgentSandbox, AgentSandboxService>()(
  "AgentSandbox",
) {}

/** Where a listed sandbox stands; none listed is one the agent has not opened yet. */
function stateOf(sandbox: ListedSandbox | undefined): SandboxState {
  if (sandbox === undefined) return SANDBOX_STATE.STARTING;
  return STATE_OF_STATUS.get(sandbox.status ?? "") ?? SANDBOX_STATE.STOPPED;
}

/** The service over the calls `vercel-sandbox-api.ts` makes, the store its firewall's launch is read from, and the agents' image a sandbox is made again from. */
function agentSandboxOver(
  api: VercelSandboxApi,
  context: Context.Context<DatabaseServices>,
  image: AgentImageService,
): AgentSandboxService {
  const firewall = sandboxFirewall(api);
  /**
   * The session's sandbox, where it stands, and while it is up the running
   * session a command goes to, held for the operation's every call.
   */
  const standing = (sessionId: string) =>
    Effect.gen(function* () {
      const [sandbox] = yield* api.listTagged(sessionId);
      const state = stateOf(sandbox);
      const sandboxSessionId =
        state === SANDBOX_STATE.RUNNING ? sandbox?.currentSessionId : undefined;
      const running =
        sandbox === undefined || sandboxSessionId === undefined
          ? undefined
          : yield* api.session({ name: sandbox.name, sessionId: sandboxSessionId });
      return { sandbox, state, sandboxSessionId, running };
    });

  /** A command run in the running sandbox; a sandbox not running is refused as it stands. */
  const inRunning = <A>(
    sessionId: string,
    then: (
      running: SandboxSessionApi,
    ) => Effect.Effect<Result.Result<A, ShellRefusal>, SandboxUnavailable>,
  ): ShellEffect<A> =>
    Effect.flatMap(standing(sessionId), ({ state, running }) =>
      running === undefined
        ? Effect.succeed(Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: state }))
        : then(running),
    );

  /** A command that names one shell: its nonzero exit is a shell that is not there. */
  const onShell = (sessionId: string, ask: ReturnType<typeof renameTerminal>): ShellEffect<void> =>
    inRunning(sessionId, (running) =>
      Effect.map(running.run(ask), (run) =>
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
        const listed = terminalsOf(yield* running.run(listTerminals()));
        // A list tmux could not give is an outage, never a sandbox with no shells.
        if (listed === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { sandbox: state, terminals: listed };
      }),
    listeningPorts: (sessionId) =>
      Effect.gen(function* () {
        const { running } = yield* standing(sessionId);
        if (running === undefined) return { running: false, ports: [] };
        const ports = listeningPortsOf(yield* running.run(readSocketTables()));
        // Tables the kernel could not be read for are an outage, never a sandbox with no servers.
        if (ports === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { running: true, ports };
      }),
    start: (sessionId, terminalId, title) =>
      inRunning(sessionId, (running) =>
        Effect.gen(function* () {
          const started = yield* running.run(startTerminal(terminalId, title));
          // A shell tmux could not start, or could not list once started, is an outage: the id is the service's own, so it names nothing missing.
          if (started.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
          const listed = terminalsOf(yield* running.run(listTerminals()));
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
        const { sandbox, state, sandboxSessionId, running } = yield* standing(sessionId);
        if (sandbox === undefined || running === undefined || sandboxSessionId === undefined) {
          return {
            state:
              state === SANDBOX_STATE.STARTING ? SANDBOX_STATE.STARTING : SANDBOX_STATE.STOPPED,
          };
        }
        // A shell that is not there was ended elsewhere, or never started: no PTY is minted for it.
        const held = yield* running.run(holdsTerminal(terminalId));
        if (held.exitCode === TMUX_EXIT.NO_SESSION) {
          return { state: SANDBOX_STATE.RUNNING, gone: true } as const;
        }
        // A tmux that could not be started or asked is an outage the tab may retry, never a shell gone.
        if (held.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
        // The running session's own PTY, never the sandbox's: a mint on the sandbox would resume it.
        const shell = yield* running.openInteractive();
        return { state: SANDBOX_STATE.RUNNING, sandboxName: sandbox.name, sandboxSessionId, shell };
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
        const shell = yield* running.openInteractive();
        return { state: SANDBOX_STATE.RUNNING, shell };
      }),
    setCredential: (session, credential) =>
      Effect.provideContext(firewall.write(session, { github: credential }), context),
    resume: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, state } = yield* standing(sessionId);
        if (sandbox === undefined || state === SANDBOX_STATE.RUNNING) return state;
        if (sandbox.name !== agentSandboxName(sessionId)) {
          return stateOf(yield* api.resume(sandbox.name));
        }
        const opened = yield* openAgentSandbox(api, {
          sessionId,
          tags: { ...sandbox.tags },
          vcpus: sandbox.vcpus,
        }).pipe(Effect.provideService(AgentImage, image));
        return stateOf(opened.sandbox);
      }),
  };
}

/** The service as the deployment runs it, on the function's own OIDC token and the agents' image its build names. */
export const agentSandboxLayer: Layer.Layer<AgentSandbox, never, DatabaseServices | AgentImage> =
  Layer.effect(
    AgentSandbox,
    Effect.gen(function* () {
      const api = yield* vercelSandboxApi(deploymentOidcToken);
      return agentSandboxOver(api, yield* Effect.context<DatabaseServices>(), yield* AgentImage);
    }),
  );
