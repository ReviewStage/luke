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
 * branch's worktree the first time, on a local branch of the same name
 * tracking GitHub's, and after that resets that branch to the head just
 * fetched, so a branch the agent
 * force-pushed or rebased opens as readily as one it pushed more to; a
 * branch GitHub deleted once its pull request merged opens at that pull
 * request's last head, which GitHub keeps; while
 * what Git ignores there, installed dependencies and build output among it,
 * is kept for the next run. A worktree with changes of the developer's own,
 * a tracked file edited or a file Git does not ignore added, is left as it
 * stands and said, rather than overwritten, and so is one with commits of
 * the developer's own that the fetched head does not hold. The first step that fails
 * ends the bringing there, and is the only failure said. The script runs the repository's
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
 * A branch as one folder name: percent-encoded, so no two branches share a
 * folder and none reaches outside it, with `+` in place of `%`, which no
 * encoded name holds otherwise. A `%` in a folder breaks the `file://` URL
 * Electron's `loadFile` makes of a path in it, which a build of Luke's own
 * desktop loads its windows from.
 */
function branchFolder(branch: string): string {
  return encodeURIComponent(branch).replaceAll("%", "+");
}

/** Where a branch's worktree lives: under the state root, by repository, its branch one folder name. */
export function worktreeFolder(stateRoot: string, repository: string, branch: string): string {
  return path.join(
    stateRoot,
    WORKTREES_FOLDER,
    ...repositoryFolders(repository),
    branchFolder(branch),
  );
}

/** The script, its values quoted, that brings the branch into a worktree of Luke's clone, runs the command there where there is one, and opens a shell. */
export function openOnMacScript(input: {
  /** The repository as `owner/name`, cloned from GitHub the first time. */
  readonly repository: string;
  readonly clone: string;
  readonly worktree: string;
  readonly branch: string;
  /** The pull request from the branch, whose last head is opened where GitHub deleted the branch once it merged; none where it has none. */
  readonly pullRequest?: number | null | undefined;
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
    `legacy=${shellQuoted(path.join(path.dirname(input.worktree), encodeURIComponent(input.branch)))}`,
    `pull=${input.pullRequest == null ? "''" : shellQuoted(String(Math.trunc(input.pullRequest)))}`,
    // Note that every step returns on failure by hand: `set -e` is ignored in a function called from an `||` list, as this one is.
    "opened() {",
    '  if [ ! -e "$clone/.git" ]; then',
    '    echo "▸ Cloning ${https%.git}"',
    '    mkdir -p "$(dirname "$clone")" || return 1',
    '    rm -rf "$clone"',
    '    git clone --no-checkout --filter=blob:none "$https" "$clone" ||',
    '      { rm -rf "$clone"; git clone --no-checkout --filter=blob:none "$ssh" "$clone"; } || return 1',
    "  fi",
    '  cd "$clone" || return 1',
    // Note that the clone, which checks nothing out, holds no branch, so a worktree may hold any, its default branch among them.
    "  if git symbolic-ref --quiet HEAD >/dev/null; then git update-ref --no-deref HEAD HEAD || return 1; fi",
    '  echo "▸ Fetching $branch"',
    '  if ! git fetch origin "$branch"; then',
    // Note that GitHub deletes a pull request's branch once it merges, and keeps its last head under refs/pull for good.
    '    [ -n "$pull" ] || return 1',
    '    echo "▸ $branch is no longer on GitHub, as once its pull request merged; fetching the last head of pull request #$pull instead"',
    '    git fetch origin "refs/pull/$pull/head" || return 1',
    "  fi",
    // Note that the head is read once, in the clone, as a commit every worktree of it shares, so the worktree fetches nothing of its own.
    '  head="$(git rev-parse --verify --quiet "FETCH_HEAD^{commit}")" || return 1',
    // Note that a worktree made under its earlier, percent-encoded folder is moved to its folder now, what it holds kept; one Git will not move, as one holding submodules, is left where it stands and a fresh one made.
    '  if [ "$legacy" != "$worktree" ] && [ ! -e "$worktree" ] && [ -e "$legacy/.git" ]; then',
    '    echo "▸ Moving the worktree to $worktree"',
    '    mkdir -p "$(dirname "$worktree")" || return 1',
    '    git worktree move "$legacy" "$worktree" ||',
    '      echo "▸ Could not move it; left at $legacy, and a fresh worktree made"',
    "  fi",
    '  if [ -e "$worktree/.git" ]; then',
    '    cd "$worktree" || return 1',
    '    changes="$(git status --porcelain)" || return 1',
    '    if [ -n "$changes" ]; then',
    '      echo "▸ The worktree has changes of its own; left as it stands rather than overwritten."',
    "      return 1",
    "    fi",
    // Note that the head Luke last checked out is kept as a ref of the worktree's own; one moved on from it to a commit the fetched head does not hold is a commit of the developer's.
    '    current="$(git rev-parse --verify --quiet HEAD)" || return 1',
    '    opened="$(git rev-parse --verify --quiet refs/worktree/luke-opened)"',
    '    if [ -n "$opened" ] && [ "$current" != "$opened" ] && ! git merge-base --is-ancestor "$current" "$head"; then',
    '      echo "▸ The worktree has commits of its own not on GitHub; left as it stands rather than overwritten."',
    "      return 1",
    "    fi",
    // Note that the branch is reset to the fetched head, which takes it as it now stands, a force-push or a rebase among it; with nothing changed there it has nothing to overwrite, and it leaves ignored files alone.
    '    git checkout --quiet -B "$branch" "$head" || return 1',
    "  else",
    '    mkdir -p "$(dirname "$worktree")" || return 1',
    // Note that a worktree folder deleted by hand is still registered, which would refuse it being made again.
    "    git worktree prune --expire now || return 1",
    '    git worktree add --quiet -B "$branch" "$worktree" "$head" || return 1',
    '    cd "$worktree" || return 1',
    "  fi",
    // Note that the worktree is on the branch itself, never a detached head, so a script that names its run by the branch, as `run.sh --preview` names its instance, names the same one each time, and a commit made there pushes back to it.
    '  git config "branch.$branch.remote" origin || return 1',
    '  git config "branch.$branch.merge" "refs/heads/$branch" || return 1',
    '  git update-ref refs/worktree/luke-opened "$head" || return 1',
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
