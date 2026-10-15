import { Effect, Redacted } from "effect";
import {
  REPOSITORY_REFUSAL,
  RepositoryRefusal,
  type RepositorySandbox,
} from "./repository-shell.js";

/**
 * github-credentials.ts -- the two GitHub credentials a coding agent's sandbox carries at its firewall: the App's for `git`, and the developer's or the App's for GitHub's API.
 *
 * A coding agent's sandbox reaches GitHub through its firewall, which sets
 * the credential on every request to a GitHub host, so no token enters the
 * sandbox's filesystem, environment, or any command's output. The two hosts
 * carry two credentials. `github.com`, where `git` fetches and pushes,
 * carries the Luke GitHub App's installation token for the agent's one
 * repository, so every push is the App's: the delivery GitHub sends for it
 * names the App's bot, which is how an automation tells a push by Luke's
 * agents from a person's and never fires on its own agent's push.
 * `api.github.com`, where `gh` speaks, carries the developer's own token
 * where the agent writes as them, so the pull request it opens, a comment it
 * posts, and a draft it marks ready are the developer's, with the App's
 * badge beside them, and carries the App's token otherwise. Note that the
 * developer's token reaches every repository both they and the App reach,
 * not the agent's one; it is the token the agent's GitHub MCP server is
 * handed already.
 *
 * `git` speaks Basic over the token, as GitHub takes an App's token for a
 * push; the API takes the token as a bearer. A policy set here replaces the
 * sandbox's whole one, which is every host open and these two carrying
 * their credentials.
 */

/** The GitHub hosts a sandbox reaches with a credential, each by what speaks to it. */
const GITHUB_CREDENTIAL_HOST = {
  /** Where `git` fetches and pushes. */
  GIT: "github.com",
  /** Where `gh` and every other API call speak. */
  API: "api.github.com",
} as const;

/** The two credentials, each a token as GitHub minted it. */
export interface AgentGitHubCredentials {
  /** The App's installation token for the agent's one repository, which every push goes out on. */
  readonly git: Redacted.Redacted;
  /** The developer's own token where the agent writes as them, the App's `git` token otherwise. */
  readonly api: Redacted.Redacted;
}

/** One host's rule: every request to it leaves with the authorization given. */
function carrying(authorization: string) {
  return [{ transform: [{ headers: { authorization } }] }];
}

/**
 * The firewall's whole policy for the credentials: every host open, and the
 * two GitHub hosts carrying theirs. The tokens are revealed here alone.
 */
export function githubCredentialPolicy(credentials: AgentGitHubCredentials) {
  const basic = Buffer.from(`x-access-token:${Redacted.value(credentials.git)}`).toString("base64");
  return {
    allow: {
      "*": [],
      [GITHUB_CREDENTIAL_HOST.GIT]: carrying(`Basic ${basic}`),
      [GITHUB_CREDENTIAL_HOST.API]: carrying(`Bearer ${Redacted.value(credentials.api)}`),
    },
  };
}

/** The credentials set at the sandbox's firewall; refused where the sandbox has none, or would not take them. */
export const setGitHubCredentials = /* @__PURE__ */ Effect.fn("web/setGitHubCredentials")(
  function* (
    sandbox: RepositorySandbox,
    credentials: AgentGitHubCredentials,
  ): Effect.fn.Return<void, RepositoryRefusal> {
    const setNetworkPolicy = sandbox.setNetworkPolicy;
    if (setNetworkPolicy === undefined) {
      return yield* new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.NO_FIREWALL });
    }
    yield* Effect.tryPromise({
      try: () => setNetworkPolicy(githubCredentialPolicy(credentials)),
      catch: () => new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.NO_FIREWALL }),
    });
  },
);
