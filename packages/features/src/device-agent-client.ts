import { HTTP_METHOD } from "@luke/wire";
import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type AccountCallEffects, accountCall, type CallCredential } from "./account-call.js";
import {
  DEVICE_ISOLATION,
  type DeviceAgentAnswer,
  type DeviceAgentLaunchSecrets,
  type DeviceAgentLine,
  type DeviceAgentRelease,
  type DeviceAgentRequest,
  type DeviceArch,
  type DeviceCapability,
  type DeviceIsolation,
  type DeviceLaunchRefusal,
  type DevicePlatform,
  type DeviceSetup,
  type DeviceSignedIn,
  type HostUpdate,
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

/**
 * device-agent-client.ts -- a local agent's Mac as it asks the service (`contract/device-agents.ts`): it registers and beats, reads which of its agents should still stand, holds a read for its lines and one for its requests, claims each by its id, settles a line or answers a request, and saves its agents' state.
 *
 * Each is a procedure of the hosted contract over the one account call, so
 * the bearer is read fresh per attempt and a 401 is renewed and retried
 * once. No call fails: a held read the service did not answer is nothing,
 * which the caller asks again after a pause; a claim refused is
 * `DEVICE_AGENT_NOT_CLAIMED` (another claim took it, or its caller withdrew
 * it) and one unanswered nothing; a
 * register, a settle, or an answer not taken is false, and a beat or a
 * read of the live agents not taken is nothing. A save of an agent's
 * state, or its commit, refused says whether a newer save made it stale,
 * and one unanswered, or refused as unavailable, is nothing. A host also
 * asks the runner token route for a GitHub token for one of its agents
 * (`githubToken`), on the same credential, its device secret. A box with
 * no secret yet pairs with a code: it starts a pairing with no credential
 * (`startHostPairing`) and polls on the poll secret it was answered
 * (`pollHostPairing`) until a member approves or denies it.
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

/** A beat the service took: the ids of the launches it holds the device to, none from a service before the field, and a release newer than the host's, where the service names one (`deviceAgentBeatAnswerSchema`). */
export interface DeviceAgentBeat {
  readonly openLaunches?: readonly string[] | undefined;
  readonly release?: DeviceAgentRelease | undefined;
}

/** Where a host's update stands, as its beat says it while one is under way, and why it failed where it did. */
export interface DeviceAgentUpdate {
  readonly update: HostUpdate;
  readonly updateFailure?: string | undefined;
}

/** What a Mac registers as: its name, its platform and architecture, its home folder, the Claude Code CLI it bundles, the Codex it checked where it has one, which harnesses it is signed in to, the lines beyond the first it takes, and where its setup stands until it is ready. */
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
  /** Where its setup stands while it is not ready to take an agent, and why it failed where it did; none once it is ready. */
  readonly setup?: DeviceSetup | undefined;
  readonly setupFailure?: string | undefined;
}

/** How a pairing's start or poll ended. */
export const HOST_PAIRING_OUTCOME = {
  /** The service answered: a start its poll secret, code, and link; a poll where the pairing stands. */
  ANSWERED: "answered",
  /** The service is taking no more starts from the box's address for now; start again a little later. */
  BRAKED: "braked",
  /** The service refused the daemon's version as below its floor (`HOST_WIRE.VERSION_HEADER`). */
  UPGRADE_NEEDED: "upgrade-needed",
  /** The service refused the call for any other reason: a malformed start, or a poll on no poll secret. */
  REFUSED: "refused",
  /** No answer could be read: the network, the deadline, or a service answering something else. */
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

/** A pairing call's answer, or how it failed, by the refusal's slug. */
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
  return pairingOutcome(askHosted(hosted.deviceAgents.startPairing, request));
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
  return pairingOutcome(askHosted(hosted.deviceAgents.pollPairing, undefined));
}

/** The machine an own enroll names, which the service creates the device from where the account never registered its id. */
type OwnEnrollingMachine = Required<Omit<OwnDeviceEnrollRequest, "deviceId">>;

/** How an own device's enroll ended (`HostedDeviceAgentClient.enrollOwn`). */
export const OWN_ENROLL_OUTCOME = {
  /** The service converted the device in place and answered its device secret, this once. */
  ENROLLED: "enrolled",
  /** The account holds no device of that id. */
  NOT_FOUND: "not-found",
  /** The service refused the enroll for any other reason, its slug kept. */
  REFUSED: "refused",
  /** The service refused the host program's version as below its floor (`HOST_WIRE.VERSION_HEADER`). */
  UPGRADE_NEEDED: "upgrade-needed",
  /** No answer could be read: the network, the deadline, or a service answering something else. */
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

/** How a refusal of an own device's enroll reads, by its slug. */
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

  /** This Mac registered under its id; whether the service took it. */
  register(
    deviceId: string,
    device: DeviceAgentDevice,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const { codexExecutable, capabilities, isolation, setup, setupFailure, ...rest } = device;
    // Note that a Mac with no Codex checked names none, which the service reads as no Codex,
    // and one with no capability names no list, which a service from before the field refuses.
    // Likewise a device running bare names no isolation, so a service from before the field still takes its register.
    const input = {
      deviceId,
      ...rest,
      ...(codexExecutable === undefined ? undefined : { codexExecutable }),
      ...(capabilities.length === 0 ? undefined : { capabilities }),
      ...(isolation === DEVICE_ISOLATION.BARE ? undefined : { isolation }),
      // Likewise a device ready to take an agent names no setup, so only one a service from before the field would never list is refused.
      ...(setup === undefined ? undefined : { setup }),
      ...(setup === undefined || setupFailure === undefined ? undefined : { setupFailure }),
    };
    return askHosted(this.#hosted.deviceAgents.register, input).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /** That this Mac is here now, which harnesses it is signed in to, and where its update stands while one is under way; the launches the service holds it to and a newer release where it took the beat, and nothing where it did not. */
  beat(
    deviceId: string,
    signedIn: DeviceSignedIn,
    updating?: DeviceAgentUpdate,
  ): Effect.Effect<DeviceAgentBeat | undefined, never, HttpClient.HttpClient> {
    const failure = updating?.updateFailure;
    const input = {
      deviceId,
      signedIn,
      // Note that a beat updating nothing names neither key, since a service from before them refuses a key it does not know.
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

  /** The ids of the account's agents that should still stand on this Mac; nothing where the service did not answer or refused, which is never an empty list. */
  liveAgents(
    deviceId: string,
  ): Effect.Effect<readonly string[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.deviceAgents.liveAgents, { deviceId }).pipe(
      Effect.map((answer): readonly string[] => answer.agentIds),
      Effect.orElseSucceed(() => undefined),
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

  /**
   * One line settled, a launch line with its runner's exit code where it
   * exited with one, and why it never started where the device says;
   * whether the service took it. Note that a settle naming why is asked
   * again without it where the service refuses it, since a service from
   * before the field refuses a request naming any key it does not know.
   */
  settleLine(
    deviceId: string,
    id: string,
    exitCode?: number,
    refusal?: DeviceLaunchRefusal,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    const settled = (named: DeviceLaunchRefusal | undefined) =>
      askHosted(this.#hosted.deviceAgents.settleLine, {
        deviceId,
        id,
        ...(exitCode === undefined ? {} : { exitCode }),
        ...(named === undefined ? {} : { refusal: named }),
      });
    return settled(refusal).pipe(
      Effect.catch((failed) =>
        refusal !== undefined && failed._tag === "HostedRefused"
          ? settled(undefined)
          : Effect.fail(failed),
      ),
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
    const wire = { ...answer, bytes: answer.bytes === null ? null : encodeBytes(answer.bytes) };
    return askHosted(this.#hosted.deviceAgents.answerRequest, { deviceId, id, answer: wire }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }
}
