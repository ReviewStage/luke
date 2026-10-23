import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import type {
  InstalledSkillFilesRefusal,
  InstalledSkillPreview,
  InstalledSkillSummary,
  InstalledSkillUpdateCheck,
  installedSkillInstallRequestSchema,
  installedSkillPreviewFileRequestSchema,
} from "./installed-skill-route-wire.js";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillCallFailure,
} from "./installed-skill-view.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * installed-skill-client.ts -- the window's side of the skills members install into Luke, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract
 * (`contract/installed-skills.ts`) carried by the one account call
 * (`hosted-link.ts`), so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. Each call answers what the service said or why
 * there is no answer, never a failure, because every caller does the same
 * with one: says why, and offers to try again. A skill refused is answered
 * with its name and why its files were refused where the service said.
 * A preview, an install, and an update read GitHub on the service before
 * they answer, so they wait as long as a Start does.
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

/** A procedure's answer picked, or the refusal it failed with where it is one named here, with the skill it names; unanswered for everything else. */
function resultOf<Answer, Picked>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  pick: (answer: Answer) => Picked,
): Effect.Effect<InstalledSkillCallResult<Picked>, never, HttpClient.HttpClient> {
  return Effect.match(asked, {
    onSuccess: (answer): InstalledSkillCallResult<Picked> => ({ ok: true, answer: pick(answer) }),
    onFailure: (failed): InstalledSkillCallResult<Picked> => {
      const failure = failed._tag === "HostedRefused" ? REFUSALS.get(failed.refusal) : undefined;
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

  /** The skills the account sees in the workspace: the workspace's, then its own. */
  list(
    workspaceId: string,
  ): Effect.Effect<
    InstalledSkillCallResult<readonly InstalledSkillSummary[]>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(this.#hosted.installedSkills.list, { workspaceId }),
      (answer) => answer.skills,
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
    InstalledSkillCallResult<readonly InstalledSkillSummary[]>,
    never,
    HttpClient.HttpClient
  > {
    return resultOf(
      askHosted(this.#hosted.installedSkills.install, params, HOSTED_DEADLINE.START),
      (answer) => answer.skills,
    );
  }

  /** One skill turned on or off, as it then stands. */
  setEnabled(
    skillId: string,
    enabled: boolean,
  ): Effect.Effect<InstalledSkillCallResult<InstalledSkillSummary>, never, HttpClient.HttpClient> {
    return resultOf(
      askHosted(this.#hosted.installedSkills.setEnabled, {
        params: { id: skillId },
        body: { enabled },
      }),
      (answer) => answer.skill,
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
    InstalledSkillCallResult<{ readonly skill: InstalledSkillSummary; readonly changed: boolean }>,
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

  /** One skill removed with its files. */
  remove(
    skillId: string,
  ): Effect.Effect<InstalledSkillCallResult<string>, never, HttpClient.HttpClient> {
    return resultOf(
      askHosted(this.#hosted.installedSkills.remove, { id: skillId }),
      (answer) => answer.id,
    );
  }
}
