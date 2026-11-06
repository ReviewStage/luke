import path from "node:path";
import type { MirrorPlatformSeam } from "../effect/seams.js";

export function worktreesRoot(home: string): string {
  return path.join(home, ".vespin");
}

const CLONES_FOLDER = "clones";

const MIRRORS_FOLDER = "mirrors";

export function mirrorsFolder(home: string): string {
  return path.join(worktreesRoot(home), MIRRORS_FOLDER);
}

function repositoryFolders(repository: string): readonly [string, string] {
  const [owner = "", name = ""] = repository.toLowerCase().split("/");
  return [owner, name];
}

export function cloneFolder(stateRoot: string, repository: string): string {
  return path.join(stateRoot, CLONES_FOLDER, ...repositoryFolders(repository));
}

const WORKTREE_TIMING = {
  STALL_SECONDS: 60,
  LOW_SPEED_BYTES: 1000,
  CONNECT_SECONDS: 20,
} as const;

const LOGIN_PATH = [
  'PATH="$("${SHELL:-/bin/zsh}" -l -c \'printf %s "$PATH"\' 2>/dev/null || printf %s "$PATH")"',
  "export PATH",
];

function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

function nonInteractiveGit(stallSeconds: number): string[] {
  return [
    "export GIT_TERMINAL_PROMPT=0",
    "export GIT_ASKPASS=/usr/bin/true",
    `git() { command git -c http.lowSpeedLimit=${WORKTREE_TIMING.LOW_SPEED_BYTES} -c http.lowSpeedTime=${stallSeconds} "$@"; }`,
    'ssh_command="${GIT_SSH_COMMAND:-$(git config --get core.sshCommand 2>/dev/null)}"',
    `export GIT_SSH_COMMAND="\${ssh_command:-ssh} -o BatchMode=yes -o ConnectTimeout=${WORKTREE_TIMING.CONNECT_SECONDS} -o ServerAliveInterval=15 -o ServerAliveCountMax=4"`,
  ];
}

const SHARED_CLONE = [
  "opened() {",
  '  mkdir -p "$(dirname "$clone")" || return 1',
  '  lock="$clone.lock"',
  '  until mkdir "$lock" 2>/dev/null; do',
  '    holder="$(cat "$lock/pid" 2>/dev/null)"',
  '    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then',
  '      rm -rf "$lock"',
  "      continue",
  "    fi",
  "    sleep 1",
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
  '  git clone --no-checkout --filter=blob:none "$https" "$cloning" || { rm -rf "$cloning"; return 1; }',
  '  mv "$cloning" "$clone"',
  "}",
];

const UNMADE = ["unmade() {", '  rm -rf "$making"', "  git worktree prune", "}"];

export function repositoryReachedScript(input: {
  readonly repository: string;
  readonly remote?: string | undefined;
}): string {
  return [
    ...nonInteractiveGit(WORKTREE_TIMING.STALL_SECONDS),
    `https=${shellQuoted(input.remote ?? `https://github.com/${input.repository}.git`)}`,
    'git ls-remote --quiet "$https" HEAD >/dev/null',
    "",
  ].join("\n");
}

export function agentWorktreeScript(input: {
  readonly repository: string;
  readonly clone: string;
  readonly worktree: string;
  readonly branch: string | null;
  readonly remote?: string | undefined;
  readonly stallSeconds?: number | undefined;
}): string {
  const stallSeconds = input.stallSeconds ?? WORKTREE_TIMING.STALL_SECONDS;
  return [
    ...LOGIN_PATH,
    ...nonInteractiveGit(Math.max(1, Math.trunc(stallSeconds))),
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
    '    git fetch origin "+HEAD:refs/agent/default-head" || return 1',
    '    fetched="refs/agent/default-head"',
    "  fi",
    '  head="$(git rev-parse --verify --quiet "$fetched^{commit}")" || return 1',
    '  mkdir -p "$(dirname "$worktree")" || return 1',
    '  making="$worktree.making"',
    '  rm -rf "$making" || return 1',
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

export function mirrorWorktreeScript(input: {
  readonly repository: string;
  readonly clone: string;
  readonly worktree: string;
  readonly base: string;
}): string {
  return [
    ...LOGIN_PATH,
    ...nonInteractiveGit(WORKTREE_TIMING.STALL_SECONDS),
    `clone=${shellQuoted(input.clone)}`,
    `worktree=${shellQuoted(input.worktree)}`,
    `base=${shellQuoted(input.base)}`,
    `https=${shellQuoted(`https://github.com/${input.repository}.git`)}`,
    ...SHARED_CLONE,
    "brought_in() {",
    "  cloned || return 1",
    '  cd "$clone" || return 1',
    '  git fetch origin "$base" || return 1',
    '  mkdir -p "$(dirname "$worktree")" || return 1',
    '  git worktree add --quiet --detach "$worktree" "$base"',
    "}",
    '[ -e "$worktree/.git" ] && exit 0',
    "( opened )",
    "",
  ].join("\n");
}

export function mirrorListScript(worktree: string): string {
  return [
    ...LOGIN_PATH,
    `git -C ${shellQuoted(worktree)} ls-files -co --exclude-standard -z`,
    "",
  ].join("\n");
}

export function mirrorRemovedScript(worktree: string): string {
  return [
    ...LOGIN_PATH,
    `worktree=${shellQuoted(worktree)}`,
    'common="$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir)" || exit 1',
    'git -C "$(dirname "$common")" worktree remove --force "$worktree"',
    "",
  ].join("\n");
}

export function mirrorPlatform(home: string): MirrorPlatformSeam {
  return {
    folder: mirrorsFolder(home),
    worktreeScript: (input) =>
      mirrorWorktreeScript({ ...input, clone: cloneFolder(worktreesRoot(home), input.repository) }),
    listScript: mirrorListScript,
    removeScript: mirrorRemovedScript,
  };
}
