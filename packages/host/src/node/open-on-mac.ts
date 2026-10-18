import path from "node:path";

/**
 * open-on-mac.ts -- the script Open on this Mac runs in a terminal of this Mac drawn in Luke: a coding agent's pushed branch checked out in a worktree of Luke's own clone of the repository, and a shell opened there.
 *
 * Nothing is asked of the developer first. Luke keeps one clone of each
 * repository under its application data, made the first time a branch of
 * it is opened, and a worktree per branch beside it. The script runs in the
 * developer's login shell with their own Git login, so their credentials
 * and tools are the ones used: it clones over HTTPS, and over SSH where
 * that fails, without checking anything out; fetches the branch; makes the
 * branch's worktree the first time, detached at its head, and after that
 * checks the head just fetched out over it, so a branch the agent
 * force-pushed or rebased opens as readily as one it pushed more to, while
 * what Git ignores there, installed dependencies and build output among it,
 * is kept for the next run. A worktree with changes of the developer's own,
 * a tracked file edited or a file Git does not ignore added, is left as it
 * stands and said, rather than overwritten. The script runs the repository's
 * run command in the worktree where this Mac has one for it and the branch
 * was brought in, and then opens a login shell there for the developer to
 * run what they like. The script deletes
 * itself as it starts. Every value in it is quoted for the shell, never
 * spliced in bare.
 */

/** The folders under the state root Luke's clones and every agent branch's worktree live in. */
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

/**
 * Where a branch's worktree lives: under the state root, by repository, its
 * branch percent-encoded into one folder name, so no two branches share a
 * folder and none reaches outside it.
 */
export function worktreeFolder(stateRoot: string, repository: string, branch: string): string {
  return path.join(
    stateRoot,
    WORKTREES_FOLDER,
    ...repositoryFolders(repository),
    encodeURIComponent(branch),
  );
}

/** The script, its values quoted, that brings the branch into a worktree of Luke's clone, runs the command there where there is one, and opens a shell. */
export function openOnMacScript(input: {
  /** The repository as `owner/name`, cloned from GitHub the first time. */
  readonly repository: string;
  readonly clone: string;
  readonly worktree: string;
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
    `worktree=${shellQuoted(input.worktree)}`,
    `branch=${shellQuoted(input.branch)}`,
    `https=${shellQuoted(remotes.https)}`,
    `ssh=${shellQuoted(remotes.ssh)}`,
    "opened() {",
    "  set -e",
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
    '  if [ -e "$worktree/.git" ]; then',
    '    cd "$worktree"',
    // Note that a worktree keeps its own FETCH_HEAD, so it fetches the branch itself.
    '    git fetch origin "$branch"',
    '    if [ -n "$(git status --porcelain)" ]; then',
    '      echo "▸ The worktree has changes of its own; left as it stands rather than overwritten."',
    "      return 1",
    "    fi",
    // Note that a checkout of the fetched head takes the branch as it now stands, a force-push or a rebase among it; with nothing changed there it has nothing to overwrite, and it leaves ignored files alone.
    "    git checkout --quiet --detach FETCH_HEAD",
    "  else",
    '    mkdir -p "$(dirname "$worktree")"',
    '    git worktree add --detach "$worktree" FETCH_HEAD',
    "  fi",
    "}",
    // Note that a failed step is said and the shell still opens, in the worktree where it stands and the clone or home where not.
    "brought=",
    '( opened ) && brought=1 || echo "▸ Could not bring $branch onto this Mac; the shell is yours to look into it."',
    'if [ -d "$worktree" ]; then cd "$worktree"; elif [ -d "$clone" ]; then cd "$clone"; fi',
    'echo "▸ $branch in $(pwd)"',
    ...(input.command == null
      ? []
      : [
          // Note that the command runs only on the branch as just brought in, never on a stale or missing checkout.
          'if [ -n "$brought" ]; then',
          `  command=${shellQuoted(input.command)}`,
          '  echo "▸ Running $command"',
          // Note that Ctrl-C ends the command and not this script, so the shell after it still opens.
          "  trap : INT",
          '  "${SHELL:-/bin/zsh}" -l -c "$command" || true',
          "  trap - INT",
          "fi",
        ]),
    'exec "${SHELL:-/bin/zsh}" -l',
    "",
  ].join("\n");
}
