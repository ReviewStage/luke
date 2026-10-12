import { CODING_AGENT_BRIEF, type CodingAgentBrief } from "@sidecar/hosted/coding-agent-wire";
import { planSections } from "@sidecar/hosted/plan-document";
import { PLAN_HEADING } from "@sidecar/hosted/plan-template";
import { ROLLOUT_BASE, type RolloutItem } from "@sidecar/hosted/plan-wire";
import type { CodingAgent } from "../coding-agent-store.js";

/**
 * brief.ts -- the brief a rollout's worker is handed as its first message: one pull request of the plan, and nothing it must not build.
 *
 * A worker started at a position of the plan's rollout is handed this in the
 * plan's place (`start.ts`). It carries the plan's Context and Goal verbatim,
 * so the worker knows why the work exists, then its own pull request's title,
 * scope, and acceptance, then the chain of pull requests from main up to its
 * own with the branch each stands on where one is known, and the rollout's
 * other pull requests by title as out of scope, so a worker never builds a
 * sibling's slice. A worker whose base is not main is told to link its stack
 * once its pull request is open. Context and Goal are the plan's sections
 * under those headings; a missing one is left out rather than drawn empty. The row keeps the brief where it keeps a
 * plan's snapshot, so what an agent was handed is read off its row: its task
 * where it has one, a pull request's brief where it holds a position, and
 * the plan otherwise.
 */

/** What the brief reads of a plan: its whole text and its rollout. */
export interface BriefPlan {
  readonly text: string;
  readonly rollout: readonly RolloutItem[];
}

/** The plan's sections a worker is handed verbatim, in order. */
const VERBATIM_SECTIONS = [PLAN_HEADING.CONTEXT, PLAN_HEADING.GOAL] as const;

/** The plan's Context and Goal as Markdown sections, each left out where the plan holds none. */
function verbatimSections(plan: BriefPlan): readonly string[] {
  const sections = planSections(plan.text);
  return VERBATIM_SECTIONS.flatMap((heading) => {
    const wanted = heading.toLowerCase();
    const section = sections.find((each) => each.heading.trim().toLowerCase() === wanted);
    return section === undefined ? [] : [section.text];
  });
}

/** The positions from the lowest pull request on main up to this one, each counted from one. */
function chainTo(rollout: readonly RolloutItem[], position: number): readonly number[] {
  const chain: number[] = [];
  let at: number | typeof ROLLOUT_BASE.MAIN = position;
  while (at !== ROLLOUT_BASE.MAIN) {
    chain.unshift(at);
    const item: RolloutItem | undefined = rollout[at - 1];
    if (item === undefined) break;
    at = item.base;
  }
  return chain;
}

/** One pull request as the brief names it: its position and its title. */
function named(rollout: readonly RolloutItem[], position: number): string {
  return `#${position} ${rollout[position - 1]?.title ?? ""}`.trimEnd();
}

/** The stack from main up to this pull request, one line each, with the branch each earlier one stands on where it is known. */
function stackLines(
  rollout: readonly RolloutItem[],
  chain: readonly number[],
  branches: ReadonlyMap<number, string>,
): string {
  const lines = chain.map((at, depth) => {
    const indent = "  ".repeat(depth + 1);
    const branch = branches.get(at);
    const where =
      at === chain.at(-1) ? " (yours)" : branch === undefined ? "" : ` on \`${branch}\``;
    return `${indent}- ${named(rollout, at)}${where}`;
  });
  return [`- ${ROLLOUT_BASE.MAIN}`, ...lines].join("\n");
}

/** The command that links the stack once the worker's pull request is open, naming a branch it does not know by its position. */
function linkCommand(chain: readonly number[], branches: ReadonlyMap<number, string>): string {
  const below = chain
    .slice(0, -1)
    .map((at) => branches.get(at) ?? `<the branch of #${at}>`)
    .join(" ");
  return `gh stack link ${below} <your branch>`;
}

/**
 * The brief for the worker at `position` of the plan's rollout, counted from
 * one, with the branch each earlier pull request stands on where it is known;
 * undefined where the rollout names no such position.
 */
export function pullRequestBrief(
  plan: BriefPlan,
  position: number,
  branches: ReadonlyMap<number, string>,
): string | undefined {
  const { rollout } = plan;
  const item = rollout[position - 1];
  if (item === undefined) return undefined;
  const chain = chainTo(rollout, position);
  const others = rollout.flatMap((_, at) => (at + 1 === position ? [] : [named(rollout, at + 1)]));
  const parts = [
    `# Pull request ${position} of ${rollout.length}: ${item.title}`,
    `You are the worker for one pull request of this plan's rollout. Build this pull request and nothing else.`,
    ...verbatimSections(plan),
    `## This pull request\n\n${item.scope}`,
    ...(item.acceptance === null ? [] : [`Done when: ${item.acceptance}`]),
    `## The stack\n\n${stackLines(rollout, chain, branches)}`,
    ...(chain.length > 1
      ? [
          `Once your pull request is open, link the stack, bottom to top: \`${linkCommand(chain, branches)}\`.`,
        ]
      : []),
    ...(others.length === 0
      ? []
      : [
          `## Out of scope\n\nThe rollout's other pull requests are other workers' to build; build none of them:\n\n${others.map((each) => `- ${each}`).join("\n")}`,
        ]),
  ];
  return `${parts.join("\n\n")}\n`;
}

/** What the agent was handed as its first message, read off its row as above. */
export function briefOf(agent: Pick<CodingAgent, "task" | "position">): CodingAgentBrief {
  if (agent.task !== null) return CODING_AGENT_BRIEF.TASK;
  return agent.position === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.PULL_REQUEST;
}
