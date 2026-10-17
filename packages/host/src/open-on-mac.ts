import path from "node:path";

/**
 * open-on-mac.ts -- the script Open on this Mac runs in a terminal of this Mac drawn in Luke: a coding agent's pushed branch checked out in a fresh, throwaway worktree of Luke's own clone of the repository, and a shell opened there.
 *
 * Nothing is asked of the developer first. Luke keeps one clone of each
 * repository under its application data, made the first time a branch of
 * it is opened. The script runs in the developer's login shell with their
 * own Git login, so their credentials and tools are the ones used: it
 * clones over HTTPS, and over SSH where that fails, without checking
 * anything out; fetches the branch; and checks it out, detached at the head
 * just fetched, in a new worktree of its own, so whatever the agent did to
 * the branch since, a force-push or a rebase among it, the worktree is the
 * branch as it stands. It runs the repository's run command there where
 * this Mac has one for it, and then opens a login shell in the worktree for
 * the developer to run what they like. The worktree lasts as long as the
 * terminal: once the shell exits or the terminal is closed or hung up, the
 * script removes it, and every open first sweeps away the worktrees of
 * earlier terminals that ended without removing theirs, each known by the
 * process that made it no longer running. Anything left uncommitted or
 * unpushed in a worktree goes with it. The script deletes itself as it
 * starts. Every value in it is quoted for the shell, never spliced in bare.
 */

/** The folders under the state root Luke's clones and every open terminal's worktree live in. */
const CLONES_FOLDER = "clones";
const WORKTREES_FOLDER = "worktrees";

/** A repository's owner and name as folder names, lowercased as GitHub matches them. */
function repositoryFolders(repository: string): readonly [string, string] {
  const [owner = "", name = ""] = repository.toLowerCase().split("/");
  return [owner, name];
}

/** Where Luke's own clone of a repository lives, under the state root. */
export function cloneFolder(stateRoot: string, repository: string): string {
  return path.join(stateRoot, CLONES_FOLDER, ...repositoryFolders(repository));
}

/** A word quoted for a POSIX shell. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The folder a repository's worktrees are made in, one for each terminal open on one of its branches, under the state root. */
export function worktreesFolder(stateRoot: string, repository: string): string {
  return path.join(stateRoot, WORKTREES_FOLDER, ...repositoryFolders(repository));
}

/** A branch as the start of a folder name: every character but a letter, a digit, a dot, an underscore, or a hyphen made a hyphen, so none reaches outside the folder. */
function branchFolderName(branch: string): string {
  return branch.replaceAll(/[^\w.-]/gu, "-").replace(/^\.+/u, "-");
}

/** The script, its values quoted, that brings the branch into a fresh worktree of Luke's clone, runs the command there where there is one, opens a shell, and removes the worktree once the terminal ends. */
export function openOnMacScript(input: {
  /** The repository as `owner/name`, cloned from GitHub the first time. */
  readonly repository: string;
  readonly clone: string;
  /** The folder the terminal's own worktree is made in, beside any other terminal's. */
  readonly worktrees: string;
  readonly branch: string;
  /** The repository's run command on this Mac, run in the worktree before the shell opens; none where it has none. */
  readonly command?: string | null | undefined;
  /** Where the script writes its terminal's device, which Luke resizes it through; none where nothing resizes it. */
  readonly ttyFile?: string | undefined;
  /** The terminal's size in cells as the tab first draws it. */
  readonly size?: { readonly cols: number; readonly rows: number } | undefined;
  /** Where the repository is cloned from, by protocol; GitHub's own unless a test names its own. */
  readonly remotes?: { readonly https: string; readonly ssh: string } | undefined;
}): string {
  const remotes = input.remotes ?? {
    https: `https://github.com/${input.repository}.git`,
    ssh: `git@github.com:${input.repository}.git`,
  };
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
    `clone=${shellQuoted(input.clone)}`,
    `worktrees=${shellQuoted(input.worktrees)}`,
    `branch=${shellQuoted(input.branch)}`,
    `https=${shellQuoted(remotes.https)}`,
    `ssh=${shellQuoted(remotes.ssh)}`,
    // A worktree's folder holds only what Git checks out; the process that made it is written beside it, in `<folder>.pid`.
    'mkdir -p "$worktrees"',
    `worktree="$(mktemp -d "$worktrees/"${shellQuoted(branchFolderName(input.branch))}".XXXXXX")" || worktree=`,
    'if [ -n "$worktree" ]; then echo "$$" > "$worktree.pid"; fi',
    "removed() {",
    '  rm -rf "$1"',
    '  rm -f "$1.pid"',
    '  if [ -d "$clone" ]; then git -C "$clone" worktree prune; fi',
    "}",
    "cleaned() {",
    // Note that the terminal's close hangs up and then terminates; neither cuts the removal short.
    "  trap '' HUP TERM INT",
    '  if [ -n "$worktree" ]; then removed "$worktree" > /dev/null 2>&1; fi',
    "}",
    "trap cleaned EXIT",
    "trap 'exit 129' HUP",
    "trap 'exit 143' TERM",
    // Note that a worktree whose process is no longer running was left by a terminal that ended without removing it.
    "swept() {",
    '  for pid_file in "$worktrees"/*.pid; do',
    '    [ -f "$pid_file" ] || continue',
    '    [ "$pid_file" = "$worktree.pid" ] && continue',
    '    pid="$(cat "$pid_file" 2>/dev/null)"',
    '    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then continue; fi',
    '    removed "${pid_file%.pid}"',
    "  done",
    "}",
    "( swept ) > /dev/null 2>&1",
    "opened() {",
    "  set -e",
    '  [ -n "$worktree" ]',
    '  if [ ! -e "$clone/.git" ]; then',
    '    echo "▸ Cloning ${https%.git}"',
    '    mkdir -p "$(dirname "$clone")"',
    '    rm -rf "$clone"',
    '    git clone --no-checkout --filter=blob:none "$https" "$clone" ||',
    '      { rm -rf "$clone"; git clone --no-checkout --filter=blob:none "$ssh" "$clone"; }',
    "  fi",
    '  cd "$clone"',
    '  echo "▸ Fetching $branch"',
    '  git fetch origin "$branch"',
    '  git worktree add --detach "$worktree" FETCH_HEAD',
    "}",
    // Note that a failed step is said and the shell still opens, in the worktree where it was made and the clone or home where not.
    '( opened ) || echo "▸ Could not bring $branch onto this Mac; the shell is yours to look into it."',
    'if [ -n "$worktree" ] && [ -e "$worktree/.git" ]; then',
    '  cd "$worktree"',
    '  echo "▸ $branch in $(pwd), a worktree removed when this terminal ends"',
    "else",
    '  if [ -d "$clone" ]; then cd "$clone"; fi',
    '  echo "▸ $branch not checked out; this shell is in $(pwd)"',
    "fi",
    // Note that Ctrl-C ends the command or reaches the shell, never this script, so the shell still opens and the worktree is still removed.
    "trap : INT",
    ...(input.command == null
      ? []
      : [
          `command=${shellQuoted(input.command)}`,
          'echo "▸ Running $command"',
          '"${SHELL:-/bin/zsh}" -l -c "$command" || true',
        ]),
    // Note that the shell is waited on rather than exec'd, so the worktree is removed once it exits.
    '"${SHELL:-/bin/zsh}" -l',
    "",
  ].join("\n");
}
