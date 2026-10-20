/**
 * github.ts -- the account's GitHub and the repositories of a workspace's installation, as one resource.
 *
 * Connecting the account's GitHub (`github-connection-wire.ts`): the Mac's
 * connect intent, the page's claim of it, whether GitHub is connected, and
 * the disconnect. And the repositories of a workspace's GitHub installation
 * (`github-repositories-wire.ts`), and one of them's tree, skills, pull
 * request, and issue, and the issues New task's picker offers of it.
 *
 * Every read of a repository is a GET whose input is its query, so each
 * field is declared by what the query carries, text, and decodes to the
 * wire's own value: a workspace, a repository's full name, a folder, and a
 * number. A key named more than once reaches the schema as a list and is
 * refused as an invalid request, as the old group refused it, and a key it
 * does not name is ignored, as the old group ignored one. The claim's body
 * is read exactly, a key it does not name refused. Each output is the wire
 * schema flipped, so oRPC's output check encodes the handler's value into
 * the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema, SchemaTransformation } from "effect";
import {
  githubConnectAnswerSchema,
  githubConnectClaimAnswerSchema,
  githubConnectClaimRequestSchema,
  githubConnectionAnswerSchema,
} from "../github-connection-wire.js";
import {
  GITHUB_ISSUES_BOUNDS,
  GITHUB_REPOSITORIES_QUERY,
  githubPullRequestNumberSchema,
  githubRepositoriesAnswerSchema,
  githubRepositoryFullNameSchema,
  githubRepositoryIssueAnswerSchema,
  githubRepositoryIssuesAnswerSchema,
  githubRepositoryPullRequestAnswerSchema,
} from "../github-repositories-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  CODE_PATH_MAX_CHARS,
  taskSkillsAnswerSchema,
  taskTreeAnswerSchema,
  workspaceIdSchema,
} from "../task-wire.js";
import { exactInput, hostedProcedure } from "./base.js";

/** The value a tree's `recursive` query carries when everything under the folder is asked. */
export const GITHUB_REPOSITORY_TREE_RECURSIVE = "1";

/** A repository as a read with no plan names it: the workspace whose installation reaches it, and the repository. */
const repositoryPlaceQuery = {
  [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID]: workspaceIdSchema,
  [GITHUB_REPOSITORIES_QUERY.REPOSITORY]: githubRepositoryFullNameSchema,
};

/** A pull request's or an issue's number, as the query carries it in text. */
const numberQuerySchema = EffectSchema.String.pipe(
  EffectSchema.decodeTo(
    githubPullRequestNumberSchema,
    SchemaTransformation.transform({
      decode: (text): number => Number(text),
      encode: (number): string => String(number),
    }),
  ),
);

const numberedQuerySchema = EffectSchema.Struct({
  ...repositoryPlaceQuery,
  [GITHUB_REPOSITORIES_QUERY.NUMBER]: numberQuerySchema,
});

export const githubContract = {
  connect: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.GITHUB_CONNECT }))
    .output(EffectSchema.flip(githubConnectAnswerSchema)),
  claim: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.GITHUB_CONNECT_CLAIM }))
    .input(exactInput(githubConnectClaimRequestSchema))
    .output(EffectSchema.flip(githubConnectClaimAnswerSchema)),
  connection: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_CONNECTION }))
    .output(EffectSchema.flip(githubConnectionAnswerSchema)),
  disconnect: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.GITHUB_DISCONNECT }))
    .output(EffectSchema.flip(githubConnectionAnswerSchema)),
  repositories: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES }))
    .input(
      EffectSchema.Struct({
        [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID]: EffectSchema.optionalKey(workspaceIdSchema),
      }),
    )
    .output(EffectSchema.flip(githubRepositoriesAnswerSchema)),
  repositoryTree: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE }))
    .input(
      EffectSchema.Struct({
        ...repositoryPlaceQuery,
        /** The folder, the root where it is not named. */
        path: EffectSchema.optionalKey(
          EffectSchema.String.check(EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS)),
        ),
        /** Whether everything under the folder is asked. */
        recursive: EffectSchema.optionalKey(EffectSchema.Literal(GITHUB_REPOSITORY_TREE_RECURSIVE)),
      }),
    )
    .output(EffectSchema.flip(taskTreeAnswerSchema)),
  repositorySkills: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS }))
    .input(EffectSchema.Struct(repositoryPlaceQuery))
    .output(EffectSchema.flip(taskSkillsAnswerSchema)),
  repositoryPullRequest: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_PULL_REQUEST,
      }),
    )
    .input(numberedQuerySchema)
    .output(EffectSchema.flip(githubRepositoryPullRequestAnswerSchema)),
  repositoryIssue: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUE }))
    .input(numberedQuerySchema)
    .output(EffectSchema.flip(githubRepositoryIssueAnswerSchema)),
  /** A repository's issues: the one `number` names, else those `query`'s words find, else its open issues. */
  repositoryIssues: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUES }))
    .input(
      EffectSchema.Struct({
        ...repositoryPlaceQuery,
        [GITHUB_REPOSITORIES_QUERY.QUERY]: EffectSchema.optionalKey(
          EffectSchema.String.check(EffectSchema.isMaxLength(GITHUB_ISSUES_BOUNDS.MAX_QUERY_CHARS)),
        ),
        [GITHUB_REPOSITORIES_QUERY.NUMBER]: EffectSchema.optionalKey(numberQuerySchema),
      }),
    )
    .output(EffectSchema.flip(githubRepositoryIssuesAnswerSchema)),
};
