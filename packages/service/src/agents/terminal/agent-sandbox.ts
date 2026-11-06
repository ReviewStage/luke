import type { DatabaseServices } from "@repo/database/core/query";
import type { ListeningPortsAnswer } from "@repo/features/listening-ports-wire";
import {
  SANDBOX_STATE,
  type SandboxState,
  type TerminalSummary,
  type TerminalsAnswer,
} from "@repo/features/terminal-wire";
import { Context, Effect, Layer, Result } from "effect";
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

const STATE_OF_STATUS = new Map<string, SandboxState>([
  [SANDBOX_STATUS.RUNNING, SANDBOX_STATE.RUNNING],
  [SANDBOX_STATUS.PENDING, SANDBOX_STATE.STARTING],
  [SANDBOX_STATUS.STOPPING, SANDBOX_STATE.STOPPED],
  [SANDBOX_STATUS.SNAPSHOTTING, SANDBOX_STATE.STOPPED],
  [SANDBOX_STATUS.STOPPED, SANDBOX_STATE.STOPPED],
  ["failed", SANDBOX_STATE.STOPPED],
  ["aborted", SANDBOX_STATE.STOPPED],
]);

export const SHELL_REFUSAL = {
  NOT_RUNNING: "not-running",
  NOT_FOUND: "not-found",
} as const;

export type ShellRefusal =
  | { readonly kind: typeof SHELL_REFUSAL.NOT_RUNNING; readonly sandbox: SandboxState }
  | { readonly kind: typeof SHELL_REFUSAL.NOT_FOUND };

type ShellEffect<A> = Effect.Effect<Result.Result<A, ShellRefusal>, SandboxUnavailable>;

type SandboxAttach =
  | {
      readonly state: typeof SANDBOX_STATE.RUNNING;
      readonly sandboxName: string;
      readonly sandboxSessionId: string;
      readonly shell: InteractiveShell;
    }
  | { readonly state: typeof SANDBOX_STATE.STOPPED | typeof SANDBOX_STATE.STARTING }
  | { readonly state: typeof SANDBOX_STATE.RUNNING; readonly gone: true };

export type SandboxOpen =
  | { readonly state: typeof SANDBOX_STATE.RUNNING; readonly shell: InteractiveShell }
  | { readonly state: typeof SANDBOX_STATE.STOPPED | typeof SANDBOX_STATE.STARTING };

export interface AgentSandboxService {
  readonly terminals: (sessionId: string) => Effect.Effect<TerminalsAnswer, SandboxUnavailable>;
  readonly listeningPorts: (
    sessionId: string,
  ) => Effect.Effect<ListeningPortsAnswer, SandboxUnavailable>;
  readonly start: (
    sessionId: string,
    terminalId: string,
    title: string | undefined,
  ) => ShellEffect<TerminalSummary>;
  readonly rename: (sessionId: string, terminalId: string, title: string) => ShellEffect<void>;
  readonly kill: (sessionId: string, terminalId: string) => ShellEffect<void>;
  readonly resume: (sessionId: string) => Effect.Effect<SandboxState, SandboxUnavailable>;
  readonly attach: (
    sessionId: string,
    terminalId: string,
  ) => Effect.Effect<SandboxAttach, SandboxUnavailable>;
  readonly open: (sessionId: string) => Effect.Effect<SandboxOpen, SandboxUnavailable>;
  readonly setCredential: (
    session: FirewallSession,
    credential: RepositoryCredential,
  ) => Effect.Effect<void, SandboxUnavailable>;
  readonly withdrawCredential: (
    session: FirewallSession,
  ) => Effect.Effect<void, SandboxUnavailable>;
}

export class AgentSandbox extends Context.Service<AgentSandbox, AgentSandboxService>()(
  "AgentSandbox",
) {}

function stateOf(sandbox: ListedSandbox | undefined): SandboxState {
  if (sandbox === undefined) return SANDBOX_STATE.STARTING;
  return STATE_OF_STATUS.get(sandbox.status ?? "") ?? SANDBOX_STATE.STOPPED;
}

function agentSandboxOver(
  api: VercelSandboxApi,
  context: Context.Context<DatabaseServices>,
): AgentSandboxService {
  const firewall = sandboxFirewall(api);
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
        if (listed === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { sandbox: state, terminals: listed };
      }),
    listeningPorts: (sessionId) =>
      Effect.gen(function* () {
        const { running } = yield* standing(sessionId);
        if (running === undefined) return { running: false, ports: [] };
        const ports = listeningPortsOf(yield* running.run(readSocketTables()));
        if (ports === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { running: true, ports };
      }),
    start: (sessionId, terminalId, title) =>
      inRunning(sessionId, (running) =>
        Effect.gen(function* () {
          const started = yield* running.run(startTerminal(terminalId, title));
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
        const held = yield* running.run(holdsTerminal(terminalId));
        if (held.exitCode === TMUX_EXIT.NO_SESSION) {
          return { state: SANDBOX_STATE.RUNNING, gone: true } as const;
        }
        if (held.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
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
        const shell = yield* running.openInteractive();
        return { state: SANDBOX_STATE.RUNNING, shell };
      }),
    setCredential: (session, credential) =>
      Effect.provideContext(firewall.write(session, { github: credential }), context),
    withdrawCredential: (session) => Effect.provideContext(firewall.write(session, {}), context),
    resume: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, state } = yield* standing(sessionId);
        if (sandbox === undefined || state === SANDBOX_STATE.RUNNING) return state;
        return stateOf(yield* api.resume(sandbox.name));
      }),
  };
}

export const agentSandboxLayer: Layer.Layer<AgentSandbox, never, DatabaseServices> = Layer.effect(
  AgentSandbox,
  Effect.gen(function* () {
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    return agentSandboxOver(api, yield* Effect.context<DatabaseServices>());
  }),
);
