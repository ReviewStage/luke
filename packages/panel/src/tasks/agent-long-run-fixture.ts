/**
 * agent-long-run-fixture.ts -- the orchestrator a fixture run's long-run profile opens: days of work, thousands of calls, written to while it is open.
 *
 * The agent profiles' agent (`agent-fixture.ts`) ran one short turn. Under
 * the long-run profile it is an orchestrator that has run for days instead,
 * as the agent tab meets one at its heaviest: forty finished turns, each
 * opened by a teammate's line and answered by a journal of some fifty parts,
 * and a turn still under way that has done twenty rounds of the same work,
 * teammates' lines arriving between them, so the transcript holds about
 * three thousand entries. Among them stand hundreds of message and Inbox calls,
 * sixty coding agents it started and twenty workers it delegated to,
 * hundreds of mention chips in long Markdown with tables and links, and
 * thirty sets of pictures, each a screenshot's size. After the first page,
 * the stream pushes the running turn's journal again every
 * `LONG_RUN.STEP_MS`, a step longer each time, as a running agent's follow
 * does. Every name, address, and line here is invented.
 */

import type { CodingAgentTranscriptPage } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { FIXTURE_IDS } from "@luke/host/fixture-stage";
import { MESSAGE_ROLE, type WireRecord, type WireValue } from "@luke/wire";
import { AsyncIteratorClass } from "@orpc/client";
import { rendererPause } from "../renderer-runtime.js";

/** How big the run is, and how fast its newest turn is written. */
export const LONG_RUN = {
  /** The turns it ran, each a line in and a journal out; the newest is still under way. */
  TURNS: 41,
  /** The rounds of work the newest turn has done so far, each as much as a finished turn holds, a teammate's line arriving after some. */
  ROUNDS: 20,
  /** The calls each turn makes before its words, a coding agent started and a set of pictures among them. */
  CALLS_PER_TURN: 22,
  /** How often a running turn's journal is pushed again, a part longer, in milliseconds. */
  STEP_MS: 1_000,
  /** How wide and tall each picture the agent showed is, in pixels: a screenshot's size. */
  PICTURE_WIDTH: 2_400,
  PICTURE_HEIGHT: 1_500,
} as const;

const MINUTE = 60_000;

/** When the run began: three days before the fixture's clock reads it. */
const RUN_STARTED_AT = Date.parse("2026-10-22T09:00:00Z");

/** The teammates the run's words mention, as a workspace's chips name them. */
const PEOPLE = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson"] as const;

/** The jobs the agents it started work on, named as a rollout names them. */
const JOBS = [
  "fix(panel): menus keep their place on a small window",
  "refactor(ui): one toolbar for every pane",
  "feat(panel): the Inbox opens on its list on a phone",
  "fix(service): agent search matches each word",
  "perf(panel): drafts written after a pause",
  "fix(ui): chips fade where cut",
] as const;

/** A coding agent the run started, by its turn: its id and its name. */
function startedAgent(turn: number): { readonly id: string; readonly name: string } {
  const hex = turn.toString(16).padStart(12, "0");
  return {
    id: `0a1b2c3d-4e5f-4a6b-8c7d-${hex}`,
    name: `${JOBS[turn % JOBS.length]} (${turn + 1})`,
  };
}

/** A mention of the agent the run started at `turn`, as the run writes one. */
function agentMention(turn: number): string {
  const agent = startedAgent(turn);
  return `[@${agent.name}](https://tryluke.dev/stage/plan/${FIXTURE_IDS.TASK}/agent/${agent.id})`;
}

/** A mention of a pull request the run's agents opened. */
function pullRequestMention(turn: number): string {
  const number = 5_000 + turn;
  return `[@#${number} ${JOBS[turn % JOBS.length]}](https://github.com/ada/relay/pull/${number})`;
}

/** A tool's call as the transcript stores it, answered. */
function toolPart(tool: string, callId: string, input: WireRecord, output: WireValue): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** The same call still under way, as a running turn's newest call stands. */
function runningPart(tool: string, callId: string, input: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "input-available", input };
}

/** The long Markdown a turn ends on: a table of the rollout's pull requests, links, and chips. */
function turnWords(turn: number): string {
  const rows = Array.from({ length: 3 }, (_, at) => {
    const each = turn * 3 + at;
    return `| ${pullRequestMention(each)} | ${each % 3 === 0 ? "Merged" : "In the queue"} | ${agentMention((turn + at) % LONG_RUN.TURNS)} |`;
  });
  return [
    `Wave ${turn + 1} stands as below. ${agentMention(turn)} opened its pull request, and ${PEOPLE[turn % PEOPLE.length]} asked for the narrow layout first.`,
    "",
    "| Pull request | State | Agent |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `Next: restack ${pullRequestMention(turn + 1)} onto \`main\` once [the queue](https://github.com/ada/relay/queue/main) clears, then start the **next wave** of ${JOBS.length} agents.`,
  ].join("\n");
}

/** One of the run's calls, its `at`th of the turn: message and Inbox calls most, then commands and reads. */
function call(turn: number, at: number): WireRecord {
  const id = `long-run-${turn}-${at}`;
  switch (at % 7) {
    case 0:
      return toolPart(
        "message_agent",
        id,
        {
          agentId: startedAgent(turn).id,
          text: `pushed wave ${turn + 1}, ${at} of ${LONG_RUN.CALLS_PER_TURN} green`,
        },
        { status: "accepted" },
      );
    case 1:
      return toolPart("read_threads", id, {}, { status: "accepted", threads: [] });
    case 2:
      return toolPart(
        "post_to_inbox",
        id,
        {
          key: `wave-${turn}-${at}`,
          title: `Wave ${turn + 1} is ready`,
          body: `Every pull request of wave ${turn + 1} is up. ${agentMention(turn)}`,
        },
        { status: "accepted", inbox: [] },
      );
    case 3:
      return toolPart(
        "bash",
        id,
        { command: `gh pr checks ${5_000 + turn}`, description: "Read the pull request's checks" },
        {
          stdout: Array.from({ length: 12 }, (_, line) => `check-${line}\tpass\t1m${line}s`).join(
            "\n",
          ),
          stderr: "",
          exitCode: 0,
        },
      );
    case 4:
      return toolPart(
        "read_file",
        id,
        { filePath: `packages/panel/src/tasks/wave-${turn}.ts` },
        { content: `export const WAVE = ${turn};\n`.repeat(20) },
      );
    case 5:
      return toolPart(
        "list_agents",
        id,
        { taskId: FIXTURE_IDS.TASK },
        { status: "accepted", agents: [] },
      );
    default:
      return toolPart(
        "message_agent",
        id,
        { agentId: startedAgent(turn).id, text: "ci's red on lint, fixing" },
        { status: "accepted" },
      );
  }
}

/** The coding agent a turn started, as `start_agent` answers. */
function startAgentPart(turn: number): WireRecord {
  const agent = startedAgent(turn);
  return toolPart(
    "start_agent",
    `long-run-${turn}-start`,
    { taskId: FIXTURE_IDS.TASK, title: agent.name, prompt: `Build ${agent.name}.` },
    {
      status: "accepted",
      agent: {
        id: agent.id,
        title: agent.name,
        model: "anthropic/claude-opus-5.5",
        modelName: "Opus 5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
        onYourTask: true,
      },
    },
  );
}

/** The worker a turn delegated to, as `delegate` answers. */
function delegatePart(turn: number): WireRecord {
  return toolPart(
    "delegate",
    `long-run-${turn}-delegate`,
    {
      description: `Audit wave ${turn + 1}`,
      task: `Read every pull request of wave ${turn + 1} and list what still fails.`,
    },
    { result: `Wave ${turn + 1}: nothing fails.` },
  );
}

/** The set of pictures a turn showed, as `show_image` answers. */
function picturesPart(turn: number): WireRecord {
  return toolPart(
    "show_image",
    `long-run-${turn}-pictures`,
    { images: [{ path: `/tmp/wave-${turn}.png`, caption: `Wave ${turn + 1} at 760px` }] },
    {
      pictures: [
        {
          id: `long-run-picture-${turn}`,
          mediaType: "image/png",
          width: LONG_RUN.PICTURE_WIDTH,
          height: LONG_RUN.PICTURE_HEIGHT,
          byteCount: 400_000,
        },
      ],
    },
  );
}

/** A turn's parts, in the order its journal stored them: thinking, its calls a step each, then its words. */
function turnParts(turn: number): WireRecord[] {
  const calls = Array.from({ length: LONG_RUN.CALLS_PER_TURN }, (_, at) => [
    { type: "step-start" },
    call(turn, at),
  ]).flat();
  return [
    { type: "step-start" },
    { type: "reasoning", text: `Wave ${turn + 1} first: read the threads, then the queue.` },
    ...calls,
    startAgentPart(turn),
    ...(turn % 3 === 0 ? [delegatePart(turn)] : []),
    ...(turn % 2 === 0 ? [picturesPart(turn)] : []),
    { type: "text", text: turnWords(turn) },
  ];
}

/** The line that opened a turn: a teammate's, or the developer's own naming what to do next. */
function turnLine(turn: number): CodingAgentMessage {
  const at = RUN_STARTED_AT + turn * 70 * MINUTE;
  return {
    id: `long-run-line-${turn}`,
    turnId: `long-run-turn-${turn}`,
    role: MESSAGE_ROLE.USER,
    parts: [
      {
        type: "text",
        text: `${PEOPLE[turn % PEOPLE.length]}: ${agentMention(turn)} is done, take the next of ${pullRequestMention(turn)}.`,
      },
    ],
    sentAt: at,
  };
}

/** A turn's journal, finished an hour after it began, or still under way where it is the newest. */
function turnJournal(turn: number, parts: readonly WireRecord[], running: boolean) {
  const at = RUN_STARTED_AT + turn * 70 * MINUTE;
  return {
    id: `long-run-journal-${turn}`,
    turnId: `long-run-turn-${turn}`,
    role: MESSAGE_ROLE.ASSISTANT,
    parts,
    startedAt: at,
    ...(running ? undefined : { finishedAt: at + 60 * MINUTE }),
  } satisfies CodingAgentMessage;
}

/** Every turn but the newest, whole, then the newest's line. */
const SETTLED: readonly CodingAgentMessage[] = Array.from({ length: LONG_RUN.TURNS }, (_, turn) =>
  turn === LONG_RUN.TURNS - 1
    ? [turnLine(turn)]
    : [turnLine(turn), turnJournal(turn, turnParts(turn), false)],
).flat();

/** The rounds the newest turn has done, each a finished turn's work, numbered after the settled turns. */
const ROUND_PARTS: readonly (readonly WireRecord[])[] = Array.from(
  { length: LONG_RUN.ROUNDS },
  (_, round) => turnParts(LONG_RUN.TURNS + round),
);

/** The id of the newest turn's journal. */
const NEWEST_JOURNAL = `long-run-journal-${LONG_RUN.TURNS - 1}`;

/** How many steps the newest turn had begun by the end of each of its rounds. */
const ROUND_STEPS: readonly number[] = ROUND_PARTS.map(
  (_, round) =>
    ROUND_PARTS.slice(0, round + 1)
      .flat()
      .filter((part) => part.type === "step-start").length,
);

/** A teammate's line that reached the newest turn after every third round, as a steer does. */
const ARRIVED: readonly CodingAgentMessage[] = ROUND_STEPS.flatMap((afterStep, round) =>
  round % 3 === 2
    ? [
        {
          ...turnLine(LONG_RUN.TURNS + round),
          id: `long-run-arrived-${round}`,
          arrivedIn: { journalId: NEWEST_JOURNAL, afterStep },
        },
      ]
    : [],
);

/** The newest turn's journal: its rounds, then `steps` steps written while the tab is open, its last call still under way. */
function newestJournal(steps: number): CodingAgentMessage {
  const turn = LONG_RUN.TURNS - 1;
  const parts: WireRecord[] = ROUND_PARTS.flat();
  for (let at = 0; at < steps; at += 1) {
    const done = call(turn, at);
    parts.push(
      { type: "step-start" },
      at === steps - 1 && isRecord(done.input)
        ? runningPart(String(done.type).slice("tool-".length), String(done.toolCallId), done.input)
        : done,
    );
  }
  return turnJournal(turn, parts, true);
}

function isRecord(value: WireValue | undefined): value is WireRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A page of the run as the stream pushes it: running, caught up. */
function runPage(
  messages: readonly CodingAgentMessage[],
  step: number,
  newest: boolean,
): CodingAgentTranscriptPage {
  return {
    messages,
    cursor: `${step}:0`,
    status: CODING_AGENT_STATUS.RUNNING,
    runStartedAt: RUN_STARTED_AT + (LONG_RUN.TURNS - 1) * 70 * MINUTE,
    title: "Roll out the polish waves",
    ...(newest ? { newest: true } : undefined),
    caughtUp: true,
  };
}

/** The run's whole transcript as its first page opens on it. */
export function longRunMessages(): readonly CodingAgentMessage[] {
  return [...SETTLED, newestJournal(1), ...ARRIVED];
}

/**
 * The run's stream, as main opens one on a running agent: the whole
 * transcript, then its newest journal again every `LONG_RUN.STEP_MS`, a step
 * longer, until the tab closes it.
 */
export function longRunStream(): AsyncIteratorClass<CodingAgentTranscriptPage, void> {
  let step = 0;
  let closed = false;
  return new AsyncIteratorClass<CodingAgentTranscriptPage, void>(
    async () => {
      if (closed) return { done: true, value: undefined };
      step += 1;
      if (step === 1) return { done: false, value: runPage(longRunMessages(), step, true) };
      await rendererPause(LONG_RUN.STEP_MS);
      return { done: false, value: runPage([newestJournal(step)], step, false) };
    },
    async () => {
      closed = true;
    },
  );
}

/** Each picture's bytes as the run showed it, drawn once: a screenshot-sized PNG. */
let pictureBytes: string | undefined;

/** A picture the run showed, read as main reads one: a screenshot-sized PNG. */
export function longRunPicture(): { readonly contentType: "image/png"; readonly base64: string } {
  if (pictureBytes === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = LONG_RUN.PICTURE_WIDTH;
    canvas.height = LONG_RUN.PICTURE_HEIGHT;
    const context = canvas.getContext("2d");
    if (context !== null) {
      const ground = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      ground.addColorStop(0, "#dbe7ff");
      ground.addColorStop(1, "#f7e3ff");
      context.fillStyle = ground;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    pictureBytes = canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  }
  return { contentType: "image/png", base64: pictureBytes };
}
