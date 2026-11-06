import type { AnyProcedureContract } from "@orpc/contract";
import { HTTP_METHOD } from "@repo/wire";
import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type AccountCallEffects, accountCall, type CallCredential } from "./account-call.js";
import { deviceAgentsContract } from "./contract/device-agents.js";
import type {
  DeviceAgentAnswer,
  DeviceAgentLaunchSecrets,
  DeviceAgentLine,
  DeviceAgentRelease,
  DeviceAgentRequest,
  DeviceArch,
  DeviceCapability,
  DeviceLaunchStep,
  DeviceLaunchUnstarted,
  DeviceMachine,
  DevicePlatform,
  DeviceSetup,
  HostUpdate,
} from "./device-agent-wire.js";
import {
  type HostEnrollAnswer,
  type HostPairingPollAnswer,
  type HostPairingStartAnswer,
  type HostPairingStartRequest,
  hostGithubTokenAnswerSchema,
  type OwnDeviceEnrollRequest,
} from "./host-wire.js";
import { hostedCall } from "./hosted-call.js";
import { failureSetOf, type HostedFailed } from "./hosted-failure.js";
import { HOSTED_DEADLINE, type HostedClient, hostedClient } from "./hosted-link.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * device-agent-client.ts -- a local agent's Mac as it asks the service (`contract/device-agents.ts`): it registers and beats, holds a read for its lines and one for its requests, claims each by its id, says which step a launch it claimed has reached, settles a line or answers a request, and saves its agents' state.
 *
 * Each is a procedure of the hosted contract asked through `hostedCall`
 * over the one account call, so the bearer is read fresh per attempt and a
 * 401 is renewed and retried once, and a refusal its contract declares is
 * read as a failure, every other one as unanswered. No call fails: a held read the service did not answer is nothing,
 * which the caller asks again after a pause; a claim refused is
 * `DEVICE_AGENT_NOT_CLAIMED` (another claim took it, or its caller withdrew
 * it) and one unanswered nothing; a
 * register, a step, a settle, or an answer not taken is false, and a beat
 * not taken is nothing. A save of an agent's
 * state, or its commit, refused says whether a newer save made it stale,
 * and one unanswered, or refused as unavailable, is nothing. A host also
 * asks the runner token route for a GitHub token for one of its agents
 * (`githubToken`), on the same credential, its device secret. A box with
 * no secret yet pairs with a code: it starts a pairing with no credential
 * (`startHostPairing`) and polls on the poll secret it was answered
 * (`pollHostPairing`) until a member approves or denies it. A pairing's
 * call and an own enroll answer as `hostedCall` does, their refusals spelled
 * as they shipped (`HOST_PAIRING_FAILURE`, `OWN_ENROLL_FAILURE`).
 */

/** A read's bytes as the answer's wire spells them. */
const encodeBytes = Schema.encodeSync(Schema.Uint8ArrayFromBase64);

/** What a claim the service refused answers. */
export const DEVICE_AGENT_NOT_CLAIMED = { claimed: false } as const;

/** A launch line claimed, with the secrets its claim handed over once, where it is one, or saying they are gone, where its claim was asked again. */
export interface DeviceAgentClaimedLine {
  readonly line: DeviceAgentLine;
  readonly secrets?: DeviceAgentLaunchSecrets | undefined;
  readonly secretsGone?: true | undefined;
}

/** A beat the service took: the ids of the launches it holds the device to, and a release newer than the host's, where the service names one (`deviceAgentBeatAnswerSchema`). */
export interface DeviceAgentBeat {
  readonly openLaunches: readonly string[];
  readonly release?: DeviceAgentRelease | undefined;
}

/** Where a host's update stands, as its beat says it while one is under way, and why it failed where it did. */
export interface DeviceAgentUpdate {
  readonly update: HostUpdate;
  readonly updateFailure?: string | undefined;
}

/** What a Mac registers as: its name, its platform and architecture, which machine it is where it read it (`DeviceMachine`), its home folder, the Claude Code CLI it bundles, the Codex it checked where it has one, the lines beyond the first it takes, and where its setup stands until it is ready. */
export interface DeviceAgentDevice extends DeviceMachine {
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly home: string;
  /** The folder its own layout puts its agents under (`deviceAgentsFolder`), absolute. */
  readonly agentsFolder: string;
  readonly claudeExecutable: string;
  readonly codexExecutable?: string | undefined;
  readonly capabilities: readonly DeviceCapability[];
  /** Where its setup stands while it is not ready to take an agent, and why it failed where it did; none once it is ready. */
  readonly setup?: DeviceSetup | undefined;
  readonly setupFailure?: string | undefined;
}

/** A procedure's declared refusals, by the slug each is coded as. */
type DeclaredBy<Procedure extends AnyProcedureContract> = keyof Procedure["~orpc"]["errorMap"] &
  HostedApiError;

const { startPairing, pollPairing, enrollOwn, ...deviceCalls } = deviceAgentsContract;

/**
 * How a host's join, a pairing's start or poll or an own enroll, reads its
 * refusals, as it shipped: below the floor as needing an upgrade, braked
 * where the service takes no more starts from the box's address, and every
 * other refusal (a malformed start, a poll on no poll secret, a store that
 * could not answer, a method its path is not served on) as refused. An own
 * enroll keeps not found as its own.
 */
const HOST_JOIN_RENAMES = {
  [HOSTED_API_ERROR.HOST_UPGRADE_NEEDED]: "upgrade-needed",
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: "braked",
  [HOSTED_API_ERROR.INVALID_TOKEN]: "refused",
  [HOSTED_API_ERROR.INVALID_REQUEST]: "refused",
  [HOSTED_API_ERROR.UNAVAILABLE]: "refused",
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: "refused",
  [HOSTED_API_ERROR.METHOD_NOT_ALLOWED]: "refused",
} as const;

/** How a pairing's call reads its refusals: as a join does, and not found, a service from before the route, as refused too. */
const HOST_PAIRING_RENAMES = {
  ...HOST_JOIN_RENAMES,
  [HOSTED_API_ERROR.NOT_FOUND]: "refused",
} as const;

/**
 * How a call on the device secret reads its refusals: each as its own slug,
 * those any procedure may answer among them, since a claim refused for any
 * reason is not claimed and a leave refused on its bearer has left.
 */
const DEVICE_AGENT_RENAMES = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: HOSTED_API_ERROR.INVALID_TOKEN,
  [HOSTED_API_ERROR.INVALID_REQUEST]: HOSTED_API_ERROR.INVALID_REQUEST,
  [HOSTED_API_ERROR.UNAVAILABLE]: HOSTED_API_ERROR.UNAVAILABLE,
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: HOSTED_API_ERROR.REQUEST_TOO_LARGE,
} as const;

/** How a call on the device secret failed. */
const DEVICE_AGENT_FAILURE = failureSetOf(deviceCalls, { as: DEVICE_AGENT_RENAMES });

/** How a pairing's start or poll failed: upgrade needed, braked, refused, or unanswered. */
export const HOST_PAIRING_FAILURE = failureSetOf(
  { startPairing, pollPairing },
  { as: HOST_PAIRING_RENAMES },
);

/** How a pairing's start or poll failed (`HOST_PAIRING_FAILURE`), under its older name. */
export const HOST_PAIRING_OUTCOME = HOST_PAIRING_FAILURE;

/** A pairing's start or poll as it failed, with the floor an upgrade must reach where it names one. */
export type HostPairingFailed = HostedFailed<
  DeclaredBy<typeof startPairing> | DeclaredBy<typeof pollPairing>,
  typeof HOST_PAIRING_RENAMES
>;

/** A pairing call's answer, or how it failed. */
export type HostPairingOutcome<Answer> = Answer | HostPairingFailed;

/**
 * A box's pairing started (`contract/device-agents.ts`'s `startPairing`),
 * with no credential: answered the poll secret it polls on, the code to
 * show and the link that opens it, how long the code lasts, and how often
 * to poll. The daemon's version rides on the caller's own `HttpClient`, as
 * on every call of a host's.
 */
export function startHostPairing(
  serviceBaseUrl: string,
  request: HostPairingStartRequest,
): Effect.Effect<HostPairingOutcome<HostPairingStartAnswer>, never, HttpClient.HttpClient> {
  const hosted = hostedClient({ baseUrl: serviceBaseUrl, credential: {} });
  return hostedCall(hosted.deviceAgents.startPairing, request, { as: HOST_PAIRING_RENAMES });
}

/**
 * A pairing box's poll on its poll secret, as the call's bearer
 * (`contract/device-agents.ts`'s `pollPairing`): pending, slow down,
 * denied, expired, or approved with the box's device id and secret, which
 * the service answers this once. The daemon's version rides on the
 * caller's own `HttpClient`.
 */
export function pollHostPairing(
  serviceBaseUrl: string,
  pollSecret: string,
): Effect.Effect<HostPairingOutcome<HostPairingPollAnswer>, never, HttpClient.HttpClient> {
  const bearer = `Bearer ${pollSecret}`;
  const hosted = hostedClient({
    baseUrl: serviceBaseUrl,
    credential: { authorization: () => Effect.succeed(bearer) },
  });
  return hostedCall(hosted.deviceAgents.pollPairing, undefined, { as: HOST_PAIRING_RENAMES });
}

/** The machine an own enroll names, which the service creates the device from where the account never registered its id, and which machine it is where it was read (`DeviceMachine`). */
type OwnEnrollingMachine = Required<Pick<OwnDeviceEnrollRequest, "name" | "platform" | "arch">> &
  DeviceMachine;

/** How an own device's enroll failed: not found, upgrade needed, refused, or unanswered. */
export const OWN_ENROLL_FAILURE = failureSetOf({ enrollOwn }, { as: HOST_JOIN_RENAMES });

/** How an own device's enroll failed (`OWN_ENROLL_FAILURE`), under its older name. */
export const OWN_ENROLL_OUTCOME = OWN_ENROLL_FAILURE;

/** An own device's enroll: its device secret, answered this once, or how it failed. */
export type OwnEnrollOutcome =
  | HostEnrollAnswer
  | HostedFailed<DeclaredBy<typeof enrollOwn>, typeof HOST_JOIN_RENAMES>;

/** Whether a call on the device secret was refused, rather than answered or unanswered. */
function refused(answer: object): boolean {
  return "failure" in answer && answer.failure !== DEVICE_AGENT_FAILURE.UNANSWERED;
}

export interface HostedDeviceAgentClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

export class HostedDeviceAgentClient {
  readonly #hosted: HostedClient;
  readonly #call: AccountCallEffects;

  constructor(options: HostedDeviceAgentClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
    this.#call = accountCall({ baseUrl: options.serviceBaseUrl, credential: options.credential });
  }

  /** A GitHub token for the host's own agent's repository; nothing where the service refused it or did not answer. */
  githubToken(agentId: string): Effect.Effect<string | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.RUNNER_TOKEN,
          body: JSON.stringify({ agentId }),
        },
        hostGithubTokenAnswerSchema,
      ),
      (answer) => answer?.githubToken,
    );
  }

  /**
   * One of the account's own machines enrolled on its sign-in
   * (`contract/device-agents.ts`'s `enrollOwn`): converted in place under its
   * id, or created under the account as the machine given names itself
   * where the account never registered the id, and traded for a device
   * secret, answered this once. The host program's version rides on the
   * caller's own `HttpClient`, as on a host's every call.
   */
  enrollOwn(
    deviceId: string,
    machine?: OwnEnrollingMachine,
  ): Effect.Effect<OwnEnrollOutcome, never, HttpClient.HttpClient> {
    return hostedCall(
      this.#hosted.deviceAgents.enrollOwn,
      { deviceId, ...machine },
      { as: HOST_JOIN_RENAMES },
    );
  }

  /**
   * This host removed from its account on its own secret: whether it is
   * gone. Note that a secret the service refuses as unauthenticated is one
   * no standing host holds (`auth/device-secret.ts`), so a host the service
   * had already removed is gone too.
   */
  leave(deviceId: string): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.deviceAgents.leave, { deviceId }, { as: DEVICE_AGENT_RENAMES }),
      (answer) => !("failure" in answer) || answer.failure === DEVICE_AGENT_FAILURE.INVALID_TOKEN,
    );
  }

  /** This Mac registered under its id; whether the service took it. */
  register(
    deviceId: string,
    device: DeviceAgentDevice,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const { codexExecutable, capabilities, setup, setupFailure, ...rest } = device;
    // Note that a Mac with no Codex checked names none, which the service reads as no Codex,
    // and one with no capability names no list, which a service from before the field refuses.
    const input = {
      deviceId,
      ...rest,
      ...(codexExecutable === undefined ? undefined : { codexExecutable }),
      ...(capabilities.length === 0 ? undefined : { capabilities }),
      // Likewise a device ready to take an agent names no setup, so only one a service from before the field would never list is refused.
      ...(setup === undefined ? undefined : { setup }),
      ...(setup === undefined || setupFailure === undefined ? undefined : { setupFailure }),
    };
    return Effect.map(
      hostedCall(this.#hosted.deviceAgents.register, input),
      (answer) => !("failure" in answer),
    );
  }

  /** That this Mac is here now, and where its update stands while one is under way; the launches the service holds it to and a newer release where it took the beat, and nothing where it did not. */
  beat(
    deviceId: string,
    updating?: DeviceAgentUpdate,
  ): Effect.Effect<DeviceAgentBeat | undefined, never, HttpClient.HttpClient> {
    const failure = updating?.updateFailure;
    const input = {
      deviceId,
      // Note that a beat updating nothing names neither key, since a service from before them refuses a key it does not know.
      ...(updating === undefined ? undefined : { update: updating.update }),
      ...(updating === undefined || failure === undefined ? undefined : { updateFailure: failure }),
    };
    return Effect.map(
      hostedCall(this.#hosted.deviceAgents.beat, input),
      (answer): DeviceAgentBeat | undefined =>
        "failure" in answer
          ? undefined
          : { openLaunches: answer.openLaunches, release: answer.release },
    );
  }

  /** The lines waiting for this Mac, held by the service until one does; nothing where it did not answer. */
  lines(
    deviceId: string,
  ): Effect.Effect<readonly DeviceAgentLine[] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.deviceAgents.lines, { deviceId }, { deadline: HOSTED_DEADLINE.HELD }),
      (answer) => ("failure" in answer ? undefined : answer.lines),
    );
  }

  /**
   * One line claimed by its id under the token the Mac minted for it, with
   * a launch line's secrets; refused, or nothing where unanswered. Note
   * that a claim naming a token is asked again without it where the
   * service refuses it, since a service from before the field refuses a
   * request naming any key it does not know, and one after it refuses the
   * claim without a token too wherever it refused the claim with one.
   */
  claimLine(
    deviceId: string,
    id: string,
    claimToken?: string,
  ): Effect.Effect<
    DeviceAgentClaimedLine | typeof DEVICE_AGENT_NOT_CLAIMED | undefined,
    never,
    HttpClient.HttpClient
  > {
    const claimed = (named: string | undefined) =>
      hostedCall(
        this.#hosted.deviceAgents.claimLine,
        { deviceId, id, ...(named === undefined ? {} : { claimToken: named }) },
        { as: DEVICE_AGENT_RENAMES },
      );
    return claimed(claimToken).pipe(
      Effect.flatMap((answer) =>
        claimToken !== undefined && refused(answer) ? claimed(undefined) : Effect.succeed(answer),
      ),
      Effect.map((answer): DeviceAgentClaimedLine | typeof DEVICE_AGENT_NOT_CLAIMED | undefined => {
        if (!("failure" in answer)) return answer;
        return refused(answer) ? DEVICE_AGENT_NOT_CLAIMED : undefined;
      }),
    );
  }

  /**
   * The step a launch line this Mac claimed has reached (`DEVICE_LAUNCH_STEP`),
   * which the agent's transcript words until its harness's first event;
   * whether the service kept it. A service from before the procedure
   * refuses it, which is false too, so a report never holds up the launch.
   */
  lineStep(
    deviceId: string,
    id: string,
    step: DeviceLaunchStep,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.deviceAgents.lineStep, { deviceId, id, step }),
      (answer) => !("failure" in answer),
    );
  }

  /** One line settled, a launch line with its runner's exit code where it exited with one, and why it never started where the host knows; whether the service took it. */
  settleLine(
    deviceId: string,
    id: string,
    exitCode?: number,
    unstarted?: DeviceLaunchUnstarted,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const input = {
      deviceId,
      id,
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(unstarted === undefined ? {} : { unstarted }),
    };
    return Effect.map(
      hostedCall(this.#hosted.deviceAgents.settleLine, input),
      (answer) => !("failure" in answer),
    );
  }

  /** The requests waiting for this Mac, held by the service until one does; nothing where it did not answer. */
  requests(
    deviceId: string,
  ): Effect.Effect<readonly DeviceAgentRequest[] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.deviceAgents.requests,
        { deviceId },
        { deadline: HOSTED_DEADLINE.HELD },
      ),
      (answer) => ("failure" in answer ? undefined : answer.requests),
    );
  }

  /** One request claimed by its id; refused, or nothing where unanswered. */
  claimRequest(
    deviceId: string,
    id: string,
  ): Effect.Effect<
    DeviceAgentRequest | typeof DEVICE_AGENT_NOT_CLAIMED | undefined,
    never,
    HttpClient.HttpClient
  > {
    return Effect.map(
      hostedCall(
        this.#hosted.deviceAgents.claimRequest,
        { deviceId, id },
        { as: DEVICE_AGENT_RENAMES },
      ),
      (answer): DeviceAgentRequest | typeof DEVICE_AGENT_NOT_CLAIMED | undefined => {
        if (!("failure" in answer)) return answer.request;
        return refused(answer) ? DEVICE_AGENT_NOT_CLAIMED : undefined;
      },
    );
  }

  /** One request answered; whether the service took it. */
  answerRequest(
    deviceId: string,
    id: string,
    answer: DeviceAgentAnswer,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const wire = { ...answer, bytes: answer.bytes === null ? null : encodeBytes(answer.bytes) };
    return Effect.map(
      hostedCall(this.#hosted.deviceAgents.answerRequest, { deviceId, id, answer: wire }),
      (answered) => !("failure" in answered),
    );
  }
}
