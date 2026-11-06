import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

export const REPOSITORY_UNREACHED = {
  NOT_CONNECTED: "not-connected",
  CONNECTION_LAPSED: "connection-lapsed",
  OTHER_OWNER: "other-owner",
  NOT_SELECTED: "not-selected",
  GONE: "gone",
  OTHER_WORKSPACE: "other-workspace",
  NO_TOKEN: "no-token",
  TOKEN_INVALID: "token-invalid",
  TOKEN_NO_ACCESS: "token-no-access",
  TOKEN_CANNOT_PUSH: "token-cannot-push",
  TOKEN_SSO: "token-sso",
} as const;

const GITHUB_SETTINGS_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9/_.-]+$/u;

export const GITHUB_SSO_URL_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9/_.-]+(?:\?[A-Za-z0-9_.~=&%+-]*)?$/u;

const reachingWorkspaceSchema = EffectSchema.Struct({
  id: workspaceIdSchema,
  name: EffectSchema.String,
});

const unreachedBare = (
  reason:
    | typeof REPOSITORY_UNREACHED.NOT_CONNECTED
    | typeof REPOSITORY_UNREACHED.CONNECTION_LAPSED
    | typeof REPOSITORY_UNREACHED.GONE
    | typeof REPOSITORY_UNREACHED.NO_TOKEN
    | typeof REPOSITORY_UNREACHED.TOKEN_INVALID
    | typeof REPOSITORY_UNREACHED.TOKEN_NO_ACCESS
    | typeof REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH,
) =>
  EffectSchema.Struct({
    reason: EffectSchema.Literal(reason),
    repository: githubRepositoryFullNameSchema,
  });

export const repositoryUnreachedSchema = EffectSchema.Union([
  unreachedBare(REPOSITORY_UNREACHED.NOT_CONNECTED),
  unreachedBare(REPOSITORY_UNREACHED.CONNECTION_LAPSED),
  unreachedBare(REPOSITORY_UNREACHED.GONE),
  unreachedBare(REPOSITORY_UNREACHED.NO_TOKEN),
  unreachedBare(REPOSITORY_UNREACHED.TOKEN_INVALID),
  unreachedBare(REPOSITORY_UNREACHED.TOKEN_NO_ACCESS),
  unreachedBare(REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH),
  EffectSchema.Struct({
    reason: EffectSchema.Literal(REPOSITORY_UNREACHED.OTHER_OWNER),
    repository: githubRepositoryFullNameSchema,
    connectedTo: EffectSchema.optionalKey(EffectSchema.String),
  }),
  EffectSchema.Struct({
    reason: EffectSchema.Literal(REPOSITORY_UNREACHED.NOT_SELECTED),
    repository: githubRepositoryFullNameSchema,
    settingsUrl: EffectSchema.String.check(EffectSchema.isPattern(GITHUB_SETTINGS_URL_PATTERN)),
  }),
  EffectSchema.Struct({
    reason: EffectSchema.Literal(REPOSITORY_UNREACHED.TOKEN_SSO),
    repository: githubRepositoryFullNameSchema,
    authorizeUrl: EffectSchema.String.check(EffectSchema.isPattern(GITHUB_SSO_URL_PATTERN)),
  }),
  EffectSchema.Struct({
    reason: EffectSchema.Literal(REPOSITORY_UNREACHED.OTHER_WORKSPACE),
    repository: githubRepositoryFullNameSchema,
    workspace: reachingWorkspaceSchema,
  }),
]);

export type RepositoryUnreached = typeof repositoryUnreachedSchema.Type;

export const repositoryNotReachableSchema = EffectSchema.Struct({
  error: EffectSchema.Literal(HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
  unreached: repositoryUnreachedSchema,
});
