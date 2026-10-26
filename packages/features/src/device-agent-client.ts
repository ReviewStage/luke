import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_ISOLATION,
  type DeviceAgentAnswer,
  type DeviceAgentLaunchSecrets,
  type DeviceAgentLine,
  type DeviceAgentRequest,
  type DeviceArch,
  type DeviceCapability,
  type DeviceIsolation,
  type DevicePlatform,
  type DeviceSignedIn,
} from "./device-agent-wire.js";
import { askHosted, HOSTED_DEADLINE, type HostedClient, hostedClient } from "./hosted-link.js";

/**
 * device-agent-client.ts -- a local agent's Mac as it asks the service (`contract/device-agents.ts`): it registers and beats, holds a read for its lines and one for its requests, claims each by its id, and settles a line or answers a request.
 *
 * Each is a procedure of the hosted contract over the one account call, so
 * the bearer is read fresh per attempt and a 401 is renewed and retried
 * once. No call fails: a held read the service did not answer is nothing,
 * which the caller asks again after a pause; a claim refused is
 * `DEVICE_AGENT_NOT_CLAIMED` (another claim took it, its caller withdrew it,
 * or the account's experiment is off) and one unanswered nothing; a
 * register, a beat, a settle, or an answer not taken is false.
 */

/** A read's bytes as the answer's wire spells them. */
const encodeBytes = Schema.encodeSync(Schema.Uint8ArrayFromBase64);

/** What a claim the service refused answers. */
export const DEVICE_AGENT_NOT_CLAIMED = { claimed: false } as const;

/** A launch line claimed, with the secrets its claim handed over once, where it is one. */
export interface DeviceAgentClaimedLine {
  readonly line: DeviceAgentLine;
  readonly secrets?: DeviceAgentLaunchSecrets | undefined;
}

/** What a Mac registers as: its name, its platform and architecture, its home folder, the Claude Code CLI it bundles, the Codex it checked where it has one, which harnesses it is signed in to, and the lines beyond the first it takes. */
export interface DeviceAgentDevice {
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly isolation: DeviceIsolation;
  readonly home: string;
  readonly claudeExecutable: string;
  readonly codexExecutable?: string | undefined;
  readonly signedIn: DeviceSignedIn;
  readonly capabilities: readonly DeviceCapability[];
}

export interface HostedDeviceAgentClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

export class HostedDeviceAgentClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedDeviceAgentClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
  }

  /** This Mac registered under its id; whether the service took it. */
  register(
    deviceId: string,
    device: DeviceAgentDevice,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const { codexExecutable, capabilities, isolation, ...rest } = device;
    // Note that a Mac with no Codex checked names none, which the service reads as no Codex,
    // and one with no capability names no list, which a service from before the field refuses.
    // Likewise a device running bare names no isolation, so a service from before the field still takes its register.
    const input = {
      deviceId,
      ...rest,
      ...(codexExecutable === undefined ? undefined : { codexExecutable }),
      ...(capabilities.length === 0 ? undefined : { capabilities }),
      ...(isolation === DEVICE_ISOLATION.BARE ? undefined : { isolation }),
    };
    return askHosted(this.#hosted.deviceAgents.register, input).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /** That this Mac is here now, and which harnesses it is signed in to; whether the service took it. */
  beat(
    deviceId: string,
    signedIn: DeviceSignedIn,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.beat, { deviceId, signedIn }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /** The lines waiting for this Mac, held by the service until one does; nothing where it did not answer. */
  lines(
    deviceId: string,
  ): Effect.Effect<readonly DeviceAgentLine[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.lines, { deviceId }, HOSTED_DEADLINE.HELD).pipe(
      Effect.map((answer): readonly DeviceAgentLine[] => answer.lines),
      Effect.orElseSucceed(() => undefined),
    );
  }

  /** One line claimed by its id, with a launch line's secrets; refused, or nothing where unanswered. */
  claimLine(
    deviceId: string,
    id: string,
  ): Effect.Effect<
    DeviceAgentClaimedLine | typeof DEVICE_AGENT_NOT_CLAIMED | undefined,
    never,
    HttpClient.HttpClient
  > {
    return askHosted(this.#hosted.deviceAgents.claimLine, { deviceId, id }).pipe(
      Effect.map((answer): DeviceAgentClaimedLine => answer),
      Effect.catch((failed) =>
        Effect.succeed(failed._tag === "HostedRefused" ? DEVICE_AGENT_NOT_CLAIMED : undefined),
      ),
    );
  }

  /** One line settled, a launch line with its runner's exit code where it exited with one; whether the service took it. */
  settleLine(
    deviceId: string,
    id: string,
    exitCode?: number,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.settleLine, {
      deviceId,
      id,
      ...(exitCode === undefined ? {} : { exitCode }),
    }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /** The requests waiting for this Mac, held by the service until one does; nothing where it did not answer. */
  requests(
    deviceId: string,
  ): Effect.Effect<readonly DeviceAgentRequest[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.requests, { deviceId }, HOSTED_DEADLINE.HELD).pipe(
      Effect.map((answer): readonly DeviceAgentRequest[] => answer.requests),
      Effect.orElseSucceed(() => undefined),
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
    return askHosted(this.#hosted.deviceAgents.claimRequest, { deviceId, id }).pipe(
      Effect.map((answer): DeviceAgentRequest => answer.request),
      Effect.catch((failed) =>
        Effect.succeed(failed._tag === "HostedRefused" ? DEVICE_AGENT_NOT_CLAIMED : undefined),
      ),
    );
  }

  /** One request answered; whether the service took it. */
  answerRequest(
    deviceId: string,
    id: string,
    answer: DeviceAgentAnswer,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const wire =
      answer.kind === DEVICE_AGENT_REQUEST_KIND.READ_FILE
        ? { ...answer, bytes: answer.bytes === null ? null : encodeBytes(answer.bytes) }
        : answer;
    return askHosted(this.#hosted.deviceAgents.answerRequest, { deviceId, id, answer: wire }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }
}
