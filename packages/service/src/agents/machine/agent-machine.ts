/**
 * agent-machine.ts -- the machine a native coding agent runs on, as the one interface its launch and Luke's doors to its files reach it through.
 *
 * A native agent's runner (`@luke/agent-runner`) runs on a machine Luke
 * opens for it, today a Vercel Sandbox (`vercel-machine.ts`). Its launch
 * (`../coder-host/runner-sessions.ts`) and the doors Luke's MCP tools read
 * a file or run `show_code` through (`../luke-mcp/sandbox-door.ts`) reach
 * that machine here and nowhere else, so a second kind of machine shares one
 * launch path and one set of doors rather than a copy of each that drifts.
 *
 * The interface is pitched at intent and holds only what the launch and the
 * doors use: open the agent's place with its checkout, launch the runner
 * there and write its stdin, read whether it ended, end it, read one file,
 * and run one command of the repository's. What each machine keeps of its
 * own (a Vercel sandbox's tags, firewall, stop and resume, snapshots, the
 * Terminal, the browser) stays outside it until a second machine needs it.
 *
 * A place is named by Luke's own runtime session id, which the conversation
 * records and every machine can find its place by, and by where the session
 * runs now, which is the machine's own and opaque to everyone else. A door
 * holds the session id alone, so a door's call names only that.
 *
 * What fails answers `SandboxUnavailable`, with the status the machine
 * answered where it answered one; a runner that has ended answers
 * `NOT_FOUND_STATUS` to a write, which is how a caller tells it from a
 * machine that did not answer.
 */

import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { type Brand, Context, Data, type Duration, type Effect } from "effect";
import type { AgentSandboxImage } from "../agent-sandbox-image.js";
import type { KeyRefusal, PlanRefusal } from "../brain-host/eve-sessions.js";
import type { CheckoutServices } from "../coder-host/checkout.js";
import type { RunnerBundle } from "../coder-host/runner-bundle.js";
import type { RepositorySandbox } from "../repository-shell.js";
import type { CommandExit, CommandRun, SandboxUnavailable } from "../vercel-sandbox-api.js";

/** Where a session runs now, as its machine names it: a Vercel sandbox's running session. Opaque to every caller but the machine. */
export type MachineRunning = string & Brand.Brand<"MachineRunning">;

/** What a machine's own lifecycle calls a place: a Vercel sandbox's name. Opaque to every caller but the machine. */
export type MachineName = string & Brand.Brand<"MachineName">;

/** One agent's place on a machine: Luke's runtime session id, and where that session runs now. */
export interface MachinePlace {
  readonly session: string;
  readonly running: MachineRunning;
}

/** A runner launched in a place: the place, and the machine's own id for the runner's process. */
export interface RunnerHandle extends MachinePlace {
  readonly command: string;
}

/** What a machine's calls reach of the caller's services: the store, GitHub, the image, and the runner's bundle. */
type MachineServices = CheckoutServices | AgentSandboxImage | RunnerBundle;

/** A launch could not start: no agent, no credential, no snapshot, a model the harness cannot name, or the account's plan or API key refused. */
export class LaunchRefused extends Data.TaggedError("LaunchRefused")<{
  readonly reason: string;
  /** How the account's plan failed, where it is why. */
  readonly planRefusal?: PlanRefusal | undefined;
  /** How the account's API key failed, for an agent it pays for, where it is why. */
  readonly keyRefusal?: KeyRefusal | undefined;
  /** When a reached limit resets, in epoch milliseconds, where the provider said. */
  readonly planResetsAt?: number | undefined;
}> {}

/** What an open asks: the session the place is opened under, the agent whose repository it checks out, and the reads run beside it. */
interface MachineOpen<B, EB, RB> {
  readonly session: string;
  /** The account and conversation the open acts for: the agent's starter's. */
  readonly target: ConversationTarget;
  readonly agent: CodingAgent;
  /** How the log names the agent's harness. */
  readonly harness: string;
  /** Whether the open waits on a machine image still being prepared, rather than failing at once. */
  readonly waitOnImage: boolean;
  /** The caller's reads that need no place, run beside the open, whose result `use` is handed. */
  readonly beside: Effect.Effect<B, EB, RB>;
}

/** A place opened: where it stands, its lifecycle's own name for it, where the agent's checkout is, and what is left of the checkout to run beside the launch. */
export interface OpenedPlace {
  readonly place: MachinePlace;
  readonly name: MachineName;
  readonly checkoutPath: string;
  /** The checkout's last step, which the launch's `ready` runs: nothing where the open left nothing to do. */
  readonly finishCheckout: Effect.Effect<void, { readonly _tag: string }>;
}

/** What a launch starts the runner with, and what it waits on before it does. */
interface RunnerLaunch<A, E, R, EL, RL> {
  /**
   * The runner's environment beside the machine's own: every value is
   * secret, the harness's credential and the runner's bearer among them, and
   * is written nowhere but the runner's environment, never its argv, a file,
   * or a log.
   */
  readonly env: Readonly<Record<string, string>>;
  /** The caller's steps the runner waits on, run beside the machine's own; their result is handed back. */
  readonly ready: Effect.Effect<A, E, R>;
  /**
   * The runner's first lines, read once it started and before it reads
   * anything: the caller records the handle here, so a runner never takes a
   * line before a later call can find it. The lines go with the launch
   * itself, so a machine that seals the launch seals them with it.
   */
  readonly firstLines: (ready: A, handle: RunnerHandle) => Effect.Effect<string, EL, RL>;
  /** What the caller undoes where the runner started but never took its first lines, run once it is ended; a failure of it is let be. */
  readonly abandon: (ready: A) => Effect.Effect<void, { readonly _tag: string }, RL>;
}

/** What one command of a repository's runs: a shell script, where it says, under the environment it names. */
export type RepositoryCommand = Parameters<RepositorySandbox["run"]>[0];

export interface AgentMachineService {
  /**
   * The agent's place opened under the session, its repository checked out
   * there where it has one, and handed to `use`; a place `use` fails in is
   * thrown away again, since no conversation records the session that would
   * find it.
   */
  readonly open: <A, E, R, B, EB, RB>(
    ask: MachineOpen<B, EB, RB>,
    use: (opened: OpenedPlace, beside: B) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    E | EB | LaunchRefused | { readonly _tag: string },
    R | RB | MachineServices
  >;
  /** The runner launched in the place once `ready` is done, and handed its first lines; ended again where they were not taken. */
  readonly launchRunner: <A, E, R, EL, RL>(
    place: MachinePlace,
    launch: RunnerLaunch<A, E, R, EL, RL>,
  ) => Effect.Effect<
    { readonly handle: RunnerHandle; readonly ready: A },
    E | EL | SandboxUnavailable | { readonly _tag: string },
    R | RL | MachineServices
  >;
  /**
   * Text appended to the runner's stdin after whatever it already took;
   * `NOT_FOUND_STATUS` where the runner has ended. Note that a line written
   * here is not sealed, so a line that carries a secret (Codex's token
   * refresh, `@luke/agent-runner/protocol`) must be sealed on a machine that
   * keeps its lines, once Codex runs on one.
   */
  readonly writeLine: (
    handle: RunnerHandle,
    text: string,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /** The runner's exit code, null while it runs, or gone where the machine no longer knows it; waiting at most `within` for the exit. */
  readonly runnerExit: (
    handle: RunnerHandle,
    within?: Duration.Duration,
  ) => Effect.Effect<CommandExit, SandboxUnavailable>;
  /** Ends the runner; one already gone counts as ended. */
  readonly kill: (handle: RunnerHandle) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * One file of the session's place, read as the agent's own user, never as
   * root: at most one byte past `bound`, so a caller still sees a file
   * larger than it; nothing where that user reads no such file.
   */
  readonly readFile: (
    session: string,
    path: string,
    bound: number,
  ) => Effect.Effect<Uint8Array | undefined, SandboxUnavailable>;
  /** One command of the repository's run in the session's place as the agent's own user, and waited on. */
  readonly runRepositoryCommand: (
    session: string,
    command: RepositoryCommand,
  ) => Effect.Effect<CommandRun, SandboxUnavailable>;
}

export class AgentMachine extends Context.Service<AgentMachine, AgentMachineService>()(
  "AgentMachine",
) {}
