/**
 * agent-machine.ts -- the machine a native coding agent runs on, as the one interface its launch and our doors to its files reach it through.
 *
 * A native agent's runner (`@repo/agent-runner`) runs on a machine we
 * open for it, today a Vercel Sandbox (`vercel-machine.ts`). Its launch
 * (`../coder-host/runner-sessions.ts`) and the door our MCP tools read
 * a file through (`../workspace-mcp/sandbox-door.ts`) reach that machine here
 * and nowhere else, so a second kind of machine shares one launch path and
 * one door rather than a copy of each that drifts.
 *
 * The interface is pitched at intent and holds only what the launch and the
 * door use: where the agent's things stand on the machine (`layout`), open
 * the agent's place with its checkout, find it again and record the runner
 * it runs, set and take off what stands at its firewall, resume, stop,
 * and discard it, write files into it, launch the runner there and write
 * its stdin, read whether it ended, end it, and read one file. A runner on a
 * machine whose layout says it reads its lines takes them from our store
 * instead (`../coder-host/runner-sessions.ts`), and its stdin carries only
 * its config. What a
 * machine keeps of its own beyond that (a Vercel sandbox's snapshots, the
 * Terminal, the browser) stays outside it until a second machine needs it.
 *
 * Two machines answer it: Vercel Sandbox (`vercel-machine.ts`) and the
 * starter's Mac (`device-machine.ts`), which the agent's row picks between
 * (`agent.machine`, `agent-machines.ts`).
 *
 * A place is named by our own runtime session id, which the conversation
 * records and every machine can find its place by, and by where the session
 * runs now, which is the machine's own and opaque to everyone else. A door
 * holds the session id alone, so a door's call names only that.
 *
 * What fails answers `SandboxUnavailable`, with the status the machine
 * answered where it answered one; a runner that has ended answers
 * `NOT_FOUND_STATUS` to a write, which is how a caller tells it from a
 * machine that did not answer.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import type { AgentMachineKind } from "@repo/features/agent-wire";
import { type Brand, Context, Data, type Duration, type Effect, type Redacted } from "effect";
import type { AgentImage, AgentImageMissing } from "../coder-host/agent-image.js";
import type { CheckoutRefused, CheckoutServices } from "../coder-host/checkout.js";
import type { KeyRefusal, PlanRefusal } from "../eve-host/eve-sessions.js";
import type {
  FirewallLaunch,
  FirewallSources,
  LaunchSwapKind,
  LaunchSwaps,
  PlaceholderSwap,
} from "../sandbox-firewall.js";
import type { CommandExit, SandboxFile, SandboxUnavailable } from "../vercel-sandbox-api.js";

/** Where a session runs now, as its machine names it: a Vercel sandbox's running session, or a local agent's id on its Mac. Opaque to every caller but the machine. */
export type MachineRunning = string & Brand.Brand<"MachineRunning">;

/** What a machine's own lifecycle calls a place: a Vercel sandbox's name, or a local agent's id. Opaque to every caller but the machine. */
export type MachineName = string & Brand.Brand<"MachineName">;

/** What a machine keeps of a place it found, for its own later calls on it. Opaque to every caller but the machine. */
export type MachineKept = Brand.Brand<"MachineKept">;

/** One agent's place on a machine: which machine, our runtime session id, the place's lifecycle name, and where that session runs now. */
export interface MachinePlace {
  readonly machine: AgentMachineKind;
  readonly session: string;
  readonly name: MachineName;
  readonly running: MachineRunning;
}

/**
 * Where a machine keeps an agent's things, decided from the agent alone, so
 * a launch names them before the machine is asked anything: its checkout,
 * where the harness starts and the instructions name, where the member's
 * installed skills are installed and where they are written for that, the
 * folder a message's files are written under, and the Claude Code CLI and
 * the Codex a launch runs, none where the harness's own default stands.
 */
export interface MachineLayout {
  readonly checkoutPath: string;
  readonly installedSkills: string;
  readonly skillsUpload: string;
  readonly attachments: string;
  /** Where the agent saves a file the service reads back, a screenshot it shows or a page it posts: a folder the service's reads reach on that machine. */
  readonly sharedFiles: string;
  readonly claudeExecutable: string | undefined;
  /** None on a Mac that checked no Codex yet, which runs no Codex agent, as on a sandbox, which runs the image's. */
  readonly codexExecutable: string | undefined;
  /**
   * Whether the runner reads its lines past its config from the service
   * (`@repo/agent-runner`'s `RUNNER_LINES`), as a sandbox's does, rather than
   * from its stdin, as a Mac's follower writes them to the runner its
   * release bundled.
   */
  readonly linesRead: boolean;
  /**
   * Whether the runner keeps the CLI's transcript at the service
   * (`@repo/agent-runner`'s `RUNNER_TRANSCRIPTS`), as a sandbox's does, so
   * a place made anew still resumes the CLI's session; a Mac's CLI keeps
   * its own files on the Mac.
   */
  readonly transcriptsKept: boolean;
}

/** What a later call reads of a launch: its first event number, and what it was started with, as a digest (`runner-sessions.ts`'s `launchFingerprint`). */
export interface RunnerMark {
  readonly firstSequence: number;
  /** None for a launch from before fingerprints were recorded. */
  readonly fingerprint?: string;
  /** Whether the launch reads its lines from the service (`MachineLayout`'s `linesRead`); none for one the service writes them to the stdin of, a launch from before the read among them. */
  readonly linesRead?: boolean;
}

/** A runner as its machine recorded it: the handle a later call writes to, and its launch's mark. */
export interface RecordedRunner {
  readonly handle: RunnerHandle;
  readonly mark: RunnerMark;
}

/** What a place's record says of its runner. */
export const RUNNER_RECORD = {
  /** No runner, nor any launch to tell a late END by. */
  NONE: "none",
  /** A launch to tell a late END by, and no runner a call writes to. */
  LAUNCHED: "launched",
  /** A runner a call writes to. */
  RUNNING: "running",
} as const;

export type RunnerRecord =
  | { readonly kind: typeof RUNNER_RECORD.NONE }
  | { readonly kind: typeof RUNNER_RECORD.LAUNCHED; readonly mark: RunnerMark }
  | { readonly kind: typeof RUNNER_RECORD.RUNNING; readonly runner: RecordedRunner };

/** A place as a later call finds it by its session. */
export interface FoundPlace {
  readonly machine: AgentMachineKind;
  readonly session: string;
  /** The agent the place was opened for, where it names one. */
  readonly agentId: string | undefined;
  /** The place's lifecycle name, which its record is kept under. */
  readonly name: MachineName;
  /** Where the place runs now; none where it is stopped. */
  readonly running: MachinePlace | undefined;
  /** The runner recorded, where the place still runs in the session it was started in, whether or not it has exited since. */
  readonly runner: RecordedRunner | undefined;
  /** The launch recorded last, which a late END is told by; none where none is. */
  readonly launch: RunnerMark | undefined;
  readonly kept: MachineKept;
}

/** A found place's resume where it can never run again, its disk lost. */
export const PLACE_RESUME = { GONE: "gone" } as const;

/**
 * A found place running again: where it runs now, and whether it was made
 * anew in place of one whose disk was lost (`created`), which holds nothing
 * the place kept off its drive, the harness's own session among it.
 */
export interface ResumedPlace {
  readonly place: MachinePlace;
  readonly created: boolean;
}

/**
 * A running place's firewall, the account whose agent it is named beside
 * it: the whole policy written from the sources given and the swaps of the
 * launch kept for it; a launch's swaps kept ahead of its first write; that
 * launch let go and the policy written without it; or every credential
 * cleared ahead of a stop (`../sandbox-firewall.ts`). A machine with no
 * firewall of ours does nothing.
 */
interface MachineFirewall {
  readonly write: (
    place: MachinePlace,
    userId: string,
    sources: FirewallSources,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  readonly keepLaunch: (
    place: MachinePlace,
    userId: string,
    launch: FirewallLaunch,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  readonly endLaunch: (
    place: MachinePlace,
    userId: string,
    sources: FirewallSources,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  readonly clear: (
    place: MachinePlace,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
}

/** Whether the service renews a runner's credential while its launch stands. */
export const CREDENTIAL_RENEWAL = {
  /** Fixed for its launch: a Mac hands it to the runner, and a sandbox holds it at its firewall. */
  FIXED: "fixed",
  /** Renewed by the service: a Mac hands nothing, its runner asking our token route for each, and a sandbox holds it at its firewall, which the sweep renews. */
  RENEWED: "renewed",
} as const;

export type CredentialRenewal = (typeof CREDENTIAL_RENEWAL)[keyof typeof CREDENTIAL_RENEWAL];

/**
 * A credential a launch declares for its runner, which the machine decides
 * how to hand over (`deliverCredentials`): the variable the runner reads it
 * in, its value, without its scheme, where the runner sends it (the domain,
 * and the path prefix where one is named), in which header, named in lower
 * case, behind which scheme (`Bearer ` or nothing), the slot a firewall
 * holds it in, and whether the service renews it.
 */
export interface RunnerCredential {
  readonly variable: string;
  readonly value: Redacted.Redacted<string>;
  readonly target: Pick<PlaceholderSwap, "domain" | "path">;
  readonly header: string;
  readonly scheme: string;
  readonly slot: LaunchSwapKind;
  readonly renewal: CredentialRenewal;
}

/** Credentials as a machine hands them over: the variables the runner is started with, every one secret, and the swaps its place's firewall keeps for the launch, none on a machine with no firewall of ours. */
export interface DeliveredCredentials {
  readonly env: Readonly<Record<string, string>>;
  readonly swaps: LaunchSwaps;
}

/** A runner launched in a place: the place, and the machine's own id for the runner's process. */
export interface RunnerHandle extends MachinePlace {
  readonly command: string;
}

/** What a machine's calls reach of the caller's services: the store, GitHub, and the agents' image. */
type MachineServices = CheckoutServices | AgentImage;

/** A launch could not start: no agent, no credential, no snapshot, a model the harness cannot name, or the account's plan or API key refused. */
export class LaunchRefused extends Data.TaggedError("LaunchRefused")<{
  readonly reason: string;
  /** How the account's plan failed, where it is why. */
  readonly planRefusal?: PlanRefusal | undefined;
  /** How the account's API key failed, for an agent it pays for, where it is why. */
  readonly keyRefusal?: KeyRefusal | undefined;
  /** When a reached limit resets, in epoch milliseconds, where the provider said. */
  readonly planResetsAt?: number | undefined;
  /** Whether the agent's device is a host its account removed, which no message brings back. */
  readonly deviceRemoved?: true | undefined;
  /** Whether the agent's device has not beaten lately, so nothing it is sent would be taken until it is back. */
  readonly deviceAway?: true | undefined;
}> {}

/** What an open asks: the session the place is opened under, the agent whose repository it checks out, and the reads run beside it. */
export interface MachineOpen<B, EB, RB> {
  readonly session: string;
  /** The account and conversation the open acts for: the agent's starter's. */
  readonly target: ConversationTarget;
  readonly agent: Agent;
  /** How the log names the agent's harness. */
  readonly harness: string;
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
export interface RunnerLaunch<A, E, R, EL, RL> {
  /**
   * The runner's environment beside the machine's own: every value is
   * secret, the harness's credential and the runner's bearer among them, and
   * is written nowhere but the runner's environment, never its argv, a file,
   * or a log.
   */
  readonly env: Readonly<Record<string, string>>;
  /** The account the runner's record is kept under: the agent's starter's. */
  readonly userId: string;
  /** The agent the runner is launched for, whose place's record names it. */
  readonly agentId: string;
  /** Where the repositories the agent works in beside its own are checked out (`extraCheckoutPaths`), which a sandbox's launch marks as it marks the agent's own checkout; none for an agent in one repository or none. */
  readonly extraCheckouts?: readonly string[] | undefined;
  /** The place's lifecycle name, which the runner is recorded under. */
  readonly name: MachineName;
  /** The caller's steps the runner waits on, run beside the machine's own; their result is handed back. */
  readonly ready: Effect.Effect<A, E, R>;
  /**
   * The runner's first lines and its launch's mark, read once it started
   * and before it reads anything: the machine records the runner under the
   * mark before it hands the lines over, so a runner never takes a line
   * before a later call can find it. The lines go with the launch itself,
   * so a machine that seals the launch seals them with it.
   */
  readonly firstLines: (
    ready: A,
    handle: RunnerHandle,
  ) => Effect.Effect<{ readonly lines: string; readonly mark: RunnerMark }, EL, RL>;
  /** What the caller undoes where the runner started but never took its first lines, run once it is ended; a failure of it is let be. */
  readonly abandon: (ready: A) => Effect.Effect<void, { readonly _tag: string }, RL>;
}

export interface AgentMachineService {
  /** Where the machine keeps the agent's things. */
  readonly layout: (
    agent: Agent,
  ) => Effect.Effect<MachineLayout, LaunchRefused | { readonly _tag: string }>;
  /**
   * The credentials a launch of the agent's runner declares, as the machine
   * hands them over: in a sandbox, each held at its firewall behind a
   * placeholder minted for the launch, which the variable carries in its
   * place, so no value enters the machine; on a Mac, which has no firewall
   * of ours, a fixed one in its variable and a renewed one not at all.
   */
  readonly deliverCredentials: (
    agent: Agent,
    credentials: readonly RunnerCredential[],
  ) => DeliveredCredentials;
  /**
   * The agent's place opened under the session, its repository checked out
   * there where it has one, and handed to `use`; a place `use` fails in is
   * left standing for the session's next message.
   */
  readonly open: <A, E, R, B, EB, RB>(
    ask: MachineOpen<B, EB, RB>,
    use: (opened: OpenedPlace, beside: B) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    E | EB | LaunchRefused | { readonly _tag: string },
    R | RB | MachineServices
  >;
  /** Every place opened under the account's session, the newest first; none where none stands. */
  readonly findPlaces: (
    userId: string,
    session: string,
  ) => Effect.Effect<readonly FoundPlace[], SandboxUnavailable | StoreFailure, DatabaseServices>;
  /** What the place's record says of its runner, in place of whatever it said, kept under the account given. */
  readonly recordRunner: (
    place: {
      readonly machine: AgentMachineKind;
      readonly session: string;
      readonly name: MachineName;
      readonly userId: string;
      readonly agentId: string;
    },
    record: RunnerRecord,
  ) => Effect.Effect<void, SandboxUnavailable | StoreFailure, DatabaseServices>;
  /** The running place's firewall, every write to it composing what stands whole. */
  readonly firewall: MachineFirewall;
  /**
   * The agent's found place run again, where it is not, and where it runs
   * now: made anew on the machine's own terms where its disk is lost, or
   * gone where the machine cannot make it again.
   */
  readonly resume: (
    found: FoundPlace,
    agent: Agent,
  ) => Effect.Effect<
    ResumedPlace | typeof PLACE_RESUME.GONE,
    SandboxUnavailable | CheckoutRefused | AgentImageMissing,
    AgentImage | DatabaseServices
  >;
  /** The running place stopped, its disk kept for a later resume. */
  readonly stop: (place: MachinePlace) => Effect.Effect<void, SandboxUnavailable>;
  /** The found place thrown away, with whatever runs in it and its record. */
  readonly discard: (
    found: FoundPlace,
  ) => Effect.Effect<void, SandboxUnavailable | StoreFailure, DatabaseServices>;
  /** Files written into the running place, as the machine's default user, before a later line names them; refused (`LaunchRefused`'s `deviceAway`) where they would go to a device that is away, as the line naming them would be. */
  readonly writeFiles: (
    place: MachinePlace,
    files: readonly SandboxFile[],
  ) => Effect.Effect<void, SandboxUnavailable | LaunchRefused>;
  /**
   * The repositories the agent works in beside its own that the running
   * place does not hold yet cloned into their folders, on the token minted
   * for each, the ones it holds left as they stand; where the runner already
   * runs (`shared`), each folder is then shared with the runner's user as a
   * launch shares it, which a launch to come does itself. Nothing on a
   * machine that clones no extras, a device's, nor for an agent with none.
   */
  readonly checkOutExtras: (
    place: MachinePlace,
    target: ConversationTarget,
    agent: Agent,
    shared: boolean,
  ) => Effect.Effect<void, CheckoutRefused | SandboxUnavailable, CheckoutServices>;
  /** The runner launched in the place once `ready` is done, recorded, and handed its first lines; ended again where they were not taken. */
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
   * `NOT_FOUND_STATUS` where the runner has ended, and refused
   * (`LaunchRefused`'s `deviceAway`) where a line that carries more than a
   * stop goes to a device that is away. Note that a line written
   * here is not sealed, and a Mac keeps its lines in the store until it
   * takes them, so no line may carry a secret: Codex asks the service for each
   * access token over HTTPS through the runner's token command
   * (`@repo/agent-runner`'s `codex-token.ts`) rather than taking it on stdin.
   * A machine whose runner reads its lines (`MachineLayout`'s `linesRead`),
   * as a sandbox's does, is never written to here.
   */
  readonly writeLine: (
    handle: RunnerHandle,
    text: string,
  ) => Effect.Effect<void, SandboxUnavailable | LaunchRefused>;
  /**
   * Whether the text given was written to the runner since its launch, as
   * one write, where the machine keeps what it wrote: a Mac keeps its lines
   * in the store. A sandbox keeps nothing of its runner's stdin, and its
   * runner reads its lines from the service, which its END hands on, so it answers
   * false.
   */
  readonly wrote: (
    handle: RunnerHandle,
    text: string,
  ) => Effect.Effect<boolean, SandboxUnavailable>;
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
}

/** What a machine does to a place it already opened: everything but where it keeps things, opening a place or running it again, checking out what it clones beside the agent's own, handing a runner its credentials, and launching a runner in it. */
export type MachineLifecycle = Omit<
  AgentMachineService,
  "layout" | "open" | "resume" | "checkOutExtras" | "deliverCredentials" | "launchRunner"
>;

export class AgentMachine extends Context.Service<AgentMachine, AgentMachineService>()(
  "AgentMachine",
) {}
