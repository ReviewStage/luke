import { INBOX_ASK, type InboxAsk } from "@luke/features/inbox-wire";

/**
 * inbox-ask-words.ts -- what an Inbox ask asks, in the words its box leads with: the one name the box, the list's row, and the agent's transcript say it by.
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
export function askHeadWords(ask: InboxAsk, ticked: readonly number[] | undefined): string {
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
