import {
  INBOX_KIND,
  INBOX_REPLY,
  type InboxItem,
  type InboxReply,
  inboxTitleLine,
} from "@sidecar/hosted/inbox-wire";
import { NOTE_KIND, type PlanNote } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import { Effect, Option } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { readCodingAgent } from "../coding-agent-store.js";
import { PLAN_SAVE_REFUSAL, PLAN_SAVE_STATUS, saveNotes } from "../plan-notes.js";
import { logStoreFailure } from "../store-failure.js";

/**
 * inbox-decision.ts -- an inbox answer that decided something, written into the plan as a note of the agent that asked.
 *
 * A choice taken or an approval answered is a decision about how the work
 * is built, and the plan is the record of those, so the answer route writes
 * it where the template keeps decisions (`docs/PLANNING.md`): the decision
 * under Approach with the developer's note as its why, the options it beat
 * under Alternatives, and a step declined under Not doing, since it was
 * decided against. A question answered or a task done decides nothing of
 * the design and writes nothing. The notes go through the plan's one write
 * (`plan-notes.ts`) as the agent's own, exactly as its `edit_plan` would
 * take them, so the plan's history journals the save under the agent whose
 * item it was, and every note names the item, so the history reads back to
 * the question. Note that nothing here can fail the answer: an agent handed
 * a task rather than the plan has no plan of its to write, and a plan that
 * refuses notes, one that is a document among them, refuses them here too;
 * each is logged, and the answer stands as it was taken.
 */

/** How a note opens: the lead, then the item's title, so the plan's reader finds the question it answers. */
const NOTE_LEAD = {
  /** The decision itself, under Approach or Not doing. */
  DECISION: "Decision on",
  /** The options the decision beat, under Alternatives. */
  REJECTED: "Rejected on",
} as const;

/** The developer's note with every line after the first indented, so a note of several lines stays inside the plan's bullet. */
function indented(note: string): string {
  return note.trim().split("\n").join("\n  ");
}

/** Several labels as one phrase: "A", "A and B", "A, B, and C". */
function listed(labels: readonly string[]): string {
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1] ?? ""}`;
}

/** One bullet opening with the lead and the item's title. */
function bullet(lead: string, item: Pick<InboxItem, "title">, words: string): string {
  return `- ${lead} "${inboxTitleLine(item.title)}": ${words}`;
}

/** The developer's note as the decision's why, where they wrote one. */
function why(reply: InboxReply): string {
  const note = reply.note?.trim() ?? "";
  return note === "" ? "" : ` Why: ${indented(note)}`;
}

/** The options the decision beat: every one but the chosen, matched exactly as the answer was admitted, or every one where the developer answered in their own words. */
function rejectedOptions(item: InboxItem, reply: InboxReply): readonly string[] {
  const labels = (item.options ?? []).map((option) => option.label);
  const chosen = reply.reply === INBOX_REPLY.CHOSE ? labels.indexOf(reply.choice ?? "") : -1;
  return labels.filter((_, at) => at !== chosen).map(inboxTitleLine);
}

/** A choice's notes: the decision under Approach, and the options it beat under Alternatives where there were any. */
function choiceNotes(item: InboxItem, reply: InboxReply): readonly PlanNote[] {
  const rejected = rejectedOptions(item, reply);
  const decided =
    reply.reply === INBOX_REPLY.CHOSE
      ? `${inboxTitleLine(reply.choice ?? "")}.${why(reply)}`
      : indented(reply.note ?? "");
  const won =
    reply.reply === INBOX_REPLY.CHOSE
      ? inboxTitleLine(reply.choice ?? "")
      : "the developer's own answer";
  const decision: PlanNote = {
    kind: NOTE_KIND.ADD,
    field: PLAN_FIELD.APPROACH,
    text: bullet(NOTE_LEAD.DECISION, item, decided),
  };
  if (rejected.length === 0) return [decision];
  return [
    decision,
    {
      kind: NOTE_KIND.ADD,
      field: PLAN_FIELD.ALTERNATIVES,
      text: bullet(NOTE_LEAD.REJECTED, item, `${listed(rejected)}, in favor of ${won}.`),
    },
  ];
}

/** An approval's note: the step under Approach where it was approved, under Not doing where it was declined. */
function approvalNotes(item: InboxItem, reply: InboxReply): readonly PlanNote[] {
  const approved = reply.reply === INBOX_REPLY.APPROVED;
  return [
    {
      kind: NOTE_KIND.ADD,
      field: approved ? PLAN_FIELD.APPROACH : PLAN_FIELD.NOT_DOING,
      text: bullet(NOTE_LEAD.DECISION, item, `${approved ? "approved" : "declined"}.${why(reply)}`),
    },
  ];
}

/**
 * The notes an answer writes into the plan, in the order they are taken:
 * a choice's decision and the options it beat, an approval's step where it
 * is built or where it is not; none for a question or a task. The answer
 * is read as the item takes it: a reply the item's kind does not take was
 * refused before it was recorded.
 */
function decisionNotes(item: InboxItem, reply: InboxReply): readonly PlanNote[] {
  switch (item.kind) {
    case INBOX_KIND.CHOICE:
      return choiceNotes(item, reply);
    case INBOX_KIND.APPROVAL:
      return approvalNotes(item, reply);
    case INBOX_KIND.QUESTION:
    case INBOX_KIND.TASK:
      return [];
  }
}

/**
 * The answer's decision written into the agent's plan as the agent's own
 * notes, journaled under it; nothing, logged, where the agent was handed a
 * task rather than the plan or the plan refused the notes, and nothing
 * where the agent is no longer the account's. Never fails: the answer was
 * taken, and the plan's record of it is not what the developer is waiting
 * on. Note that a task-handed agent and a plan that is one document are
 * logged as information, because each is a plan's ordinary state rather
 * than a fault; a refusal of any other kind is a warning.
 */
export function recordInboxDecision(
  userId: string,
  item: InboxItem,
  reply: InboxReply,
): Effect.Effect<void, never, SqlClient.SqlClient> {
  const notes = decisionNotes(item, reply);
  if (notes.length === 0) return Effect.void;
  const recorded = Effect.gen(function* () {
    const agent = yield* readCodingAgent(userId, item.agentId);
    if (Option.isNone(agent)) return;
    // An agent handed a task never saw the plan, so its decisions are not the plan's to record.
    if (agent.value.task !== null) {
      return yield* Effect.logInfo(
        "an inbox decision was not written into the plan: the agent was handed a task rather than the plan",
      );
    }
    const binding = { userId, planId: agent.value.planId };
    const writer = { actor: PLAN_ACTOR.AGENT, agentId: agent.value.id } as const;
    const saved = yield* saveNotes(binding, notes, writer);
    if (saved.status === PLAN_SAVE_STATUS.SAVED) return;
    const line = `an inbox decision was not written into the plan: ${saved.reason}`;
    return yield* saved.reason === PLAN_SAVE_REFUSAL.DOCUMENT
      ? Effect.logInfo(line)
      : Effect.logWarning(line);
  });
  return recorded.pipe(Effect.tapError(logStoreFailure), Effect.ignore);
}
