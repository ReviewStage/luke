import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import type { AgentMachineKind } from "@repo/features/agent-wire";
import { type Brand, Context, Data, type Duration, type Effect } from "effect";
import type { AgentImage } from "../coder-host/agent-image.js";
import type { CheckoutRefused, CheckoutServices } from "../coder-host/checkout.js";
import type { KeyRefusal, PlanRefusal } from "../eve-host/eve-sessions.js";
import type { FirewallLaunch, FirewallSources } from "../sandbox-firewall.js";
import type { CommandExit, SandboxFile, SandboxUnavailable } from "../vercel-sandbox-api.js";

export type MachineRunning = string & Brand.Brand<"MachineRunning">;

export type MachineName = string & Brand.Brand<"MachineName">;

export type MachineKept = Brand.Brand<"MachineKept">;

export interface MachinePlace {
  readonly machine: AgentMachineKind;
  readonly session: string;
  readonly name: MachineName;
  readonly running: MachineRunning;
}

export interface MachineLayout {
  readonly checkoutPath: string;
  readonly installedSkills: string;
  readonly skillsUpload: string;
  readonly attachments: string;
  readonly sharedFiles: string;
  readonly claudeExecutable: string | undefined;
  readonly codexExecutable: string | undefined;
  readonly linesRead: boolean;
}

export interface RunnerMark {
  readonly firstSequence: number;
  readonly fingerprint?: string;
  readonly linesRead?: boolean;
}

export interface RecordedRunner {
  readonly handle: RunnerHandle;
  readonly mark: RunnerMark;
}

export const RUNNER_RECORD = {
  NONE: "none",
  LAUNCHED: "launched",
  RUNNING: "running",
} as const;

export type RunnerRecord =
  | { readonly kind: typeof RUNNER_RECORD.NONE }
  | { readonly kind: typeof RUNNER_RECORD.LAUNCHED; readonly mark: RunnerMark }
  | { readonly kind: typeof RUNNER_RECORD.RUNNING; readonly runner: RecordedRunner };

export interface FoundPlace {
  readonly machine: AgentMachineKind;
  readonly session: string;
  readonly agentId: string | undefined;
  readonly name: MachineName;
  readonly running: MachinePlace | undefined;
  readonly runner: RecordedRunner | undefined;
  readonly launch: RunnerMark | undefined;
  readonly kept: MachineKept;
}

export const PLACE_RESUME = { GONE: "gone" } as const;

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

export interface RunnerHandle extends MachinePlace {
  readonly command: string;
}

type MachineServices = CheckoutServices | AgentImage;

export class LaunchRefused extends Data.TaggedError("LaunchRefused")<{
  readonly reason: string;
  readonly planRefusal?: PlanRefusal | undefined;
  readonly keyRefusal?: KeyRefusal | undefined;
  readonly planResetsAt?: number | undefined;
  readonly deviceRemoved?: true | undefined;
  readonly deviceAway?: true | undefined;
}> {}

export interface MachineOpen<B, EB, RB> {
  readonly session: string;
  readonly target: ConversationTarget;
  readonly agent: Agent;
  readonly harness: string;
  readonly beside: Effect.Effect<B, EB, RB>;
}

export interface OpenedPlace {
  readonly place: MachinePlace;
  readonly name: MachineName;
  readonly checkoutPath: string;
  readonly finishCheckout: Effect.Effect<void, { readonly _tag: string }>;
}

export interface RunnerLaunch<A, E, R, EL, RL> {
  readonly env: Readonly<Record<string, string>>;
  readonly userId: string;
  readonly agentId: string;
  readonly extraCheckouts?: readonly string[] | undefined;
  readonly name: MachineName;
  readonly ready: Effect.Effect<A, E, R>;
  readonly firstLines: (
    ready: A,
    handle: RunnerHandle,
  ) => Effect.Effect<{ readonly lines: string; readonly mark: RunnerMark }, EL, RL>;
  readonly abandon: (ready: A) => Effect.Effect<void, { readonly _tag: string }, RL>;
}

export interface AgentMachineService {
  readonly layout: (
    agent: Agent,
  ) => Effect.Effect<MachineLayout, LaunchRefused | { readonly _tag: string }>;
  readonly open: <A, E, R, B, EB, RB>(
    ask: MachineOpen<B, EB, RB>,
    use: (opened: OpenedPlace, beside: B) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    E | EB | LaunchRefused | { readonly _tag: string },
    R | RB | MachineServices
  >;
  readonly findPlaces: (
    userId: string,
    session: string,
  ) => Effect.Effect<readonly FoundPlace[], SandboxUnavailable | StoreFailure, DatabaseServices>;
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
  readonly firewall: MachineFirewall;
  readonly resume: (
    found: FoundPlace,
  ) => Effect.Effect<MachinePlace | typeof PLACE_RESUME.GONE, SandboxUnavailable>;
  readonly stop: (place: MachinePlace) => Effect.Effect<void, SandboxUnavailable>;
  readonly discard: (
    found: FoundPlace,
  ) => Effect.Effect<void, SandboxUnavailable | StoreFailure, DatabaseServices>;
  readonly writeFiles: (
    place: MachinePlace,
    files: readonly SandboxFile[],
  ) => Effect.Effect<void, SandboxUnavailable | LaunchRefused>;
  readonly checkOutExtras: (
    place: MachinePlace,
    target: ConversationTarget,
    agent: Agent,
    shared: boolean,
  ) => Effect.Effect<void, CheckoutRefused | SandboxUnavailable, CheckoutServices>;
  readonly launchRunner: <A, E, R, EL, RL>(
    place: MachinePlace,
    launch: RunnerLaunch<A, E, R, EL, RL>,
  ) => Effect.Effect<
    { readonly handle: RunnerHandle; readonly ready: A },
    E | EL | SandboxUnavailable | { readonly _tag: string },
    R | RL | MachineServices
  >;
  readonly writeLine: (
    handle: RunnerHandle,
    text: string,
  ) => Effect.Effect<void, SandboxUnavailable | LaunchRefused>;
  readonly wrote: (
    handle: RunnerHandle,
    text: string,
  ) => Effect.Effect<boolean, SandboxUnavailable>;
  readonly runnerExit: (
    handle: RunnerHandle,
    within?: Duration.Duration,
  ) => Effect.Effect<CommandExit, SandboxUnavailable>;
  readonly kill: (handle: RunnerHandle) => Effect.Effect<void, SandboxUnavailable>;
  readonly readFile: (
    session: string,
    path: string,
    bound: number,
  ) => Effect.Effect<Uint8Array | undefined, SandboxUnavailable>;
}

export type MachineLifecycle = Omit<
  AgentMachineService,
  "layout" | "open" | "checkOutExtras" | "launchRunner"
>;

export class AgentMachine extends Context.Service<AgentMachine, AgentMachineService>()(
  "AgentMachine",
) {}
