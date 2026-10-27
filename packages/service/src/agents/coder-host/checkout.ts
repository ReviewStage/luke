import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  settleCodingAgentAuthor,
  type WithRepository,
} from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { CODING_AGENT_AUTHOR, type CodingAgentAuthor } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Data, Effect, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  type GitHubTokenAccess,
  type GitHubUser,
  noreplyAddress,
} from "../../github/github-app.js";
import {
  agentMember,
  agentWorkspace as workspaceOfAgent,
} from "../../github/workspace-repository.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import {
  type CheckoutIdentity,
  checkoutDeepened,
  cloneRepository,
  deepenRepository,
  markDeepened,
  REPOSITORY_REFUSAL,
  type RepositorySandbox,
  refreshRepository,
  runInSandbox,
  SHALLOW_CLONE_DEPTH,
  setCheckoutIdentity,
} from "../repository-shell.js";
import { credentialPolicy, type RepositoryCredential } from "../terminal/agent-sandbox.js";
import { CODER, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";

/**
 * checkout.ts -- a coding agent's checkout of its repository, whose its commits are, and the credential its sandbox pushes through.
 *
 * The agent's repository is checked out in two steps. As its sandbox opens,
 * it is checked out on the same terms as the brain's checkout
 * (`repository-shell.ts`): the installation of its task's workspace is
 * confirmed to reach it and a read token minted for that one repository,
 * set at the sandbox's firewall for the clone alone and withdrawn after it.
 * eve's clone is one commit deep, so a sandbox opened to read the code, as a
 * call's first look at it does, opens fast and holds no credential. A native
 * harness's is whole, since it deepens at once, or is no clone at all where
 * its workspace's repository snapshot opened the sandbox on a checkout
 * already made, which is fetched up to the branch instead
 * (`refreshAgentCheckout`, `repository-snapshot.ts`).
 * The first write deepens it (`deepenAgentCheckout`): a write token is
 * minted, carrying contents and pull requests write, since the agent pushes
 * a branch and opens a pull request from it, and set at the firewall for
 * the fetch of the rest of the history alone, since a branch and a pull
 * request are cut from it; the commit identity is set; and the token is
 * handed back for the authored file to set at the firewall for the
 * session's own commands, in the shape `credentialPolicy` gives it
 * (`terminal/agent-sandbox.ts`), which is where `gh` and `git push` reach
 * GitHub; it never enters the sandbox's filesystem or environment. An installation token is good for an hour, so
 * the host mints another on the same terms when the session's step hook
 * finds the one standing old. No developer's sign-in token ever stands at
 * the firewall. Where only its starter's own classic token reaches the
 * repository (`agent.githubAccess`), that token is the agent's credential:
 * set on the repository's own git and REST paths alone, taken off as each
 * turn ends, and set again as the next begins.
 *
 * Who the agent writes as is settled once, as its first session starts, and
 * kept on its row (`CODING_AGENT_AUTHOR`), so the instructions that session
 * runs under and the checkout agree for the agent's life. An agent a
 * developer started, by hand or by voice, writes as that developer where
 * they signed in with GitHub and their own account may push to the
 * repository: its commits are authored as their GitHub account, at the
 * noreply address GitHub links to it, each ending on a trailer that names
 * the App's bot as co-author, which is how Claude Code names itself beside
 * the person it worked for, and its pull request is opened as them by the
 * service (`pull-request.ts`). An agent an automation started writes as the
 * App's bot, since no developer's hand started it, and so does one whose
 * developer has no GitHub sign-in or may not push, the row saying why. An
 * agent on its starter's own token writes as the account the token belongs
 * to, read on it, with the same trailer, and its pull request is opened on
 * that token alone. The
 * identity is set here, as the checkout opens, and never by the model,
 * whose instructions say so.
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

/** Why the checkout or a mint ran nothing, in the host's own words. */
export class CheckoutRefused extends Data.TaggedError("CheckoutRefused")<{
  readonly reason: CoderRefusal | string;
}> {}

/** What a mint or a checkout may reach: GitHub through the App, and the store for the workspace's installation. */
export type CheckoutServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/** The branch checked out, as git prints it: the name, or nothing on a detached HEAD. */
const SHOW_BRANCH = "git branch --show-current";

/** A read of the workspace's installation that failed, in the host's word for it: GitHub not answering. */
function refusedBy(): CheckoutRefused {
  return new CheckoutRefused({ reason: CODER_REFUSAL.GITHUB_UNAVAILABLE });
}

/** The agent's workspace, whose installation its repository is reached through; none where its starter no longer reaches it. */
function agentWorkspace(target: ConversationTarget, agent: CodingAgent) {
  return workspaceOfAgent(target.userId, agent);
}

/** An account as a commit names it: the name it set, or its login, at the noreply address GitHub links to it. */
function identityOf(user: GitHubUser): CheckoutIdentity {
  return { name: user.name ?? user.login, email: noreplyAddress(user) };
}

/**
 * Who the agent writes as, read now: the App's bot for an agent an
 * automation started; its starter's own token for an agent on it; the
 * developer where their GitHub sign-in may push to the repository; the
 * App's bot otherwise, with why. A GitHub that would not answer is the
 * App's bot too, since an agent's start does not wait on it, and only the
 * store's failure is the caller's.
 */
const readAuthor = /* @__PURE__ */ Effect.fn("web/agentReadAuthor")(function* (
  target: ConversationTarget,
  agent: WithRepository<CodingAgent>,
): Effect.fn.Return<CodingAgentAuthor, StoreFailure, CheckoutServices> {
  // Note that the run's origin outlives its automation, whose id goes null once it is deleted.
  if (agent.automationId !== null || agent.automationOrigin !== null) {
    return CODING_AGENT_AUTHOR.APP_AUTOMATION;
  }
  if (agent.githubAccess === GITHUB_ACCESS.TOKEN) return CODING_AGENT_AUTHOR.TOKEN;
  const app = yield* GitHubApp;
  return yield* app.userPusher(target.userId, agent.repository).pipe(
    Effect.map((pusher) =>
      Option.isSome(pusher) ? CODING_AGENT_AUTHOR.DEVELOPER : CODING_AGENT_AUTHOR.APP_NO_PUSH,
    ),
    Effect.catchTag("GitHubSignInRequired", () => Effect.succeed(CODING_AGENT_AUTHOR.APP_UNLINKED)),
    // Note that GitHub refusing the token outright is a sign-in it no longer honours, whatever the row says.
    Effect.catchTag("GitHubUnavailable", (failure) =>
      Effect.succeed(
        failure.status === GITHUB_HTTP_STATUS.UNAUTHORIZED
          ? CODING_AGENT_AUTHOR.APP_UNLINKED
          : CODING_AGENT_AUTHOR.APP_UNREAD,
      ),
    ),
    Effect.catchTag("GitHubAppNotConfigured", () => Effect.succeed(CODING_AGENT_AUTHOR.APP_UNREAD)),
  );
});

/**
 * Who the agent writes as: the author its row holds, or, on its first
 * session, the one read now and settled on the row, which answers the one
 * standing where another session settled it first.
 */
const agentAuthor = /* @__PURE__ */ Effect.fn("web/agentAuthor")(function* (
  target: ConversationTarget,
  agent: WithRepository<CodingAgent>,
): Effect.fn.Return<CodingAgentAuthor, StoreFailure, CheckoutServices> {
  if (agent.author !== null) return agent.author;
  const read = yield* readAuthor(target, agent);
  const settled = yield* settleCodingAgentAuthor(target.userId, agent.id, read);
  return Option.getOrElse(settled, () => read);
});

/**
 * The trailer naming the App's bot as co-author of the agent's commits,
 * where the agent writes as its developer, through their sign-in or their
 * own token, which the bot is read on. Told to the session as it starts, so
 * a read that fails is logged and answers none, which words the
 * instructions as the App's and leaves the commits without the trailer
 * rather than failing the start.
 */
export const agentCoAuthor = /* @__PURE__ */ Effect.fn("web/agentCoAuthor")(function* (
  target: ConversationTarget,
  agent: WithRepository<CodingAgent>,
): Effect.fn.Return<string | undefined, never, CheckoutServices> {
  const app = yield* GitHubApp;
  return yield* Effect.gen(function* () {
    const author = yield* agentAuthor(target, agent);
    if (author !== CODING_AGENT_AUTHOR.DEVELOPER && author !== CODING_AGENT_AUTHOR.TOKEN) {
      return undefined;
    }
    // Note that an agent on its starter's own token reads the bot on that token, which stands where their sign-in may not.
    const token =
      author === CODING_AGENT_AUTHOR.TOKEN
        ? (yield* agentRepositoryToken(target, agent)).token
        : yield* app.userToken(target.userId);
    const bot = yield* app.appBot(token);
    return `Co-authored-by: ${bot.login} <${noreplyAddress(bot)}>`;
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `The co-author of conversation ${target.conversationId}'s commits was not read: ${failure._tag}`,
        ),
        undefined,
      ),
    ),
  );
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
  agent: WithRepository<CodingAgent>,
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
 * the repository as GitHub spells it.
 */
export const agentRepositoryToken = /* @__PURE__ */ Effect.fn("web/agentRepositoryToken")(
  function* (
    target: ConversationTarget,
    agent: WithRepository<CodingAgent>,
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
  agent: WithRepository<CodingAgent>,
  author: CodingAgentAuthor,
  credential: RepositoryCredential,
): Effect.fn.Return<CheckoutIdentity, CheckoutRefused, CheckoutServices> {
  const app = yield* GitHubApp;
  if (author === CODING_AGENT_AUTHOR.TOKEN && credential.access.kind === GITHUB_ACCESS.TOKEN) {
    return identityOf(yield* app.tokenUser(credential.token).pipe(Effect.mapError(refusedBy)));
  }
  if (author === CODING_AGENT_AUTHOR.DEVELOPER) {
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

/** A refusal of the repository's shell, as the checkout's own. */
function refusedWith(failure: { readonly reason: string }): CheckoutRefused {
  return new CheckoutRefused({ reason: failure.reason });
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
  agent: WithRepository<CodingAgent>,
): Effect.fn.Return<AgentRepositoryRead, CheckoutRefused, CheckoutServices> {
  const app = yield* GitHubApp;
  // Note that a store that could not be read refuses as GitHub unavailable, as the checkout always has.
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
 * (`deepenAgentCheckout`). Note that a start branch deleted since the start
 * fails the clone, which says so in git's own words.
 */
export const cloneAgentRepository = /* @__PURE__ */ Effect.fn("web/cloneAgentRepository")(
  function* (
    agent: WithRepository<CodingAgent>,
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

/** The agent's repository read and checked out shallow into the sandbox, as eve's sandbox opens on it (`cloneAgentRepository`). */
export const checkOutAgentRepository = /* @__PURE__ */ Effect.fn("web/checkOutAgentRepository")(
  function* (
    target: ConversationTarget,
    agent: WithRepository<CodingAgent>,
    sandbox: RepositorySandbox,
  ): Effect.fn.Return<void, CheckoutRefused | StoreFailure, CheckoutServices> {
    const read = yield* agentRepositoryRead(target, agent);
    yield* cloneAgentRepository(agent, sandbox, read);
  },
);

/**
 * The checkout a repository snapshot opened the sandbox on brought up to the
 * repository's default branch, on the read the caller made of it, the token
 * at the firewall for the fetch alone, and recorded under the name the
 * agent's row holds; refused, in git's words, where the sandbox holds no
 * checkout of that repository or the fetch failed. As after a clone, no
 * identity and no credential is set (`deepenAgentCheckout`).
 */
export const refreshAgentCheckout = /* @__PURE__ */ Effect.fn("web/refreshAgentCheckout")(
  function* (
    agent: WithRepository<CodingAgent>,
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

/** The command that makes the working folder where a checkout would stand; one already there is left as it is. */
const MAKE_WORKING_FOLDER = `mkdir -p ${CODER.CHECKOUT_PATH}`;

/**
 * The empty folder an agent with no repository works in, made where a
 * checkout would stand, so its shell and its file reads start there as an
 * agent's with a repository do (`shell.ts`, `files.ts`); refused where the
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
  ).pipe(Effect.mapError((refused) => new CheckoutRefused({ reason: refused.reason })));
  if (made.exitCode !== 0) {
    return yield* new CheckoutRefused({
      reason: `\`${MAKE_WORKING_FOLDER}\` exited ${made.exitCode}`,
    });
  }
});

/**
 * The agent's shallow checkout deepened, as its first write asks: a write
 * token minted and set at the firewall in the session's own shape
 * (`credentialPolicy`), where it stands from then on for the session's `gh`
 * and `git`; the rest of the history fetched through it; the commit
 * identity set; and the deepen's record written last. A sandbox whose
 * record stands is left as it is. Note that the credential is set ahead of
 * the fetch and never taken off after it, so two writes deepening at once
 * each leave it standing whatever order they end in, the fetch itself
 * running once (`deepenRepository`); that a deepen cut short anywhere
 * writes no record, so the next write runs it again whole; and that the
 * identity is read ahead of the fetch, so an account GitHub cannot name
 * costs no fetch.
 */
export const deepenAgentCheckout = /* @__PURE__ */ Effect.fn("web/deepenAgentCheckout")(function* (
  target: ConversationTarget,
  agent: WithRepository<CodingAgent>,
  sandbox: RepositorySandbox,
): Effect.fn.Return<void, CheckoutRefused | StoreFailure, CheckoutServices> {
  if (yield* checkoutDeepened(sandbox).pipe(Effect.mapError(refusedWith))) return;
  if (sandbox.setNetworkPolicy === undefined) {
    return yield* new CheckoutRefused({ reason: REPOSITORY_REFUSAL.NO_FIREWALL });
  }
  yield* deepenCheckoutWith(sandbox, yield* agentDeepenPlan(target, agent));
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
  agent: WithRepository<CodingAgent>,
): Effect.fn.Return<AgentDeepenPlan, CheckoutRefused | StoreFailure, CheckoutServices> {
  const minted = yield* agentRepositoryToken(target, agent);
  const author = yield* agentAuthor(target, agent);
  const identity = yield* commitIdentity(target, agent, author, minted);
  return {
    credential: { token: minted.token, fullName: minted.fullName, access: minted.access },
    identity,
  };
});

/**
 * The deepen's steps in the sandbox, on a plan already read: the write
 * token at the firewall, the rest of the history fetched through it, the
 * identity set, and the record written last (`deepenAgentCheckout`).
 */
export const deepenCheckoutWith = /* @__PURE__ */ Effect.fn("web/deepenCheckoutWith")(function* (
  sandbox: RepositorySandbox,
  plan: AgentDeepenPlan,
): Effect.fn.Return<void, CheckoutRefused> {
  const setNetworkPolicy = sandbox.setNetworkPolicy;
  if (setNetworkPolicy === undefined) {
    return yield* new CheckoutRefused({ reason: REPOSITORY_REFUSAL.NO_FIREWALL });
  }
  // The token is revealed only into the firewall rules set for GitHub.
  yield* Effect.tryPromise({
    try: () => setNetworkPolicy(credentialPolicy(plan.credential)),
    catch: () => new CheckoutRefused({ reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED }),
  });
  yield* deepenRepository(sandbox).pipe(Effect.mapError(refusedWith));
  yield* setCheckoutIdentity(sandbox, plan.identity).pipe(Effect.mapError(refusedWith));
  yield* markDeepened(sandbox).pipe(Effect.mapError(refusedWith));
});

/**
 * The branch checked out in the agent's sandbox now, or null where the
 * checkout stands detached; refused where the sandbox is gone or git could
 * not say.
 */
export const checkoutBranch = /* @__PURE__ */ Effect.fn("web/checkoutBranch")(function* (
  sandbox: RepositorySandbox,
): Effect.fn.Return<string | null, CheckoutRefused> {
  const shown = yield* runInSandbox(
    sandbox,
    { command: SHOW_BRANCH, workingDirectory: CODER.CHECKOUT_PATH },
    REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
  ).pipe(Effect.mapError((refused) => new CheckoutRefused({ reason: refused.reason })));
  if (shown.exitCode !== 0) {
    return yield* new CheckoutRefused({ reason: `\`${SHOW_BRANCH}\` exited ${shown.exitCode}` });
  }
  const branch = shown.stdout.trim();
  return branch.length === 0 ? null : branch;
});
