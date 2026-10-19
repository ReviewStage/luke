import { Schema as EffectSchema } from "effect";
import { PULL_REQUEST_STATE } from "./coding-agent-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * github-repositories-wire.ts -- the repositories a signed-in developer reaches through the Luke GitHub App, as the desktop reads them.
 *
 * The service reads them from GitHub on the developer's own token the moment
 * they are asked for, and stores none of them: what travels is each
 * repository's names, its default branch, whether it is private, and when
 * GitHub last saw it change, with whether the developer has installed the
 * App anywhere at all and where to send them to install it. A repository is
 * named everywhere by its full name, `owner/name` as GitHub spells it, which
 * is the one form a plan stores and a coding agent checks out. One pull
 * request of such a repository is read the same way, by its number, and
 * travels as no more than a link to it draws: its number, title, page,
 * where it stands, its author, its size, its age, its branches, its labels,
 * and its comment and commit counts; and so is one issue,
 * by its number, open, closed as
 * done, or closed as not planned. And the issues New task's picker offers of
 * a repository: its open issues newest changed first, those a search finds,
 * or the one a number names, each with who opened it and how GitHub says
 * they stand to the repository, or why none can be read where the
 * installation has not granted the App issues.
 */

const GITHUB_REPOSITORY_BOUNDS = {
  /** GitHub's own bound on an owner's login. */
  MAX_OWNER_CHARS: 39,
  /** GitHub's own bound on a repository's name. */
  MAX_NAME_CHARS: 100,
} as const;

/**
 * `owner/name`: a login, which GitHub spells in letters, digits, and single
 * hyphens between them, one slash, and a name in letters, digits, dots,
 * underscores, and hyphens, which GitHub never lets be `.` or `..`. Nothing
 * else, so a path cannot ride in a repository's name.
 */
const FULL_NAME_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u;

/** A repository's full name as the wire takes it: trimmed, and held to GitHub's own shape and bounds. */
export const githubRepositoryFullNameSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(
    GITHUB_REPOSITORY_BOUNDS.MAX_OWNER_CHARS + 1 + GITHUB_REPOSITORY_BOUNDS.MAX_NAME_CHARS,
  ),
  EffectSchema.isPattern(FULL_NAME_PATTERN),
);

/** One repository the App reaches for the developer. */
export const githubRepositorySchema = EffectSchema.Struct({
  /** The user or organization that owns it. */
  owner: EffectSchema.String,
  name: EffectSchema.String,
  /** `owner/name` as GitHub spells it. */
  fullName: githubRepositoryFullNameSchema,
  defaultBranch: EffectSchema.String,
  private: EffectSchema.Boolean,
  /** Epoch milliseconds GitHub last saw the repository change. */
  updatedAt: countedNumber,
});

export type GitHubRepository = typeof githubRepositorySchema.Type;

/**
 * The queries a repositories read names: the workspace a listing is for,
 * since a workspace of a GitHub App installation lists only that
 * installation's repositories; for a read of one repository's tree, skills,
 * or pull request, the repository, `owner/name`; for the pull request's,
 * its number; and for its issues, the words searched for or the number of
 * the one asked.
 */
export const GITHUB_REPOSITORIES_QUERY = {
  WORKSPACE_ID: "workspaceId",
  REPOSITORY: "repository",
  NUMBER: "number",
  /** The words an issues read searches for. */
  QUERY: "query",
} as const;

/** The repositories (GET): every one the App reaches for the developer, or for the workspace named, most recently updated first. */
export const githubRepositoriesAnswerSchema = EffectSchema.Struct({
  /** Whether the developer reaches any installation of the App at all; false is "Install Luke on GitHub". */
  installed: EffectSchema.Boolean,
  repositories: EffectSchema.Array(githubRepositorySchema),
  /** Where to send the developer to install the App, or to change which repositories it reaches. */
  installationUrl: EffectSchema.String,
});

export type GitHubRepositoriesAnswer = typeof githubRepositoriesAnswerSchema.Type;

/** A pull request's number as the wire takes it: GitHub numbers a repository's issues and pull requests from one. */
export const githubPullRequestNumberSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
);

/**
 * One pull request of a repository as a link to it is drawn: its number,
 * its title, its own page on GitHub, and where it stands, merged before
 * closed and draft before open, as an agent's pill reads it; and who
 * opened it, its size, its age, its branches, its labels, and its comment
 * and commit counts, as GitHub counts them, none of which an older service
 * answers, so a link it read draws none of them.
 */
export const githubPullRequestSummarySchema = EffectSchema.Struct({
  number: githubPullRequestNumberSchema,
  title: EffectSchema.String,
  /** The pull request's own page on GitHub. */
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
  /** The GitHub login of who opened it; absent where GitHub named none, and from a service older than it. */
  author: EffectSchema.optionalKey(EffectSchema.String),
  /** Their avatar, where GitHub's avatar host serves it, and whether they are an App's bot. */
  authorAvatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  authorBot: EffectSchema.optionalKey(EffectSchema.Boolean),
  additions: EffectSchema.optionalKey(countedNumber),
  deletions: EffectSchema.optionalKey(countedNumber),
  /** How many files it changes. */
  changedFiles: EffectSchema.optionalKey(countedNumber),
  /** When it was opened, and when it was merged or closed where it was, as epoch milliseconds. */
  openedAt: EffectSchema.optionalKey(countedNumber),
  mergedAt: EffectSchema.optionalKey(countedNumber),
  closedAt: EffectSchema.optionalKey(countedNumber),
  /** The branch it merges into, and the branch it merges from. */
  baseRef: EffectSchema.optionalKey(EffectSchema.String),
  headRef: EffectSchema.optionalKey(EffectSchema.String),
  /** Its labels, each by its name and its colour as GitHub's six hex digits with no `#`. */
  labels: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({ name: EffectSchema.String, color: EffectSchema.String }),
    ),
  ),
  /** How many comments it holds, on its conversation and its diff together, and how many commits. */
  comments: EffectSchema.optionalKey(countedNumber),
  commits: EffectSchema.optionalKey(countedNumber),
});

export type GitHubPullRequestSummary = typeof githubPullRequestSummarySchema.Type;

/**
 * One pull request of a repository a workspace's installation reaches
 * (GET), by its number: null where the repository holds none of that
 * number, or where the installation does not reach the repository, which
 * the answer does not tell apart, since a link to either draws the same.
 */
export const githubRepositoryPullRequestAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(githubPullRequestSummarySchema),
});

export type GitHubRepositoryPullRequestAnswer = typeof githubRepositoryPullRequestAnswerSchema.Type;

/**
 * Where an issue stands, as GitHub draws its mark: open, closed as done,
 * or closed as not planned, which a duplicate is closed as too, under the
 * same grey mark.
 */
export const ISSUE_STATE = {
  OPEN: "open",
  CLOSED: "closed",
  NOT_PLANNED: "not-planned",
} as const;

export type IssueState = (typeof ISSUE_STATE)[keyof typeof ISSUE_STATE];

/** One issue of a repository as a link to it is drawn: its number, its title, its own page on GitHub, and where it stands. */
export const githubIssueSummarySchema = EffectSchema.Struct({
  number: githubPullRequestNumberSchema,
  title: EffectSchema.String,
  /** The issue's own page on GitHub. */
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(ISSUE_STATE)),
  /** The GitHub login of who opened it; absent where GitHub named none, and from a service older than it. */
  author: EffectSchema.optionalKey(EffectSchema.String),
  /** Their avatar, where GitHub's avatar host serves it, and whether they are an App's bot. */
  authorAvatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  authorBot: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type GitHubIssueSummary = typeof githubIssueSummarySchema.Type;

/**
 * One issue of a repository a workspace's installation reaches (GET), by
 * its number: null where the repository holds no issue of that number, a
 * pull request's number among them, where its issues are turned off, where
 * the installation does not reach the repository, or where it does not
 * grant the App issues read, which the answer does not tell apart, since a
 * link to any of them draws the same.
 */
export const githubRepositoryIssueAnswerSchema = EffectSchema.Struct({
  issue: EffectSchema.NullOr(githubIssueSummarySchema),
});

export type GitHubRepositoryIssueAnswer = typeof githubRepositoryIssueAnswerSchema.Type;

/** GitHub's own host, whose `/<owner>/<name>/pull/<number>` pages are its pull requests and `/<owner>/<name>/issues/<number>` its issues. */
const GITHUB_HOST = "github.com";

/** The step before a numbered page's number in its path: a pull request's, or an issue's. */
const NUMBERED_STEP = { PULL: "pull", ISSUES: "issues" } as const;

type NumberedStep = (typeof NUMBERED_STEP)[keyof typeof NUMBERED_STEP];

/** A pull request's or an issue's number as its page's path spells it: whole, from one. */
const PAGE_NUMBER = /^[1-9]\d{0,8}$/u;

/** A pull request or an issue a page's address names: its repository, `owner/name`, and its number. */
export interface NumberedAddress {
  readonly repository: string;
  readonly number: number;
}

/** The repository and number a page of GitHub's under the step given names; nothing for any other address. */
function numberedAddressOf(href: string, wanted: NumberedStep): NumberedAddress | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.hostname !== GITHUB_HOST) return undefined;
  const [first, owner, name, step, number] = url.pathname.split("/");
  if (first !== "" || owner === undefined || name === undefined || step !== wanted) {
    return undefined;
  }
  if (number === undefined || !PAGE_NUMBER.test(number)) return undefined;
  const repository = `${owner}/${name}`;
  return EffectSchema.is(githubRepositoryFullNameSchema)(repository)
    ? { repository, number: Number(number) }
    : undefined;
}

/**
 * The pull request a page of GitHub's is, `acme/relay` and `42` from
 * `https://github.com/acme/relay/pull/42` or any page under it, its Files
 * tab say; nothing for any other address, another of GitHub's pages among
 * them.
 */
export function pullRequestAddressOf(href: string): NumberedAddress | undefined {
  return numberedAddressOf(href, NUMBERED_STEP.PULL);
}

/**
 * The issue a page of GitHub's is, `acme/relay` and `7` from
 * `https://github.com/acme/relay/issues/7`; nothing for any other address,
 * the repository's list of issues among them.
 */
export function issueAddressOf(href: string): NumberedAddress | undefined {
  return numberedAddressOf(href, NUMBERED_STEP.ISSUES);
}

/** The bounds of a read of a repository's issues for New task's picker. */
export const GITHUB_ISSUES_BOUNDS = {
  /** The most characters a search may spell. */
  MAX_QUERY_CHARS: 200,
  /** The most issues one read answers. */
  MAX_ISSUES: 50,
  /** The most characters an issue's node id may spell; GitHub's are short and opaque. */
  MAX_NODE_ID_CHARS: 100,
} as const;

/**
 * How GitHub says who opened an issue stands to its repository
 * (`author_association`): its owner, a member of the organization that owns
 * it, or a collaborator on it, who are inside; and anyone else, who is not.
 */
export const GITHUB_AUTHOR_ASSOCIATION = {
  OWNER: "OWNER",
  MEMBER: "MEMBER",
  COLLABORATOR: "COLLABORATOR",
  CONTRIBUTOR: "CONTRIBUTOR",
  FIRST_TIME_CONTRIBUTOR: "FIRST_TIME_CONTRIBUTOR",
  FIRST_TIMER: "FIRST_TIMER",
  MANNEQUIN: "MANNEQUIN",
  NONE: "NONE",
} as const;

/** The associations of someone inside the repository, whose words an agent may read as a teammate's. */
const INSIDE_ASSOCIATIONS: ReadonlySet<string> = new Set([
  GITHUB_AUTHOR_ASSOCIATION.OWNER,
  GITHUB_AUTHOR_ASSOCIATION.MEMBER,
  GITHUB_AUTHOR_ASSOCIATION.COLLABORATOR,
]);

/**
 * Whether an issue was opened by someone outside its repository: anyone
 * GitHub names neither its owner, a member, nor a collaborator, a value
 * GitHub adds later among them, since an agent that can push reads it.
 */
export function isOutsideAuthor(association: string): boolean {
  return !INSIDE_ASSOCIATIONS.has(association);
}

/** A GitHub issue's node id, which survives a rename or a transfer of its repository. */
export const githubIssueNodeIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(GITHUB_ISSUES_BOUNDS.MAX_NODE_ID_CHARS),
);

/** One issue as New task's picker lists it: what a person picks it by, and who opened it. */
export const githubIssuePickSchema = EffectSchema.Struct({
  nodeId: githubIssueNodeIdSchema,
  /** `owner/name` as GitHub spells it. */
  repository: githubRepositoryFullNameSchema,
  number: githubPullRequestNumberSchema,
  title: EffectSchema.String,
  /** The issue's own page on GitHub. */
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(ISSUE_STATE)),
  /** The login of who opened it; absent where their account is gone. */
  author: EffectSchema.optionalKey(EffectSchema.String),
  /** How GitHub says they stand to the repository, `GITHUB_AUTHOR_ASSOCIATION`'s, kept as GitHub spells it. */
  authorAssociation: EffectSchema.String,
  /** Epoch milliseconds GitHub last saw it change. */
  updatedAt: countedNumber,
});

export type GitHubIssuePick = typeof githubIssuePickSchema.Type;

/**
 * A repository's issues as New task's picker reads them (GET), by the
 * workspace whose installation reaches it: its open issues newest changed
 * first, those GitHub's search finds for the words where `query` names
 * some, or the one issue `number` names, none where it is a pull request's
 * or holds none; a repository the installation does not reach has none.
 * An installation that has not granted the App issues answers
 * `ungranted` instead of an empty list, with where on GitHub its owner
 * grants them, since nothing can be read until they do.
 */
export const githubRepositoryIssuesAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    issues: EffectSchema.Array(githubIssuePickSchema).check(
      EffectSchema.isMaxLength(GITHUB_ISSUES_BOUNDS.MAX_ISSUES),
    ),
  }),
  EffectSchema.Struct({
    ungranted: EffectSchema.Struct({
      /** The installation's own settings page on GitHub. */
      settingsUrl: EffectSchema.String,
    }),
  }),
]);

export type GitHubRepositoryIssuesAnswer = typeof githubRepositoryIssuesAnswerSchema.Type;

/** What a read of a repository's issues asks: the one issue numbered, else those the words find, else its open issues. */
export interface RepositoryIssuesAsk {
  readonly query?: string;
  readonly number?: number;
}

/** An issue of a repository words name: its repository, `owner/name`, and its number. */
export interface GitHubIssueRef {
  readonly repository: string;
  readonly number: number;
}

/** `owner/name#N`, or `#N` alone, typed whole; neither part holds a slash, so the match never backtracks over one. */
const ISSUE_REF = /^(?:([^\s#/]{1,39}\/[^\s#/]{1,100}))?#([1-9]\d{0,8})$/u;

/**
 * The issue words typed or pasted name whole: a link to one of GitHub's
 * issue pages, `owner/name#N`, or `#N` alone, which names an issue of the
 * repository given and nothing where none is; nothing for any other words.
 */
export function githubIssueRefIn(
  typed: string,
  repository: string | null,
): GitHubIssueRef | undefined {
  const words = typed.trim();
  const linked = issueAddressOf(words);
  if (linked !== undefined) return linked;
  const named = ISSUE_REF.exec(words);
  if (named === null) return undefined;
  const [, owner, number] = named;
  const place = owner ?? repository ?? undefined;
  if (place === undefined || !EffectSchema.is(githubRepositoryFullNameSchema)(place)) {
    return undefined;
  }
  return { repository: place, number: Number(number) };
}
