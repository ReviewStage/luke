import path from "node:path";

/**
 * open-on-mac.ts -- the script Open on this Mac runs in a terminal of this Mac drawn in Luke: a coding agent's pushed branch checked out in a worktree of Luke's own clone of the repository, and the repository's run command run there.
 *
 * Nothing is asked of the developer first. Luke keeps one clone of each
 * repository under `~/.luke`, shared by every Luke install, made the first
 * time a branch of it is opened, under a lock, and a worktree per branch
 * beside it; a worktree an earlier Luke kept under its application data is
 * left there and said. The script runs in the
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
 * was brought in, in the developer's login shell, and ends with it; it
 * opens no shell to type in, and Stop ends it. The script deletes
 * itself as it starts. Every value in it is quoted for the shell, never
 * spliced in bare.
 */

/**
 * Where every Luke install on this Mac keeps its clones and worktrees, shared
 * between them: a folder of the home folder whose path holds no space, so a
 * worktree reads to a repository's own scripts as any checkout of it would.
 */
export function worktreesRoot(home: string): string {
  return path.join(home, ".luke");
}

/** The folders under the root Luke's clones and every agent branch's worktree live in. */
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

/**
 * The tidy each open runs beside its run: it finishes deleting what an
 * earlier tidy moved aside, then moves aside every other worktree of the
 * repository, this Luke's and an earlier one's, whose branch GitHub no
 * longer has, which no run is using, which was not opened in the last day,
 * and which holds no change and no commit of the developer's, and an earlier
 * Luke's clone left with no worktree and no commit of the developer's. A
 * worktree is moved aside whole and its record pruned before it is deleted,
 * so one stopped half-way is never left half a worktree. GitHub unread, it
 * tidies nothing.
 */
const SWEEP = [
  "sweep() {",
  '  [ -n "$trash" ] || return 0',
  '  rm -rf "$trash"/* 2>/dev/null',
  '  live="$(git -C "$clone" ls-remote --heads origin)" || return 0',
  '  for each in "$(dirname "$worktree")"/* ${earlier_worktrees:+"$earlier_worktrees"/*}; do',
  '    [ -e "$each/.git" ] && [ "$each" != "$worktree" ] || continue',
  '    name="$(basename "$each")"',
  '    name="${name//+2F//}"',
  '    name="${name//%2F//}"',
  `    printf "%s\\n" "$live" | awk -v want="refs/heads/$name" '$2 == want { found = 1 } END { exit !found }' && continue`,
  '    gitdir="$(git -C "$each" rev-parse --absolute-git-dir 2>/dev/null)" || continue',
  '    holder="$(cat "$gitdir/luke-running" 2>/dev/null)"',
  '    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then continue; fi',
  '    [ -z "$(find "$gitdir/luke-opened-at" -mtime -1 2>/dev/null)" ] || continue',
  '    changes="$(git -C "$each" status --porcelain 2>/dev/null)" || continue',
  '    [ -z "$changes" ] || continue',
  '    mine="$(git -C "$each" rev-list --max-count=1 HEAD --not --remotes --glob=refs/luke/* 2>/dev/null)" || continue',
  '    [ -z "$mine" ] || continue',
  '    common="$(git -C "$each" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || continue',
  '    mkdir -p "$trash" && mv "$each" "$trash/$(date +%s)-$$-$(basename "$each")" || continue',
  '    git --git-dir="$common" worktree prune',
  '    echo "▸ Removed the worktree of $name, whose branch is gone from GitHub"',
  "  done",
  '  if [ -n "$earlier_clone" ] && [ -e "$earlier_clone/.git" ] &&',
  '    [ "$(git -C "$earlier_clone" worktree list --porcelain | grep -c "^worktree ")" = 1 ] &&',
  '    [ -z "$(git -C "$earlier_clone" rev-list --max-count=1 --branches --not --remotes --glob=refs/luke/*)" ]; then',
  '    mkdir -p "$trash" && mv "$earlier_clone" "$trash/$(date +%s)-$$-clone" &&',
  '      echo "▸ Removed the clone an earlier Luke kept at $earlier_clone"',
  "  fi",
  '  rm -rf "$trash"/* 2>/dev/null',
  "}",
];

/** The script, its values quoted, that brings the branch into a worktree of Luke's clone and runs the command there, where there is one; it ends with the command. */
export function openOnMacScript(input: {
  /** The repository as `owner/name`, cloned from GitHub the first time. */
  readonly repository: string;
  readonly clone: string;
  readonly worktree: string;
  readonly branch: string;
  /** The pull request from the branch, whose last head is opened where GitHub deleted the branch once it merged; none where it has none. */
  readonly pullRequest?: number | null | undefined;
  /** The repository's run command on this Mac, run in the worktree; none where it has none, which the script says. */
  readonly command?: string | null | undefined;
  /** The folder an earlier Luke kept this repository's worktrees in, under its application data, whose worktree of the branch is pointed to rather than moved; none for none. */
  readonly earlier?:
    | { readonly worktrees: string; readonly clone?: string | undefined }
    | undefined;
  /**
   * Where worktrees past their use are moved to be deleted, under the shared
   * root; none where the script tidies nothing. Each open tidies the
   * repository's other worktrees there: one whose branch is gone from
   * GitHub, that no run is using, not opened in the last day, and holding
   * nothing of the developer's, and an earlier Luke's clone left with none.
   */
  readonly trash?: string | undefined;
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
    `earlier_worktrees=${shellQuoted(input.earlier?.worktrees ?? "")}`,
    `earlier_clone=${shellQuoted(input.earlier?.clone ?? "")}`,
    `trash=${shellQuoted(input.trash ?? "")}`,
    `earlier_names=${shellQuoted(`${path.basename(input.worktree)} ${encodeURIComponent(input.branch)}`)}`,
    `pull=${input.pullRequest == null ? "''" : shellQuoted(String(Math.trunc(input.pullRequest)))}`,
    // Note that every step returns on failure by hand: `set -e` is ignored in a function called from an `||` list, as this one is.
    // Note that every Luke install shares the clone, so the whole of bringing a branch in, its clone, fetch, worktree and config, is done under a lock, released however it ends.
    "opened() {",
    '  mkdir -p "$(dirname "$clone")" || return 1',
    '  lock="$clone.lock"',
    "  waited=0",
    '  until mkdir "$lock" 2>/dev/null; do',
    '    holder="$(cat "$lock/pid" 2>/dev/null)"',
    // Note that a lock is taken over only from a holder that is gone, or from one that never wrote its id in half a minute; never from one alive, however long it takes.
    '    if [ -n "$holder" ]; then',
    '      if ! kill -0 "$holder" 2>/dev/null; then rm -rf "$lock"; continue; fi',
    "      waited=0",
    '    elif [ "$waited" -ge 30 ]; then',
    '      rm -rf "$lock"',
    "      continue",
    "    fi",
    "    sleep 1",
    "    waited=$((waited + 1))",
    "  done",
    '  echo "$$" > "$lock/pid"',
    "  brought_in",
    "  ended=$?",
    '  rm -rf "$lock"',
    '  return "$ended"',
    "}",
    "brought_in() {",
    '  if [ ! -e "$clone/.git" ]; then',
    '    echo "▸ Cloning ${https%.git}"',
    '    rm -rf "$clone"',
    '    git clone --no-checkout --filter=blob:none "$https" "$clone" ||',
    '      { rm -rf "$clone"; git clone --no-checkout --filter=blob:none "$ssh" "$clone"; } || return 1',
    "  fi",
    '  cd "$clone" || return 1',
    '  echo "▸ Fetching $branch"',
    // Note that each branch is fetched into a ref of its own, never FETCH_HEAD, which two opens of the shared clone at once would write over each other.
    '  if git fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"; then',
    '    fetched="refs/remotes/origin/$branch"',
    "  else",
    // Note that GitHub deletes a pull request's branch once it merges, and keeps its last head under refs/pull for good.
    '    [ -n "$pull" ] || return 1',
    '    echo "▸ $branch is no longer on GitHub, as once its pull request merged; fetching the last head of pull request #$pull instead"',
    '    git fetch origin "+refs/pull/$pull/head:refs/luke/pull/$pull" || return 1',
    '    fetched="refs/luke/pull/$pull"',
    "  fi",
    // Note that the head is read once, in the clone, as a commit every worktree of it shares, so the worktree fetches nothing of its own.
    '  head="$(git rev-parse --verify --quiet "$fetched^{commit}")" || return 1',
    // Note that a worktree an earlier Luke made of the branch under its application data is left there, with anything of the developer's in it, and said.
    '  if [ ! -e "$worktree" ] && [ -n "$earlier_worktrees" ]; then',
    "    for name in $earlier_names; do",
    '      if [ -e "$earlier_worktrees/$name/.git" ]; then',
    '        echo "▸ An earlier worktree of $branch stays at $earlier_worktrees/$name, anything of yours in it kept there; this one is made fresh."',
    "        break",
    "      fi",
    "    done",
    "  fi",
    // Note that a commit is the developer's own where neither GitHub, the head just fetched, nor the head Luke last checked out holds it; one that cannot be read is taken for theirs.
    "  unpushed() {",
    '    found="$(git rev-list --max-count=1 "$1" --not --remotes --glob=refs/luke/* "$head" ${opened:+"$opened"})" || return 0',
    '    [ -n "$found" ]',
    "  }",
    "  opened=",
    "  current=",
    '  if [ -e "$worktree/.git" ]; then',
    '    cd "$worktree" || return 1',
    '    changes="$(git status --porcelain)" || return 1',
    '    if [ -n "$changes" ]; then',
    '      echo "▸ The worktree has changes of its own; left as it stands rather than overwritten."',
    "      return 1",
    "    fi",
    // Note that the head Luke last checked out is kept as a ref of the worktree's own, so an agent's force-push over it is taken.
    '    current="$(git rev-parse --verify --quiet HEAD)" || return 1',
    '    opened="$(git rev-parse --verify --quiet refs/worktree/luke-opened)"',
    '    if unpushed "$current"; then',
    '      echo "▸ The worktree has commits of its own not on GitHub; left as it stands rather than overwritten."',
    "      return 1",
    "    fi",
    "  fi",
    '  if git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null && unpushed "refs/heads/$branch"; then',
    '    echo "▸ The branch $branch in $clone has commits of its own not on GitHub; left as it stands rather than overwritten."',
    "    return 1",
    "  fi",
    // Note that the clone, which checks nothing out, may hold the branch as its own HEAD, which no worktree may hold beside it.
    '  if [ "$(git -C "$clone" symbolic-ref --quiet HEAD)" = "refs/heads/$branch" ]; then',
    '    git -C "$clone" update-ref --no-deref HEAD HEAD || return 1',
    "  fi",
    '  if [ -n "$current" ]; then',
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
    // Note that when the worktree was last opened is kept beside Git's own record of it, which a tidy reads.
    '  touch "$(git rev-parse --absolute-git-dir)/luke-opened-at"',
    "}",
    // Note that a failed step is said, and the run ends there, never running the command on a stale or missing checkout.
    "if ! ( opened ); then",
    '  echo "▸ Could not bring $branch onto this Mac. Open in Terminal to look into it."',
    "  exit 1",
    "fi",
    'cd "$worktree" || exit 1',
    ...SWEEP,
    // Note that the tidy runs beside the run, so a slow network or a large delete never holds the run up.
    "( sweep ) &",
    // Note that the run's id is kept beside Git's record of the worktree, so a tidy from any Luke leaves a worktree in use alone; the command takes the script's place, keeping its id.
    'echo "$$" > "$(git rev-parse --absolute-git-dir)/luke-running"',
    'echo "▸ $branch in $(pwd)"',
    ...(input.command == null
      ? [
          'echo "▸ No run command is set for this repository on this Mac. Set one in Settings, under Workspace, Repositories, then press Run."',
        ]
      : [
          `command=${shellQuoted(input.command)}`,
          'echo "▸ Running $command"',
          // Note that the command takes the script's place, so its exit is the run's, and Stop reaches it as the terminal's own.
          'exec "${SHELL:-/bin/zsh}" -l -c "$command"',
        ]),
    "",
  ].join("\n");
}
