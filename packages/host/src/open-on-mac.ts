import path from "node:path";

/**
 * open-on-mac.ts -- the script Open on this Mac runs in a terminal of this Mac drawn in Luke: a coding agent's pushed branch checked out in a worktree of the developer's own clone, and the repository's command run there.
 *
 * Luke does none of it itself. The script runs in the developer's login
 * shell with their own Git login, so their credentials, remotes, and tools
 * are the ones used. It fetches the branch into their clone, makes a
 * worktree for it under Luke's application data the first time (detached at
 * the branch's head, so a branch they have checked out elsewhere is never in
 * the way) and moves it forward with a fast-forward after that, which Git
 * refuses rather than overwrite anything changed there. Then it runs the
 * command from the worktree and leaves a login shell open in it, Ctrl-C
 * included. The script deletes itself as it starts. Every value in it is
 * quoted for the shell, never spliced in bare.
 */

/** The folder under the state root every agent branch's worktree lives in. */
const WORKTREES_FOLDER = "worktrees";

/** A word quoted for a POSIX shell. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Where a branch's worktree lives: under the state root, by repository, its branch's slashes made dashes. */
export function worktreeFolder(stateRoot: string, repository: string, branch: string): string {
  const [owner = "", name = ""] = repository.toLowerCase().split("/");
  return path.join(stateRoot, WORKTREES_FOLDER, owner, name, branch.replaceAll("/", "-"));
}

/** The script, its values quoted, that brings the branch into a worktree of the clone and runs the command there. */
export function openOnMacScript(input: {
  readonly clone: string;
  readonly worktree: string;
  readonly branch: string;
  readonly command: string;
  /** Where the script writes its terminal's device, which Luke resizes it through; none where nothing resizes it. */
  readonly ttyFile?: string | undefined;
  /** The terminal's size in cells as the tab first draws it. */
  readonly size?: { readonly cols: number; readonly rows: number } | undefined;
}): string {
  return [
    "#!/bin/bash",
    'rm -f "$0"',
    ...(input.ttyFile === undefined ? [] : [`tty > ${shellQuoted(input.ttyFile)}`]),
    ...(input.size === undefined
      ? []
      : [`stty rows ${Math.trunc(input.size.rows)} cols ${Math.trunc(input.size.cols)}`]),
    // An app opened from the Dock has a bare PATH; the login shell's is the one the developer's Git and tools live on.
    'PATH="$("${SHELL:-/bin/zsh}" -l -c \'printf %s "$PATH"\' 2>/dev/null || printf %s "$PATH")"',
    "export PATH",
    "set -e",
    `clone=${shellQuoted(input.clone)}`,
    `worktree=${shellQuoted(input.worktree)}`,
    `branch=${shellQuoted(input.branch)}`,
    `command=${shellQuoted(input.command)}`,
    'cd "$clone"',
    'echo "▸ Fetching $branch"',
    'git fetch origin "$branch"',
    'if [ -e "$worktree/.git" ]; then',
    '  cd "$worktree"',
    '  git fetch origin "$branch"',
    "  git merge --ff-only FETCH_HEAD",
    "else",
    '  mkdir -p "$(dirname "$worktree")"',
    '  git worktree add --detach "$worktree" FETCH_HEAD',
    '  cd "$worktree"',
    "fi",
    'echo "▸ Running $command"',
    // Note that Ctrl-C ends the command and not this script, so the shell after it still opens in the worktree.
    "trap : INT",
    '"${SHELL:-/bin/zsh}" -l -c "$command" || true',
    "trap - INT",
    'exec "${SHELL:-/bin/zsh}" -l',
    "",
  ].join("\n");
}
