import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  settleCodingAgentAuthor,
} from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { CODING_AGENT_AUTHOR, type CodingAgentAuthor } from "@luke/features/coding-agent-wire";
import { Data, Effect, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  type GitHubUser,
  noreplyAddress,
} from "../../github/github-app.js";
import { agentWorkspace as workspaceOfAgent } from "../../github/workspace-repository.js";
import type { StoreFailure } from "../../http/store-failure.js";
import {
  type CheckoutIdentity,
  cloneRepository,
  REPOSITORY_REFUSAL,
  type RepositorySandbox,
  runInSandbox,
  setCheckoutIdentity,
} from "../repository-shell.js";
import { CODER, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";

/**
 * checkout.ts -- a coding agent's checkout of its repository, whose its commits are, and the credential its sandbox pushes through.
 *
 * The agent's repository is checked out once, as its sandbox opens, on the
 * same terms as the planning checkout (`repository-shell.ts`): the
 * installation of its plan's workspace is confirmed to reach it and a token
 * minted for that one repository, set at
 * the sandbox's firewall for the clone alone and withdrawn after it. What
 * differs is the token and the depth: the token carries contents and pull
 * requests write, since the agent pushes a branch and opens a pull request
 * from it, and the clone is the whole history, since a branch and a pull
 * request are cut from it. The token is then handed back for the authored
 * sandbox file to set at the firewall for the session's own commands,
 * through eve's `authenticateGitHub`, which is where `gh` and `git push`
 * reach GitHub as the App; it never enters the sandbox's filesystem or
 * environment. A token is good for an hour, so the host mints another on
 * the same terms when the session's step hook finds the one standing old.
 * No developer's own token ever stands at the firewall: the sandbox is the
 * workspace's, and any member may open a terminal in it.
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
 * developer has no GitHub sign-in or may not push, the row saying why. The
 * identity is set here, as the checkout opens, and never by the model,
 * whose instructions say so.
 *
 * The agent publishes through `git` and `gh` of its own, so what it
 * published is read off the checkout rather than guessed: the branch
 * checked out as a turn ends is the one its pull request is on, whatever
 * branches it cut, switched, or deleted on the way, and the session's
 * turn-end hook writes it on the agent's row through the host.
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
 * automation started; the developer where their GitHub sign-in may push to
 * the repository; the App's bot otherwise, with why. A GitHub that would
 * not answer is the App's bot too, since an agent's start does not wait on
 * it, and only the store's failure is the caller's.
 */
const readAuthor = /* @__PURE__ */ Effect.fn("web/agentReadAuthor")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentAuthor, StoreFailure, CheckoutServices> {
  // Note that the run's origin outlives its automation, whose id goes null once it is deleted.
  if (agent.automationId !== null || agent.automationOrigin !== null) {
    return CODING_AGENT_AUTHOR.APP_AUTOMATION;
  }
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
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentAuthor, StoreFailure, CheckoutServices> {
  if (agent.author !== null) return agent.author;
  const read = yield* readAuthor(target, agent);
  const settled = yield* settleCodingAgentAuthor(target.userId, agent.id, read);
  return Option.getOrElse(settled, () => read);
});

/**
 * The trailer naming the App's bot as co-author of the agent's commits,
 * where the agent writes as its developer. Told to the session as it
 * starts, so a read that fails is logged and answers none, which words the
 * instructions as the App's and leaves the commits without the trailer
 * rather than failing the start.
 */
export const agentCoAuthor = /* @__PURE__ */ Effect.fn("web/agentCoAuthor")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.fn.Return<string | undefined, never, CheckoutServices> {
  const app = yield* GitHubApp;
  return yield* Effect.gen(function* () {
    if ((yield* agentAuthor(target, agent)) !== CODING_AGENT_AUTHOR.DEVELOPER) return undefined;
    const bot = yield* Effect.flatMap(app.userToken(target.userId), app.appBot);
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
 * installation of its plan's workspace grants the App the read (`github-app.ts`'s `CI_READ_PERMISSIONS`). Told to the session
 * as it starts, so a read that fails is logged and reads as not readable
 * rather than failing the start: the checkout refuses on its own terms when
 * the sandbox opens.
 */
export const agentCiReadable = /* @__PURE__ */ Effect.fn("web/agentCiReadable")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.fn.Return<boolean, never, CheckoutServices> {
  const app = yield* GitHubApp;
  return yield* Effect.gen(function* () {
    const workspace = yield* agentWorkspace(target, agent);
    if (Option.isNone(workspace)) return false;
    return yield* app.repositoryCiReadable(workspace.value, agent.repository);
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
 * installation of its plan's workspace still reaches the repository, with
 * the repository as GitHub spells it.
 */
export const agentRepositoryToken = /* @__PURE__ */ Effect.fn("web/agentRepositoryToken")(
  function* (
    target: ConversationTarget,
    agent: CodingAgent,
  ): Effect.fn.Return<
    {
      readonly token: Redacted.Redacted;
      readonly defaultBranch: string;
      readonly fullName: string;
    },
    CheckoutRefused,
    CheckoutServices
  > {
    const app = yield* GitHubApp;
    const reached = yield* Effect.gen(function* () {
      const workspace = yield* agentWorkspace(target, agent);
      if (Option.isNone(workspace)) return Option.none();
      return yield* app.repositoryWriteToken(workspace.value, agent.repository);
    }).pipe(Effect.mapError(refusedBy));
    if (Option.isNone(reached))
      return yield* new CheckoutRefused({ reason: CODER_REFUSAL.NOT_REACHABLE });
    const { repository, token } = reached.value;
    return { token, defaultBranch: repository.defaultBranch, fullName: repository.fullName };
  },
);

/**
 * Who the checkout's commits are by: the developer's GitHub account where
 * the agent writes as them and that account still pushes to the repository,
 * and the App's bot otherwise, read on the token just minted for the
 * repository. Note that a developer whose push lapsed since the agent
 * started is said in the log and leaves the commits the bot's.
 */
const commitIdentity = /* @__PURE__ */ Effect.fn("web/agentCommitIdentity")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
  author: CodingAgentAuthor,
  token: Redacted.Redacted,
): Effect.fn.Return<CheckoutIdentity, CheckoutRefused, CheckoutServices> {
  const app = yield* GitHubApp;
  if (author === CODING_AGENT_AUTHOR.DEVELOPER) {
    const pusher = yield* Effect.option(app.userPusher(target.userId, agent.repository));
    const developer = Option.flatten(pusher);
    if (Option.isSome(developer)) return identityOf(developer.value.user);
    yield* Effect.logWarning(
      `The developer of conversation ${target.conversationId} no longer pushes to its repository; its commits are the App's`,
    );
  }
  const bot = yield* app.appBot(token).pipe(Effect.mapError(refusedBy));
  return { name: bot.login, email: noreplyAddress(bot) };
});

/**
 * The agent's repository checked out whole, at the branch it was started on
 * where its row names one and at the current default branch otherwise, into
 * the sandbox, with its commit identity set in it; answers the token
 * minted for it, for the caller to set at the firewall for the commands
 * that follow. The checkout is recorded under the name the agent's row
 * holds. Note that the identity is read ahead of the clone, so a bot GitHub
 * cannot name costs no clone; and that a start branch deleted since the
 * start fails the clone, which says so in git's own words.
 */
export const checkOutAgentRepository = /* @__PURE__ */ Effect.fn("web/checkOutAgentRepository")(
  function* (
    target: ConversationTarget,
    agent: CodingAgent,
    sandbox: RepositorySandbox,
  ): Effect.fn.Return<Redacted.Redacted, CheckoutRefused | StoreFailure, CheckoutServices> {
    const minted = yield* agentRepositoryToken(target, agent);
    const author = yield* agentAuthor(target, agent);
    const identity = yield* commitIdentity(target, agent, author, minted.token);
    const refused = (failure: { readonly reason: string }) =>
      new CheckoutRefused({ reason: failure.reason });
    yield* cloneRepository(
      sandbox,
      {
        fullName: minted.fullName,
        defaultBranch: agent.startBranch ?? minted.defaultBranch,
        recordedAs: agent.repository,
      },
      minted.token,
    ).pipe(Effect.mapError(refused));
    yield* setCheckoutIdentity(sandbox, identity).pipe(Effect.mapError(refused));
    return minted.token;
  },
);

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
