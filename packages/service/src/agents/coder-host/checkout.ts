import type { DatabaseServices } from "@repo/database/core/query";
import { readAccountPreferences } from "@repo/database/models/account-store";
import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import {
  type Agent,
  settleAgentAuthor,
  type WithRepository,
} from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_AUTHOR, type AgentAuthor } from "@repo/features/agent-wire";
import type { CheckoutIdentity } from "@repo/features/checkout-identity";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { automationRun } from "@repo/features/model-label";
import {
  appAuthors,
  COMMIT_AUTHOR_DEFAULT,
  type CommitAuthor,
  coAuthorCredited,
} from "@repo/settings";
import { Data, Effect, Option, type Redacted, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  type GitHubTokenAccess,
  type GitHubUser,
  noreplyAddress,
  REPOSITORY_SET_UNREACHED,
} from "../../github/github-app.js";
import {
  agentMember,
  agentWorkspace as workspaceOfAgent,
} from "../../github/workspace-repository.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { extraCheckoutPaths, REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import {
  cloneExtraRepository,
  cloneRepository,
  deepenRepository,
  REPOSITORY_REFUSAL,
  type RepositoryRefusal,
  type RepositorySandbox,
  refreshRepository,
  runInSandbox,
  SHALLOW_CLONE_DEPTH,
  setCheckoutIdentity,
} from "../repository-shell.js";
import { FIREWALL_SLOT, githubEntry, type RepositoryCredential } from "../sandbox-firewall.js";
import { CODER, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";

/**
 * checkout.ts -- a coding agent's checkout of its repository, whose commits are, and the credential its sandbox pushes through.
 *
 * The agent's repository is checked out in two steps. As its sandbox opens,
 * it is checked out on the same terms as the brain's checkout
 * (`repository-shell.ts`): the installation of its task's workspace is
 * confirmed to reach it and a read token minted for that one repository,
 * set at the sandbox's firewall for the clone alone and withdrawn after it.
 * A native harness's clone is whole, since it deepens at once, or is no
 * clone at all where its workspace's repository snapshot opened the sandbox
 * on a checkout already made, which is fetched up to the branch instead
 * (`refreshAgentCheckout`, `repository-snapshot.ts`).
 * The launch then deepens it (`deepenCheckoutWith`): a write token is
 * minted, carrying contents and pull requests write, since the agent pushes
 * a branch and opens a pull request from it, and set at the firewall for
 * the fetch of the rest of the history alone, since a branch and a pull
 * request are cut from it; the commit identity is set; and the token is
 * handed back for the authored file to set at the firewall for the
 * session's own commands, in the shape `githubEntry` gives it
 * (`../sandbox-firewall.ts`), which is where `gh` and `git push` reach
 * GitHub; it never enters the sandbox's filesystem or environment. An installation token is good for an hour, so
 * the host mints another on the same terms when the session's step hook
 * finds the one standing old. No developer's sign-in token ever stands at
 * the firewall. Where only its starter's own classic token reaches the
 * repository (`agent.githubAccess`), that token is the agent's credential:
 * set on the repository's own git and REST paths alone, taken off as each
 * turn ends, and set again as the next begins.
 *
 * Who the agent writes as is settled once, as its first session starts, and
 * kept on its row (`AGENT_AUTHOR`), so the instructions that session
 * runs under and the checkout agree for the agent's life. An agent a
 * developer started by hand writes as that developer where
 * they signed in with GitHub, their own account may push to the
 * repository, and their Commit author choice (`@repo/settings`'s
 * `COMMIT_AUTHOR`) has them author: its commits are authored as their GitHub account, at the
 * noreply address GitHub links to it, each ending on a trailer that names
 * the App's bot as co-author where the choice credits it, which is how Claude Code names itself beside
 * the person it worked for, and its pull request is opened as them by the
 * service (`pull-request.ts`). An agent an automation started writes as the
 * App's bot, since no developer's hand started it, and so does one whose
 * developer chose the bot, has no GitHub sign-in, or may not push, the row
 * saying why; where the developer chose the bot with themselves credited,
 * the trailer names their GitHub account. An
 * agent on its starter's own token writes as the account the token belongs
 * to, read on it, with the bot's trailer where the choice credits it, since
 * the App does not reach its repository, and its pull request is opened on
 * that token alone. Whether a trailer is written is read from the choice
 * as each session starts, so a change takes from the agent's next session,
 * while who authors stays as it was settled. The
 * identity is set here, as the checkout opens, and never by the model,
 * whose instructions say so; a device's checkout is the Mac's to make, so
 * its launch line carries the same identity, read the same way
 * (`agentCommitIdentity`), for the Mac to set by the same step.
 *
 * The agent publishes through `git` and `gh` of its own, so what it
 * published is read off the checkout rather than guessed: the branch
 * checked out as a turn ends is the one its pull request is on, whatever
 * branches it cut, switched, or deleted on the way, and the session's
 * turn-end hook writes it on the agent's row through the host.
 *
 * An agent with no repository has none of this: no clone, no token, and no
 * identity, only an empty working folder where the checkout would stand.
 */

/** Why the checkout or a mint ran nothing, in the host's own words, and what the sandbox's run said where it threw (`RepositoryRefusal`'s `detail`). */
export class CheckoutRefused extends Data.TaggedError("CheckoutRefused")<{
  readonly reason: CoderRefusal | string;
  readonly detail?: string | undefined;
}> {}

/** What a mint or a checkout may reach: GitHub through the App, and the store for the workspace's installation. */
export type CheckoutServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/** A read of the workspace's installation that failed, in the host's word for it: GitHub not answering. */
function refusedBy(): CheckoutRefused {
  return new CheckoutRefused({ reason: CODER_REFUSAL.GITHUB_UNAVAILABLE });
}

/** The agent's workspace, whose installation its repository is reached through; none where its starter no longer reaches it. */
function agentWorkspace(target: ConversationTarget, agent: Agent) {
  return workspaceOfAgent(target.userId, agent);
}

/** An account as a commit names it: the name it set, or its login, at the noreply address GitHub links to it. */
function identityOf(user: GitHubUser): CheckoutIdentity {
  return { name: user.name ?? user.login, email: noreplyAddress(user) };
}

/** The starter's Commit author choice, as their preferences hold it; the default where they never chose. */
const commitAuthorOf = (userId: string) =>
  Effect.map(
    readAccountPreferences(userId),
    (row) => row?.preferences.commitAuthor ?? COMMIT_AUTHOR_DEFAULT,
  );

/**
 * Who the agent writes as, read now: the App's bot for an agent an
 * automation started; its starter's own token for an agent on it; the
 * App's bot where the starter chose it; the developer where their GitHub
 * sign-in may push to the repository; the App's bot otherwise, with why. A
 * GitHub that would not answer is the App's bot too, since an agent's start
 * does not wait on it, and only the store's failure is the caller's.
 */
const readAuthor = /* @__PURE__ */ Effect.fn("web/agentReadAuthor")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<AgentAuthor, StoreFailure, CheckoutServices> {
  if (automationRun(agent) !== undefined) return AGENT_AUTHOR.APP_AUTOMATION;
  if (agent.githubAccess === GITHUB_ACCESS.TOKEN) return AGENT_AUTHOR.TOKEN;
  if (appAuthors(yield* commitAuthorOf(target.userId))) return AGENT_AUTHOR.APP_CHOSEN;
  const app = yield* GitHubApp;
  return yield* app.userPusher(target.userId, agent.repository).pipe(
    Effect.map((pusher) =>
      Option.isSome(pusher) ? AGENT_AUTHOR.DEVELOPER : AGENT_AUTHOR.APP_NO_PUSH,
    ),
    Effect.catchTag("GitHubSignInRequired", () => Effect.succeed(AGENT_AUTHOR.APP_UNLINKED)),
    // Note that GitHub refusing the token outright is a sign-in it no longer honors, whatever the row says.
    Effect.catchTag("GitHubUnavailable", (failure) =>
      Effect.succeed(
        failure.status === GITHUB_HTTP_STATUS.UNAUTHORIZED
          ? AGENT_AUTHOR.APP_UNLINKED
          : AGENT_AUTHOR.APP_UNREAD,
      ),
    ),
    Effect.catchTag("GitHubAppNotConfigured", () => Effect.succeed(AGENT_AUTHOR.APP_UNREAD)),
  );
});

/**
 * Who the agent writes as: the author its row holds, or, on its first
 * session, the one read now and settled on the row, which answers the one
 * standing where another session settled it first.
 */
const agentAuthor = /* @__PURE__ */ Effect.fn("web/agentAuthor")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<AgentAuthor, StoreFailure, CheckoutServices> {
  if (agent.author !== null) return agent.author;
  const read = yield* readAuthor(target, agent);
  const settled = yield* settleAgentAuthor(target.userId, agent.id, read);
  return Option.getOrElse(settled, () => read);
});

/** Who an agent's commits are by, as its instructions tell it. */
export const COMMIT_BY = {
  DEVELOPER: "developer",
  APP: "app",
} as const;

export type CommitBy = (typeof COMMIT_BY)[keyof typeof COMMIT_BY];

/** Whose the agent's commits are, and the trailer naming the other as co-author, where the starter's choice credits one. */
export interface CommitAuthorship {
  readonly by: CommitBy;
  readonly coAuthor: string | undefined;
}

/** A trailer crediting an account as a commit's co-author. */
function coAuthorTrailer(identity: CheckoutIdentity): string {
  return `Co-authored-by: ${identity.name} <${identity.email}>`;
}

/**
 * The trailer the agent's commits end on, for the author settled and the
 * starter's choice read now: the App's bot where the agent writes as its
 * developer, through their sign-in or their own token, which the bot is read
 * on; the developer's GitHub account where they chose the bot to author;
 * none where the choice credits no one, and none for an agent the bot
 * writes for any other reason.
 */
const coAuthorOf = /* @__PURE__ */ Effect.fn("web/agentCoAuthorOf")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  author: AgentAuthor,
  choice: CommitAuthor,
) {
  if (!coAuthorCredited(choice)) return undefined;
  const app = yield* GitHubApp;
  if (author === AGENT_AUTHOR.APP_CHOSEN) {
    const token = yield* app.userToken(target.userId);
    return coAuthorTrailer(identityOf(yield* app.tokenUser(token)));
  }
  if (author !== AGENT_AUTHOR.DEVELOPER && author !== AGENT_AUTHOR.TOKEN) return undefined;
  // Note that an agent on its starter's own token reads the bot on that token, which stands where their sign-in may not.
  const token =
    author === AGENT_AUTHOR.TOKEN
      ? (yield* agentRepositoryToken(target, agent)).token
      : yield* app.userToken(target.userId);
  const bot = yield* app.appBot(token);
  return coAuthorTrailer({ name: bot.login, email: noreplyAddress(bot) });
});

/**
 * Whose the agent's commits are and the trailer they end on, told to the
 * session as it starts: the developer's where it writes as them, through
 * their sign-in or their own token, and the App's bot's otherwise. A read
 * that fails is logged rather than failing the start: an author unread
 * answers the bot's, as the checkout falls back to it, and a trailer
 * unread answers none.
 */
export const agentAuthorship = /* @__PURE__ */ Effect.fn("web/agentAuthorship")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<CommitAuthorship, never, CheckoutServices> {
  const unread = (what: string) => (failure: { readonly _tag: string }) =>
    Effect.logWarning(
      `The ${what} of conversation ${target.conversationId}'s commits was not read: ${failure._tag}`,
    );
  const author = yield* agentAuthor(target, agent).pipe(
    Effect.tapError(unread("author")),
    Effect.option,
  );
  if (Option.isNone(author)) return { by: COMMIT_BY.APP, coAuthor: undefined };
  const by =
    author.value === AGENT_AUTHOR.DEVELOPER || author.value === AGENT_AUTHOR.TOKEN
      ? COMMIT_BY.DEVELOPER
      : COMMIT_BY.APP;
  const coAuthor = yield* Effect.flatMap(commitAuthorOf(target.userId), (choice) =>
    coAuthorOf(target, agent, author.value, choice),
  ).pipe(
    Effect.tapError(unread("co-author")),
    Effect.orElseSucceed(() => undefined),
  );
  return { by, coAuthor };
});

/**
 * Whether the agent's token will read its pull request's CI: the
 * installation of its task's workspace grants the App the read (`github-app.ts`'s `CI_READ_PERMISSIONS`). Told to the session
 * as it starts, so a read that fails is logged and reads as not readable
 * rather than failing the start: the checkout refuses on its own terms when
 * the sandbox opens.
 */
export const agentCiReadable = /* @__PURE__ */ Effect.fn("web/agentCiReadable")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<boolean, never, CheckoutServices> {
  const app = yield* GitHubApp;
  return yield* Effect.gen(function* () {
    const workspace = yield* agentWorkspace(target, agent);
    if (Option.isNone(workspace)) return false;
    return yield* app.repositoryCiReadable(workspace.value, agent.repository, agentMember(agent));
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `Whether conversation ${target.conversationId} reads its CI was not read: ${failure._tag}`,
        ),
        false,
      ),
    ),
  );
});

/**
 * A write token for the agent's repository, minted as the App where the
 * installation of its task's workspace still reaches the repository, with
 * the repository as GitHub spells it. An agent that works in other
 * repositories beside its own (`readAgentRepositories`) is minted one token
 * for them all, on the one installation that reaches them
 * (`repositoriesWriteToken`), its own repository still the one answered;
 * refused as not reachable, naming the first repository the token does not
 * reach, where one is no longer reached, is reached only on its starter's
 * token, or moved to another installation since it started. Note that an
 * agent in one repository is minted as it always was.
 */
export const agentRepositoryToken = /* @__PURE__ */ Effect.fn("web/agentRepositoryToken")(
  function* (
    target: ConversationTarget,
    agent: WithRepository<Agent>,
  ): Effect.fn.Return<
    {
      readonly token: Redacted.Redacted;
      readonly defaultBranch: string;
      readonly fullName: string;
      /** Whose the token is: the App's, or the starter's own with their GitHub login. */
      readonly access: GitHubTokenAccess;
    },
    CheckoutRefused,
    CheckoutServices
  > {
    const app = yield* GitHubApp;
    const repositories = yield* readAgentRepositories(target.userId, agent.id).pipe(
      Effect.mapError(refusedBy),
    );
    if (repositories.length > 1) {
      return yield* agentRepositoriesToken(
        target,
        agent,
        repositories.map((each) => each.repository),
      );
    }
    const reached = yield* Effect.gen(function* () {
      const workspace = yield* agentWorkspace(target, agent);
      if (Option.isNone(workspace)) return Option.none();
      return yield* app.repositoryWriteToken(workspace.value, agent.repository, agentMember(agent));
    }).pipe(Effect.mapError(refusedBy));
    if (Option.isNone(reached))
      return yield* new CheckoutRefused({ reason: CODER_REFUSAL.NOT_REACHABLE });
    const { repository, token, access } = reached.value;
    return {
      token,
      defaultBranch: repository.defaultBranch,
      fullName: repository.fullName,
      access,
    };
  },
);

/** The one write token for every repository the agent works in, its own first, as `agentRepositoryToken` mints it for an agent in several. */
const agentRepositoriesToken = Effect.fnUntraced(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  repositories: readonly string[],
) {
  const app = yield* GitHubApp;
  const minted = yield* Effect.gen(function* () {
    const workspace = yield* agentWorkspace(target, agent);
    if (Option.isNone(workspace)) return Option.none();
    return Option.some(
      yield* app.repositoriesWriteToken(workspace.value, repositories, agentMember(agent)),
    );
  }).pipe(Effect.mapError(refusedBy));
  if (Option.isNone(minted))
    return yield* new CheckoutRefused({ reason: CODER_REFUSAL.NOT_REACHABLE });
  if (Result.isFailure(minted.value)) {
    const refused = minted.value.failure;
    const repository =
      refused.why === REPOSITORY_SET_UNREACHED.UNREACHED
        ? refused.unreached.repository
        : refused.repository;
    return yield* new CheckoutRefused({
      reason: CODER_REFUSAL.NOT_REACHABLE,
      detail: `Not reached: ${repository}.`,
    });
  }
  const { repositories: reached, token, access } = minted.value.success;
  const [own] = reached;
  if (own === undefined) return yield* Effect.die("a set of repositories answered none");
  return { token, defaultBranch: own.defaultBranch, fullName: own.fullName, access };
});

/**
 * Who the checkout's commits are by: the developer's GitHub account where
 * the agent writes as them and that account still pushes to the repository,
 * the account a member's own token belongs to where the agent writes on it,
 * read on that token, and the App's bot otherwise, read on the token just
 * minted for the repository. Note that a developer whose push lapsed since
 * the agent started is said in the log and leaves the commits the bot's, as
 * does an agent on a token whose repository an installation reaches since.
 */
const commitIdentity = /* @__PURE__ */ Effect.fn("web/agentCommitIdentity")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  author: AgentAuthor,
  credential: RepositoryCredential,
): Effect.fn.Return<CheckoutIdentity, CheckoutRefused, CheckoutServices> {
  const app = yield* GitHubApp;
  if (author === AGENT_AUTHOR.TOKEN && credential.access.kind === GITHUB_ACCESS.TOKEN) {
    return identityOf(yield* app.tokenUser(credential.token).pipe(Effect.mapError(refusedBy)));
  }
  if (author === AGENT_AUTHOR.DEVELOPER) {
    const pusher = yield* Effect.option(app.userPusher(target.userId, agent.repository));
    const developer = Option.flatten(pusher);
    if (Option.isSome(developer)) return identityOf(developer.value.user);
    yield* Effect.logWarning(
      `The developer of conversation ${target.conversationId} no longer pushes to its repository; its commits are the App's`,
    );
  }
  const bot = yield* app.appBot(credential.token).pipe(Effect.mapError(refusedBy));
  return { name: bot.login, email: noreplyAddress(bot) };
});

/** Who the checkout's commits are by, on a token just minted for the repository: the agent's author settled, then the account it names (`commitIdentity`). */
const identityOn = (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  credential: RepositoryCredential,
) =>
  Effect.flatMap(agentAuthor(target, agent), (author) =>
    commitIdentity(target, agent, author, credential),
  );

/** A refusal of the repository's shell, as the checkout's own. */
function refusedWith(failure: RepositoryRefusal): CheckoutRefused {
  return new CheckoutRefused({ reason: failure.reason, detail: failure.detail });
}

/** The agent's repository as its workspace reaches it: the workspace, the repository as GitHub spells it, its default branch, and a read token with whose it is. */
export interface AgentRepositoryRead {
  readonly workspaceId: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/**
 * The agent's repository as its workspace reaches it now: the workspace, the
 * repository as GitHub spells it with its default branch, and a read token
 * for that one repository with whose it is; refused as not reachable where
 * neither the workspace's installation nor the starter's own token reaches
 * it, and as GitHub unavailable where GitHub did not say.
 */
export const agentRepositoryRead = /* @__PURE__ */ Effect.fn("web/agentRepositoryRead")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<AgentRepositoryRead, CheckoutRefused, CheckoutServices> {
  const app = yield* GitHubApp;
  // Note that a store that could not be read refuses as GitHub unavailable.
  const workspace = yield* agentWorkspace(target, agent).pipe(Effect.mapError(refusedBy));
  if (Option.isNone(workspace))
    return yield* new CheckoutRefused({ reason: CODER_REFUSAL.NOT_REACHABLE });
  const reached = yield* app
    .repositoryReadToken(workspace.value, agent.repository, agentMember(agent))
    .pipe(Effect.mapError(refusedBy));
  if (Option.isNone(reached))
    return yield* new CheckoutRefused({ reason: CODER_REFUSAL.NOT_REACHABLE });
  const { repository, token, access } = reached.value;
  return {
    workspaceId: workspace.value,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    token,
    access,
  };
});

/** A repository the agent works in beside its own, as its workspace reaches it: the repository as GitHub spells it, the branch its checkout is cloned at, the folder it is cloned into, and a read token for it with whose it is. */
export interface AgentExtraRead {
  readonly fullName: string;
  readonly branch: string;
  readonly path: string;
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/**
 * The repositories the agent works in beside its own (`readAgentRepositories`),
 * each as its workspace reaches it now, with a read token for that one
 * repository, the branch it was named at or its default branch, and the
 * folder it is cloned into (`extraCheckoutPaths`); none for an agent in one
 * repository, which reads nothing of GitHub. Refused as not reachable,
 * naming the repository, where one is no longer reached.
 */
export const agentExtraReads = /* @__PURE__ */ Effect.fn("web/agentExtraReads")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<readonly AgentExtraRead[], CheckoutRefused, CheckoutServices> {
  const [, ...extras] = yield* readAgentRepositories(target.userId, agent.id).pipe(
    Effect.mapError(refusedBy),
  );
  if (extras.length === 0) return [];
  const app = yield* GitHubApp;
  const workspace = yield* agentWorkspace(target, agent).pipe(Effect.mapError(refusedBy));
  if (Option.isNone(workspace))
    return yield* new CheckoutRefused({ reason: CODER_REFUSAL.NOT_REACHABLE });
  const paths = extraCheckoutPaths(extras.map((each) => each.repository));
  return yield* Effect.forEach(
    extras,
    (extra, index) =>
      Effect.gen(function* () {
        const reached = yield* app
          .repositoryReadToken(workspace.value, extra.repository, agentMember(agent))
          .pipe(Effect.mapError(refusedBy));
        if (Option.isNone(reached)) {
          return yield* new CheckoutRefused({
            reason: CODER_REFUSAL.NOT_REACHABLE,
            detail: `Not reached: ${extra.repository}.`,
          });
        }
        const { repository, token, access } = reached.value;
        const read: AgentExtraRead = {
          fullName: repository.fullName,
          branch: extra.baseBranch ?? repository.defaultBranch,
          path: paths[index] ?? REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE,
          token,
          access,
        };
        return read;
      }),
    { concurrency: "unbounded" },
  );
});

/**
 * The repositories the agent works in beside its own cloned whole into
 * their folders, on the reads the caller made of them, one after another,
 * since each clone's token stands in the one slot the firewall keeps for a
 * clone (`underCloneCredential`); nothing for an agent with none.
 */
export const cloneAgentExtras = /* @__PURE__ */ Effect.fn("web/cloneAgentExtras")(function* (
  sandbox: RepositorySandbox,
  reads: readonly AgentExtraRead[],
): Effect.fn.Return<void, CheckoutRefused> {
  for (const read of reads) {
    yield* cloneExtraRepository(
      sandbox,
      { fullName: read.fullName, branch: read.branch, folder: read.path.split("/").pop() ?? "" },
      read.token,
      read.access,
    ).pipe(Effect.mapError(refusedWith));
  }
});

/** How deep an agent's checkout is cloned: one commit for eve's, whose first write deepens it, or whole for a native harness's, deepened at once anyway. */
export const CHECKOUT_DEPTH = {
  SHALLOW: "shallow",
  WHOLE: "whole",
} as const;

export type CheckoutDepthChoice = (typeof CHECKOUT_DEPTH)[keyof typeof CHECKOUT_DEPTH];

/**
 * The agent's repository cloned into the sandbox on the read the caller
 * made of it, at the branch it was started on where its row names one and
 * at the default branch otherwise, the read token standing at the firewall
 * for the clone alone: one commit deep by default, or whole where the caller
 * asks, as a native harness's launch does, since it deepens at once and a
 * whole clone is fetched in half the time of a shallow one deepened. The
 * checkout is recorded under the name the agent's row holds. Nothing else
 * is set: no commit identity and no credential, which the deepen sets
 * (`deepenCheckoutWith`). Note that a start branch deleted since the start
 * fails the clone, which says so in git's own words.
 */
export const cloneAgentRepository = /* @__PURE__ */ Effect.fn("web/cloneAgentRepository")(
  function* (
    agent: WithRepository<Agent>,
    sandbox: RepositorySandbox,
    read: AgentRepositoryRead,
    depth: CheckoutDepthChoice = CHECKOUT_DEPTH.SHALLOW,
  ): Effect.fn.Return<void, CheckoutRefused> {
    yield* cloneRepository(
      sandbox,
      {
        fullName: read.fullName,
        defaultBranch: agent.startBranch ?? read.defaultBranch,
        recordedAs: agent.repository,
      },
      read.token,
      {
        ...(depth === CHECKOUT_DEPTH.SHALLOW ? { depth: SHALLOW_CLONE_DEPTH } : undefined),
        access: read.access,
      },
    ).pipe(Effect.mapError(refusedWith));
  },
);

/**
 * The checkout a repository snapshot opened the sandbox on brought up to the
 * repository's default branch, on the read the caller made of it, the token
 * at the firewall for the fetch alone, and recorded under the name the
 * agent's row holds; refused, in git's words, where the sandbox holds no
 * checkout of that repository or the fetch failed. As after a clone, no
 * identity and no credential is set (`deepenCheckoutWith`).
 */
export const refreshAgentCheckout = /* @__PURE__ */ Effect.fn("web/refreshAgentCheckout")(
  function* (
    agent: WithRepository<Agent>,
    sandbox: RepositorySandbox,
    read: AgentRepositoryRead,
  ): Effect.fn.Return<void, CheckoutRefused> {
    yield* refreshRepository(
      sandbox,
      { fullName: read.fullName, defaultBranch: read.defaultBranch, recordedAs: agent.repository },
      read.token,
      read.access,
    ).pipe(Effect.mapError(refusedWith));
  },
);

const MAKE_WORKING_FOLDER = `mkdir -p ${CODER.CHECKOUT_PATH}`;

/**
 * The empty folder an agent with no repository works in, made where a
 * checkout would stand, so its shell and its file reads start there as an
 * agent's with a repository do (`claude-code-sessions.ts`'s and
 * `codex-sessions.ts`'s `cwd`); refused where the
 * sandbox is gone or the folder could not be made. Nothing is cloned and no
 * credential is set at the firewall.
 */
export const openWorkingFolder = /* @__PURE__ */ Effect.fn("web/openWorkingFolder")(function* (
  sandbox: RepositorySandbox,
): Effect.fn.Return<void, CheckoutRefused> {
  const made = yield* runInSandbox(
    sandbox,
    { command: MAKE_WORKING_FOLDER, workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE },
    REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
  ).pipe(Effect.mapError(refusedWith));
  if (made.exitCode !== 0) {
    return yield* new CheckoutRefused({
      reason: `\`${MAKE_WORKING_FOLDER}\` exited ${made.exitCode}`,
    });
  }
});

/** What a deepen sets of GitHub's: the write token for the firewall, and who the commits are by. */
export interface AgentDeepenPlan {
  readonly credential: RepositoryCredential;
  readonly identity: CheckoutIdentity;
}

/**
 * What the deepen reads of GitHub, apart from the sandbox: a write token
 * minted and the commit identity read, so a launch that opens a sandbox
 * anyway reads them while its checkout is made (`runner-sessions.ts`).
 */
export const agentDeepenPlan = /* @__PURE__ */ Effect.fn("web/agentDeepenPlan")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<AgentDeepenPlan, CheckoutRefused | StoreFailure, CheckoutServices> {
  const minted = yield* agentRepositoryToken(target, agent);
  const identity = yield* identityOn(target, agent, minted);
  return {
    credential: { token: minted.token, fullName: minted.fullName, access: minted.access },
    identity,
  };
});

/**
 * Who the agent's commits are by, read as a cloud checkout's deepen reads it
 * (`agentDeepenPlan`), for a checkout this service sets no identity in
 * itself: a device's, which its launch line carries it to
 * (`machine/device-machine.ts`).
 */
export const agentCommitIdentity = /* @__PURE__ */ Effect.fn("web/agentCommitIdentity")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<CheckoutIdentity, CheckoutRefused | StoreFailure, CheckoutServices> {
  return yield* identityOn(target, agent, yield* agentRepositoryToken(target, agent));
});

/**
 * The deepen's steps in the sandbox, on a plan already read: the write
 * token at the firewall, the rest of the history fetched through it, and
 * the identity set.
 */
export const deepenCheckoutWith = /* @__PURE__ */ Effect.fn("web/deepenCheckoutWith")(function* (
  sandbox: RepositorySandbox,
  plan: AgentDeepenPlan,
): Effect.fn.Return<void, CheckoutRefused> {
  const firewall = sandbox.firewall;
  if (firewall === undefined) {
    return yield* new CheckoutRefused({ reason: REPOSITORY_REFUSAL.NO_FIREWALL });
  }
  // The token is revealed only into the firewall rules set for GitHub.
  yield* firewall
    .set(FIREWALL_SLOT.GITHUB, githubEntry(plan.credential))
    .pipe(
      Effect.mapError(() => new CheckoutRefused({ reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED })),
    );
  yield* deepenRepository(sandbox).pipe(Effect.mapError(refusedWith));
  yield* setCheckoutIdentity(sandbox, plan.identity).pipe(Effect.mapError(refusedWith));
});
