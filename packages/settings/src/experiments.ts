// experiments.ts -- the features a developer can turn on before they are finished, and how a choice of them is read.
import type { UnparsedWireValue } from "@luke/wire";
import { Option, Schema } from "effect";

/**
 * Every experiment's key: what its gate names, what the account stores its
 * choice under, and what it is counted as. A key is deleted when its feature
 * graduates, which is what makes every gate left behind fail to compile.
 */
export const EXPERIMENT = {
  /** The read-only Talk → Build → Ship board beside the Inbox. */
  FACTORY: "factory",
  /** Coding agents started on a schedule, listed and made on their own page. */
  AUTOMATIONS: "automations",
  /** Calls that open with Luke on video, a Keyframe avatar at the top of the Call tab. */
  VIDEO_CALLS: "video-calls",
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
    key: EXPERIMENT.VIDEO_CALLS,
    name: "Video calls",
    detail:
      "Calls open with Luke on video at the top of the Call tab. Keyframe Labs animates him from his " +
      "voice, so what he says about your plan reaches Keyframe. Your own voice never does.",
    owner: "Charles",
    since: "2026-10-15",
  },
  {
    key: EXPERIMENT.AUTOMATIONS,
    name: "Automations",
    detail:
      "Start a coding agent on a schedule, for you or for the whole workspace, from the Automations page in the sidebar.",
    owner: "Dean",
    since: "2026-10-15",
  },
  {
    key: EXPERIMENT.FACTORY,
    name: "Factory",
    detail:
      "Every task on one board, from Talk to Build to Ship, beside the Inbox. Read-only for now.",
    owner: "Dean",
    since: "2026-10-14",
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
