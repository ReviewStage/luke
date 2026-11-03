/**
 * repository-sandbox-contract.ts -- where a repository's checkout stands in a sandbox and the variables its scripts read.
 *
 * A leaf of its own, importing nothing, because the coding agent's bounds
 * (`coder-host/bounds.ts`) name the checkout's path and every tool file of
 * the agent reads those bounds: kept in `repository-shell.ts`, the path
 * reached GitHub's App and the auth service with it, and each tool's own
 * bundle carried them.
 */

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
    // Note that the record keeps its old folder, because a persistent sandbox and a repository snapshot made before still hold it there, and a checkout whose record does not match is cloned again.
    CHECKOUT_RECORD: ".luke/repository",
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
  },
} as const;

/**
 * The steps a coding agent's shallow checkout is deepened by: the probe of
 * whether a deepen already finished, the probe of whether the checkout is
 * still shallow, the fetch of the rest of its history, and the mark that
 * the deepen finished, written last.
 */
export const DEEPEN_STEP = {
  PROBE: "probe",
  SHALLOW: "shallow",
  FETCH: "fetch",
  MARK: "mark",
} as const;
