/**
 * lapsed-runner.ts -- a coding agent's turns whose runner stopped posting, settled lost at the next touch of the agent.
 *
 * Every post a runner makes pushes on the lease of the turns it runs
 * (`@repo/database/models/turn-lease`), and a local agent's Mac holds its
 * runs only as long as it beats (`DEVICE_LEASE`). Nothing watches either on
 * a timer: every reader takes a turn past its lease as its runner lost
 * (`@repo/features/agent-status`), and whatever touches the agent next (a
 * message, a Stop, a relaunch, an open of the agent) settles it so here,
 * before it acts, as a queue's next receive takes back a message whose
 * visibility ran out.
 *
 * The settle runs under the agent's runner lease, read again once the lease
 * is held, so a runner that posted meanwhile keeps its turn, and only where
 * no other call holds the lease, since that call is at work on the agent and
 * a later touch settles what is still lost. The runner is let go first: its
 * bearer dropped, so nothing it posts after is taken; its credentials taken
 * off its place's firewall; a command still recorded as running ended; and
 * its record cleared, so the next message relaunches. For a Mac that
 * stopped beating, its open launch is settled instead, which the Mac's own
 * beat reads as a run it holds no longer once it is back. Then every lapsed turn is
 * settled through the writer's own end (`settleRunnerLostTurns`): canceled
 * where a Stop was asked of it, and failed otherwise, its detail the fixed
 * sentence the status words read, then how the runner ended where that
 * could be read (its exit code and its stderr's redacted tail), or the Mac
 * named where the Mac went away. A failed one is said once in the log and
 * reported as an issue under the agent's ids, since nothing the developer
 * did ends a run this way; its stderr stays in the turn's row alone, never a
 * log line or a report, which reach Sentry. Nothing here fails its caller:
 * a settle that could not be made is logged, and the next touch tries again.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  lapsedTurnIds,
  RUNNER_LOST_DETAIL,
  runningTurnIds,
  settleRunnerLostTurns,
} from "@repo/database/models/abandoned-turns";
import { type Agent, recordAgentRunnerToken } from "@repo/database/models/agent-store";
import {
  latestDeviceAgentLaunch,
  settleLapsedDeviceAgentLine,
} from "@repo/database/models/device-agent-store";
import { devicesNamed } from "@repo/database/models/device-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import { storeWriter } from "@repo/database/models/writer";
import { AGENT_MACHINE, DEVICE_LEASE } from "@repo/features/agent-wire";
import { redactCredentials } from "@repo/features/credential-redaction";
import { failureKind } from "@repo/runtime/effect";
import { Cause, Clock, Data, Effect, ErrorReporter, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import type { FoundPlace, MachineLifecycle, RecordedRunner } from "../machine/agent-machine.js";
import { RUNNER_RECORD } from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { FAILURE_CHARS } from "../native-events/runner-moments.js";
import {
  COMMAND_GONE,
  type CommandExit,
  deploymentOidcToken,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { agentLogIds } from "./agent-log.js";
import { CODER } from "./bounds.js";
import { holdingRunnerIfFree } from "./runner-lease.js";
import { hostAwayDetail } from "./status.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** What of an agent the settle reads: its ids, its starter, and where its runner lives. */
export type LapsedAgent = Pick<Agent, "id" | "userId" | "conversationId" | "machine" | "deviceId">;

/** Why the turns lapsed: their lease ran out, or the Mac the agent runs on stopped beating, named. */
type Lapse =
  | { readonly kind: "lease" }
  | { readonly kind: "device"; readonly deviceName: string; readonly seenBefore: Date };

/**
 * A runner whose turn lapsed, reported as one issue whatever the agent,
 * since the ids and exit ride as attributes rather than in its message.
 */
class RunnerLost extends Data.TaggedError("RunnerLost")<{
  readonly agentId: string;
  readonly conversationId: string;
  readonly turnIds: readonly string[];
  readonly exitCode: string;
}> {
  override get message(): string {
    return RUNNER_LOST_DETAIL;
  }

  override readonly [ErrorReporter.attributes] = {
    agentId: this.agentId,
    conversationId: this.conversationId,
    turnIds: this.turnIds.join(","),
    exitCode: this.exitCode,
    reason: this._tag,
  };
}

/** The Mac a local agent runs on, where it last beat before its lease: its name, and the instant a beat must follow to hold its runs; none for a sandboxed agent, or a Mac still beating. */
const deviceLapse = (agent: LapsedAgent, now: number) =>
  Effect.gen(function* () {
    if (agent.machine !== AGENT_MACHINE.DEVICE || agent.deviceId == null) return undefined;
    const device = (yield* devicesNamed([agent.deviceId])).get(agent.deviceId);
    const seenBefore = new Date(now - DEVICE_LEASE.MS);
    if (device === undefined || device.lastSeenAt >= seenBefore) return undefined;
    return { kind: "device", deviceName: device.name, seenBefore } as const satisfies Lapse;
  });

/** The turns of the agent whose runner is lost at `now`, and why: every open one where its Mac stopped beating, else those past their lease. */
const lapsedOf = (agent: LapsedAgent, now: number) =>
  Effect.gen(function* () {
    const device = yield* deviceLapse(agent, now);
    if (device !== undefined) {
      return { lapse: device as Lapse, turnIds: yield* runningTurnIds(agent.conversationId) };
    }
    const turnIds = yield* lapsedTurnIds(agent.conversationId, now);
    return { lapse: { kind: "lease" } as Lapse, turnIds };
  });

/** The agent's place, found by the session its conversation records; none where it records none, or the place is another agent's. */
const placeOf = (machine: MachineLifecycle, agent: LapsedAgent) =>
  Effect.gen(function* () {
    const sessionId = yield* recordedRuntimeSession({
      userId: agent.userId,
      conversationId: agent.conversationId,
    });
    if (sessionId === undefined) return undefined;
    const [found] = yield* machine.findPlaces(agent.userId, sessionId);
    return found?.agentId === agent.id ? found : undefined;
  });

/** What a sandbox's runner printed on stderr before it went, its tail redacted; none on a Mac, or where Vercel did not answer. */
const stderrOf = (runner: RecordedRunner) =>
  runner.handle.machine !== AGENT_MACHINE.VERCEL
    ? Effect.succeed(undefined)
    : Effect.flatMap(vercelSandboxApi(deploymentOidcToken), (api) =>
        api
          .session({ name: runner.handle.name, sessionId: runner.handle.running })
          .pipe(Effect.flatMap((session) => session.commandStderrTail(runner.handle.command))),
      ).pipe(Effect.orElseSucceed(() => undefined));

/** A lost runner's turn's failure detail: the fixed sentence the status words match on, then how the runner ended, redacted and bounded as a runner's own failure is. */
function exitedDetail(exit: Exclude<CommandExit, null>, stderr: string | undefined): string {
  const ended = `exit ${exit === COMMAND_GONE ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`;
  return `${RUNNER_LOST_DETAIL}: ${redactCredentials(ended)}`.slice(0, FAILURE_CHARS);
}

/**
 * The runner let go, as the header says, answering how it ended where that
 * could be read: its exit, null for one still recorded running, which is
 * ended, or none where no runner is recorded or the machine did not answer.
 * Note that a Mac that stopped beating is neither asked nor sent a stop,
 * since nothing there answers: its launch is settled instead, which its beat
 * reads as a run to end once it is back.
 */
const letGo = (
  machine: MachineLifecycle,
  agent: LapsedAgent,
  found: FoundPlace | undefined,
  lapse: Lapse,
) =>
  Effect.gen(function* () {
    yield* recordAgentRunnerToken(agent.userId, agent.id, null);
    if (found === undefined || lapse.kind === "device") return undefined;
    const runner = found.runner;
    const exit =
      runner === undefined
        ? undefined
        : yield* machine
            .runnerExit(runner.handle, CODER.RUNNER_EXIT_READ)
            .pipe(Effect.orElseSucceed(() => undefined));
    if (runner !== undefined && exit === null) yield* Effect.ignore(machine.kill(runner.handle));
    if (found.running !== undefined) yield* Effect.ignore(machine.firewall.clear(found.running));
    const place = { ...found, userId: agent.userId, agentId: agent.id };
    yield* Effect.ignore(machine.recordRunner(place, { kind: RUNNER_RECORD.NONE }));
    return exit === undefined || exit === null || runner === undefined
      ? undefined
      : { exit, stderr: yield* stderrOf(runner) };
  });

/**
 * The open launch of a Mac that stopped beating taken from it, before its
 * bearer is dropped or a turn settled: whether the run is the settle's to
 * take. Note that the launch's settle is guarded by the Mac's last beat in
 * the one statement that writes it (`settleLapsedDeviceAgentLine`), so a Mac
 * that beat since keeps its launch, and the settle then takes nothing; one
 * that settled its launch itself, or holds none, has no run to keep.
 */
const launchTaken = (agent: LapsedAgent, lapse: Extract<Lapse, { kind: "device" }>, now: number) =>
  Effect.gen(function* () {
    const launch = yield* latestDeviceAgentLaunch(agent.userId, agent.id);
    if (Option.isNone(launch)) return true;
    const taken = yield* settleLapsedDeviceAgentLine(
      agent.userId,
      launch.value.id,
      lapse.seenBefore,
    );
    if (Option.isSome(taken)) return true;
    // Read again, since a launch the guard left open is one whose Mac beat since.
    return (yield* deviceLapse(agent, now)) !== undefined;
  });

/** The settle the header describes, its caller holding the agent's runner lease: the ids of the turns it settled failed. */
const settledHolding = (agent: LapsedAgent, readFirst: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const { lapse, turnIds } = yield* lapsedOf(agent, now);
    // Read again under the lease, so a turn whose runner posted since the first read keeps running.
    const lost = new Set(turnIds.filter((id) => readFirst.has(id)));
    if (lost.size === 0) return [];
    if (lapse.kind === "device" && !(yield* launchTaken(agent, lapse, now))) return [];
    const machine = yield* deploymentLifecycle;
    const found = yield* placeOf(machine, agent).pipe(Effect.orElseSucceed(() => undefined));
    const ended = yield* letGo(machine, agent, found, lapse);
    const detail =
      lapse.kind === "device"
        ? hostAwayDetail(lapse.deviceName)
        : ended === undefined
          ? RUNNER_LOST_DETAIL
          : exitedDetail(ended.exit, ended.stderr);
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const failed = yield* settleRunnerLostTurns(writer, agent.conversationId, now, detail, lost);
    if (failed.length === 0) return failed;
    const report = new RunnerLost({
      agentId: agent.id,
      conversationId: agent.conversationId,
      turnIds: failed,
      exitCode: ended === undefined ? lapse.kind : String(ended.exit),
    });
    yield* Effect.logError(`${RUNNER_LOST_DETAIL}: ${report.exitCode}`).pipe(
      Effect.annotateLogs({ turnId: failed.join(","), exitCode: report.exitCode }),
    );
    yield* ErrorReporter.report(Cause.fail(report));
    return failed;
  });

/**
 * Settles the agent's turns whose runner is lost at the instant read, as
 * the header says, before its caller touches the agent; answers the ids of
 * the turns it settled failed, none where none lapsed, another call held the
 * agent's runner lease, or the settle could not be made, which is logged.
 * The one settle every touch of the agent goes through, so whatever follows
 * a turn's end (the agent's queue handed on among it) follows from here too.
 */
export const settleLapsedRunner = /* @__PURE__ */ Effect.fn("web/settleLapsedRunner")(function* (
  agent: LapsedAgent,
): Effect.fn.Return<readonly string[], never, DatabaseServices> {
  return yield* Effect.gen(function* () {
    const { turnIds } = yield* lapsedOf(agent, yield* Clock.currentTimeMillis);
    if (turnIds.length === 0) return [];
    const settled = yield* holdingRunnerIfFree(agent.id, settledHolding(agent, new Set(turnIds)));
    return Option.getOrElse(settled, (): readonly string[] => []);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`a lapsed runner's turns were not settled: ${failureKind(failure)}`),
        [],
      ),
    ),
    Effect.annotateLogs(agentLogIds(agent)),
  );
});
