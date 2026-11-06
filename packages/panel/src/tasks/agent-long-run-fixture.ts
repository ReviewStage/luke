import { AsyncIteratorClass } from "@orpc/client";
import { AGENT_STATUS, type AgentTranscriptMessage } from "@repo/features/agent-wire";
import type { AppTranscript } from "@repo/host/app-state";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";
import { MESSAGE_ROLE, type WireRecord, type WireValue } from "@repo/wire";
import { rendererPause } from "../renderer-runtime.js";
import { fixtureMoved } from "./fixture-moves.js";

export const LONG_RUN = {
  TURNS: 41,
  ROUNDS: 20,
  CALLS_PER_TURN: 22,
  STEP_MS: 1_000,
  PICTURE_WIDTH: 2_400,
  PICTURE_HEIGHT: 1_500,
} as const;

const MINUTE = 60_000;

const RUN_STARTED_AT = Date.parse("2026-10-22T09:00:00Z");

const PEOPLE = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson"] as const;

const JOBS = [
  "fix(panel): menus keep their place on a small window",
  "refactor(ui): one toolbar for every pane",
  "feat(panel): the Inbox opens on its list on a phone",
  "fix(service): agent search matches each word",
  "perf(panel): drafts written after a pause",
  "fix(ui): chips fade where cut",
] as const;

function startedAgent(turn: number): { readonly id: string; readonly name: string } {
  const hex = turn.toString(16).padStart(12, "0");
  return {
    id: `0a1b2c3d-4e5f-4a6b-8c7d-${hex}`,
    name: `${JOBS[turn % JOBS.length]} (${turn + 1})`,
  };
}

function agentMention(turn: number): string {
  const agent = startedAgent(turn);
  return `[@${agent.name}](https://vespin.dev/stage/plan/${FIXTURE_IDS.TASK}/agent/${agent.id})`;
}

function pullRequestMention(turn: number): string {
  const number = 5_000 + turn;
  return `[@#${number} ${JOBS[turn % JOBS.length]}](https://github.com/ada/relay/pull/${number})`;
}

function toolPart(tool: string, callId: string, input: WireRecord, output: WireValue): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

function runningPart(tool: string, callId: string, input: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "input-available", input };
}

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
        status: AGENT_STATUS.RUNNING,
        onYourTask: true,
      },
    },
  );
}

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

function turnLine(turn: number): AgentTranscriptMessage {
  const at = RUN_STARTED_AT + turn * 70 * MINUTE;
  return {
    id: `long-run-line-${turn}`,
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

function turnJournal(turn: number, parts: readonly WireRecord[], running: boolean) {
  const at = RUN_STARTED_AT + turn * 70 * MINUTE;
  return {
    id: `long-run-journal-${turn}`,
    role: MESSAGE_ROLE.ASSISTANT,
    parts,
    startedAt: at,
    ...(running ? undefined : { finishedAt: at + 60 * MINUTE }),
  } satisfies AgentTranscriptMessage;
}

const SETTLED: readonly AgentTranscriptMessage[] = Array.from(
  { length: LONG_RUN.TURNS },
  (_, turn) =>
    turn === LONG_RUN.TURNS - 1
      ? [turnLine(turn)]
      : [turnLine(turn), turnJournal(turn, turnParts(turn), false)],
).flat();

const ROUND_PARTS: readonly (readonly WireRecord[])[] = Array.from(
  { length: LONG_RUN.ROUNDS },
  (_, round) => turnParts(LONG_RUN.TURNS + round),
);

const NEWEST_JOURNAL = `long-run-journal-${LONG_RUN.TURNS - 1}`;

const ROUND_STEPS: readonly number[] = ROUND_PARTS.map(
  (_, round) =>
    ROUND_PARTS.slice(0, round + 1)
      .flat()
      .filter((part) => part.type === "step-start").length,
);

const ARRIVED: readonly AgentTranscriptMessage[] = ROUND_STEPS.flatMap((afterStep, round) =>
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

function newestJournal(steps: number): AgentTranscriptMessage {
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

let step = 1;

const holds = new Set<object>();

let staged: { readonly step: number; readonly transcript: AppTranscript } | undefined;

export function longRunTranscript(): AppTranscript {
  if (staged?.step === step) return staged.transcript;
  const transcript: AppTranscript = {
    messages: [...SETTLED, newestJournal(step), ...ARRIVED],
    cursor: `${step}:0`,
    word: {
      status: AGENT_STATUS.RUNNING,
      runStartedAt: RUN_STARTED_AT + (LONG_RUN.TURNS - 1) * 70 * MINUTE,
      title: "Roll out the polish waves",
      caughtUp: true,
    },
    pages: step,
  };
  staged = { step, transcript };
  return transcript;
}

export function longRunHold(): AsyncIteratorClass<never, void> {
  const hold = {};
  let closed = false;
  return new AsyncIteratorClass<never, void>(
    async () => {
      if (!closed) holds.add(hold);
      while (!closed) {
        await rendererPause(LONG_RUN.STEP_MS);
        if (closed || holds.values().next().value !== hold) continue;
        step += 1;
        fixtureMoved();
      }
      return { done: true, value: undefined };
    },
    async () => {
      closed = true;
      holds.delete(hold);
    },
  );
}

let pictureBytes: string | undefined;

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
