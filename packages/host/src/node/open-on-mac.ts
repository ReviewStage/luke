import path from "node:path";

/**
 * open-on-mac.ts -- the script a local agent's worktree is made with on its box, from the box's own clone of the repository.
 *
 * The box keeps one clone of each repository under `~/.vespin`, made the
 * first time an agent of it starts, under a lock, and every agent of it
 * works in a worktree of that clone, so the repository's files are had
 * once per box rather than once per agent, and its branches stand in the
 * clone. The clone is made over HTTPS, reading the agent's GitHub token
 * through gh's helper, without checking anything out. Every value in a
 * script is quoted for the shell, never spliced in bare.
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

/**
 * How long a stalled step may stand before the script gives it up, and how
 * long a launch waits on a clone another holds alive before it gives up.
 * Note that the lock wait is the host's own deadline for the whole script
 * (`compose-local-agents.ts`'s `WORKTREE_DEADLINE`), which a first clone of a
 * large repository over a slow link has to fit in; a transfer that has
 * stopped is cut off far sooner, by `STALL`, and a dead network by `CONNECT`.
 */
const WORKTREE_TIMING = {
  /** Seconds a transfer may move under `LOW_SPEED_BYTES` a second before Git, over HTTPS, fails it. */
  STALL_SECONDS: 60,
  LOW_SPEED_BYTES: 1000,
  /** Seconds a connection over SSH, which a clone made over it before still fetches by, may take to open. */
  CONNECT_SECONDS: 20,
  LOCK_WAIT_SECONDS: 25 * 60,
} as const;

/** The exit code of a script whose launch gave up waiting on a clone another held alive (`EX_TEMPFAIL`). */
export const WORKTREE_LOCK_BUSY = 75;

/** A word quoted for a POSIX shell. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The lines that make every Git step of a script non-interactive and bounded,
 * run after `PATH` is the login shell's. Nothing prompts: Git's terminal
 * prompt is off and its askpass is a program that answers nothing, so a
 * credential Git cannot read from its helper fails the step; SSH never asks
 * for a password or a host key (`BatchMode`), takes only so long to connect,
 * and drops a connection that has stopped answering. Over HTTPS, a transfer
 * under `LOW_SPEED_BYTES` a second for `STALL_SECONDS` fails. Note that the
 * developer's own `GIT_SSH_COMMAND`, or `core.sshCommand`, is the command the
 * options are added to, never replaced; and that `git` is a function of the
 * script so the HTTPS limits reach every call, whatever the developer's own
 * Git configuration says.
 */
function nonInteractiveGit(stallSeconds: number): string[] {
  return [
    "export GIT_TERMINAL_PROMPT=0",
    "export GIT_ASKPASS=/usr/bin/true",
    `git() { command git -c http.lowSpeedLimit=${WORKTREE_TIMING.LOW_SPEED_BYTES} -c http.lowSpeedTime=${stallSeconds} "$@"; }`,
    'ssh_command="${GIT_SSH_COMMAND:-$(git config --get core.sshCommand 2>/dev/null)}"',
    `export GIT_SSH_COMMAND="\${ssh_command:-ssh} -o BatchMode=yes -o ConnectTimeout=${WORKTREE_TIMING.CONNECT_SECONDS} -o ServerAliveInterval=15 -o ServerAliveCountMax=4"`,
  ];
}

/**
 * `opened`, which takes the shared clone's lock, runs `brought_in` under it,
 * and lets go however it ends, and `cloned`, which makes the clone the first
 * time, over HTTPS, checking nothing out. Every agent of the repository
 * shares the clone, so the whole of bringing a branch in, its clone, fetch,
 * and worktree, is done under the lock. A script defines `brought_in`, and
 * sets `clone`, `https`, and `lock_wait`, before it calls `opened`.
 */
const SHARED_CLONE = [
  "opened() {",
  '  mkdir -p "$(dirname "$clone")" || return 1',
  '  lock="$clone.lock"',
  "  waited=0",
  "  blocked=0",
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
  // Note that a live holder's lock is never taken, but a launch waits on it only so long, so one stalled holder cannot hold every other launch of the repository.
  '    if [ "$blocked" -ge "$lock_wait" ]; then',
  '      echo "▸ Gave up waiting on another launch of ${https%.git} to finish making its clone." >&2',
  `      return ${WORKTREE_LOCK_BUSY}`,
  "    fi",
  "    sleep 1",
  "    waited=$((waited + 1))",
  "    blocked=$((blocked + 1))",
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
  '  cloning="$clone.cloning"',
  '  rm -rf "$clone" "$cloning" || return 1',
  // Note that the clone is made beside its place and moved in whole, so one cut off midway never stands where the next launch would trust it.
  '  git clone --no-checkout --filter=blob:none "$https" "$cloning" || { rm -rf "$cloning"; return 1; }',
  '  mv "$cloning" "$clone"',
  "}",
];

/**
 * `unmade`, which takes away a worktree whose making failed, its folder and
 * its entry in the shared clone alike, so the next launch starts clean. A
 * script runs it in the shared clone, with `making` set.
 */
const UNMADE = ["unmade() {", '  rm -rf "$making"', "  git worktree prune", "}"];

/**
 * The script, its values quoted, that makes a local agent's worktree
 * (`@repo/host`'s `compose-local-agents.ts`) of the box's shared clone,
 * detached at the head of the branch the agent starts from, or of GitHub's
 * default branch where it names none, fetched into the clone under its
 * lock. The worktree's files are had from GitHub as its checkout needs
 * them, through the agent's own GitHub credential, and the branches the
 * agent makes stand in the shared clone. A folder that already holds a
 * repository is left as it stands, since it holds the agent's work, a
 * folder made before worktrees among them. The worktree is made beside its
 * place and moved in by Git, which keeps its links, so one a launch cut off
 * left half made never stands where the next launch would trust it; the
 * next takes it away, entry and all. A step that fails takes away what it
 * made too (`UNMADE`), and the script ends with its failure, having said
 * which.
 */
export function agentWorktreeScript(input: {
  /** The repository as `owner/name`, cloned from GitHub the first time. */
  readonly repository: string;
  readonly clone: string;
  readonly worktree: string;
  /** The branch the agent starts from; none for GitHub's default branch. */
  readonly branch: string | null;
  /** Where the repository is cloned from; GitHub's over HTTPS unless a test names its own. */
  readonly remote?: string | undefined;
  /** The seconds a stalled transfer and a wait on a live holder of the clone's lock last; `WORKTREE_TIMING`'s unless a test names its own. */
  readonly seconds?: { readonly stall: number; readonly lockWait: number } | undefined;
}): string {
  const seconds = input.seconds ?? {
    stall: WORKTREE_TIMING.STALL_SECONDS,
    lockWait: WORKTREE_TIMING.LOCK_WAIT_SECONDS,
  };
  return [
    // An app opened from the Dock has a bare PATH; the login shell's is the one the developer's Git and tools live on.
    'PATH="$("${SHELL:-/bin/zsh}" -l -c \'printf %s "$PATH"\' 2>/dev/null || printf %s "$PATH")"',
    "export PATH",
    ...nonInteractiveGit(Math.max(1, Math.trunc(seconds.stall))),
    `lock_wait=${Math.max(1, Math.trunc(seconds.lockWait))}`,
    `clone=${shellQuoted(input.clone)}`,
    `worktree=${shellQuoted(input.worktree)}`,
    `branch=${shellQuoted(input.branch ?? "")}`,
    `https=${shellQuoted(input.remote ?? `https://github.com/${input.repository}.git`)}`,
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
    // Note that forcing twice takes over the entry a launch cut off left for the same place, locked or not, which Git would otherwise refuse.
    '  git worktree add --quiet --force --force --detach "$making" "$head" || { unmade; return 1; }',
    '  if [ -e "$worktree" ]; then rmdir "$worktree" || { unmade; return 1; }; fi',
    '  git worktree move "$making" "$worktree" || { unmade; return 1; }',
    "}",
    ...UNMADE,
    '[ -e "$worktree/.git" ] && exit 0',
    "( opened )",
    "status=$?",
    'if [ "$status" -ne 0 ]; then',
    '  echo "▸ Could not make the agent\'s worktree of ${branch:-the default branch}." >&2',
    '  exit "$status"',
    "fi",
    "",
  ].join("\n");
}
