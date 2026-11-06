import type { DatabaseServices } from "@repo/database/core/query";
import {
  APPEND_REFUSAL,
  type AppendRefusal,
  appendAgentRepository,
  readAgentRepositories,
} from "@repo/database/models/agent-repositories";
import { type Agent, hasRepository } from "@repo/database/models/agent-store";
import { heardFromAnotherAccount } from "@repo/database/models/mac-command-store";
import { APP_LINE_METADATA, type StoreWriter } from "@repo/database/models/writer";
import {
  ADDED_REPOSITORY_CHECKOUT,
  type AddedRepositoryCheckout,
  AGENT_BOUNDS,
  AGENT_MACHINE,
  type AgentAlsoRepository,
  EXTRA_REPOSITORY_REFUSAL,
} from "@repo/features/agent-wire";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { GitHubApp, REPOSITORY_SET_UNREACHED } from "../../github/github-app.js";
import { githubReachOrRefusal } from "../../github/github-refusal.js";
import {
  extraRepositoryRefused,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  repositoryNotReachable,
} from "../../http/http-effect.js";
import type { AgentSessions } from "../eve-host/eve-sessions.js";
import { extraCheckoutPaths } from "../repository-sandbox-contract.js";
import { RUNNER_CHECKOUT, runnerCheckedOut } from "./runtime-sessions.js";
import { confirmedBranch } from "./start.js";
import { agentLineSender, steerAgent } from "./steer.js";

export interface RepositoryAdder {
  readonly userId: string;
  readonly agent?: Pick<Agent, "id" | "userId" | "conversationId"> | undefined;
}

export interface RepositoryTelling {
  readonly eve: AgentSessions;
  readonly writer: Effect.Effect<StoreWriter>;
  readonly clientKey: string;
}

export interface AddedRepository {
  readonly repository: string;
  readonly path: string;
  readonly checkout: AddedRepositoryCheckout;
}

const APPEND_REFUSED = {
  [APPEND_REFUSAL.ALREADY]: (repository: string) =>
    extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.ALREADY, repository),
  [APPEND_REFUSAL.FULL]: () => extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.FULL),
  [APPEND_REFUSAL.UNREACHED]: () => HOSTED_REFUSAL.NOT_FOUND,
} as const satisfies Record<AppendRefusal, (repository: string) => HostedRefusal>;

export function addedRepositoryLine(added: Pick<AddedRepository, "repository" | "path">): string {
  return `${added.repository} is now checked out at ${added.path}; your token reaches it.`;
}

const checkedRepository = Effect.fnUntraced(function* (
  adder: RepositoryAdder,
  agent: Agent,
  asked: AgentAlsoRepository,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  if (adder.userId !== agent.userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (adder.agent !== undefined) {
    const caller = { userId: adder.agent.userId, conversationId: adder.agent.conversationId };
    if (yield* hostedStoreOrUnavailable(heardFromAnotherAccount(caller))) {
      return yield* Effect.fail(
        extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT),
      );
    }
  }
  if (!hasRepository(agent)) {
    return yield* Effect.fail(extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY));
  }
  if (agent.machine === AGENT_MACHINE.DEVICE) {
    return yield* Effect.fail(extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.DEVICE));
  }
  const standing = yield* hostedStoreOrUnavailable(readAgentRepositories(agent.userId, agent.id));
  const every = standing.map((each) => each.repository);
  if (every.some((each) => each.toLowerCase() === asked.repository.toLowerCase())) {
    return yield* Effect.fail(
      extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.ALREADY, asked.repository),
    );
  }
  if (every.length > AGENT_BOUNDS.MAX_ALSO_REPOSITORIES) {
    return yield* Effect.fail(extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.FULL));
  }
  const app = yield* GitHubApp;
  const reached = yield* githubReachOrRefusal(
    app.repositorySetReach(agent.organizationId, [...every, asked.repository], agent.userId),
  );
  if (Result.isFailure(reached)) {
    const refused = reached.failure;
    return yield* Effect.fail(
      refused.why === REPOSITORY_SET_UNREACHED.UNREACHED
        ? repositoryNotReachable(refused.unreached)
        : extraRepositoryRefused(
            refused.why === REPOSITORY_SET_UNREACHED.TOKEN
              ? EXTRA_REPOSITORY_REFUSAL.TOKEN
              : EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION,
            refused.repository,
          ),
    );
  }
  const repository = reached.success.at(-1)?.fullName ?? asked.repository;
  if (asked.branch !== undefined) {
    yield* confirmedBranch(agent.organizationId, repository, agent.userId, asked.branch);
  }
  return repository;
});

export const addAgentRepository = /* @__PURE__ */ Effect.fn("web/addAgentRepository")(function* (
  adder: RepositoryAdder,
  agent: Agent,
  asked: AgentAlsoRepository,
  telling: RepositoryTelling,
): Effect.fn.Return<
  AddedRepository,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  const repository = yield* checkedRepository(adder, agent, asked);
  const written = yield* hostedStoreOrUnavailable(
    appendAgentRepository(agent.userId, agent.id, {
      repository,
      baseBranch: asked.branch ?? null,
    }),
  );
  if (Result.isFailure(written))
    return yield* Effect.fail(APPEND_REFUSED[written.failure](repository));
  const [, ...extras] = yield* hostedStoreOrUnavailable(
    readAgentRepositories(agent.userId, agent.id),
  );
  const paths = extraCheckoutPaths(extras.map((extra) => extra.repository));
  const index = extras.findIndex((extra) => extra.repository === repository);
  const path = paths[index] ?? paths.at(-1) ?? repository;
  const live = (yield* runnerCheckedOut(agent)) === RUNNER_CHECKOUT.CHECKED_OUT;
  const checkout = live ? ADDED_REPOSITORY_CHECKOUT.NOW : ADDED_REPOSITORY_CHECKOUT.NEXT_TURN;
  const added: AddedRepository = { repository, path, checkout };
  if (live && adder.agent?.id !== agent.id) {
    yield* steerAgent(telling.eve, telling.writer, agent.userId, agent, {
      text: addedRepositoryLine(added),
      clientKey: telling.clientKey,
      sender: agentLineSender(agent),
      metadata: APP_LINE_METADATA,
    }).pipe(
      Effect.catch((refused) =>
        Effect.logWarning(`an added repository was not told to its agent: ${refused.error}`),
      ),
    );
  }
  return added;
});
