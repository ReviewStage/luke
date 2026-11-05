/**
 * cli-inbox-answer.ts -- what `vespin inbox answer` sends for a thread's open ask, from the words and the `-F` input on its command line.
 *
 * The answer travels as the app's inbox sends one: a member's message on
 * the thread carrying the answer to its open ask (`inboxMessageRequestSchema`'s
 * `answers`). Each ask takes it its own way: a `decide` the labels of the
 * options picked, matched whatever their case; a `do` the word `done`,
 * which ticks every step as Mark done does, or `not-done`; an `answer`
 * with fields a JSON object of values by field label; and one without
 * fields its words. What the service would refuse is refused here first,
 * in the words `inboxAnswersRefusal` reads the ask with.
 */

import {
  INBOX_ASK,
  INBOX_REPLY,
  type InboxAnswers,
  type InboxAsk,
  type InboxAsking,
  type InboxFormValue,
  inboxAnswersRefusal,
  knownAsk,
} from "./inbox-wire.js";

/** The words a `do` ask is answered with on the command line. */
export const CLI_DO_ANSWER = {
  DONE: "done",
  NOT_DONE: "not-done",
} as const;

/** What the command line gave: its words after the thread, and the `-F` input's text where it named one. */
export interface CliAnswerInput {
  readonly words: readonly string[];
  readonly input?: string | undefined;
}

/** What to send, or why nothing can be. */
export type CliAnswer =
  | { readonly text: string; readonly answers: InboxAnswers }
  | { readonly refusal: string };

/** The label a name stands for among those offered, whatever its case; the name itself where none matches. */
function labelOf(offered: readonly string[], name: string): string {
  const wanted = name.trim().toLowerCase();
  return offered.find((label) => label.toLowerCase() === wanted) ?? name;
}

/** A JSON object of field values as a form's values, each named by its field's label; none where it is not one. */
function formValues(
  text: string,
  labels: readonly string[],
): readonly InboxFormValue[] | undefined {
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof read !== "object" || read === null || Array.isArray(read)) return undefined;
  const values: InboxFormValue[] = [];
  for (const [name, value] of Object.entries(read)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return undefined;
    }
    values.push({ label: labelOf(labels, name), value });
  }
  return values;
}

/** The answer each ask takes from the command line, before it is checked against the ask. */
function answerOf(ask: InboxAsk, id: string, given: CliAnswerInput): CliAnswer {
  switch (ask.type) {
    case INBOX_ASK.DECIDE: {
      if (given.words.length === 0) return { refusal: "Name the option to pick." };
      const labels = ask.options.map((option) => option.label);
      const choices = given.words.map((word) => labelOf(labels, word));
      const unknown = choices.find((choice) => !labels.includes(choice));
      if (unknown !== undefined) {
        return { refusal: `${unknown} is not an option. The options: ${labels.join(", ")}.` };
      }
      return { text: given.input ?? "", answers: { ask: id, reply: INBOX_REPLY.CHOSE, choices } };
    }
    case INBOX_ASK.DO: {
      const [word, ...rest] = given.words;
      const steps = ask.steps.map((_step, index) => index);
      if (word === CLI_DO_ANSWER.DONE && rest.length === 0) {
        return { text: given.input ?? "", answers: { ask: id, reply: INBOX_REPLY.DONE, steps } };
      }
      if (word === CLI_DO_ANSWER.NOT_DONE && rest.length === 0) {
        return {
          text: given.input ?? "",
          answers: { ask: id, reply: INBOX_REPLY.NOT_DONE, steps: [] },
        };
      }
      return { refusal: `Answer a to-do with ${CLI_DO_ANSWER.DONE} or ${CLI_DO_ANSWER.NOT_DONE}.` };
    }
    case INBOX_ASK.ANSWER: {
      if (ask.fields === undefined) {
        const text = given.input ?? given.words.join(" ");
        return { text, answers: { ask: id, reply: INBOX_REPLY.ANSWERED } };
      }
      const labels = ask.fields.map((field) => field.label);
      const values = given.input === undefined ? undefined : formValues(given.input, labels);
      if (values === undefined) {
        return {
          refusal: `Answer the form with -F and a JSON object of values by field: ${labels.join(", ")}.`,
        };
      }
      return { text: "", answers: { ask: id, reply: INBOX_REPLY.SUBMITTED, values } };
    }
  }
}

/**
 * The message that answers a thread's open ask, from the command line's
 * words and `-F` input, or why it cannot: no ask stands open, the words do
 * not fit the ask, or the ask would refuse the answer they make.
 */
export function cliInboxAnswer(asking: InboxAsking | undefined, given: CliAnswerInput): CliAnswer {
  if (asking === undefined) return { refusal: "The thread holds no open ask." };
  const ask = knownAsk(asking.ask);
  if (ask === undefined) {
    return { refusal: "The ask is of a kind this version cannot answer. Update vespin." };
  }
  const made = answerOf(ask, asking.message.id, given);
  if ("refusal" in made) return made;
  const refusal = inboxAnswersRefusal(ask, made.answers, made.text.trim());
  return refusal === undefined ? { text: made.text.trim(), answers: made.answers } : { refusal };
}
