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
    CHECKOUT_RECORD: ".luke/repository",
  },
  VARIABLE: {
    /** The repository the call is about, `owner/name`, read by the probe and the checkout. */
    REPOSITORY: "LUKE_REPOSITORY",
    /** The branch the checkout is of: the default branch, or the one a coding agent was started on. */
    BRANCH: "LUKE_BRANCH",
    /** The clone's URL, which carries no credential; its presence is what makes a run the checkout. */
    URL: "LUKE_CLONE_URL",
    /** How deep the clone is; unset, the whole history, which a coding agent's branch and pull request need. */
    DEPTH: "LUKE_CLONE_DEPTH",
    /** The model's command, which bash reads from the variable and never from shell text. */
    COMMAND: "LUKE_COMMAND",
    /** The file `show_code` reads, relative to the checkout root, which its scripts read from the variable alone. */
    FILE: "LUKE_FILE",
    /** The first and last line of the window `show_code` reads, counted from one. */
    FIRST_LINE: "LUKE_FIRST_LINE",
    LAST_LINE: "LUKE_LAST_LINE",
    /** Who a coding agent's commits are by: the Luke GitHub App's bot and its noreply address, set in the checkout's own config. */
    GIT_NAME: "LUKE_GIT_NAME",
    GIT_EMAIL: "LUKE_GIT_EMAIL",
  },
} as const;
