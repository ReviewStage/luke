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

export type InstalledSkillCallResult<Answer> =
  | { readonly ok: true; readonly answer: Answer }
  | {
      readonly ok: false;
      readonly failure: InstalledSkillCallFailure;
      readonly skillName?: string;
    };

export interface HostedInstalledSkillClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export type InstalledSkillInstallParams = typeof installedSkillInstallRequestSchema.Type;

export interface InstalledSkillsLiveFailed {
  readonly failure: InstalledSkillCallFailure;
}

const REFUSALS: ReadonlyMap<HostedApiError, InstalledSkillCallFailure> = new Map([
  [HOSTED_API_ERROR.NOT_FOUND, INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND],
  [HOSTED_API_ERROR.NOT_PERMITTED, INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED],
  [HOSTED_API_ERROR.INVALID_REQUEST, INSTALLED_SKILL_CALL_FAILURE.INVALID],
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN, INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, INSTALLED_SKILL_CALL_FAILURE.UNREACHABLE],
  [HOSTED_API_ERROR.GITHUB_UNANSWERED, INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED],
]);

function failureOf(failed: HostedFailure): InstalledSkillCallFailure | undefined {
  if (failed._tag !== "HostedRefused") return undefined;
  if (failed.refusal === HOSTED_API_ERROR.SKILL_FILES_REFUSED) return failed.data?.skillRefusal;
  return REFUSALS.get(failed.refusal);
}

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

export class HostedInstalledSkillClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedInstalledSkillClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

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

  read(
    skillId: string,
  ): Effect.Effect<InstalledSkillCallResult<InstalledSkillContent>, never, HttpClient.HttpClient> {
    return resultOf(
      askHosted(this.#hosted.installedSkills.read, { id: skillId }),
      (answer) => answer,
    );
  }

  preview(
    workspaceId: string,
    text: string,
  ): Effect.Effect<InstalledSkillCallResult<InstalledSkillPreview>, never, HttpClient.HttpClient> {
    return resultOf(
      askHosted(this.#hosted.installedSkills.preview, { workspaceId, text }, HOSTED_DEADLINE.START),
      (answer) => answer,
    );
  }

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
