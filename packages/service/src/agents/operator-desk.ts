/**
 * operator-desk.ts -- what an operator reads of its member's open work: the desk its turns open with, and `list_open_asks`.
 *
 * The member's operator (`coder-host/operator.ts`) runs one conversation
 * for weeks, so what stands of its member's work is handed to it as a short
 * standing context rather than read afresh each turn: the desk, a few
 * sections of rows, which a turn's own message carries after the history
 * only where it changed since the operator's last turn
 * (`coder-host/host.ts`'s `turnMessage`), so the history stays the
 * provider's cached prefix. It holds the member's own agents of the
 * workspace still running and failed, the pull requests they opened that
 * wait on the member, and the asks waiting in the member's inbox, each
 * section at most `OPERATOR_DESK.ROWS` rows with how many more stand; no
 * row names a time, so the same work reads as the same desk. A section is a
 * heading and its rows (`DeskSection`), so another kind of row joins the
 * desk as one more section (`readDeskSections`).
 *
 * `list_open_asks` is the operator's read of every ask waiting on its member
 * across all their agents, where `read_inbox` reads only the caller's own
 * threads (`../inbox/inbox-store.ts`'s `memberOpenAsks`): only an operator is
 * offered it, and any other caller is refused. A member's own agents are the
 * ones whose row is theirs, started by them or by any of their agents, the
 * operator among them; a teammate's never.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  awaitingLinesOfReached,
  type CodingAgent,
  latestTurnsOfReached,
  listPublishedCodingAgentsById,
  listWorkspaceCodingAgents,
} from "@luke/database/models/coding-agent-store";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "@luke/wire";
import { Clock, Effect, Schema } from "effect";
import type { StoreFailure } from "../http/store-failure.js";
import { type MemberOpenAsk, memberOpenAsks } from "../inbox/inbox-store.js";
import { codingAgentFailureOf, codingAgentStatusOf, startedBlank } from "./coder-host/status.js";
import {
  AGENT_CALLER,
  agentToolRejected,
  type CodingAgentCall,
  orStoreRefusal,
} from "./coding-agent-tools.js";
import { isOperator } from "./steward.js";
import { workspaceStepOf, writtenMention } from "./written-mentions.js";

/** How much the desk and the asks read hold. */
export const OPERATOR_DESK = {
  /** The most rows a section of the desk shows; the rest are counted. */
  ROWS: 8,
  /** The most of the workspace's agents, newest first, the desk reads its member's from. */
  AGENTS_READ: 200,
  /** The most asks `list_open_asks` answers, the latest changed first. */
  ASKS_LISTED: 100,
  /** The most characters of an ask's own words `list_open_asks` answers. */
  ASK_CHARS: 600,
} as const;

/** The line the desk rides behind in a turn's message. */
export const DESK_LEAD =
  "Your desk as this turn opens, handed to you as data because it is new to you or changed since your last turn:";

/** Why `list_open_asks` answered nothing, in words the model can act on. */
export const LIST_OPEN_ASKS_REFUSAL = {
  NOT_OPERATOR: `Not run: only your member's operator reads their whole inbox; ${AGENT_TOOL.READ_INBOX} reads your own threads.`,
} as const;

/** `list_open_asks`, as the operator is offered it: it takes nothing. */
export const LIST_OPEN_ASKS_TOOL = {
  name: AGENT_TOOL.LIST_OPEN_ASKS,
  description:
    "List every thread waiting on the developer in their inbox, across all of their own agents in this workspace, " +
    "yours among them, and none of a teammate's: each with its key, its title, the agent that posted it (its id, " +
    "name, and mention) and its task (null for none), the kind of ask that waits (decide, do, or answer; null for a " +
    "post that only waits to be read) and its words, the latest changed first and at most " +
    `${OPERATOR_DESK.ASKS_LISTED}. It only reads: never answer an ask for the developer. ${AGENT_TOOL.READ_INBOX} ` +
    "reads only your own threads.",
  inputSchema: Schema.Struct({}),
} as const;

/** One section of the desk: its heading, and every row it holds, of which it shows `OPERATOR_DESK.ROWS`. */
export interface DeskSection {
  readonly heading: string;
  readonly rows: readonly string[];
  /** Where the rows past the cap are read whole. */
  readonly more: string;
}

/** The headings of the desk's own sections. */
const DESK_HEADING = {
  RUNNING: "Running",
  FAILED: "Failed",
  PULL_REQUESTS: "Pull requests awaiting them",
  ASKS: "Waiting on them in their inbox",
} as const;

/** The agent as a row names it: its human name, its title, or its model. */
function agentName(agent: Pick<CodingAgent, "personaName" | "title" | "model">): string {
  return agent.personaName ?? agent.title ?? agent.model;
}

/** An agent's mention under the workspace's step, under its task where it has one. */
function agentMention(
  agent: { readonly id: string; readonly taskId: string | null },
  name: string,
  step: string,
): string {
  const task = agent.taskId === null ? undefined : { taskId: agent.taskId };
  return writtenMention({ kind: MENTION_KIND.AGENT, ...task, agentId: agent.id }, name, step);
}

/** An ask's agent as its rows name it. */
function askAgent(ask: MemberOpenAsk, step: string) {
  const name = ask.agentName ?? ask.agentModel;
  return {
    id: ask.agentId,
    name,
    mention: agentMention({ id: ask.agentId, taskId: ask.taskId }, name, step),
  };
}

/** A section's rows as the desk shows them: the first `OPERATOR_DESK.ROWS`, then how many more and where to read them. */
function sectionText(section: DeskSection): string {
  const shown = section.rows.slice(0, OPERATOR_DESK.ROWS);
  const left = section.rows.length - shown.length;
  const more = left > 0 ? [`- and ${left} more; ${section.more}`] : [];
  return [`${section.heading} (${section.rows.length}):`, ...shown, ...more].join("\n");
}

/**
 * The desk as a turn's message carries it, behind its lead: each section
 * that holds a row, or a line saying none holds one.
 */
export function deskText(sections: readonly DeskSection[]): string {
  const held = sections.filter((section) => section.rows.length > 0);
  const body =
    held.length === 0
      ? "Nothing stands: none of their agents runs or failed, no pull request awaits them, and nothing waits in their inbox."
      : held.map(sectionText).join("\n\n");
  return `${DESK_LEAD}\n${body}`;
}

/** The member's own agents of the workspace standing, the operator left out, each with what it reads as now. */
const memberAgentsOf = (operator: CodingAgent) =>
  Effect.gen(function* () {
    const listed = yield* listWorkspaceCodingAgents(operator.userId, operator.organizationId, {
      limit: OPERATOR_DESK.AGENTS_READ,
    });
    const own = listed.filter(
      (agent) => agent.userId === operator.userId && agent.id !== operator.id,
    );
    // What each published is read beside it, as its tab reads it: the pull request GitHub last answered.
    const agents = yield* listPublishedCodingAgentsById(
      operator.userId,
      own.map((agent) => agent.id),
    );
    const ids = agents.map(({ agent }) => agent.conversationId);
    const turns = yield* latestTurnsOfReached(ids);
    const awaiting = yield* awaitingLinesOfReached(ids);
    const now = yield* Clock.currentTimeMillis;
    return agents.map(({ agent, published }) => {
      const turn = turns.get(agent.conversationId);
      const status = codingAgentStatusOf(turn, {
        createdAt: agent.createdAt,
        now,
        awaitingLineAt: awaiting.get(agent.conversationId),
        blank: startedBlank(agent),
      });
      const failure =
        status === CODING_AGENT_STATUS.FAILED ? codingAgentFailureOf(turn) : undefined;
      return { agent, published, status, failure };
    });
  });

/**
 * The desk's sections for the operator's member, as above: their agents
 * running and failed, the pull requests their agents opened that are open
 * and ready, and the threads waiting in their inbox. Read as the operator's
 * member, so a workspace they have left reads as nothing standing.
 */
export const readDeskSections = (
  operator: CodingAgent,
): Effect.Effect<readonly DeskSection[], StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const [agents, asks, step] = yield* Effect.all(
      [
        memberAgentsOf(operator),
        memberOpenAsks(operator.userId, operator.organizationId, OPERATOR_DESK.ASKS_LISTED),
        workspaceStepOf(operator.userId, operator.organizationId),
      ],
      { concurrency: "unbounded" },
    );
    const named = (agent: CodingAgent) => agentMention(agent, agentName(agent), step);
    const running = agents.filter(
      ({ status }) =>
        status === CODING_AGENT_STATUS.STARTING || status === CODING_AGENT_STATUS.RUNNING,
    );
    const failed = agents.filter(({ status }) => status === CODING_AGENT_STATUS.FAILED);
    const awaiting = agents.flatMap(({ agent, published }) =>
      published?.state === PULL_REQUEST_STATE.OPEN ? [{ agent, pull: published }] : [],
    );
    return [
      {
        heading: DESK_HEADING.RUNNING,
        rows: running.map(({ agent, status }) => `- ${named(agent)}, ${status}`),
        more: `${AGENT_TOOL.LIST_AGENTS} names them all.`,
      },
      {
        heading: DESK_HEADING.FAILED,
        rows: failed.map(({ agent, failure }) =>
          failure === undefined ? `- ${named(agent)}` : `- ${named(agent)}, ${failure}`,
        ),
        more: `${AGENT_TOOL.LIST_AGENTS} names them all.`,
      },
      {
        heading: DESK_HEADING.PULL_REQUESTS,
        rows: awaiting.map(
          ({ agent, pull }) =>
            `- [@#${pull.number} ${pull.title}](${pull.url}) by ${named(agent)}, checks ${pull.checks}`,
        ),
        more: `${AGENT_TOOL.READ_AGENT} reads each agent's.`,
      },
      {
        heading: DESK_HEADING.ASKS,
        rows: asks.map((ask) => {
          const kind = ask.askType === null ? "" : ` (${ask.askType})`;
          return `- "${ask.title}"${kind} from ${askAgent(ask, step).mention}`;
        }),
        more: `${AGENT_TOOL.LIST_OPEN_ASKS} lists them all.`,
      },
    ];
  });

/** The desk's text for the operator, as a turn's message carries it. */
export const operatorDesk = (
  operator: CodingAgent,
): Effect.Effect<string, StoreFailure, DatabaseServices> =>
  Effect.map(readDeskSections(operator), deskText);

/** An ask's own words, cut to the bound on a whole character. */
function askWords(text: string | null): string | null {
  if (text === null) return null;
  const chars = [...text];
  return chars.length <= OPERATOR_DESK.ASK_CHARS
    ? text
    : `${chars.slice(0, OPERATOR_DESK.ASK_CHARS).join("")}…`;
}

/**
 * One call of `list_open_asks`: every thread waiting on the operator's
 * member across their own agents in its workspace, or the refusal for any
 * caller that is no operator. Note that the caller's input is read for
 * nothing, since the tool takes none, so an extra field asks nothing.
 */
export function runListOpenAsks(
  call: CodingAgentCall,
  _input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const { caller } = call;
  if (caller.kind !== AGENT_CALLER.AGENT || !isOperator(caller.agent)) {
    return Effect.succeed(agentToolRejected(LIST_OPEN_ASKS_REFUSAL.NOT_OPERATOR));
  }
  const operator = caller.agent;
  return orStoreRefusal(
    Effect.gen(function* () {
      const [asks, step] = yield* Effect.all([
        memberOpenAsks(operator.userId, operator.organizationId, OPERATOR_DESK.ASKS_LISTED),
        workspaceStepOf(operator.userId, operator.organizationId),
      ]);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        asks: asks.map((ask) => ({
          key: ask.key,
          title: ask.title,
          agent: askAgent(ask, step),
          task: ask.taskId === null ? null : { id: ask.taskId, name: ask.taskName ?? "" },
          ask: ask.askType,
          words: askWords(ask.askText),
        })),
      };
    }),
  );
}
