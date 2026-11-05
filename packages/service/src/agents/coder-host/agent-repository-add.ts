/**
 * agent-repository-add.ts -- a repository added to a running agent beside the ones it works in: checked, written, checked out, and told.
 *
 * `update_agent`'s `addRepository` and the agent's ⋯ menu's Add repository…
 * both add through here, so a model and a member are held to one rule. The
 * repository is appended after the agent's extras (`appendAgentRepository`),
 * never replacing one, and nothing removes one yet. It is refused, before
 * anything is written:
 *
 * - to anyone but the agent's starter or one of their agents, since the
 *   token the set is minted on is minted for the starter;
 * - while the starter has the Several repositories experiment off;
 * - to an agent caller that has heard words from another account
 *   (`heardFromAnotherAccount`, as `run_on_mac` is gated), so words from a
 *   review comment on a public repository never widen what an agent's
 *   token reaches, its own or another agent's it would then message;
 * - for an agent that works in no repository of its own, or runs on a
 *   device, as a Start naming extras is (`start.ts`'s `extraRepositoriesOf`);
 * - for one already among the agent's, in any case, or past the bound a
 *   Start holds its extras to (`AGENT_BOUNDS.MAX_ALSO_REPOSITORIES`);
 * - and unless the workspace's one installation of the App that reaches the
 *   agent's own repository reaches the whole set with it
 *   (`repositorySetReach`), each refused by name where it is reached only on
 *   the starter's own token or through another installation, in the same
 *   refusals a Start's extras answer.
 *
 * Once written, the running place is handed it (`runnerCheckedOut`): the
 * credential renewed for the whole set (`renewCredential`, which mints
 * through `agentRepositoryToken`) and the repository cloned on the path a
 * launch clones extras on (`agentExtraReads`, `cloneAgentExtras`); where no
 * place runs, the next launch clones it. Where the running place took it,
 * the agent is then told in one line of its conversation, a new message
 * rather than a change to its instructions, so the prompt cache they open
 * stands; an agent that added it to itself reads the line as the call's own
 * answer instead. Where none ran, it is told nothing, so an idle agent is
 * not woken: its next launch clones it and its instructions name it then.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
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
import { EXPERIMENT } from "@repo/settings";
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

/** Who adds the repository: the member acting, and the agent acting for them where an agent calls. */
export interface RepositoryAdder {
  readonly userId: string;
  readonly agent?: Pick<Agent, "id" | "userId" | "conversationId"> | undefined;
}

/** How the agent is told: the sessions and the writer its line goes through, and the key it is sent under, which a repeat carries again. */
export interface RepositoryTelling {
  readonly eve: AgentSessions;
  readonly writer: Effect.Effect<StoreWriter>;
  readonly clientKey: string;
}

/** A repository added: as GitHub spells it, where it is checked out, and whether the running place holds it now or only its next launch will. */
export interface AddedRepository {
  readonly repository: string;
  readonly path: string;
  /** Now, in the place the agent runs, where it is told; at its next turn where no place ran or the checkout there failed, as its next launch clones it and its instructions name it, and it is told nothing. */
  readonly checkout: AddedRepositoryCheckout;
}

/** A refusal the append answered under the agent's lock, as two adds at once can meet one: the repository already among the agent's, the bound reached, or the agent out of reach since the checks. */
const APPEND_REFUSED = {
  [APPEND_REFUSAL.ALREADY]: (repository: string) =>
    extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.ALREADY, repository),
  [APPEND_REFUSAL.FULL]: () => extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.FULL),
  [APPEND_REFUSAL.UNREACHED]: () => HOSTED_REFUSAL.NOT_FOUND,
} as const satisfies Record<AppendRefusal, (repository: string) => HostedRefusal>;

/** The line the agent is told, or reads as its own call's answer: where the repository stands and that its credential reaches it. */
export function addedRepositoryLine(added: Pick<AddedRepository, "repository" | "path">): string {
  return `${added.repository} is now checked out at ${added.path}; your token reaches it.`;
}

/** The repository named checked against the agent and GitHub as above, before anything is written: as GitHub spells it, or why not. */
const checkedRepository = Effect.fnUntraced(function* (
  adder: RepositoryAdder,
  agent: Agent,
  asked: AgentAlsoRepository,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  if (adder.userId !== agent.userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const on = yield* hostedStoreOrUnavailable(
    accountExperimentOn(agent.userId, EXPERIMENT.SEVERAL_REPOSITORIES),
  );
  if (!on) {
    return yield* Effect.fail(extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.EXPERIMENT_OFF));
  }
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

/**
 * Adds the repository to the agent as the header says: checked, appended,
 * handed to the running place, and told, through `telling` unless the agent
 * added it to itself. A write that finds the repository already there, as
 * two adds of it at once do, is refused as already among the agent's.
 */
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
  // Note that only a checkout that landed in a running place is told, so an idle agent is never woken by a
  // line saying something not yet true, and an agent adding to itself reads the line as its call's answer.
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
