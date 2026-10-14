import type { CodingAgent } from "@sidecar/database/models/coding-agent-store";
import {
  CODING_AGENT_BRIEF,
  type CodingAgentBrief,
  ROLLOUT_ROLE,
} from "@sidecar/hosted/coding-agent-wire";
import { planSections } from "@sidecar/hosted/plan-document";
import { PLAN_HEADING } from "@sidecar/hosted/plan-template";
import {
  ROLLOUT_BASE,
  type RolloutItem,
  type RolloutStack,
  rolloutStacksOf,
} from "@sidecar/hosted/plan-wire";
import { rolloutBranchPrefix } from "./bounds.js";

/**
 * brief.ts -- the briefs a rollout's agents are handed as their first message: a builder's one pull request, and the keeper's stacks.
 *
 * A rollout has one builder per pull request and one stack keeper. A
 * builder started at a position of the plan's rollout is handed its brief in
 * the plan's place (`start.ts`). It carries the plan's Context and Goal
 * verbatim, so the builder knows why the work exists, then its own pull
 * request's title, scope, and acceptance, then the chain of pull requests
 * from main up to its own with the branch each stands on where one is known,
 * and the rollout's other pull requests by title as out of scope, so a
 * builder never builds a sibling's slice. A builder pushes its own branch and
 * nothing else: the keeper owns every piece of git structure, so the builder
 * is told never to touch the stack and to reset to its branch's remote head
 * when told to resync. Context and Goal are the plan's sections under those
 * headings; a missing one is left out rather than drawn empty.
 * The keeper's brief is the rollout's pull requests with the branch each
 * stands on where one is known, the chains `rolloutStacksOf` cuts it into,
 * one GitHub stack each since a stack is a line, and how it keeps them:
 * link, restack in one pass, retarget after a merge, merge on the
 * developer's go relayed by Luke, and report a conflict it would have to
 * judge rather than resolve it.
 * The row keeps the brief where it keeps a plan's snapshot, so what an agent
 * was handed is read off its row: the keeper's brief for the keeper, which
 * is never handed a task, then its task where it has one, a pull request's
 * brief where it holds a position, and the plan otherwise.
 */

/** What the brief reads of a plan: its whole text and its rollout. */
export interface BriefPlan {
  readonly text: string;
  readonly rollout: readonly RolloutItem[];
}

/** The plan's sections a builder is handed verbatim, in order. */
const VERBATIM_SECTIONS = [PLAN_HEADING.CONTEXT, PLAN_HEADING.GOAL] as const;

/** The plan's Context and Goal as Markdown sections, each as often as the plan holds it, and left out where it holds none. */
function verbatimSections(plan: BriefPlan): readonly string[] {
  const sections = planSections(plan.text);
  // A heading the plan repeats is handed every time it stands, since each may hold its own requirements.
  return VERBATIM_SECTIONS.flatMap((heading) => {
    const wanted = heading.toLowerCase();
    return sections
      .filter((each) => each.heading.trim().toLowerCase() === wanted)
      .map((each) => each.text);
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

/** What a builder is told of the stack its pull request stands in: its own branch is all it pushes, and the keeper does the rest. */
const BUILDER_STACK_WORDS =
  "Push your own branch and nothing else. The rollout's stack keeper owns its git structure: it links the stacks, restacks a branch when one below it moves, retargets a pull request after a merge, and merges on the developer's word. So never run `gh stack`, never rebase your branch onto a base that moved, never retarget your pull request, and never merge anything. Push every commit as you make it, so a resync loses nothing. When you are told to resync, run `git fetch origin <your branch> && git reset --hard origin/<your branch>` before any more work, since the keeper rewrote your branch on the remote; where you still hold edits or commits you have not pushed, reset nothing, and say so in your message, so nothing of yours is lost.";

/**
 * The brief for the builder at `position` of the plan's rollout, counted from
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
    `You are the builder of one pull request of this plan's rollout. Build this pull request and nothing else.`,
    ...verbatimSections(plan),
    `## This pull request\n\n${item.scope}`,
    ...(item.acceptance === null ? [] : [`Done when: ${item.acceptance}`]),
    `## The stack\n\n${stackLines(rollout, chain, branches)}`,
    BUILDER_STACK_WORDS,
    ...(others.length === 0
      ? []
      : [
          `## Out of scope\n\nThe rollout's other pull requests are other builders' to write; build none of them:\n\n${others.map((each) => `- ${each}`).join("\n")}`,
        ]),
  ];
  return `${parts.join("\n\n")}\n`;
}

/** One pull request as the keeper's list names it: its position and title, its base, and its branch where one is known. */
function keptLine(
  item: RolloutItem,
  position: number,
  branches: ReadonlyMap<number, string>,
): string {
  const base = item.base === ROLLOUT_BASE.MAIN ? ROLLOUT_BASE.MAIN : `#${item.base}`;
  const branch = branches.get(position);
  const where = branch === undefined ? "no branch yet" : `\`${branch}\``;
  return `- #${position} ${item.title} · base: ${base} · ${where}`;
}

/** One chain as the keeper's list names it: what it bases on, then its pull requests bottom to top. */
function chainLine(rollout: readonly RolloutItem[], stack: RolloutStack): string {
  const base = stack.base === ROLLOUT_BASE.MAIN ? ROLLOUT_BASE.MAIN : named(rollout, stack.base);
  return `On ${base}: ${stack.positions.map((at) => named(rollout, at)).join(" → ")}`;
}

/** How the keeper keeps the stacks, one rule a line. */
const KEEPER_RULES = [
  "Link a chain as its pull requests open: check out its bottom branch and run `gh stack init <branch> <branch> …` over the chain's existing branches, bottom to top, with `--base <branch>` where the chain does not start on main; `gh stack add <branch>` puts a pull request that opens later on top of a linked chain; `gh stack submit` links the chain on GitHub.",
  "After any push or merge below a pull request, restack its chain in one pass with `gh stack sync`. Where sync stops on a conflict, run `gh stack rebase`, resolve it, and go on with `gh stack rebase --continue`, or give up with `gh stack rebase --abort`; then `gh stack push`. Every push of a rewritten branch is `--force-with-lease`, never a plain force.",
  "After a pull request merges, retarget the next one up to main with `gh pr edit <number> --base main`, then restack what stands on it.",
  "Merge only when Luke relays the developer's go, and only the bottom pull request of a chain, with `gh pr merge <number> --squash`. Never merge on your own.",
  "Write no feature code. Resolve a conflict only where it is mechanical: both sides kept whole, as a moved import or neighbouring lines. A conflict that needs a judgment of how the code should work is not yours: abort, and report it as `conflict`, naming the pull request and the files, so Luke relays it to that pull request's builder.",
  "Report with your report tool after every restack, naming each pull request whose branch you rewrote so its builder resyncs, after every merge, and on every conflict you did not resolve.",
] as const;

/**
 * The brief for the stack keeper of the plan's rollout, with the branch each
 * pull request stands on where it is known and the prefix every builder's
 * branch is cut under; undefined for a rollout with nothing in it.
 */
export function stackKeeperBrief(
  planId: string,
  rollout: readonly RolloutItem[],
  branches: ReadonlyMap<number, string>,
): string | undefined {
  if (rollout.length === 0) return undefined;
  const stacks = rolloutStacksOf(rollout);
  const prefix = rolloutBranchPrefix(planId);
  const parts = [
    `# Stack keeper: ${rollout.length} pull requests in ${stacks.length} ${stacks.length === 1 ? "stack" : "stacks"}`,
    "You keep the git structure of this plan's rollout. Each pull request has a builder of its own, who writes it on its base and pushes only its own branch; you write none of the code.",
    `## The pull requests\n\nEvery builder's branch is \`${prefix}<position>-<slug>\`, fetched in your checkout under \`origin/${prefix}\`, so one not yet listed here is found there once its builder pushes it.\n\n${rollout.map((item, at) => keptLine(item, at + 1, branches)).join("\n")}`,
    `## The stacks\n\n\`gh stack\` keeps one line of branches, so each chain is a GitHub stack of its own, bottom to top:\n\n${stacks.map((stack, at) => `${at + 1}. ${chainLine(rollout, stack)}`).join("\n")}`,
    `## Keeping them\n\n${KEEPER_RULES.map((rule) => `- ${rule}`).join("\n")}`,
  ];
  return `${parts.join("\n\n")}\n`;
}

/** What the agent was handed as its first message, read off its row as above. */
export function briefOf(agent: Pick<CodingAgent, "task" | "position" | "role">): CodingAgentBrief {
  if (agent.role === ROLLOUT_ROLE.KEEPER) return CODING_AGENT_BRIEF.STACK_KEEPER;
  if (agent.task !== null) return CODING_AGENT_BRIEF.TASK;
  return agent.position === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.PULL_REQUEST;
}
