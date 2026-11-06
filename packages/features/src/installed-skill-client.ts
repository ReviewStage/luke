import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { hostedCall } from "./hosted-call.js";
import {
  askLive,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import type { InstalledSkillsLiveAnswer } from "./installed-skill-live.js";
import type {
  installedSkillInstallRequestSchema,
  installedSkillRefusedDataSchema,
} from "./installed-skill-route-wire.js";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  INSTALLED_SKILL_RENAMES,
  type InstalledSkillCallFailure,
} from "./installed-skill-view.js";
import type { InstalledSkillRefusal } from "./installed-skill-wire.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * installed-skill-client.ts -- the window's side of the skills members install into the app, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract
 * (`contract/installed-skills.ts`) carried by the one account call
 * (`hosted-link.ts`), so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. Each call answers what the service said or why
 * there is no answer (`hostedCall`), never a failure, because every caller
 * does the same with one: says why, and offers to try again. A skill's
 * files refused are answered by the store's reason, with its name where
 * the service said.
 * A preview and an install read GitHub on the service before
 * they answer, so they wait as long as a Start does. Each write answers the
 * service's answer whole, the transaction it committed in among it, which
 * the host waits for on the skills it holds live (`installedSkillsLive`).
 */

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

const UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

/** The refusals the live read names, by the service's own word for each. */
const REFUSALS: ReadonlyMap<HostedApiError, InstalledSkillCallFailure> = new Map([
  [HOSTED_API_ERROR.NOT_FOUND, INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND],
  [HOSTED_API_ERROR.NOT_PERMITTED, INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED],
  [HOSTED_API_ERROR.INVALID_REQUEST, INSTALLED_SKILL_CALL_FAILURE.INVALID],
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN, INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN],
  [
    HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
    INSTALLED_SKILL_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  ],
  [HOSTED_API_ERROR.GITHUB_UNANSWERED, INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED],
]);

/** The live read's word for a refusal named here, a skill refused by the store's reason for it; nothing for everything else. */
function failureOf(failed: HostedFailure): InstalledSkillCallFailure | undefined {
  if (failed._tag !== "HostedRefused") return undefined;
  if (failed.refusal === HOSTED_API_ERROR.SKILL_FILES_REFUSED) return failed.data?.skillRefusal;
  return REFUSALS.get(failed.refusal);
}

/** A skill's files refused, as `hostedCall` reads the refusal. */
interface FilesRefused {
  readonly failure: typeof HOSTED_API_ERROR.SKILL_FILES_REFUSED;
}

/** The skill a refusal names and why, as the service carried them. */
type SkillRefusedData = typeof installedSkillRefusedDataSchema.Type;

/** A skill's files refused, by the store's reason, as the window hears it. */
interface SkillRefused {
  readonly failure: InstalledSkillRefusal;
  readonly skillName?: string;
}

/**
 * A call's answer with a skill's files refused spelled by the store's
 * reason, as the window shipped hearing it, and unanswered where the
 * service gave none; every other answer as it stands.
 */
function spelledBySkill<Answer extends object>(
  answer: Answer,
): Exclude<Answer, FilesRefused> | SkillRefused | typeof UNANSWERED {
  if (!("failure" in answer) || answer.failure !== HOSTED_API_ERROR.SKILL_FILES_REFUSED) {
    // SAFETY: only a failure spelled as files refused is taken out, and this is none.
    return answer as Exclude<Answer, FilesRefused>;
  }
  // SAFETY: `hostedCall` carries files refused with the fields the refusal declares.
  const { skillName, skillRefusal } = answer as SkillRefusedData;
  if (skillRefusal === undefined) return UNANSWERED;
  return { failure: skillRefusal, ...(skillName === undefined ? undefined : { skillName }) };
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
  read(skillId: string) {
    return hostedCall(
      this.#hosted.installedSkills.read,
      { id: skillId },
      { as: INSTALLED_SKILL_RENAMES },
    );
  }

  /** What a paste would install, read in the workspace whose GitHub installation reaches its source; nothing is written. */
  preview(workspaceId: string, text: string) {
    return Effect.map(
      hostedCall(
        this.#hosted.installedSkills.preview,
        { workspaceId, text },
        { as: INSTALLED_SKILL_RENAMES, deadline: HOSTED_DEADLINE.START },
      ),
      spelledBySkill,
    );
  }

  /** The skills a paste makes, installed in the scope asked, all or none. */
  install(params: InstalledSkillInstallParams) {
    return Effect.map(
      hostedCall(this.#hosted.installedSkills.install, params, {
        as: INSTALLED_SKILL_RENAMES,
        deadline: HOSTED_DEADLINE.START,
      }),
      spelledBySkill,
    );
  }

  /** One skill removed with its files. */
  remove(skillId: string) {
    return hostedCall(
      this.#hosted.installedSkills.remove,
      { id: skillId },
      { as: INSTALLED_SKILL_RENAMES },
    );
  }
}
