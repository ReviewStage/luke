import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, HOSTED_DEADLINE, type HostedClient, hostedClient } from "./hosted-link.js";
import {
  MAC_AGENT_REQUEST_KIND,
  type MacAgentAnswer,
  type MacAgentLaunchSecrets,
  type MacAgentLine,
  type MacAgentRequest,
} from "./mac-agent-wire.js";

/**
 * mac-agent-client.ts -- a local agent's Mac as it asks the service (`contract/mac-agents.ts`): it registers and beats, holds a read for its lines and one for its requests, claims each by its id, and settles a line or answers a request.
 *
 * Each is a procedure of the hosted contract over the one account call, so
 * the bearer is read fresh per attempt and a 401 is renewed and retried
 * once. No call fails: a held read the service did not answer is nothing,
 * which the caller asks again after a pause; a claim refused is
 * `MAC_AGENT_NOT_CLAIMED` (another claim took it, its caller withdrew it,
 * or the account's experiment is off) and one unanswered nothing; a
 * register, a beat, a settle, or an answer not taken is false.
 */

/** A read's bytes as the answer's wire spells them. */
const encodeBytes = Schema.encodeSync(Schema.Uint8ArrayFromBase64);

/** What a claim the service refused answers. */
export const MAC_AGENT_NOT_CLAIMED = { claimed: false } as const;

/** A launch line claimed, with the secrets its claim handed over once, where it is one. */
export interface MacAgentClaimedLine {
  readonly line: MacAgentLine;
  readonly secrets?: MacAgentLaunchSecrets | undefined;
}

/** What a Mac registers as: its name, its home folder, and the Claude Code CLI it bundles. */
export interface MacAgentDevice {
  readonly name: string;
  readonly home: string;
  readonly claudeExecutable: string;
}

export interface HostedMacAgentClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

export class HostedMacAgentClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedMacAgentClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
  }

  /** This Mac registered under its id; whether the service took it. */
  register(
    deviceId: string,
    device: MacAgentDevice,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macAgents.register, { deviceId, ...device }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /** That this Mac is here now; whether the service took it. */
  beat(deviceId: string): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macAgents.beat, { deviceId }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /** The lines waiting for this Mac, held by the service until one does; nothing where it did not answer. */
  lines(
    deviceId: string,
  ): Effect.Effect<readonly MacAgentLine[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macAgents.lines, { deviceId }, HOSTED_DEADLINE.HELD).pipe(
      Effect.map((answer): readonly MacAgentLine[] => answer.lines),
      Effect.orElseSucceed(() => undefined),
    );
  }

  /** One line claimed by its id, with a launch line's secrets; refused, or nothing where unanswered. */
  claimLine(
    deviceId: string,
    id: string,
  ): Effect.Effect<
    MacAgentClaimedLine | typeof MAC_AGENT_NOT_CLAIMED | undefined,
    never,
    HttpClient.HttpClient
  > {
    return askHosted(this.#hosted.macAgents.claimLine, { deviceId, id }).pipe(
      Effect.map((answer): MacAgentClaimedLine => answer),
      Effect.catch((failed) =>
        Effect.succeed(failed._tag === "HostedRefused" ? MAC_AGENT_NOT_CLAIMED : undefined),
      ),
    );
  }

  /** One line settled, a launch line with its runner's exit code where it exited with one; whether the service took it. */
  settleLine(
    deviceId: string,
    id: string,
    exitCode?: number,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macAgents.settleLine, {
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
  ): Effect.Effect<readonly MacAgentRequest[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macAgents.requests, { deviceId }, HOSTED_DEADLINE.HELD).pipe(
      Effect.map((answer): readonly MacAgentRequest[] => answer.requests),
      Effect.orElseSucceed(() => undefined),
    );
  }

  /** One request claimed by its id; refused, or nothing where unanswered. */
  claimRequest(
    deviceId: string,
    id: string,
  ): Effect.Effect<
    MacAgentRequest | typeof MAC_AGENT_NOT_CLAIMED | undefined,
    never,
    HttpClient.HttpClient
  > {
    return askHosted(this.#hosted.macAgents.claimRequest, { deviceId, id }).pipe(
      Effect.map((answer): MacAgentRequest => answer.request),
      Effect.catch((failed) =>
        Effect.succeed(failed._tag === "HostedRefused" ? MAC_AGENT_NOT_CLAIMED : undefined),
      ),
    );
  }

  /** One request answered; whether the service took it. */
  answerRequest(
    deviceId: string,
    id: string,
    answer: MacAgentAnswer,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const wire =
      answer.kind === MAC_AGENT_REQUEST_KIND.READ_FILE
        ? { ...answer, bytes: answer.bytes === null ? null : encodeBytes(answer.bytes) }
        : answer;
    return askHosted(this.#hosted.macAgents.answerRequest, { deviceId, id, answer: wire }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }
}
