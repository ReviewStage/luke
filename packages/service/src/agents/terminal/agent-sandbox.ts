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

/** The agent's working tree as a run on a Mac takes it: the commit its work starts from, its branch, and everything since as a gzipped binary patch. */
export interface WorkingTreeSnapshot {
  /** Where the agent's branch left the default branch, which GitHub holds. */
  readonly base: string;
  /** The branch checked out in the sandbox; null on a detached HEAD. */
  readonly branch: string | null;
  /** `git diff --binary` from the base to the working tree, untracked files not ignored included, gzipped and in base64. */
  readonly patch: string;
}

/** Why no snapshot could be taken: the sandbox is not running, the patch is past the bound, or the checkout has no base on the default branch. */
export const SNAPSHOT_REFUSAL = {
  NOT_RUNNING: "not-running",
  TOO_LARGE: "too-large",
  NO_BASE: "no-base",
} as const;

export type SnapshotRefusal =
  | { readonly kind: typeof SNAPSHOT_REFUSAL.NOT_RUNNING; readonly sandbox: SandboxState }
  | { readonly kind: typeof SNAPSHOT_REFUSAL.TOO_LARGE; readonly bytes: number }
  | { readonly kind: typeof SNAPSHOT_REFUSAL.NO_BASE };

/** The exits the snapshot script ends with where it takes none. */
const SNAPSHOT_EXIT = { TOO_LARGE: 3, NO_BASE: 4 } as const;

/**
 * The snapshot script, run with bash in the checkout's folder. A copy of the
 * index takes in every file, untracked ones too and ignored ones never, so
 * neither the agent's own index nor its working tree is touched; the patch
 * runs from the merge base with the default branch's remote ref to that
 * tree, gzipped, and goes out in base64 after a line for the base and a line
 * for the branch.
 */
const SNAPSHOT_SCRIPT = [
  "set -euo pipefail",
  'cd "$1"',
  'base=$(git merge-base HEAD "refs/remotes/origin/$2" 2>/dev/null) || exit 4',
  "branch=$(git symbolic-ref --quiet --short HEAD || true)",
  "index=$(mktemp)",
  'trap \'rm -f "$index" "$index.patch"\' EXIT',
  'cp "$(git rev-parse --git-path index)" "$index" 2>/dev/null || true',
  'GIT_INDEX_FILE="$index" git add -A',
  'tree=$(GIT_INDEX_FILE="$index" git write-tree)',
  'git -c core.quotepath=off diff --binary --no-color --no-ext-diff --no-textconv "$base" "$tree" | gzip -9 -c > "$index.patch"',
  'size=$(wc -c < "$index.patch")',
  'if [ "$size" -gt "$3" ]; then echo "$size"; exit 3; fi',
  'printf \'%s\\n%s\\n\' "$base" "$branch"',
  'base64 < "$index.patch" | tr -d "\\n"',
].join("\n");

/** A commit's id as Git spells it. */
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

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
  /**
   * The agent's working tree as it stands now, from the running sandbox's
   * checkout at `checkout`: its base on `defaultBranch` and a patch of
   * everything since, no larger than `maxBytes` gzipped; a stopped sandbox is
   * never woken here.
   */
  readonly snapshot: (
    sessionId: string,
    checkout: string,
    defaultBranch: string,
    maxBytes: number,
  ) => Effect.Effect<Result.Result<WorkingTreeSnapshot, SnapshotRefusal>, SandboxUnavailable>;
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
    snapshot: (sessionId, checkout, defaultBranch, maxBytes) =>
      Effect.gen(function* () {
        const { state, running } = yield* standing(sessionId);
        if (running === undefined) {
          return Result.fail({ kind: SNAPSHOT_REFUSAL.NOT_RUNNING, sandbox: state });
        }
        const ran = yield* api.run(running, {
          command: "bash",
          args: ["-c", SNAPSHOT_SCRIPT, "luke-snapshot", checkout, defaultBranch, String(maxBytes)],
        });
        if (ran.exitCode === SNAPSHOT_EXIT.TOO_LARGE) {
          return Result.fail({
            kind: SNAPSHOT_REFUSAL.TOO_LARGE,
            bytes: Number(ran.stdout.trim()),
          });
        }
        if (ran.exitCode === SNAPSHOT_EXIT.NO_BASE)
          return Result.fail({ kind: SNAPSHOT_REFUSAL.NO_BASE });
        const [base = "", branch = "", patch = ""] = ran.stdout.split("\n");
        // A script that ended otherwise, or wrote anything but its three lines, is an outage the Mac may retry.
        if (ran.exitCode !== 0 || !COMMIT_SHA.test(base)) {
          return yield* Effect.fail(new SandboxUnavailable({}));
        }
        return Result.succeed({ base, branch: branch === "" ? null : branch, patch });
      }),
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
