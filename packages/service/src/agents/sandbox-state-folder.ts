/**
 * sandbox-state-folder.ts -- the folder our own state stands in within a sandbox, and the link that keeps one made before the rename reading it.
 *
 * Two folders of a sandbox hold what we keep there: the workspace's, beside
 * the checkout (its record and its deepen's), and the sandbox user's home's
 * (the browser's profile and recordings). A persistent sandbox resumes from
 * its own snapshot, so one made before the product's rename holds them
 * under the old name; every script that reaches them first links the new
 * name to the old one where only the old one stands, so nothing reads as
 * missing (a checkout record that did would clone the checkout again) and
 * nothing is moved while a running browser holds it open. A leaf importing
 * nothing, since the checkout's contract imports it.
 */

/** The folder our state stands in, under the workspace and under the sandbox user's home. */
export const SANDBOX_STATE_FOLDER = ".agent";

/** Where a sandbox made before the rename keeps it, read through the link and never written. */
const SANDBOX_STATE_FOLDER_BEFORE_RENAME = ".luke";

/**
 * The link, run from the folder the state folder stands in: the new name
 * linked to the old where only the old one stands, and nothing done
 * anywhere else. Note that it can go only once Vercel lists no sandbox made
 * before the rename (named `luke-agent-` and a UUID), because a sandbox in
 * steady use resumes from its own snapshot for as long as it lives.
 */
export const LINK_SANDBOX_STATE_FOLDER = `if [ -d ${SANDBOX_STATE_FOLDER_BEFORE_RENAME} ] && [ ! -e ${SANDBOX_STATE_FOLDER} ] && [ ! -L ${SANDBOX_STATE_FOLDER} ]; then ln -s ${SANDBOX_STATE_FOLDER_BEFORE_RENAME} ${SANDBOX_STATE_FOLDER}; fi`;
