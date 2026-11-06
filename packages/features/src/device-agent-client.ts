import { HTTP_METHOD } from "@repo/wire";
import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type AccountCallEffects, accountCall, type CallCredential } from "./account-call.js";
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
  type HostPairingPollAnswer,
  type HostPairingStartAnswer,
  type HostPairingStartRequest,
  hostGithubTokenAnswerSchema,
  type OwnDeviceEnrollRequest,
} from "./host-wire.js";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  type HostedRefused,
  hostedClient,
} from "./hosted-link.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const encodeBytes = Schema.encodeSync(Schema.Uint8ArrayFromBase64);

export const DEVICE_AGENT_NOT_CLAIMED = { claimed: false } as const;

export interface DeviceAgentClaimedLine {
  readonly line: DeviceAgentLine;
  readonly secrets?: DeviceAgentLaunchSecrets | undefined;
  readonly secretsGone?: true | undefined;
}

export interface DeviceAgentBeat {
  readonly openLaunches: readonly string[];
  readonly release?: DeviceAgentRelease | undefined;
}

export interface DeviceAgentUpdate {
  readonly update: HostUpdate;
  readonly updateFailure?: string | undefined;
}

export interface DeviceAgentDevice extends DeviceMachine {
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly home: string;
  readonly agentsFolder: string;
  readonly claudeExecutable: string;
  readonly codexExecutable?: string | undefined;
  readonly capabilities: readonly DeviceCapability[];
  readonly setup?: DeviceSetup | undefined;
  readonly setupFailure?: string | undefined;
}

export const HOST_PAIRING_OUTCOME = {
  ANSWERED: "answered",
  BRAKED: "braked",
  UPGRADE_NEEDED: "upgrade-needed",
  REFUSED: "refused",
  UNANSWERED: "unanswered",
} as const;

export type HostPairingOutcome<Answer> =
  | { readonly outcome: typeof HOST_PAIRING_OUTCOME.ANSWERED; readonly answer: Answer }
  | { readonly outcome: typeof HOST_PAIRING_OUTCOME.BRAKED }
  | {
      readonly outcome: typeof HOST_PAIRING_OUTCOME.UPGRADE_NEEDED;
      readonly minimumVersion?: string | undefined;
    }
  | { readonly outcome: typeof HOST_PAIRING_OUTCOME.REFUSED }
  | { readonly outcome: typeof HOST_PAIRING_OUTCOME.UNANSWERED };

function pairingOutcome<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<HostPairingOutcome<Answer>, never, HttpClient.HttpClient> {
  return asked.pipe(
    Effect.map(
      (answer): HostPairingOutcome<Answer> => ({
        outcome: HOST_PAIRING_OUTCOME.ANSWERED,
        answer,
      }),
    ),
    Effect.catch((failed): Effect.Effect<HostPairingOutcome<Answer>> => {
      if (failed._tag !== "HostedRefused") {
        return Effect.succeed({ outcome: HOST_PAIRING_OUTCOME.UNANSWERED });
      }
      switch (failed.refusal) {
        case HOSTED_API_ERROR.HOST_UPGRADE_NEEDED:
          return Effect.succeed({
            outcome: HOST_PAIRING_OUTCOME.UPGRADE_NEEDED,
            minimumVersion: failed.data?.minimumVersion,
          });
        case HOSTED_API_ERROR.QUOTA_EXHAUSTED:
          return Effect.succeed({ outcome: HOST_PAIRING_OUTCOME.BRAKED });
        default:
          return Effect.succeed({ outcome: HOST_PAIRING_OUTCOME.REFUSED });
      }
    }),
  );
}

export function startHostPairing(
  serviceBaseUrl: string,
  request: HostPairingStartRequest,
): Effect.Effect<HostPairingOutcome<HostPairingStartAnswer>, never, HttpClient.HttpClient> {
  const hosted = hostedClient({ baseUrl: serviceBaseUrl, credential: {} });
  return pairingOutcome(askHosted(hosted.deviceAgents.startPairing, request));
}

export function pollHostPairing(
  serviceBaseUrl: string,
  pollSecret: string,
): Effect.Effect<HostPairingOutcome<HostPairingPollAnswer>, never, HttpClient.HttpClient> {
  const bearer = `Bearer ${pollSecret}`;
  const hosted = hostedClient({
    baseUrl: serviceBaseUrl,
    credential: { authorization: () => Effect.succeed(bearer) },
  });
  return pairingOutcome(askHosted(hosted.deviceAgents.pollPairing, undefined));
}

type OwnEnrollingMachine = Required<Pick<OwnDeviceEnrollRequest, "name" | "platform" | "arch">> &
  DeviceMachine;

export const OWN_ENROLL_OUTCOME = {
  ENROLLED: "enrolled",
  NOT_FOUND: "not-found",
  REFUSED: "refused",
  UPGRADE_NEEDED: "upgrade-needed",
  UNANSWERED: "unanswered",
} as const;

export type OwnEnrollOutcome =
  | { readonly outcome: typeof OWN_ENROLL_OUTCOME.ENROLLED; readonly deviceSecret: string }
  | { readonly outcome: typeof OWN_ENROLL_OUTCOME.NOT_FOUND }
  | { readonly outcome: typeof OWN_ENROLL_OUTCOME.REFUSED; readonly refusal: string }
  | {
      readonly outcome: typeof OWN_ENROLL_OUTCOME.UPGRADE_NEEDED;
      readonly minimumVersion?: string | undefined;
    }
  | { readonly outcome: typeof OWN_ENROLL_OUTCOME.UNANSWERED };

function ownEnrollRefusal(failed: HostedRefused): OwnEnrollOutcome {
  switch (failed.refusal) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return { outcome: OWN_ENROLL_OUTCOME.NOT_FOUND };
    case HOSTED_API_ERROR.HOST_UPGRADE_NEEDED:
      return {
        outcome: OWN_ENROLL_OUTCOME.UPGRADE_NEEDED,
        minimumVersion: failed.data?.minimumVersion,
      };
    default:
      return { outcome: OWN_ENROLL_OUTCOME.REFUSED, refusal: failed.refusal };
  }
}

export interface HostedDeviceAgentClientOptions {
  credential: CallCredential;
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

  enrollOwn(
    deviceId: string,
    machine?: OwnEnrollingMachine,
  ): Effect.Effect<OwnEnrollOutcome, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.enrollOwn, { deviceId, ...machine }).pipe(
      Effect.map(
        (answer): OwnEnrollOutcome => ({
          outcome: OWN_ENROLL_OUTCOME.ENROLLED,
          deviceSecret: answer.deviceSecret,
        }),
      ),
      Effect.catch((failed) =>
        Effect.succeed(
          failed._tag === "HostedRefused"
            ? ownEnrollRefusal(failed)
            : { outcome: OWN_ENROLL_OUTCOME.UNANSWERED },
        ),
      ),
    );
  }

  leave(deviceId: string): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.leave, { deviceId }).pipe(
      Effect.as(true),
      Effect.catch((failed) =>
        Effect.succeed(
          failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
        ),
      ),
    );
  }

  register(
    deviceId: string,
    device: DeviceAgentDevice,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const { codexExecutable, capabilities, setup, setupFailure, ...rest } = device;
    const input = {
      deviceId,
      ...rest,
      ...(codexExecutable === undefined ? undefined : { codexExecutable }),
      ...(capabilities.length === 0 ? undefined : { capabilities }),
      ...(setup === undefined ? undefined : { setup }),
      ...(setup === undefined || setupFailure === undefined ? undefined : { setupFailure }),
    };
    return askHosted(this.#hosted.deviceAgents.register, input).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  beat(
    deviceId: string,
    updating?: DeviceAgentUpdate,
  ): Effect.Effect<DeviceAgentBeat | undefined, never, HttpClient.HttpClient> {
    const failure = updating?.updateFailure;
    const input = {
      deviceId,
      ...(updating === undefined ? undefined : { update: updating.update }),
      ...(updating === undefined || failure === undefined ? undefined : { updateFailure: failure }),
    };
    return askHosted(this.#hosted.deviceAgents.beat, input).pipe(
      Effect.map(
        (answer): DeviceAgentBeat => ({
          openLaunches: answer.openLaunches,
          release: answer.release,
        }),
      ),
      Effect.orElseSucceed(() => undefined),
    );
  }

  lines(
    deviceId: string,
  ): Effect.Effect<readonly DeviceAgentLine[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.lines, { deviceId }, HOSTED_DEADLINE.HELD).pipe(
      Effect.map((answer): readonly DeviceAgentLine[] => answer.lines),
      Effect.orElseSucceed(() => undefined),
    );
  }

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
      askHosted(this.#hosted.deviceAgents.claimLine, {
        deviceId,
        id,
        ...(named === undefined ? {} : { claimToken: named }),
      });
    return claimed(claimToken).pipe(
      Effect.catch((failed) =>
        claimToken !== undefined && failed._tag === "HostedRefused"
          ? claimed(undefined)
          : Effect.fail(failed),
      ),
      Effect.map((answer): DeviceAgentClaimedLine => answer),
      Effect.catch((failed) =>
        Effect.succeed(failed._tag === "HostedRefused" ? DEVICE_AGENT_NOT_CLAIMED : undefined),
      ),
    );
  }

  lineStep(
    deviceId: string,
    id: string,
    step: DeviceLaunchStep,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.lineStep, { deviceId, id, step }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  settleLine(
    deviceId: string,
    id: string,
    exitCode?: number,
    unstarted?: DeviceLaunchUnstarted,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.settleLine, {
      deviceId,
      id,
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(unstarted === undefined ? {} : { unstarted }),
    }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  requests(
    deviceId: string,
  ): Effect.Effect<readonly DeviceAgentRequest[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.requests, { deviceId }, HOSTED_DEADLINE.HELD).pipe(
      Effect.map((answer): readonly DeviceAgentRequest[] => answer.requests),
      Effect.orElseSucceed(() => undefined),
    );
  }

  claimRequest(
    deviceId: string,
    id: string,
  ): Effect.Effect<
    DeviceAgentRequest | typeof DEVICE_AGENT_NOT_CLAIMED | undefined,
    never,
    HttpClient.HttpClient
  > {
    return askHosted(this.#hosted.deviceAgents.claimRequest, { deviceId, id }).pipe(
      Effect.map((answer): DeviceAgentRequest => answer.request),
      Effect.catch((failed) =>
        Effect.succeed(failed._tag === "HostedRefused" ? DEVICE_AGENT_NOT_CLAIMED : undefined),
      ),
    );
  }

  answerRequest(
    deviceId: string,
    id: string,
    answer: DeviceAgentAnswer,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const wire = { ...answer, bytes: answer.bytes === null ? null : encodeBytes(answer.bytes) };
    return askHosted(this.#hosted.deviceAgents.answerRequest, { deviceId, id, answer: wire }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }
}
