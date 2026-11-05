/**
 * repository-sandbox-contract.ts -- where a repository's checkout stands in a sandbox and the variables its scripts read.
 *
 * A leaf of its own, importing only the state folder's leaf, because the coding agent's bounds
 * (`coder-host/bounds.ts`) name the checkout's path and every tool file of
 * the agent reads those bounds: kept in `repository-shell.ts`, the path
 * reached GitHub's App and the auth service with it, and each tool's own
 * bundle carried them.
 */

import { SANDBOX_STATE_FOLDER } from "./sandbox-state-folder.js";

/**
 * What the shell hands the sandbox, which is the whole of what a sandbox
 * sees of it: where the checkout stands and the file beside it naming
 * which repository it is of, and the variables each script reads, so
 * nothing of the repository's name or the model's command is spliced into
 * shell text. A test's sandbox double answers from this contract.
 */
export const REPOSITORY_SANDBOX_CONTRACT = {
  PATH: {
    WORKSPACE: "/workspace",
    CHECKOUT: "/workspace/repository",
    CHECKOUT_RECORD: `${SANDBOX_STATE_FOLDER}/repository`,
  },
  VARIABLE: {
    /** The repository the call is about, `owner/name`, read by the probe and the checkout. */
    REPOSITORY: "APP_REPOSITORY",
    /** The branch the checkout is of: the default branch, or the one a coding agent was started on. */
    BRANCH: "APP_BRANCH",
    /** The clone's URL, which carries no credential; its presence is what makes a run the checkout. */
    URL: "APP_CLONE_URL",
    /** How deep the clone is; unset, the whole history, which a coding agent's branch and pull request need. */
    DEPTH: "APP_CLONE_DEPTH",
    /** The model's command, which bash reads from the variable and never from shell text. */
    COMMAND: "APP_COMMAND",
    /** Which step of deepening a shallow checkout the run is (`DEEPEN_STEP`); its presence is what makes a run one. */
    DEEPEN: "APP_DEEPEN",
    /** Set on the run that brings a checkout a repository snapshot holds up to its branch; its presence is what makes a run the refresh. */
    REFRESH: "APP_REFRESH",
    /** The folder under the workspace an extra repository's checkout is cloned into; its presence is what makes a run an extra's clone. */
    FOLDER: "APP_CHECKOUT_FOLDER",
  },
} as const;

/** The folders under the workspace an extra checkout never takes: the agent's own checkout's and the state folder. */
const TAKEN_FOLDERS = new Set(
  [REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT.split("/").pop(), SANDBOX_STATE_FOLDER].map((folder) =>
    folder?.toLowerCase(),
  ),
);

/**
 * Where each repository an agent works in beside its own is checked out, in
 * the order given: `/workspace/<name>`, by the repository's name, or
 * `/workspace/<owner>-<name>` where another of them shares its name in any
 * case, or the name is a folder the workspace already holds, and that with
 * its place in the list after it where even that is taken. Note that the
 * folder is spliced into the launch's shell text (`vercel-machine.ts`),
 * which is safe because an `owner/name` is held to GitHub's own letters,
 * digits, dots, underscores, and hyphens (`GITHUB_REPOSITORY_PATTERN`).
 */
export function extraCheckoutPaths(repositories: readonly string[]): readonly string[] {
  const nameOf = (repository: string) => repository.split("/").pop() ?? repository;
  const named = repositories.map((repository) => nameOf(repository).toLowerCase());
  const taken = new Set(TAKEN_FOLDERS);
  return repositories.map((repository, index) => {
    const name = nameOf(repository);
    const shared = named.filter((each) => each === name.toLowerCase()).length > 1;
    const candidates = [
      ...(shared ? [] : [name]),
      repository.replace("/", "-"),
      `${repository.replace("/", "-")}-${index + 1}`,
    ];
    const folder =
      candidates.find((candidate) => !taken.has(candidate.toLowerCase())) ?? candidates.at(-1);
    taken.add(folder?.toLowerCase());
    return `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/${folder}`;
  });
}

/** The step a coding agent's shallow checkout is deepened by: the fetch of the rest of its history. */
export const DEEPEN_STEP = {
  FETCH: "fetch",
} as const;
