import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  askHosted,
  askLive,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import type { InstalledSkillsLiveAnswer } from "./installed-skill-live.js";
import type {
  InstalledSkillContent,
  InstalledSkillPreview,
  installedSkillInstallAnswerSchema,
  installedSkillInstallRequestSchema,
  installedSkillRemovedAnswerSchema,
} from "./installed-skill-route-wire.js";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillCallFailure,
} from "./installed-skill-view.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * installed-skill-client.ts -- the window's side of the skills members install into the app, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract
 * (`contract/installed-skills.ts`) carried by the one account call
 * (`hosted-link.ts`), so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. Each call answers what the service said or why
 * there is no answer, never a failure, because every caller does the same
 * with one: says why, and offers to try again. A skill refused is answered
 * by the store's reason, with its name where the service said.
 * A preview and an install read GitHub on the service before
 * they answer, so they wait as long as a Start does. Each write answers the
 * service's answer whole, the transaction it committed in among it, which
 * the host waits for on the skills it holds live (`installedSkillsLive`).
 */

/** A call's answer, or why there is none, with the skill refused where one was. */
export type InstalledSkillCallResult<Answer> =
  | { readonly ok: true; readonly answer: Answer }
  | {
      readonly ok: false;
      readonly failure: InstalledSkillCallFailure;
      readonly skillName?: string;
    };

export interface HostedInstalledSkillClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

/** What an install sends: the paste, whose the skills are, and for a source the skills chosen and the commit previewed, for text its name and description. */
export type InstalledSkillInstallParams = typeof installedSkillInstallRequestSchema.Type;

/** A live read the service did not answer, in the window's own words. */
export interface InstalledSkillsLiveFailed {
  readonly failure: InstalledSkillCallFailure;
}

/** The refusals an installed skills call names, by the service's own word for each. */
const REFUSALS: ReadonlyMap<HostedApiError, InstalledSkillCallFailure> = new Map([
  [HOSTED_API_ERROR.NOT_FOUND, INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND],
  [HOSTED_API_ERROR.NOT_PERMITTED, INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED],
  [HOSTED_API_ERROR.INVALID_REQUEST, INSTALLED_SKILL_CALL_FAILURE.INVALID],
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN, INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, INSTALLED_SKILL_CALL_FAILURE.UNREACHABLE],
  [HOSTED_API_ERROR.GITHUB_UNANSWERED, INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED],
]);

/** The window's word for a refusal named here, a skill refused by the store's reason for it; nothing for everything else. */
function failureOf(failed: HostedFailure): InstalledSkillCallFailure | undefined {
  if (failed._tag !== "HostedRefused") return undefined;
  if (failed.refusal === HOSTED_API_ERROR.SKILL_FILES_REFUSED) return failed.data?.skillRefusal;
  return REFUSALS.get(failed.refusal);
}

/** A procedure's answer picked, or the refusal it failed with where it is one named here, with the skill it names; unanswered for everything else. */
function resultOf<Answer, Picked>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  pick: (answer: Answer) => Picked,
): Effect.Effect<InstalledSkillCallResult<Picked>, never, HttpClient.HttpClient> {
  return Effect.match(asked, {
    onSuccess: (answer): InstalledSkillCallResult<Picked> => ({ ok: true, answer: pick(answer) }),
    onFailure: (failed): InstalledSkillCallResult<Picked> => {
      const failure = failureOf(failed);
      if (failed._tag !== "HostedRefused" || failure === undefined) {
        return { ok: false, failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED };
      }
      const skillName = failed.data?.skillName;
      return { ok: false, failure, ...(skillName === undefined ? undefined : { skillName }) };
    },
  });
}

/** The window's reads and writes of installed skills. */
export class HostedInstalledSkillClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedInstalledSkillClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /**
   * The skills the account sees in the workspace, the workspace's and its
   * own, sealed for following over Neon Realtime for the account `userId`
   * names, or with `poll` their rows inline: signed out where the session
   * is another account's, and why there is none otherwise.
   */
  installedSkillsLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    InstalledSkillsLiveAnswer | InstalledSkillsLiveFailed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { workspaceId, [LIVE_USER_QUERY]: userId };
    return Effect.catch(askLive(this.#hosted.live.installedSkills, read, poll, after), (failed) =>
      Effect.succeed(
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN
          ? LIVE_SIGNED_OUT
          : { failure: failureOf(failed) ?? INSTALLED_SKILL_CALL_FAILURE.UNANSWERED },
      ),
    );
  }

  /** One skill read whole: its `SKILL.md` and every file's path and size. */
  read(
    skillId: string,
  ): Effect.Effect<InstalledSkillCallResult<InstalledSkillContent>, never, HttpClient.HttpClient> {
    return resultOf(
      askHosted(this.#hosted.installedSkills.read, { id: skillId }),
      (answer) => answer,
    );
  }

  /** What a paste would install, read in the workspace whose GitHub installation reaches its source; nothing is written. */
  preview(
    workspaceId: string,
    text: string,
  ): Effect.Effect<InstalledSkillCallResult<InstalledSkillPreview>, never, HttpClient.HttpClient> {
    return resultOf(
      askHosted(this.#hosted.installedSkills.preview, { workspaceId, text }, HOSTED_DEADLINE.START),
      (answer) => answer,
    );
  }

  /** The skills a paste makes, installed in the scope asked, all or none. */
  install(
    params: InstalledSkillInstallParams,
  ): Effect.Effect<
    InstalledSkillCallResult<typeof installedSkillInstallAnswerSchema.Type>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(this.#hosted.installedSkills.install, params, HOSTED_DEADLINE.START),
      (answer) => answer,
    );
  }

  /** One skill removed with its files. */
  remove(
    skillId: string,
  ): Effect.Effect<
    InstalledSkillCallResult<typeof installedSkillRemovedAnswerSchema.Type>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(this.#hosted.installedSkills.remove, { id: skillId }),
      (answer) => answer,
    );
  }
}
