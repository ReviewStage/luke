/**
 * repository-sandbox.ts -- a sandbox double at the agent machine's boundary, for the tests that run an agent's checkout of the task's repository.
 *
 * The double stands where the agent machine (`agents/machine/vercel-machine.ts`) hands the shell a live
 * Vercel Sandbox: it answers each run from the contract the shell hands the
 * sandbox (`REPOSITORY_SANDBOX_CONTRACT`), keeping the one thing a sandbox
 * keeps between calls, which repository stands checked out, and writing
 * down every run and every firewall policy in the order they came, each
 * composed from the sources its write named as the service composes them
 * (`sandbox-firewall.ts`), with no launch kept beside them. A clone
 * is answered as the test scripts it, and a command from the test's own
 * table. Nothing here runs a shell. Synthetic throughout.
 */

import { CHECKOUT_IDENTITY_VARIABLE } from "@repo/features/checkout-identity";
import { Effect } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../agents/repository-sandbox-contract.js";
import type {
  CommandResult,
  RepositorySandbox,
  SandboxRunOptions,
} from "../agents/repository-shell.js";
import { composePolicy, type FirewallSources } from "../agents/sandbox-firewall.js";
import { type NetworkPolicy, OPEN_INTERNET_POLICY } from "../agents/vercel-sandbox-api.js";

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
  readonly policies: NetworkPolicy[];
  /** The policy that stood while each clone ran, in order. */
  readonly policiesDuringClone: NetworkPolicy[];
  /** The repository checked out now, as the sandbox's record names it; nothing before a clone. */
  checkedOut: string | undefined;
  /** The clone's arguments, as the last clone was handed them. */
  readonly clones: { repository: string; branch: string; url: string }[];
  /** Every clone of a repository the agent works in beside its own, in order: the folder it went into, its branch, and its URL. */
  readonly extraClones: { folder: string; branch: string; url: string }[];
  /** Every commit identity set in the checkout, in order. */
  readonly identities: { name: string; email: string }[];
  /** How the next clones end; a clone with nothing scripted succeeds. */
  readonly cloneAnswers: ScriptedClone[];
  /** How the next settings of the commit identity end; one with nothing scripted succeeds. */
  readonly identityAnswers: ScriptedClone[];
}

/** What a command in the checkout answers, from the test's own table; a command off the table exits 127. */
export type CommandTable = (command: string) => CommandResult | undefined;

const EXIT = { OK: 0, FAILED: 1, NOT_FOUND: 127 } as const;

function result(exitCode: number, stdout = "", stderr = ""): CommandResult {
  return { exitCode, stdout, stderr };
}

/** A sandbox over the command table, with a firewall whose policy can be set. */
export function sandboxDouble(
  commands: CommandTable,
  options: { readonly firewall?: boolean } = {},
): SandboxDouble {
  const { PATH, VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;
  let policy: NetworkPolicy = OPEN_INTERNET_POLICY;
  /** The policy the sources compose, set and recorded. */
  const composed = (sources: FirewallSources) =>
    Effect.sync(() => {
      policy = composePolicy(sources, new Map());
      double.policies.push(policy);
    });
  const double: SandboxDouble = {
    runs: [],
    policies: [],
    policiesDuringClone: [],
    checkedOut: undefined,
    clones: [],
    extraClones: [],
    identities: [],
    cloneAnswers: [],
    identityAnswers: [],
    run: (run: SandboxRunOptions) => {
      const env = run.env;
      double.runs.push({ command: run.command, workingDirectory: run.workingDirectory, env });
      // The checkout probe: which repository the record names, and whether a checkout stands.
      if (env?.[VARIABLE.URL] === undefined && env?.[VARIABLE.REPOSITORY] !== undefined) {
        const standing = double.checkedOut === env[VARIABLE.REPOSITORY];
        return Promise.resolve(result(standing ? EXIT.OK : EXIT.FAILED));
      }
      // An extra repository's clone into its folder, recorded with the firewall that stood for it.
      const folder = env?.[VARIABLE.FOLDER];
      if (folder !== undefined) {
        double.policiesDuringClone.push(policy);
        double.extraClones.push({
          folder,
          branch: env?.[VARIABLE.BRANCH] ?? "",
          url: env?.[VARIABLE.URL] ?? "",
        });
        return Promise.resolve(result(EXIT.OK));
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
          firewall: { write: composed },
        }),
  };
  return double;
}
