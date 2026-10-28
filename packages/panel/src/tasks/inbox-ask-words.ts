import { INBOX_ASK, type InboxAsk, type InboxAskInput } from "@luke/features/inbox-wire";

/**
 * inbox-ask-words.ts -- what an Inbox ask asks, in the words its box leads with: the one name the box, the list's row, and the agent's transcript say it by; and what an unfinished answer lacks, in the words its refused send says it by.
 */

/** What parts the words, as a row's preview parts them. */
const PART = " · ";

/**
 * What an ask says it asks: a pick of one or several, steps with how many
 * the steps given tick, fields, or the reply's own words. Steps name no
 * count where none are given, as on a settled ask or an agent's post, or
 * where the ask shows one alone, the item's title standing for a to-do
 * that named none.
 */
export function askHeadWords(
  ask: InboxAsk | InboxAskInput,
  ticked: readonly number[] | undefined,
): string {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return ask.multiple === true ? "Pick any" : "Pick one";
    case INBOX_ASK.DO: {
      const shown = Math.max(ask.steps.length, 1);
      if (ticked === undefined || shown === 1) return "Steps";
      const count = new Set(ticked.filter((at) => at < shown)).size;
      return `Steps${PART}${count} of ${shown}`;
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined ? "Your answer" : "Fill in";
  }
}

/** What an ask of words alone asks for, as its row and its refused send say it. */
export const WRITE_AN_ANSWER = "Write an answer";

/** What an ask of fields asks for, the fields it names in its order: "Fill in Host, Port". */
export function fillInWords(labels: readonly string[]): string {
  return `Fill in ${labels.join(", ")}`;
}

/** What an open ask's answer still lacks: an option picked, a field filled, or the developer's own words. */
export const INBOX_MISSING = {
  OPTION: "option",
  FIELD: "field",
  WORDS: "words",
} as const;

/** What the answer lacks; a field's by its label. */
export type InboxMissing =
  | { readonly kind: typeof INBOX_MISSING.OPTION }
  | { readonly kind: typeof INBOX_MISSING.FIELD; readonly label: string }
  | { readonly kind: typeof INBOX_MISSING.WORDS };

/** Why a send of an unfinished answer was refused, as one sentence naming what it lacks: "Pick an option.", "Fill in Host.", "Write an answer." */
export function missingWords(missing: InboxMissing): string {
  switch (missing.kind) {
    case INBOX_MISSING.OPTION:
      return "Pick an option.";
    case INBOX_MISSING.FIELD:
      return `${fillInWords([missing.label])}.`;
    case INBOX_MISSING.WORDS:
      return `${WRITE_AN_ANSWER}.`;
  }
}
