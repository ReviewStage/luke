/**
 * sandbox-capabilities.ts -- how a command a person or a model drives runs in an agent's sandbox: with every Linux capability dropped.
 *
 * A Vercel Sandbox starts every command as its default user holding the
 * whole capability set, ambient and inheritable, with no sudo needed: such a
 * process reads `/etc/shadow`, the environment of another user's process
 * through `/proc/<pid>/environ`, and any file whatever its mode, and
 * bubblewrap refuses to start under it, and it reaches root whatever sudoers
 * says, so taking its sudo away would take none of that away; the image
 * keeps it (`agent-runtime/sandbox.ts`), since the sandbox's API runs a root
 * command through it. This drop is the boundary instead: a Terminal tab's
 * shells (`terminal/tmux.ts`), the commands a coding agent and its workers
 * run (`coder-host/shell.ts`), the native runner, which root drops to the
 * `agent` user (`coder-host/runner-sessions.ts`), the agent's browser
 * (`browser/sandbox-browser.ts`), and `show_code`'s reads of the checkout
 * (`../tasks/show-code.ts`) start under `setpriv` with the
 * inheritable, ambient, and bounding sets emptied: they run as the same user
 * on the same files, and can neither use a capability nor gain one back,
 * through sudo or any other setuid program: with the bounding set empty,
 * sudo fails as "unable to change to root gid". Note that emptying the bounding
 * set takes the capability to change it, which the sandbox's API grants
 * every command it starts, so the drop is applied once, at that start, and
 * a command that cannot apply it fails rather than running with the set.
 * Luke's own commands (the checkout, the image's preparation) keep the set.
 *
 * A leaf importing nothing, because every tool file of the coding agent
 * bundles the shell that reads it.
 */

/** `setpriv`'s flags that empty the inheritable, ambient, and bounding capability sets. */
const DROP_CAPABILITIES = [
  "--inh-caps=-all",
  "--ambient-caps=-all",
  "--bounding-set=-all",
] as const;

/** The program, and the arguments ahead of a command's own argv, that run that command with every capability dropped. */
export const WITHOUT_CAPABILITIES = {
  COMMAND: "setpriv",
  ARGS: [...DROP_CAPABILITIES, "--"],
} as const;

/** A string as one single-quoted shell word. */
function shellWord(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * Shell text that runs the script given in a bash of its own with every
 * capability dropped, in place of the shell that reads it. The script is
 * one quoted word, run whole as it was written; the shell's exported
 * environment and working directory carry over.
 */
export function shellWithoutCapabilities(script: string): string {
  return `exec ${WITHOUT_CAPABILITIES.COMMAND} ${WITHOUT_CAPABILITIES.ARGS.join(" ")} /bin/bash -c ${shellWord(script)}`;
}
