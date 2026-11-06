import type { DatabaseServices } from "@repo/database/core/query";
import { readAccountPreferences } from "@repo/database/models/account-store";
import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import {
  type Agent,
  hasRepository,
  readAgent,
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
import type { FirewallSources, RepositoryCredential } from "../sandbox-firewall.js";
import { CODER, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";

export class CheckoutRefused extends Data.TaggedError("CheckoutRefused")<{
  readonly reason: CoderRefusal | string;
  readonly detail?: string | undefined;
}> {}

export type CheckoutServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

function refusedBy(): CheckoutRefused {
  return new CheckoutRefused({ reason: CODER_REFUSAL.GITHUB_UNAVAILABLE });
}

function agentWorkspace(target: ConversationTarget, agent: Agent) {
  return workspaceOfAgent(target.userId, agent);
}

function identityOf(user: GitHubUser): CheckoutIdentity {
  return { name: user.name ?? user.login, email: noreplyAddress(user) };
}

const commitAuthorOf = (userId: string) =>
  Effect.map(
    readAccountPreferences(userId),
    (row) => row?.preferences.commitAuthor ?? COMMIT_AUTHOR_DEFAULT,
  );

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

const agentAuthor = /* @__PURE__ */ Effect.fn("web/agentAuthor")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<AgentAuthor, StoreFailure, CheckoutServices> {
  if (agent.author !== null) return agent.author;
  const read = yield* readAuthor(target, agent);
  const settled = yield* settleAgentAuthor(target.userId, agent.id, read);
  return Option.getOrElse(settled, () => read);
});

export const COMMIT_BY = {
  DEVELOPER: "developer",
  APP: "app",
} as const;

export type CommitBy = (typeof COMMIT_BY)[keyof typeof COMMIT_BY];

export interface CommitAuthorship {
  readonly by: CommitBy;
  readonly coAuthor: string | undefined;
}

function coAuthorTrailer(identity: CheckoutIdentity): string {
  return `Co-authored-by: ${identity.name} <${identity.email}>`;
}

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
  const token =
    author === AGENT_AUTHOR.TOKEN
      ? (yield* agentRepositoryToken(target, agent)).token
      : yield* app.userToken(target.userId);
  const bot = yield* app.appBot(token);
  return coAuthorTrailer({ name: bot.login, email: noreplyAddress(bot) });
});

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

export const agentRepositoryToken = /* @__PURE__ */ Effect.fn("web/agentRepositoryToken")(
  function* (
    target: ConversationTarget,
    agent: WithRepository<Agent>,
    named?: string,
  ): Effect.fn.Return<
    {
      readonly token: Redacted.Redacted;
      readonly defaultBranch: string;
      readonly fullName: string;
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
      const names = repositories.map((each) => each.repository);
      const answered =
        named === undefined
          ? 0
          : names.findIndex((each) => each.toLowerCase() === named.toLowerCase());
      if (answered < 0) {
        return yield* new CheckoutRefused({
          reason: CODER_REFUSAL.NOT_REACHABLE,
          detail: `Not reached: ${named}.`,
        });
      }
      return yield* agentRepositoriesToken(target, agent, names, answered);
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

export const agentFirewallSources = /* @__PURE__ */ Effect.fn("web/agentFirewallSources")(
  function* (
    target: ConversationTarget,
    agent: Agent,
  ): Effect.fn.Return<FirewallSources, CheckoutRefused, CheckoutServices> {
    if (!hasRepository(agent)) return {};
    const { token, fullName, access } = yield* agentRepositoryToken(target, agent);
    return { github: { token, fullName, access } };
  },
);

export const firewallSourcesOfAgent = /* @__PURE__ */ Effect.fn("web/firewallSourcesOfAgent")(
  function* (
    userId: string,
    agentId: string | undefined,
  ): Effect.fn.Return<FirewallSources, CheckoutRefused | StoreFailure, CheckoutServices> {
    if (agentId === undefined) return {};
    const agent = yield* readAgent(userId, agentId);
    if (Option.isNone(agent)) return {};
    const target = { userId, conversationId: agent.value.conversationId };
    return yield* agentFirewallSources(target, agent.value);
  },
);

export const firewallSourcesAfterLaunch = (userId: string, agentId: string | undefined) =>
  firewallSourcesOfAgent(userId, agentId).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `a held sandbox's repository credential was not minted as its launch ended: ${failure._tag}`,
        ),
        {} satisfies FirewallSources,
      ),
    ),
  );

const agentRepositoriesToken = Effect.fnUntraced(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  repositories: readonly string[],
  answered: number,
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
  const one = reached[answered];
  if (one === undefined)
    return yield* Effect.die("a set of repositories answered fewer than asked");
  return { token, defaultBranch: one.defaultBranch, fullName: one.fullName, access };
});

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

const identityOn = (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  credential: RepositoryCredential,
) =>
  Effect.flatMap(agentAuthor(target, agent), (author) =>
    commitIdentity(target, agent, author, credential),
  );

function refusedWith(failure: RepositoryRefusal): CheckoutRefused {
  return new CheckoutRefused({ reason: failure.reason, detail: failure.detail });
}

export interface AgentRepositoryRead {
  readonly workspaceId: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

export const agentRepositoryRead = /* @__PURE__ */ Effect.fn("web/agentRepositoryRead")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<AgentRepositoryRead, CheckoutRefused, CheckoutServices> {
  const app = yield* GitHubApp;
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

export interface AgentExtraRead {
  readonly fullName: string;
  readonly branch: string;
  readonly path: string;
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

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

export const CHECKOUT_DEPTH = {
  SHALLOW: "shallow",
  WHOLE: "whole",
} as const;

export type CheckoutDepthChoice = (typeof CHECKOUT_DEPTH)[keyof typeof CHECKOUT_DEPTH];

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

export interface AgentDeepenPlan {
  readonly credential: RepositoryCredential;
  readonly identity: CheckoutIdentity;
}

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

export const agentCommitIdentity = /* @__PURE__ */ Effect.fn("web/agentCommitIdentity")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
): Effect.fn.Return<CheckoutIdentity, CheckoutRefused | StoreFailure, CheckoutServices> {
  return yield* identityOn(target, agent, yield* agentRepositoryToken(target, agent));
});

export const deepenCheckoutWith = /* @__PURE__ */ Effect.fn("web/deepenCheckoutWith")(function* (
  sandbox: RepositorySandbox,
  plan: AgentDeepenPlan,
): Effect.fn.Return<void, CheckoutRefused> {
  const firewall = sandbox.firewall;
  if (firewall === undefined) {
    return yield* new CheckoutRefused({ reason: REPOSITORY_REFUSAL.NO_FIREWALL });
  }
  yield* firewall
    .write({ github: plan.credential })
    .pipe(
      Effect.mapError(() => new CheckoutRefused({ reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED })),
    );
  yield* deepenRepository(sandbox).pipe(Effect.mapError(refusedWith));
  yield* setCheckoutIdentity(sandbox, plan.identity).pipe(Effect.mapError(refusedWith));
});
