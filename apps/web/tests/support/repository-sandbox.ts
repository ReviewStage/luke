/**
 * repository-sandbox.ts -- a sandbox double at eve's boundary, for the tests that run the planning model's repository shell.
 *
 * The double stands where eve's `ctx.getSandbox()` hands the shell a live
 * Vercel Sandbox: it answers each run from the contract the shell hands the
 * sandbox (`REPOSITORY_SANDBOX_CONTRACT`), keeping the one thing a sandbox
 * keeps between calls, which repository stands checked out, and writing
 * down every run and every firewall policy in the order they came. A clone
 * is answered as the test scripts it, a command from the test's own table,
 * and a file read by `show_code` from the files the test says the checkout
 * holds. Nothing here runs a shell. Synthetic throughout.
 */

import type { SandboxCommandResult, SandboxNetworkPolicy, SandboxRunOptions } from "eve/sandbox";
import {
  REPOSITORY_SANDBOX_CONTRACT,
  type RepositorySandbox,
  type RepositorySandboxDoor,
} from "../../server/hosted/repository-shell";

/** One run as the sandbox saw it. */
interface SandboxRun {
  readonly command: string;
  readonly workingDirectory: string | undefined;
  readonly env: Readonly<Record<string, string>> | undefined;
}

/** How a clone of the given repository ends: as the checkout it made, or with git's exit code and words. */
interface ScriptedClone {
  readonly exitCode: number;
  readonly stderr: string;
}

export interface SandboxDouble extends RepositorySandbox {
  /** Every run, in order. */
  readonly runs: SandboxRun[];
  /** Every firewall policy set, in order. */
  readonly policies: SandboxNetworkPolicy[];
  /** The policy that stood while each clone ran, in order. */
  readonly policiesDuringClone: SandboxNetworkPolicy[];
  /** The repository checked out now, as the sandbox's record names it; nothing before a clone. */
  checkedOut: string | undefined;
  /** The clone's arguments, as the last clone was handed them. */
  readonly clones: { repository: string; branch: string; url: string }[];
  /** How the next clones end; a clone with nothing scripted succeeds. */
  readonly cloneAnswers: ScriptedClone[];
  /** The door the shell opens the sandbox through, counting each opening. */
  readonly door: RepositorySandboxDoor;
  openings: number;
}

/** What a command in the checkout answers, from the test's own table; a command off the table exits 127. */
export type CommandTable = (command: string) => SandboxCommandResult | undefined;

/** The files the checkout holds, by path relative to its root, as `show_code`'s scripts read them. */
export type CheckoutFiles = Readonly<Record<string, string>>;

/** The exit codes `show_code`'s file probe answers with, as the shell script spells them. */
const PROBE_EXIT = { MISSING: 3, NOT_TEXT: 4 } as const;

/** The largest file the probe lets through, as the script bounds it. */
const PROBE_MAX_FILE_BYTES = 1024 * 1024;

const EXIT = { OK: 0, FAILED: 1, NOT_FOUND: 127 } as const;

/** Whether the probe would call the file text: no NUL among its first bytes, and under the bound. */
function readsAsText(text: string): boolean {
  return !text.includes("\u0000") && Buffer.byteLength(text) <= PROBE_MAX_FILE_BYTES;
}

/** The file probe's answer: the line count the screen counts, or the exit the script would take. */
function probeFile(files: CheckoutFiles, path: string): SandboxCommandResult {
  const text = files[path];
  // A path that leaves the checkout resolves to no file of it.
  if (text === undefined || path.startsWith("/") || path.split("/").includes("..")) {
    return result(PROBE_EXIT.MISSING);
  }
  if (!readsAsText(text)) return result(PROBE_EXIT.NOT_TEXT);
  return result(EXIT.OK, `${text.split("\n").length}\n`);
}

/** The window read's answer: the lines first to last as sed prints them, each with its newline. */
function windowOf(files: CheckoutFiles, path: string, first: number, last: number) {
  const text = files[path];
  if (text === undefined) return result(EXIT.FAILED, "", "no such file");
  const lines = text.split("\n").slice(first - 1, last);
  return result(EXIT.OK, lines.map((line) => `${line}\n`).join(""));
}

const OPEN_INTERNET: SandboxNetworkPolicy = "allow-all";

function result(exitCode: number, stdout = "", stderr = ""): SandboxCommandResult {
  return { exitCode, stdout, stderr };
}

/** A sandbox over the command table and the checkout's files, with a firewall whose policy can be set. */
export function sandboxDouble(
  commands: CommandTable,
  options: { readonly firewall?: boolean; readonly files?: CheckoutFiles } = {},
): SandboxDouble {
  const files = options.files ?? {};
  const { PATH, VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;
  let policy: SandboxNetworkPolicy = OPEN_INTERNET;
  const double: SandboxDouble = {
    runs: [],
    policies: [],
    policiesDuringClone: [],
    checkedOut: undefined,
    clones: [],
    cloneAnswers: [],
    openings: 0,
    door: () => {
      double.openings += 1;
      return Promise.resolve(double);
    },
    run: (run: SandboxRunOptions) => {
      const env = run.env;
      double.runs.push({ command: run.command, workingDirectory: run.workingDirectory, env });
      // The checkout probe: which repository the record names, and whether a checkout stands.
      if (env?.[VARIABLE.URL] === undefined && env?.[VARIABLE.REPOSITORY] !== undefined) {
        const standing = double.checkedOut === env[VARIABLE.REPOSITORY];
        return Promise.resolve(result(standing ? EXIT.OK : EXIT.FAILED));
      }
      // The clone, answered as scripted, and recorded with the firewall that stood for it.
      const url = env?.[VARIABLE.URL];
      if (url !== undefined) {
        double.policiesDuringClone.push(policy);
        double.clones.push({
          repository: env?.[VARIABLE.REPOSITORY] ?? "",
          branch: env?.[VARIABLE.BRANCH] ?? "",
          url,
        });
        const scripted = double.cloneAnswers.shift();
        if (scripted !== undefined && scripted.exitCode !== EXIT.OK) {
          return Promise.resolve(result(scripted.exitCode, "", scripted.stderr));
        }
        double.checkedOut = env?.[VARIABLE.REPOSITORY];
        return Promise.resolve(result(EXIT.OK));
      }
      if (run.workingDirectory === PATH.CHECKOUT && double.checkedOut === undefined) {
        return Promise.resolve(result(EXIT.FAILED, "", "no checkout stands"));
      }
      // A command from the checkout root, from the table.
      const command = env?.[VARIABLE.COMMAND];
      if (run.workingDirectory === PATH.CHECKOUT && command !== undefined) {
        const answer = commands(command);
        return Promise.resolve(answer ?? result(EXIT.NOT_FOUND, "", "command not found"));
      }
      // `show_code`'s two reads of a file: the probe, then the window the probe's count placed.
      const file = env?.[VARIABLE.FILE];
      const first = env?.[VARIABLE.FIRST_LINE];
      const last = env?.[VARIABLE.LAST_LINE];
      if (run.workingDirectory === PATH.CHECKOUT && file !== undefined) {
        if (first === undefined || last === undefined)
          return Promise.resolve(probeFile(files, file));
        return Promise.resolve(windowOf(files, file, Number(first), Number(last)));
      }
      return Promise.reject(new Error(`the sandbox double was handed a run it does not know`));
    },
    ...(options.firewall === false
      ? undefined
      : {
          setNetworkPolicy: (next: SandboxNetworkPolicy) => {
            policy = next;
            double.policies.push(next);
            return Promise.resolve();
          },
        }),
  };
  return double;
}
