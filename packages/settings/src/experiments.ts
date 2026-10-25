// experiments.ts -- the features a developer can turn on before they are finished, and how a choice of them is read.
import type { UnparsedWireValue } from "@luke/wire";
import { Option, Schema } from "effect";

/**
 * Every experiment's key: what its gate names, what the account stores its
 * choice under, and what it is counted as. A key is deleted when its feature
 * graduates, which is what makes every gate left behind fail to compile.
 */
export const EXPERIMENT = {
  /** A Browser tab in the side panel: an agent's cloud browser beside the plan, watched and taken over. */
  BROWSER: "browser",
  /** The Code review automation, offered on the Automations page with its own settings in the editor. */
  CODE_REVIEW: "code-review",
  /** Calls that open with Luke on video, a Keyframe avatar in the agent's tab. */
  VIDEO_CALLS: "video-calls",
  /** A workspace's memory: its coding agents keep and recall facts with remember and recall, reviewed in Settings › Memory. */
  MEMORY: "memory",
  /** The sidebar as the Inbox: its threads under their tasks where the task list stood, the tasks left to the Tasks page. */
  INBOX_FIRST: "inbox-first",
  /** Luke as the member's operator: one standing agent per workspace that manages their other agents. */
  OPERATOR: "operator",
  /** Coding agents that run on the developer's own Mac, in a worktree, with their own tools, rather than in a cloud sandbox. */
  LOCAL_AGENTS: "local-agents",
  /** Channels: a workspace's threads read as Slack-style streams by topic, the sidebar listing channels in place of the Inbox and the tasks. */
  CHANNELS: "channels",
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
    key: EXPERIMENT.CHANNELS,
    name: "Channels",
    detail:
      "Read your workspace's threads by topic, each channel a stream your agents post to, " +
      "with the sidebar listing channels in place of your inbox and your tasks.",
    owner: "Dean",
    since: "2026-10-25",
  },
  {
    key: EXPERIMENT.MEMORY,
    name: "Memory",
    detail:
      "Your coding agents keep settled facts about how your team works and recall them in later work, " +
      "shared across your workspace and reviewed in Settings › Memory.",
    owner: "Dean",
    since: "2026-10-23",
  },
  {
    key: EXPERIMENT.OPERATOR,
    name: "Luke, your operator",
    detail:
      "One Luke of your own in each workspace that keeps an eye on your agents, steers them, " +
      "and tells you what needs you.",
    owner: "Dean",
    since: "2026-10-22",
  },
  {
    key: EXPERIMENT.INBOX_FIRST,
    name: "Inbox-first sidebar",
    detail:
      "The sidebar lists your inbox's items under their tasks in place of your task list, " +
      "which you find on the tasks page.",
    owner: "Dean",
    since: "2026-10-20",
  },
  {
    key: EXPERIMENT.CODE_REVIEW,
    name: "Code review",
    detail:
      "Suggest a Code review automation on the automations page, which reviews each pull " +
      "request as Luke and posts one GitHub review.",
    owner: "Dean",
    since: "2026-10-19",
  },
  {
    key: EXPERIMENT.BROWSER,
    name: "Browser tab",
    detail:
      "Watch your agents' cloud browsers in a tab beside your plan, and take one over to " +
      "sign in or steer.",
    owner: "Dean",
    since: "2026-10-16",
  },
  {
    key: EXPERIMENT.VIDEO_CALLS,
    name: "Video calls",
    detail:
      "Keyframe Labs animates Luke from his voice, so what he says about your plan reaches " +
      "Keyframe. Your own voice never does.",
    owner: "Charles",
    since: "2026-10-15",
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
