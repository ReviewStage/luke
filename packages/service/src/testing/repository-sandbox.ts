import { CHECKOUT_IDENTITY_VARIABLE } from "@repo/features/checkout-identity";
import { Effect } from "effect";
import { DEEPEN_STEP, REPOSITORY_SANDBOX_CONTRACT } from "../agents/repository-sandbox-contract.js";
import type {
  CommandResult,
  RepositorySandbox,
  SandboxRunOptions,
} from "../agents/repository-shell.js";
import { composePolicy, type FirewallSources } from "../agents/sandbox-firewall.js";
import { type NetworkPolicy, OPEN_INTERNET_POLICY } from "../agents/vercel-sandbox-api.js";

interface SandboxRun {
  readonly command: string;
  readonly workingDirectory: string | undefined;
  readonly env: Readonly<Record<string, string>> | undefined;
}

interface ScriptedClone {
  readonly exitCode: number;
  readonly stderr: string;
}

export interface SandboxDouble extends RepositorySandbox {
  readonly runs: SandboxRun[];
  readonly policies: NetworkPolicy[];
  readonly policiesDuringClone: NetworkPolicy[];
  readonly policiesDuringFetch: NetworkPolicy[];
  shallow: boolean;
  deepened: number;
  checkedOut: string | undefined;
  readonly clones: { repository: string; branch: string; url: string }[];
  readonly extraClones: { folder: string; branch: string; url: string }[];
  readonly identities: { name: string; email: string }[];
  readonly cloneAnswers: ScriptedClone[];
  readonly identityAnswers: ScriptedClone[];
}

export type CommandTable = (command: string) => CommandResult | undefined;

const EXIT = { OK: 0, FAILED: 1, NOT_FOUND: 127 } as const;

function result(exitCode: number, stdout = "", stderr = ""): CommandResult {
  return { exitCode, stdout, stderr };
}

export function sandboxDouble(
  commands: CommandTable,
  options: { readonly firewall?: boolean } = {},
): SandboxDouble {
  const { PATH, VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;
  let policy: NetworkPolicy = OPEN_INTERNET_POLICY;
  const composed = (sources: FirewallSources) =>
    Effect.sync(() => {
      policy = composePolicy(sources, new Map());
      double.policies.push(policy);
    });
  const double: SandboxDouble = {
    runs: [],
    policies: [],
    policiesDuringClone: [],
    policiesDuringFetch: [],
    shallow: false,
    deepened: 0,
    checkedOut: undefined,
    clones: [],
    extraClones: [],
    identities: [],
    cloneAnswers: [],
    identityAnswers: [],
    run: (run: SandboxRunOptions) => {
      const env = run.env;
      double.runs.push({ command: run.command, workingDirectory: run.workingDirectory, env });
      if (env?.[VARIABLE.DEEPEN] === DEEPEN_STEP.FETCH) {
        double.policiesDuringFetch.push(policy);
        if (double.checkedOut === undefined) {
          return Promise.resolve(result(128, "", "fatal: not a git repository"));
        }
        if (double.shallow) double.deepened += 1;
        double.shallow = false;
        return Promise.resolve(result(EXIT.OK));
      }
      if (env?.[VARIABLE.URL] === undefined && env?.[VARIABLE.REPOSITORY] !== undefined) {
        const standing = double.checkedOut === env[VARIABLE.REPOSITORY];
        return Promise.resolve(result(standing ? EXIT.OK : EXIT.FAILED));
      }
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
      const name = env?.[CHECKOUT_IDENTITY_VARIABLE.NAME];
      if (run.workingDirectory === PATH.CHECKOUT && name !== undefined) {
        const scripted = double.identityAnswers.shift();
        if (scripted !== undefined && scripted.exitCode !== EXIT.OK) {
          return Promise.resolve(result(scripted.exitCode, "", scripted.stderr));
        }
        double.identities.push({ name, email: env?.[CHECKOUT_IDENTITY_VARIABLE.EMAIL] ?? "" });
        return Promise.resolve(result(EXIT.OK));
      }
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
