import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

export const EXPERIMENT = {
  MEMORY: "memory",
  PILOT: "pilot",
  SKILLS: "skills",
  BRING_YOUR_OWN_HOST: "bring-your-own-host",
  DESCRIPTIONS: "descriptions",
} as const;

export type Experiment = (typeof EXPERIMENT)[keyof typeof EXPERIMENT];

export interface ExperimentEntry {
  readonly key: Experiment;
  readonly name: string;
  readonly detail: string;
  readonly owner: string;
  readonly since: string;
}

export const EXPERIMENTS = [
  {
    key: EXPERIMENT.DESCRIPTIONS,
    name: "Task descriptions",
    detail:
      "Give each task a description its agents keep current as they work, with comments on it and its version history.",
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

export type ExperimentChoices = Readonly<Partial<Record<Experiment, boolean>>>;

export const NO_EXPERIMENTS: ExperimentChoices = {};

export const isExperiment = Schema.is(Schema.Literals(Object.values(EXPERIMENT)));
const isChoice = Schema.is(Schema.Boolean);
const choicesRecord = Schema.Record(Schema.String, Schema.Unknown);

export function experimentChoicesFrom(value: UnparsedWireValue): ExperimentChoices | undefined {
  const decoded = Schema.decodeUnknownOption(choicesRecord)(value);
  if (Option.isNone(decoded)) return undefined;
  const choices: Partial<Record<Experiment, boolean>> = {};
  for (const [key, choice] of Object.entries(decoded.value)) {
    if (isExperiment(key) && isChoice(choice)) choices[key] = choice;
  }
  return choices;
}

export function experimentOn(choices: ExperimentChoices, experiment: Experiment): boolean {
  return choices[experiment] === true;
}
