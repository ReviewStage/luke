// experiments.ts -- the features a developer can turn on before they are finished, and how a choice of them is read.

import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

/**
 * Every experiment's key: what its gate names, what the account stores its
 * choice under, and what it is counted as. A key is deleted when its feature
 * graduates, which is what makes every gate left behind fail to compile.
 */
export const EXPERIMENT = {
  /** A workspace's memory: its coding agents keep and recall facts with remember and recall, reviewed in Settings › Memory. */
  MEMORY: "memory",
  /** Pilot: a new task can start with one pilot agent that plans the work, splits it into sub-tasks, and runs a coding agent on each. */
  PILOT: "pilot",
  /** Skills: the skills a member installs into the app for their agents, managed in Settings › Skills, and the `/` list of skills in a box written to an agent. */
  SKILLS: "skills",
  /** Bring your own host: agents that run on the member's own Macs and Linux machines, This Mac among them, set up in Settings › Hosts, rather than only in our cloud. */
  BRING_YOUR_OWN_HOST: "bring-your-own-host",
  /** Several repositories: an agent started in the cloud works in other repositories beside its own, each cloned beside its checkout. */
  SEVERAL_REPOSITORIES: "several-repositories",
  /** Plans: a task's plan document, its comments and version history, and the tools and instructions its coding agents write it and answer its comments with. */
  PLANS: "plans",
} as const;

export type Experiment = (typeof EXPERIMENT)[keyof typeof EXPERIMENT];

/** One experiment as the Experimental page lists it. */
export interface ExperimentEntry {
  readonly key: Experiment;
  /** The feature's own name, as the row and its gated surfaces call it. */
  readonly name: string;
  /** One line on what turning it on brings. */
  readonly detail: string;
  /** Who decides when it graduates or goes. */
  readonly owner: string;
  /** The day it was added, so a release's review sees how long each one has stood. */
  readonly since: string;
}

/**
 * The experiments standing now, newest first: the order the Experimental page
 * lists them. An entry exists only while its feature is experimental, so
 * there is no status to drift and every experiment is off until turned on.
 */
export const EXPERIMENTS = [
  {
    key: EXPERIMENT.PLANS,
    name: "Plans",
    detail:
      "Give each task a plan its agents write down as they go, with comments on it and its version history.",
    owner: "Dean",
    since: "2026-11-05",
  },
  {
    key: EXPERIMENT.SEVERAL_REPOSITORIES,
    name: "Several repositories",
    detail:
      "Start an agent in other repositories beside its own, each checked out beside it. " +
      "In the cloud only, for repositories reached through the GitHub App.",
    owner: "Dean",
    since: "2026-11-05",
  },
  {
    key: EXPERIMENT.BRING_YOUR_OWN_HOST,
    name: "Bring your own host",
    detail:
      "Run agents on your own Macs and Linux machines. " +
      `Their transcripts and the files their tools read still reach ${PRODUCT_NAME}.`,
    owner: "Charles",
    since: "2026-10-30",
  },
  {
    key: EXPERIMENT.SKILLS,
    name: "Skills",
    detail:
      `Install skills into ${PRODUCT_NAME} for your agents to use, ` +
      "and name one with / in a message to an agent.",
    owner: "Charles",
    since: "2026-10-30",
  },
  {
    key: EXPERIMENT.PILOT,
    name: "Pilot",
    detail:
      "Start a new task with one pilot agent that plans the work, splits it into sub-tasks, " +
      "and runs an agent on each.",
    owner: "Charles",
    since: "2026-10-29",
  },
  {
    key: EXPERIMENT.MEMORY,
    name: "Memory",
    detail:
      "Your agents keep settled facts about how your team works and recall them in later work, " +
      "shared across your workspace.",
    owner: "Dean",
    since: "2026-10-23",
  },
] as const satisfies readonly ExperimentEntry[];

/**
 * What an account has chosen: each experiment it turned on or back off.
 * An experiment it never touched is absent, which reads as off.
 */
export type ExperimentChoices = Readonly<Partial<Record<Experiment, boolean>>>;

/** No experiment chosen: every one off. */
export const NO_EXPERIMENTS: ExperimentChoices = {};

/** Whether a value names an experiment this build lists. */
export const isExperiment = Schema.is(Schema.Literals(Object.values(EXPERIMENT)));
const isChoice = Schema.is(Schema.Boolean);
const choicesRecord = Schema.Record(Schema.String, Schema.Unknown);

/**
 * A choice of experiments as it arrives from the account's store or across
 * the wire, keeping every known experiment's on or off and ignoring the
 * rest. It refuses nothing but a value that is not a record at all: a key it
 * does not know is a newer build's experiment or a graduated one's, and
 * refusing the whole answer over it would cost an older Mac every choice it
 * does know.
 */
export function experimentChoicesFrom(value: UnparsedWireValue): ExperimentChoices | undefined {
  const decoded = Schema.decodeUnknownOption(choicesRecord)(value);
  if (Option.isNone(decoded)) return undefined;
  const choices: Partial<Record<Experiment, boolean>> = {};
  for (const [key, choice] of Object.entries(decoded.value)) {
    if (isExperiment(key) && isChoice(choice)) choices[key] = choice;
  }
  return choices;
}

/** Whether the account has turned an experiment on. */
export function experimentOn(choices: ExperimentChoices, experiment: Experiment): boolean {
  return choices[experiment] === true;
}
