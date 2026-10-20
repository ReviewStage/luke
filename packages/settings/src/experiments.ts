// experiments.ts -- the features a developer can turn on before they are finished, and how a choice of them is read.
import type { UnparsedWireValue } from "@luke/wire";
import { Option, Schema } from "effect";

/**
 * Every experiment's key: what its gate names, what the account stores its
 * choice under, and what it is counted as. A key is deleted when its feature
 * graduates, which is what makes every gate left behind fail to compile.
 */
export const EXPERIMENT = {
  /** A Browser tab in the side panel: a web page beside the plan, the Mac's own `localhost` among them. */
  BROWSER: "browser",
  /** A workspace's chat: its people, coding agents, and Luke talking in channels and DMs. */
  CHAT: "chat",
  /** The read-only Talk → Build → Ship board beside the Inbox. */
  FACTORY: "factory",
  /** The Code review automation, offered on the Automations page with its own settings in the editor. */
  CODE_REVIEW: "code-review",
  /** Calls that open with Luke on video, a Keyframe avatar at the top of the Call tab. */
  VIDEO_CALLS: "video-calls",
  /** A workspace's issues, each a title, a status, a priority, and a description, listed on their own page. */
  ISSUES: "issues",
  /** Sections of your own in the sidebar, each a title and an icon, that tasks are dragged into. */
  SECTIONS: "sections",
  /** A member's own classic GitHub personal access token, for repositories the Luke GitHub App is not installed on. */
  GITHUB_TOKEN: "github-token",
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
    key: EXPERIMENT.GITHUB_TOKEN,
    name: "GitHub personal access token",
    detail: "Use a classic personal access token for repositories without the Luke GitHub App.",
    owner: "Dean",
    since: "2026-10-19",
  },
  {
    key: EXPERIMENT.CODE_REVIEW,
    name: "Code review",
    detail:
      "Suggest a Code review automation on the Automations page, which reviews each pull " +
      "request as Luke and posts one GitHub review.",
    owner: "Dean",
    since: "2026-10-19",
  },
  {
    key: EXPERIMENT.BROWSER,
    name: "Browser tab",
    detail:
      "Open a web page in a tab beside your plan, your own localhost included. Pages keep " +
      "their own cookies, apart from Luke's.",
    owner: "Dean",
    since: "2026-10-16",
  },
  {
    key: EXPERIMENT.SECTIONS,
    name: "Sections",
    detail: "Keep tasks in sections of your own in the sidebar, each with a title and an icon.",
    owner: "Charles",
    since: "2026-10-16",
  },
  {
    key: EXPERIMENT.ISSUES,
    name: "Issues",
    detail: "Track your workspace's issues on a page of their own, grouped by status.",
    owner: "Charles",
    since: "2026-10-16",
  },
  {
    key: EXPERIMENT.CHAT,
    name: "Chat",
    detail:
      "Talk with your workspace's people, coding agents, and Luke in channels and direct messages.",
    owner: "Charles",
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
  {
    key: EXPERIMENT.FACTORY,
    name: "Factory",
    detail: "Every task on one board, from Talk to Build to Ship. Read-only for now.",
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
