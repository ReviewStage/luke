import path from "node:path";
import { SALVAGE_FACT } from "../local-agent-salvage.js";

/**
 * open-on-mac.ts -- the scripts a local agent's repository is made and read with on this Mac, from the app's own clone of the repository.
 *
 * The app keeps one clone of each repository under `~/.vespin`, shared by
 * every install, made the first time an agent of it starts, under a lock.
 * The scripts run in the developer's login shell with their own Git login,
 * so their credentials and tools are the ones used: the clone is made over
 * HTTPS, and over SSH where that fails, without checking anything out. Every
 * value in a script is quoted for the shell, never spliced in bare.
 */

/**
 * Where every install on this Mac keeps its clones, shared between them: a
 * folder of the home folder whose path holds no space, so a repository made
 * from one reads to its own scripts as any checkout of it would.
 */
export function worktreesRoot(home: string): string {
  return path.join(home, ".vespin");
}

/** The folder under the root the app's clones live in. */
const CLONES_FOLDER = "clones";

/** A repository's owner and name as folder names, lowercased as GitHub matches them. */
function repositoryFolders(repository: string): readonly [string, string] {
  const [owner = "", name = ""] = repository.toLowerCase().split("/");
  return [owner, name];
}

/** Where the app's own clone of a repository lives, under the state root. */
export function cloneFolder(stateRoot: string, repository: string): string {
  return path.join(stateRoot, CLONES_FOLDER, ...repositoryFolders(repository));
}

/** A word quoted for a POSIX shell. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * `opened`, which takes the shared clone's lock, runs `brought_in` under it,
 * and lets go however it ends, and `cloned`, which makes the clone the first
 * time, over HTTPS and over SSH where that fails, checking nothing out. Every
 * install shares the clone, so the whole of bringing a branch in, its
 * clone, fetch, worktree and config, is done under the lock. A script defines
 * `brought_in`, and sets `clone`, `https`, and `ssh`, before it calls `opened`.
 */
const SHARED_CLONE = [
  "opened() {",
  '  mkdir -p "$(dirname "$clone")" || return 1',
  '  lock="$clone.lock"',
  "  waited=0",
  '  until mkdir "$lock" 2>/dev/null; do',
  '    holder="$(cat "$lock/pid" 2>/dev/null)"',
  // Note that a lock is taken over only from a holder that is gone, or from one that never wrote its id in half a minute; never from one alive, however long it takes.
  '    if [ -n "$holder" ]; then',
  // Note that the id is read again once its holder is found gone, since a holder lets go as it ends, and another open may have taken the lock since the first read; only a lock still naming the one gone is deleted.
  '      if ! kill -0 "$holder" 2>/dev/null; then',
  '        [ "$(cat "$lock/pid" 2>/dev/null)" = "$holder" ] && rm -rf "$lock"',
  "        continue",
  "      fi",
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
  "cloned() {",
  '  [ -e "$clone/.git" ] && return 0',
  '  echo "▸ Cloning ${https%.git}"',
  '  rm -rf "$clone"',
  '  git clone --no-checkout --filter=blob:none "$https" "$clone" ||',
  '    { rm -rf "$clone"; git clone --no-checkout --filter=blob:none "$ssh" "$clone"; }',
  "}",
];

/**
 * An agent's own repository, made from the shared clone at `$head`: the
 * shared clone is its first origin, which a partial fetch of commits and
 * trees alone is had from (the shared clone serving the filter it was
 * cloned with), and GitHub its origin after, which `checkout` has the head's
 * blobs from as a partial clone's promisor.
 */
const OWN_REPOSITORY = [
  "made_own() {",
  '  git init --quiet "$worktree" || return 1',
  '  cd "$worktree" || return 1',
  '  git remote add origin "$clone" || return 1',
  "  git config core.repositoryformatversion 1 || return 1",
  "  git config extensions.partialClone origin || return 1",
  "  git config remote.origin.promisor true || return 1",
  "  git config remote.origin.partialCloneFilter blob:none || return 1",
  '  git fetch --quiet --no-tags --filter=blob:none --upload-pack="git -c uploadpack.allowFilter=true upload-pack" origin "+$fetched:$fetched" || return 1',
  '  git remote set-url origin "$https" || return 1',
  '  git checkout --quiet --detach "$head"',
  "}",
];

/**
 * The script, its values quoted, that makes a local agent's own repository
 * (`@repo/host`'s `compose-local-agents.ts`), at the head of the branch the
 * agent starts from, or of GitHub's default branch where it names none,
 * read in our own clone of the repository, under its lock. The agent's work stays in its own folder,
 * and a worktree's Git folder would stand in the shared clone, so the agent
 * gets a repository of its own: fetched from the shared clone at that head,
 * its commits and trees only, then pointed at GitHub, which every blob it
 * lacks is had from as it is needed, through the agent's own GitHub
 * credential. Nothing of the shared clone, nor of another agent's work in it, is
 * copied in beyond that head's history. A repository already made is left
 * as it stands, since it holds the agent's work, and one left half made is
 * taken away, so the next launch makes it again. It ends with its failure
 * where a step fails, having said which.
 */
export function agentWorktreeScript(input: {
  /** The repository as `owner/name`, cloned from GitHub the first time. */
  readonly repository: string;
  readonly clone: string;
  readonly worktree: string;
  /** The branch the agent starts from; none for GitHub's default branch. */
  readonly branch: string | null;
  /** Where the repository is cloned from, by protocol; GitHub's own unless a test names its own. */
  readonly remotes?: { readonly https: string; readonly ssh: string } | undefined;
}): string {
  const remotes = input.remotes ?? {
    https: `https://github.com/${input.repository}.git`,
    ssh: `git@github.com:${input.repository}.git`,
  };
  return [
    // An app opened from the Dock has a bare PATH; the login shell's is the one the developer's Git and tools live on.
    'PATH="$("${SHELL:-/bin/zsh}" -l -c \'printf %s "$PATH"\' 2>/dev/null || printf %s "$PATH")"',
    "export PATH",
    `clone=${shellQuoted(input.clone)}`,
    `worktree=${shellQuoted(input.worktree)}`,
    `branch=${shellQuoted(input.branch ?? "")}`,
    `https=${shellQuoted(remotes.https)}`,
    `ssh=${shellQuoted(remotes.ssh)}`,
    ...SHARED_CLONE,
    "brought_in() {",
    "  cloned || return 1",
    '  cd "$clone" || return 1',
    '  if [ -n "$branch" ]; then',
    '    git fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch" || return 1',
    '    fetched="refs/remotes/origin/$branch"',
    "  else",
    // Note that the default branch is fetched by GitHub's own HEAD into a ref of its own, never FETCH_HEAD, which another open of the shared clone may write over.
    '    git fetch origin "+HEAD:refs/agent/default-head" || return 1',
    '    fetched="refs/agent/default-head"',
    "  fi",
    '  head="$(git rev-parse --verify --quiet "$fetched^{commit}")" || return 1',
    '  mkdir -p "$(dirname "$worktree")" || return 1',
    '  making="$worktree.making"',
    '  rm -rf "$making" || return 1',
    // Note that the repository is made beside its place and moved in whole, so one left half made never stands where the next launch would make it again.
    '  ( worktree="$making"; made_own ) || { rm -rf "$making"; return 1; }',
    '  if [ -e "$worktree" ]; then rmdir "$worktree" || { rm -rf "$making"; return 1; }; fi',
    '  mv "$making" "$worktree"',
    "}",
    ...OWN_REPOSITORY,
    '[ -e "$worktree/.git" ] && exit 0',
    "if ! ( opened ); then",
    '  echo "▸ Could not make the agent\'s worktree of ${branch:-the default branch}." >&2',
    "  exit 1",
    "fi",
    "",
  ].join("\n");
}

/**
 * The script, its path quoted, that says what a discard would lose from a
 * local agent's worktree (`@repo/host`'s `compose-local-agents.ts`): it
 * prints one line, and exits 0, when the worktree holds work that is nowhere
 * else, changes `git status --porcelain` shows, commits its upstream does
 * not hold, or, with no upstream, commits on no remote branch of our
 * shared clone nor a head it fetched, a local branch, checked out or not,
 * with commits on no such branch or head, a stash, or files in a folder with no
 * repository. It prints nothing and exits 0 for a worktree with nothing to
 * lose, or none at all, and exits 1 where Git could
 * not say, which the caller takes as work to keep. Note that it fetches
 * nothing, so a remote branch is read as the worktree last knew it, which
 * at worst keeps work GitHub already has.
 */
export function agentUnsavedWorkScript(input: { readonly worktree: string }): string {
  return [
    // An app opened from the Dock has a bare PATH; the login shell's is the one the developer's Git lives on.
    'PATH="$("${SHELL:-/bin/zsh}" -l -c \'printf %s "$PATH"\' 2>/dev/null || printf %s "$PATH")"',
    "export PATH",
    `worktree=${shellQuoted(input.worktree)}`,
    '[ -d "$worktree" ] || exit 0',
    'cd "$worktree" || exit 1',
    // Note that a folder with no repository, as an agent with none gets, holds what the agent wrote and nothing else has a copy.
    "if [ ! -e .git ]; then",
    '  files="$(ls -A)" || exit 1',
    '  [ -z "$files" ] || echo "it has files and no repository"',
    "  exit 0",
    "fi",
    // Note that untracked files are asked for by name, since the developer's own `status.showUntrackedFiles` would hide them.
    'changes="$(git status --porcelain --untracked-files=all)" || exit 1',
    'if [ -n "$changes" ]; then',
    '  echo "it has changes not committed"',
    "  exit 0",
    "fi",
    // Note that the upstream is asked for quietly, since a branch with none is the common case and no failure.
    "if git rev-parse --verify --quiet '@{upstream}' >/dev/null; then",
    `  ahead="$(git rev-list --max-count=1 HEAD --not '@{upstream}')" || exit 1`,
    '  if [ -n "$ahead" ]; then',
    '    echo "it has commits its upstream does not"',
    "    exit 0",
    "  fi",
    "else",
    // Note that the heads we fetched into refs/agent are GitHub's too, which the agent's own commits are not.
    `  ahead="$(git rev-list --max-count=1 HEAD --not --remotes --glob='refs/agent/*')" || exit 1`,
    '  if [ -n "$ahead" ]; then',
    '    echo "it has commits on no remote branch"',
    "    exit 0",
    "  fi",
    "fi",
    // Note that a branch the agent left for another holds its commits as surely as the one checked out.
    `ahead="$(git rev-list --max-count=1 --branches --not --remotes --glob='refs/agent/*')" || exit 1`,
    'if [ -n "$ahead" ]; then',
    '  echo "it has a branch with commits on no remote branch"',
    "  exit 0",
    "fi",
    "if git rev-parse --verify --quiet refs/stash >/dev/null; then",
    '  echo "it has changes stashed"',
    "fi",
    "exit 0",
    "",
  ].join("\n");
}

/**
 * Git run in the agent's repository with nothing of the developer's or the
 * agent's that could run code: a clean environment, no system or global
 * config, no prompt, no fetch of a promisor's missing objects, no fsmonitor
 * and no hooks, so the repository's own config starts nothing.
 */
const SALVAGE_GIT = [
  "g() {",
  '  env -i PATH="$PATH" LANG=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0 GIT_PAGER=cat \\',
  '    git -c core.fsmonitor= -c core.hooksPath=/dev/null "$@"',
  "}",
];

/**
 * The script, its values quoted, that saves into `salvage` what a local
 * agent's worktree holds that is nowhere else (`@repo/host`'s
 * `compose-local-agents.ts`), before its folder is removed whatever it holds:
 * a bundle of its commits on no remote branch (`SALVAGE_FACT.COMMITS`), a
 * binary diff of its changes to tracked files (`CHANGES`), and a tar of its
 * untracked files (`UNTRACKED`), or of the whole folder where it has no
 * repository (`FILES`). The bundle and the diff are always kept; a tar that
 * would take the salvage past `maxBytes` is not written, and it says so
 * (`SKIPPED`). It prints each fact as a line and exits 0 once all is
 * written, and exits 1 where a step fails, which keeps the folder.
 */
export function agentSalvageScript(input: {
  readonly worktree: string;
  readonly salvage: string;
  readonly maxBytes: number;
}): string {
  return [
    // An app opened from the Dock has a bare PATH; the login shell's is the one the developer's Git lives on.
    'PATH="$("${SHELL:-/bin/zsh}" -l -c \'printf %s "$PATH"\' 2>/dev/null || printf %s "$PATH")"',
    "export PATH",
    `worktree=${shellQuoted(input.worktree)}`,
    `salvage=${shellQuoted(input.salvage)}`,
    `cap=${Math.floor(input.maxBytes)}`,
    ...SALVAGE_GIT,
    // Note that the tar is cut one byte past the room left, so a tar too big is known by its size and never fills the disk.
    "tarred() {",
    '  room="$1"; shift',
    '  if [ "$room" -le 0 ]; then return 2; fi',
    '  tar -c -f - "$@" | head -c "$((room + 1))" > "$salvage/$name"',
    '  made="${PIPESTATUS[0]}"',
    '  if [ "$(wc -c < "$salvage/$name")" -gt "$room" ]; then rm -f "$salvage/$name"; return 2; fi',
    '  [ "$made" -eq 0 ] || return 1',
    "}",
    "umask 077",
    'mkdir -p "$salvage" || exit 1',
    '[ -d "$worktree" ] || exit 0',
    'cd "$worktree" || exit 1',
    "if [ ! -e .git ]; then",
    '  [ -n "$(ls -A)" ] || exit 0',
    "  name=files.tar",
    `  tarred "$cap" . && { echo "${SALVAGE_FACT.FILES} $name"; exit 0; }`,
    '  [ "$?" -eq 2 ] || exit 1',
    `  echo "${SALVAGE_FACT.SKIPPED} the folder's files, past $cap bytes"`,
    "  exit 0",
    "fi",
    'head="$(g rev-parse --verify --quiet HEAD)" || head=""',
    `[ -z "$head" ] || echo "${SALVAGE_FACT.HEAD} $head"`,
    'origin="$(g config --get remote.origin.url)" || origin=""',
    `[ -z "$origin" ] || echo "${SALVAGE_FACT.ORIGIN} $origin"`,
    // Note that the head, every local branch and the stash are bundled, so a commit the agent left on any of them comes back.
    "set -- --branches",
    '[ -z "$head" ] || set -- HEAD "$@"',
    'if g rev-parse --verify --quiet refs/stash >/dev/null; then set -- "$@" refs/stash; fi',
    `ahead="$(g rev-list --max-count=1 "$@" --not --remotes --glob='refs/agent/*')" || exit 1`,
    'if [ -n "$ahead" ]; then',
    `  g bundle create "$salvage/commits.bundle" "$@" --not --remotes --glob='refs/agent/*' 2>/dev/null || exit 1`,
    `  echo "${SALVAGE_FACT.COMMITS} commits.bundle"`,
    "fi",
    'if [ -n "$head" ]; then',
    '  g diff --binary --no-ext-diff --no-textconv --no-color --src-prefix=a/ --dst-prefix=b/ HEAD > "$salvage/changes.diff" || exit 1',
    '  if [ -s "$salvage/changes.diff" ]; then',
    `    echo "${SALVAGE_FACT.CHANGES} changes.diff"`,
    "  else",
    '    rm -f "$salvage/changes.diff"',
    "  fi",
    "fi",
    // Note that untracked files are asked for by name, since the developer's own `status.showUntrackedFiles` would hide them.
    'listed="$salvage/.untracked"',
    'g ls-files -z --others --exclude-standard > "$listed" || exit 1',
    'if [ -s "$listed" ]; then',
    "  used=0",
    '  for kept in "$salvage/commits.bundle" "$salvage/changes.diff"; do',
    '    [ -f "$kept" ] && used=$((used + $(wc -c < "$kept")))',
    "  done",
    "  name=untracked.tar",
    '  if tarred "$((cap - used))" --null -T "$listed"; then',
    `    echo "${SALVAGE_FACT.UNTRACKED} $name"`,
    '  elif [ "$?" -eq 2 ]; then',
    `    echo "${SALVAGE_FACT.SKIPPED} the untracked files, past $cap bytes with the commits and changes"`,
    "  else",
    '    rm -f "$listed"',
    "    exit 1",
    "  fi",
    "fi",
    'rm -f "$listed"',
    "exit 0",
    "",
  ].join("\n");
}
