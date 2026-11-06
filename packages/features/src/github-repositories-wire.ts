import { Schema as EffectSchema } from "effect";
import { PULL_REQUEST_STATE } from "./agent-wire.js";
import { githubRepositoryFullNameSchema } from "./link-grammar.js";
import { countedNumber } from "./service-wire.js";

export { githubRepositoryFullNameSchema };

export const GITHUB_ACCESS = {
  APP: "app",
  TOKEN: "token",
} as const;

export type GitHubAccess = (typeof GITHUB_ACCESS)[keyof typeof GITHUB_ACCESS];

export const GITHUB_READER = {
  [GITHUB_ACCESS.APP]: "`gh`",
  [GITHUB_ACCESS.TOKEN]: "`gh api`",
} as const;

export const githubRepositorySchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(EffectSchema.Number),
  owner: EffectSchema.String,
  name: EffectSchema.String,
  fullName: githubRepositoryFullNameSchema,
  defaultBranch: EffectSchema.String,
  private: EffectSchema.Boolean,
  updatedAt: countedNumber,
  access: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(GITHUB_ACCESS))),
});

export type GitHubRepository = typeof githubRepositorySchema.Type;

export const GITHUB_REPOSITORIES_QUERY = {
  WORKSPACE_ID: "workspaceId",
  REPOSITORY: "repository",
  NUMBER: "number",
} as const;

export const GITHUB_REPOSITORY_SELECTION = {
  ALL: "all",
  SELECTED: "selected",
} as const;

export type GitHubRepositorySelection =
  (typeof GITHUB_REPOSITORY_SELECTION)[keyof typeof GITHUB_REPOSITORY_SELECTION];

const githubListedInstallationSchema = EffectSchema.Struct({
  installationId: EffectSchema.Number,
  login: EffectSchema.optionalKey(EffectSchema.String),
  repositorySelection: EffectSchema.Literals(Object.values(GITHUB_REPOSITORY_SELECTION)),
});

export const githubRepositoriesAnswerSchema = EffectSchema.Struct({
  installed: EffectSchema.Boolean,
  repositories: EffectSchema.Array(githubRepositorySchema),
  addable: EffectSchema.optionalKey(EffectSchema.Array(githubRepositorySchema)),
  installations: EffectSchema.optionalKey(EffectSchema.Array(githubListedInstallationSchema)),
  installationUrl: EffectSchema.String,
});

export type GitHubRepositoriesAnswer = typeof githubRepositoriesAnswerSchema.Type;

export const workspaceTokenRepositorySchema = EffectSchema.Struct({
  fullName: githubRepositoryFullNameSchema,
  addedBy: EffectSchema.String,
  addedAt: countedNumber,
  removable: EffectSchema.Boolean,
});

export type WorkspaceTokenRepository = typeof workspaceTokenRepositorySchema.Type;

export const workspaceTokenRepositoriesAnswerSchema = EffectSchema.Struct({
  repositories: EffectSchema.Array(workspaceTokenRepositorySchema),
});

export type WorkspaceTokenRepositoriesAnswer = typeof workspaceTokenRepositoriesAnswerSchema.Type;

export const githubPullRequestNumberSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
);

export const githubPullRequestSummarySchema = EffectSchema.Struct({
  number: githubPullRequestNumberSchema,
  title: EffectSchema.String,
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
  author: EffectSchema.optionalKey(EffectSchema.String),
  authorAvatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  authorBot: EffectSchema.optionalKey(EffectSchema.Boolean),
  additions: EffectSchema.optionalKey(countedNumber),
  deletions: EffectSchema.optionalKey(countedNumber),
  changedFiles: EffectSchema.optionalKey(countedNumber),
  openedAt: EffectSchema.optionalKey(countedNumber),
  mergedAt: EffectSchema.optionalKey(countedNumber),
  closedAt: EffectSchema.optionalKey(countedNumber),
  baseRef: EffectSchema.optionalKey(EffectSchema.String),
  headRef: EffectSchema.optionalKey(EffectSchema.String),
  labels: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({ name: EffectSchema.String, color: EffectSchema.String }),
    ),
  ),
  comments: EffectSchema.optionalKey(countedNumber),
  commits: EffectSchema.optionalKey(countedNumber),
  queued: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type GitHubPullRequestSummary = typeof githubPullRequestSummarySchema.Type;

export const githubRepositoryPullRequestAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(githubPullRequestSummarySchema),
});

export type GitHubRepositoryPullRequestAnswer = typeof githubRepositoryPullRequestAnswerSchema.Type;

export const ISSUE_STATE = {
  OPEN: "open",
  CLOSED: "closed",
  NOT_PLANNED: "not-planned",
} as const;

export type IssueState = (typeof ISSUE_STATE)[keyof typeof ISSUE_STATE];

export const githubIssueSummarySchema = EffectSchema.Struct({
  number: githubPullRequestNumberSchema,
  title: EffectSchema.String,
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(ISSUE_STATE)),
  author: EffectSchema.optionalKey(EffectSchema.String),
  authorAvatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  authorBot: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type GitHubIssueSummary = typeof githubIssueSummarySchema.Type;

export const githubRepositoryIssueAnswerSchema = EffectSchema.Struct({
  issue: EffectSchema.NullOr(githubIssueSummarySchema),
});

export type GitHubRepositoryIssueAnswer = typeof githubRepositoryIssueAnswerSchema.Type;
