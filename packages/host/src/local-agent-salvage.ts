import { Clock, Duration, Effect, Option, Path, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess } from "effect/process";

/**
 * local-agent-salvage.ts -- what a machine saves of a local agent's work before it removes a folder it kept for that work (`salvage/<agentId>/<when>` in its state), and how long it keeps that: written by the follower (`compose-local-agents.ts`) through the platform's script (`node/open-on-mac.ts`'s `agentSalvageScript`), and pruned by its passes.
 *
 * A folder kept for work in it is removed whatever it holds once it has stood
 * a week, so its work is saved first, on the box, beside the host's state: a
 * bundle of its commits on no remote branch, a diff of its changes, a tar of
 * its untracked files, and a note of the agent, when, why, and where its
 * repository came from. A salvage that fails keeps the folder, and nothing
 * half written stands. `vespin-host uninstall` leaves the salvages where they
 * are and says where (`apps/host/scripts/vespin-host.sh`).
 */

/**
 * What a salvage of an agent's worktree prints, one line each, the word then
 * its value (`agentSalvageScript`): the head and `origin` it stood at, the
 * files it wrote in the salvage, and why it skipped what it skipped. The note
 * names each, null where the salvage printed none.
 */
export const SALVAGE_FACT = {
  HEAD: "head",
  ORIGIN: "origin",
  /** A bundle of every commit on no remote branch, from the head, every local branch, and the stash. */
  COMMITS: "commits",
  /** `git diff --binary HEAD`: every change to a tracked file, staged or not. */
  CHANGES: "changes",
  /** A tar of the untracked files Git does not ignore. */
  UNTRACKED: "untracked",
  /** A tar of a folder with no repository, whole. */
  FILES: "files",
  SKIPPED: "skipped",
} as const;

/** The folder in the machine's state the salvages stand in, one folder per agent, one per salvage under it, named for when it was written (epoch milliseconds). */
const SALVAGE_FOLDER = "salvage";
/** The note beside a salvage's files. */
const NOTE_FILE = "note.json";
/**
 * The most bytes one salvage takes, since an agent may leave build output or
 * data in untracked files, and a box that let many folders go would fill its
 * disk with copies of them. The commits and the changes are the work and are
 * kept whatever their size; the untracked files are skipped where they would
 * go past it, which the note says.
 */
export const SALVAGE_MAX_BYTES = 200 * 1024 * 1024;
/**
 * How long a salvage stands before a pass removes it: weeks past the week its
 * folder was kept, for a person who finds it by the host's log, yet bounded,
 * so a box that runs agents for months does not keep every salvage it made.
 */
const SALVAGE_KEPT_FOR = Duration.days(30);
/** How long a salvage may run before it is taken as failed and the folder kept: a bundle and a tar of up to `SALVAGE_MAX_BYTES` on a slow disk. */
const SALVAGE_DEADLINE = Duration.minutes(2);
/** How long the salvage's process has to end after SIGTERM before it is sent SIGKILL. */
const KILL_GRACE = Duration.seconds(3);
/** What a salvage's folder is named: when it was written, in epoch milliseconds. */
const STAMP = /^-?\d+$/u;

/** A repository's address with any user or token it carries taken out, so the note never holds a credential. */
function withoutCredential(address: string): string {
  return address.replace(/\/\/[^/@]*@/u, "//");
}

/** The script's facts, a word and its value a line, keyed by word. */
function factsPrinted(printed: string): ReadonlyMap<string, string> {
  const facts = new Map<string, string>();
  for (const line of printed.split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0) facts.set(line.slice(0, space), line.slice(space + 1));
  }
  return facts;
}

/** What the script given printed, run on the box in `cwd`; none where it failed, could not start, or outlasted `SALVAGE_DEADLINE`. */
const scriptPrinted = (script: string, cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make("/bin/bash", ["-c", script], {
        cwd,
        stdin: "ignore",
        stderr: "ignore",
        forceKillAfter: KILL_GRACE,
      });
      const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
      return Number(yield* handle.exitCode) === 0 ? Option.some(printed) : Option.none<string>();
    }),
  ).pipe(
    Effect.timeoutOption(SALVAGE_DEADLINE),
    Effect.map(Option.flatten),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

/**
 * The agent's work saved under the state root before its folder is removed:
 * the platform's script run on the box into a salvage folder of its own,
 * named for now, then a note of the agent, when, why it was kept, and what the
 * script printed. Where the salvage stands once all is written; none where a
 * step failed, which takes away what it wrote, so the caller keeps the folder
 * and a later pass tries again.
 */
export const agentSalvaged = (input: {
  readonly stateRoot: string;
  /** Where the script runs. */
  readonly cwd: string;
  readonly agentId: string;
  /** Why the folder was kept, as the check of its worktree said it. */
  readonly reason: string;
  /** The platform's script, writing into the salvage folder given. */
  readonly script: (salvage: string) => string;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const at = yield* Clock.currentTimeMillis;
    const salvage = path.join(input.stateRoot, SALVAGE_FOLDER, input.agentId, String(at));
    const printed = yield* scriptPrinted(input.script(salvage), input.cwd);
    const noted = Option.isNone(printed)
      ? false
      : yield* Effect.gen(function* () {
          const facts = factsPrinted(printed.value);
          const origin = facts.get(SALVAGE_FACT.ORIGIN);
          const note = {
            agentId: input.agentId,
            savedAt: new Date(at).toISOString(),
            reason: input.reason,
            ...Object.fromEntries(
              Object.values(SALVAGE_FACT).map((fact) => [fact, facts.get(fact) ?? null]),
            ),
            [SALVAGE_FACT.ORIGIN]: origin === undefined ? null : withoutCredential(origin),
          };
          yield* fileSystem.writeFileString(
            path.join(salvage, NOTE_FILE),
            `${JSON.stringify(note, null, 2)}\n`,
            { mode: 0o600 },
          );
          return true;
        }).pipe(Effect.orElseSucceed(() => false));
    if (!noted) {
      yield* Effect.ignore(fileSystem.remove(salvage, { recursive: true, force: true }));
      return Option.none<string>();
    }
    return Option.some(salvage);
  });

/**
 * Every salvage written `SALVAGE_KEPT_FOR` or longer before `now` removed,
 * each reported, and an agent's folder of them once it holds none. A name
 * that is not a stamp is left be, since this did not write it. A prune that
 * fails is reported, and the next pass tries again.
 */
export const salvagesPruned = (stateRoot: string, now: number, report: (line: string) => void) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.join(stateRoot, SALVAGE_FOLDER);
    if (!(yield* fileSystem.exists(root))) return;
    for (const agentId of yield* fileSystem.readDirectory(root)) {
      const agentRoot = path.join(root, agentId);
      const stamps = yield* fileSystem.readDirectory(agentRoot);
      const old = stamps.filter(
        (stamp) => STAMP.test(stamp) && now - Number(stamp) >= Duration.toMillis(SALVAGE_KEPT_FOR),
      );
      for (const stamp of old) {
        const salvage = path.join(agentRoot, stamp);
        yield* fileSystem.remove(salvage, { recursive: true, force: true });
        report(`a salvage of a local agent's work was removed, its time up: ${salvage}`);
      }
      if (old.length > 0 && old.length === stamps.length) {
        yield* Effect.ignore(fileSystem.remove(agentRoot));
      }
    }
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => report("the salvages of local agents' work could not be pruned")),
    ),
  );
