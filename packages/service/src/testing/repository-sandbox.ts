/**
 * repository-sandbox.ts -- a sandbox double at eve's boundary, for the tests that run an agent's checkout of the task's repository.
 *
 * The double stands where eve's `ctx.getSandbox()` hands the shell a live
 * Vercel Sandbox: it answers each run from the contract the shell hands the
 * sandbox (`REPOSITORY_SANDBOX_CONTRACT`), keeping the one thing a sandbox
 * keeps between calls, which repository stands checked out and whether it
 * is shallow, and writing
 * down every run and every firewall policy in the order they came. A clone
 * is answered as the test scripts it, and a command from the test's own
 * table. Nothing here runs a shell. Synthetic throughout.
 */

import { CHECKOUT_IDENTITY_VARIABLE } from "@luke/features/checkout-identity";
import type { SandboxCommandResult, SandboxNetworkPolicy, SandboxRunOptions } from "eve/sandbox";
import { DEEPEN_STEP, REPOSITORY_SANDBOX_CONTRACT } from "../agents/repository-sandbox-contract.js";
import type { RepositorySandbox } from "../agents/repository-shell.js";

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
  /** The policy that stood while each deepen's fetch ran, in order. */
  readonly policiesDuringFetch: SandboxNetworkPolicy[];
  /** Whether the checkout standing is shallow: cloned at a depth and not deepened since. */
  shallow: boolean;
  /** How many fetches found the checkout shallow and deepened it. */
  deepened: number;
  /** Whether a deepen wrote its record that it finished. */
  deepenMarked: boolean;
  /** The repository checked out now, as the sandbox's record names it; nothing before a clone. */
  checkedOut: string | undefined;
  /** The clone's arguments, as the last clone was handed them. */
  readonly clones: { repository: string; branch: string; url: string }[];
  /** Every commit identity set in the checkout, in order. */
  readonly identities: { name: string; email: string }[];
  /** How the next clones end; a clone with nothing scripted succeeds. */
  readonly cloneAnswers: ScriptedClone[];
  /** How the next settings of the commit identity end; one with nothing scripted succeeds. */
  readonly identityAnswers: ScriptedClone[];
}

/** What a command in the checkout answers, from the test's own table; a command off the table exits 127. */
export type CommandTable = (command: string) => SandboxCommandResult | undefined;

const EXIT = { OK: 0, FAILED: 1, NOT_FOUND: 127 } as const;

const OPEN_INTERNET: SandboxNetworkPolicy = "allow-all";

function result(exitCode: number, stdout = "", stderr = ""): SandboxCommandResult {
  return { exitCode, stdout, stderr };
}

/** A sandbox over the command table, with a firewall whose policy can be set. */
export function sandboxDouble(
  commands: CommandTable,
  options: { readonly firewall?: boolean } = {},
): SandboxDouble {
  const { PATH, VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;
  let policy: SandboxNetworkPolicy = OPEN_INTERNET;
  const double: SandboxDouble = {
    runs: [],
    policies: [],
    policiesDuringClone: [],
    policiesDuringFetch: [],
    shallow: false,
    deepened: 0,
    deepenMarked: false,
    checkedOut: undefined,
    clones: [],
    identities: [],
    cloneAnswers: [],
    identityAnswers: [],
    run: (run: SandboxRunOptions) => {
      const env = run.env;
      double.runs.push({ command: run.command, workingDirectory: run.workingDirectory, env });
      // A deepen's steps: the probe of whether one finished, the probe of whether the checkout is shallow, and the fetch of the rest of its history.
      const deepen = env?.[VARIABLE.DEEPEN];
      if (deepen === DEEPEN_STEP.PROBE) {
        return Promise.resolve(result(EXIT.OK, `${double.deepenMarked}\n`));
      }
      if (deepen === DEEPEN_STEP.SHALLOW) {
        if (double.checkedOut === undefined) {
          return Promise.resolve(result(128, "", "fatal: not a git repository"));
        }
        return Promise.resolve(result(EXIT.OK, `${double.shallow}\n`));
      }
      if (deepen === DEEPEN_STEP.FETCH) {
        double.policiesDuringFetch.push(policy);
        if (double.checkedOut === undefined) {
          return Promise.resolve(result(128, "", "fatal: not a git repository"));
        }
        if (double.shallow) double.deepened += 1;
        double.shallow = false;
        return Promise.resolve(result(EXIT.OK));
      }
      if (deepen === DEEPEN_STEP.MARK) {
        double.deepenMarked = true;
        return Promise.resolve(result(EXIT.OK));
      }
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
        double.shallow = env?.[VARIABLE.DEPTH] !== undefined;
        return Promise.resolve(result(EXIT.OK));
      }
      if (run.workingDirectory === PATH.CHECKOUT && double.checkedOut === undefined) {
        return Promise.resolve(result(EXIT.FAILED, "", "no checkout stands"));
      }
      // The commit identity set in the standing checkout.
      const name = env?.[CHECKOUT_IDENTITY_VARIABLE.NAME];
      if (run.workingDirectory === PATH.CHECKOUT && name !== undefined) {
        const scripted = double.identityAnswers.shift();
        if (scripted !== undefined && scripted.exitCode !== EXIT.OK) {
          return Promise.resolve(result(scripted.exitCode, "", scripted.stderr));
        }
        double.identities.push({ name, email: env?.[CHECKOUT_IDENTITY_VARIABLE.EMAIL] ?? "" });
        return Promise.resolve(result(EXIT.OK));
      }
      // A command from the checkout root, from the table: the model's under its variable, or the host's own as given.
      const command = env?.[VARIABLE.COMMAND] ?? (env === undefined ? run.command : undefined);
      if (run.workingDirectory === PATH.CHECKOUT && command !== undefined) {
        const answer = commands(command);
        return Promise.resolve(answer ?? result(EXIT.NOT_FOUND, "", "command not found"));
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
