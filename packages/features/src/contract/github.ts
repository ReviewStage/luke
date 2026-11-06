import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema, SchemaTransformation } from "effect";
import {
  githubConnectAnswerSchema,
  githubConnectClaimAnswerSchema,
  githubConnectClaimRequestSchema,
  githubConnectionAnswerSchema,
} from "../github-connection-wire.js";
import {
  GITHUB_REPOSITORIES_QUERY,
  githubPullRequestNumberSchema,
  githubRepositoriesAnswerSchema,
  githubRepositoryFullNameSchema,
  githubRepositoryIssueAnswerSchema,
  githubRepositoryPullRequestAnswerSchema,
  workspaceTokenRepositoriesAnswerSchema,
} from "../github-repositories-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  CODE_PATH_MAX_CHARS,
  taskFileAnswerSchema,
  taskSkillsAnswerSchema,
  taskSkillsQueryFields,
  taskTreeAnswerSchema,
  workspaceIdSchema,
} from "../task-wire.js";
import { workspaceTokenRepositoryRequestSchema } from "../workspace-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";
import { taskFileQueryFields } from "./task-files.js";

const CLAIM_BODY_BYTES = 1_024;

const TOKEN_REPOSITORY_BODY_BYTES = 1_024;

export const GITHUB_REPOSITORY_TREE_RECURSIVE = "1";

const repositoryPlaceQuery = {
  [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID]: workspaceIdSchema,
  [GITHUB_REPOSITORIES_QUERY.REPOSITORY]: githubRepositoryFullNameSchema,
};

const numberQuerySchema = EffectSchema.String.pipe(
  EffectSchema.decodeTo(
    githubPullRequestNumberSchema,
    SchemaTransformation.transform({
      decode: (text): number => Number(text),
      encode: (number): string => String(number),
    }),
  ),
);

export const numberedQuerySchema = EffectSchema.Struct({
  ...repositoryPlaceQuery,
  [GITHUB_REPOSITORIES_QUERY.NUMBER]: numberQuerySchema,
});

export const githubContract = {
  connect: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.GITHUB_CONNECT }))
    .output(EffectSchema.flip(githubConnectAnswerSchema)),
  claim: hostedProcedure
    .meta(bodyCap(CLAIM_BODY_BYTES))
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
  tokenRepositories: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN_REPOSITORIES }))
    .input(EffectSchema.Struct({ [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID]: workspaceIdSchema }))
    .output(EffectSchema.flip(workspaceTokenRepositoriesAnswerSchema)),
  setTokenRepository: hostedProcedure
    .meta(bodyCap(TOKEN_REPOSITORY_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN_REPOSITORIES }))
    .input(exactInput(workspaceTokenRepositoryRequestSchema))
    .output(EffectSchema.flip(workspaceTokenRepositoriesAnswerSchema)),
  repositoryFile: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_FILE }))
    .input(EffectSchema.Struct({ ...repositoryPlaceQuery, ...taskFileQueryFields }))
    .output(EffectSchema.flip(taskFileAnswerSchema)),
  repositoryTree: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE }))
    .input(
      EffectSchema.Struct({
        ...repositoryPlaceQuery,
        path: EffectSchema.optionalKey(
          EffectSchema.String.check(EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS)),
        ),
        recursive: EffectSchema.optionalKey(EffectSchema.Literal(GITHUB_REPOSITORY_TREE_RECURSIVE)),
      }),
    )
    .output(EffectSchema.flip(taskTreeAnswerSchema)),
  repositorySkills: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS }))
    .input(
      EffectSchema.Struct({
        [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID]: workspaceIdSchema,
        [GITHUB_REPOSITORIES_QUERY.REPOSITORY]: EffectSchema.optionalKey(
          githubRepositoryFullNameSchema,
        ),
        ...taskSkillsQueryFields,
      }),
    )
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
};
