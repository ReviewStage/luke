import { Data, Effect, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import { GitHubApp, type GitHubUserReadFailure, noreplyAddress } from "../../github/github-app.js";
import type { CodingAgent } from "../coding-agent-store.js";
import {
  type CheckoutIdentity,
  cloneRepository,
  type RepositorySandbox,
  setCheckoutIdentity,
} from "../repository-shell.js";
import type { ConversationTarget } from "../store/index.js";
import { CODER_REFUSAL, type CoderRefusal } from "./bounds.js";

/**
 * checkout.ts -- a coding agent's checkout of its repository, and the credential its sandbox pushes through.
 *
 * The agent's repository is checked out once, as its sandbox opens, on the
 * same terms as the planning checkout (`repository-shell.ts`): the owner's
 * reach is confirmed and a token minted for that one repository, set at
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
 *
 * What the agent commits is the developer's work, the way the cloud coding
 * agents attribute theirs: the checkout's own config names the developer
 * as GitHub records them and the noreply address GitHub links to their
 * account, so a commit the agent pushes is theirs on GitHub and the
 * deployment that builds it finds an account behind it, and each commit
 * message ends with Luke's co-author trailer under the App's own bot. The
 * identity is set here, as the checkout opens, and never by the model, whose
 * instructions say so.
 */

/** Why the checkout or a mint ran nothing, in the host's own words. */
export class CheckoutRefused extends Data.TaggedError("CheckoutRefused")<{
  readonly reason: CoderRefusal | string;
}> {}

/** What a mint or a checkout may reach: GitHub through the App, and the store for the account's token. */
export type CheckoutServices = SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp;

/** The name Luke's co-author trailer carries; the address beside it is the App's bot's. */
const LUKE_COMMIT_NAME = "Luke";

/** A read on the developer's token that failed, in the host's word for it: a sign-in to mend, or GitHub not answering. */
function refusedBy(failure: GitHubUserReadFailure): CheckoutRefused {
  return failure._tag === "GitHubSignInRequired"
    ? new CheckoutRefused({ reason: CODER_REFUSAL.SIGN_IN_REQUIRED })
    : new CheckoutRefused({ reason: CODER_REFUSAL.GITHUB_UNAVAILABLE });
}

/** The trailer a commit message ends with for its co-author, as GitHub reads one. */
function coAuthorTrailer(name: string, email: string): string {
  return `Co-authored-by: ${name} <${email}>`;
}

/**
 * Who the agent's commits are by: the developer under their GitHub name,
 * or their login where they set none, at their noreply address; and Luke
 * as co-author under the App's bot, where GitHub knows it.
 */
const commitIdentity = /* @__PURE__ */ Effect.fn("web/agentCommitIdentity")(function* (
  target: ConversationTarget,
): Effect.fn.Return<CheckoutIdentity, CheckoutRefused, CheckoutServices> {
  const app = yield* GitHubApp;
  const developer = yield* app.signedInUser(target.userId).pipe(Effect.mapError(refusedBy));
  const bot = yield* app.appBot(target.userId).pipe(Effect.mapError(refusedBy));
  return {
    name: developer.name ?? developer.login,
    email: noreplyAddress(developer),
    ...Option.match(bot, {
      onNone: () => undefined,
      onSome: (luke) => ({ trailer: coAuthorTrailer(LUKE_COMMIT_NAME, noreplyAddress(luke)) }),
    }),
  };
});

/**
 * A write token for the agent's repository, minted as the App where the
 * developer still reaches the repository, with the repository as GitHub
 * spells it.
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
    const reached = yield* app
      .repositoryWriteToken(target.userId, agent.repository)
      .pipe(Effect.mapError(refusedBy));
    if (Option.isNone(reached))
      return yield* new CheckoutRefused({ reason: CODER_REFUSAL.NOT_REACHABLE });
    const { repository, token } = reached.value;
    return { token, defaultBranch: repository.defaultBranch, fullName: repository.fullName };
  },
);

/**
 * The agent's repository checked out whole, at its current default branch,
 * into the sandbox, with the developer's commit identity set in it; answers
 * the token minted for it, for the caller to set at the firewall for the
 * commands that follow. The checkout is recorded under the name the agent's
 * row holds. Note that the identity is read ahead of the clone, so a
 * developer GitHub cannot name costs no clone.
 */
export const checkOutAgentRepository = /* @__PURE__ */ Effect.fn("web/checkOutAgentRepository")(
  function* (
    target: ConversationTarget,
    agent: CodingAgent,
    sandbox: RepositorySandbox,
  ): Effect.fn.Return<Redacted.Redacted, CheckoutRefused, CheckoutServices> {
    const minted = yield* agentRepositoryToken(target, agent);
    const identity = yield* commitIdentity(target);
    yield* cloneRepository(
      sandbox,
      {
        fullName: minted.fullName,
        defaultBranch: minted.defaultBranch,
        recordedAs: agent.repository,
      },
      minted.token,
    ).pipe(Effect.mapError((refused) => new CheckoutRefused({ reason: refused.reason })));
    yield* setCheckoutIdentity(sandbox, identity).pipe(
      Effect.mapError((refused) => new CheckoutRefused({ reason: refused.reason })),
    );
    return minted.token;
  },
);
