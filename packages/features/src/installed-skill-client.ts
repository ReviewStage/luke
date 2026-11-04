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
  InstalledSkillFilesRefusal,
  InstalledSkillPreview,
  InstalledSkillUpdateCheck,
  installedSkillAnswerSchema,
  installedSkillInstallAnswerSchema,
  installedSkillInstallRequestSchema,
  installedSkillPreviewFileRequestSchema,
  installedSkillRemovedAnswerSchema,
  installedSkillUpdatedAnswerSchema,
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
 * with its name and why its files were refused where the service said.
 * A preview, an install, and an update read GitHub on the service before
 * they answer, so they wait as long as a Start does. Each write answers the
 * service's answer whole, the transaction it committed in among it, which
 * the host waits for on the skills it holds live (`installedSkillsLive`).
 */

/** A call's answer, or why there is none: for a skill refused, which, and why its files were. */
export type InstalledSkillCallResult<Answer> =
  | { readonly ok: true; readonly answer: Answer }
  | {
      readonly ok: false;
      readonly failure: InstalledSkillCallFailure;
      readonly skillName?: string;
      readonly skillRefusal?: InstalledSkillFilesRefusal;
    };

export interface HostedInstalledSkillClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

/** What an install sends: the paste, whose the skills are, and for a source the skills chosen, for text the name and description it lacks. */
export type InstalledSkillInstallParams = typeof installedSkillInstallRequestSchema.Type;

/** A previewed skill's `SKILL.md` asked for: the workspace, and the repository, commit, and folder the preview named. */
export type InstalledSkillPreviewFileParams = typeof installedSkillPreviewFileRequestSchema.Type;

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
  [HOSTED_API_ERROR.SKILL_FILES_REFUSED, INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED],
  [
    HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
    INSTALLED_SKILL_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  ],
  [HOSTED_API_ERROR.BRANCH_NOT_FOUND, INSTALLED_SKILL_CALL_FAILURE.REF_NOT_FOUND],
  [HOSTED_API_ERROR.GITHUB_UNANSWERED, INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED],
]);

/** The window's word for a refusal named here; unanswered for everything else. */
function failureOf(failed: HostedFailure): InstalledSkillCallFailure | undefined {
  return failed._tag === "HostedRefused" ? REFUSALS.get(failed.refusal) : undefined;
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
      const { skillName, skillRefusal } = failed.data ?? {};
      return {
        ok: false,
        failure,
        ...(skillName === undefined ? undefined : { skillName }),
        ...(skillRefusal === undefined ? undefined : { skillRefusal }),
      };
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

  /** One previewed skill's `SKILL.md` at the commit the preview pinned, for "View" on a skill the preview carried none of. */
  previewFile(
    params: InstalledSkillPreviewFileParams,
  ): Effect.Effect<InstalledSkillCallResult<string>, never, HttpClient.HttpClient> {
    return resultOf(
      askHosted(this.#hosted.installedSkills.previewFile, params, HOSTED_DEADLINE.START),
      (answer) => answer.markdown,
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

  /** One skill turned on or off, as it then stands. */
  setEnabled(
    skillId: string,
    enabled: boolean,
  ): Effect.Effect<
    InstalledSkillCallResult<typeof installedSkillAnswerSchema.Type>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(this.#hosted.installedSkills.setEnabled, {
        params: { id: skillId },
        body: { enabled },
      }),
      (answer) => answer,
    );
  }

  /** Whether a GitHub skill's folder moved at its ref, for an "Update available" badge; never for a pasted one. */
  checkUpdate(
    workspaceId: string,
    skillId: string,
  ): Effect.Effect<
    InstalledSkillCallResult<InstalledSkillUpdateCheck>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(this.#hosted.installedSkills.checkUpdate, { id: skillId, workspaceId }),
      (answer) => answer,
    );
  }

  /** A GitHub skill's files read again at its ref and put in place of its own, with whether they changed. */
  update(
    workspaceId: string,
    skillId: string,
  ): Effect.Effect<
    InstalledSkillCallResult<typeof installedSkillUpdatedAnswerSchema.Type>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(
        this.#hosted.installedSkills.update,
        { params: { id: skillId }, body: { workspaceId } },
        HOSTED_DEADLINE.START,
      ),
      (answer) => answer,
    );
  }

  /** The account's own personal skill moved into the workspace, as it then stands. */
  share(
    workspaceId: string,
    skillId: string,
  ): Effect.Effect<
    InstalledSkillCallResult<typeof installedSkillAnswerSchema.Type>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(this.#hosted.installedSkills.share, {
        params: { id: skillId },
        body: { workspaceId },
      }),
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
