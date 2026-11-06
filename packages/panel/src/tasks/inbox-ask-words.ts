import { INBOX_ASK, type InboxAsk, type InboxAskInput } from "@repo/features/inbox-wire";

const PART = " · ";

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

export const WRITE_AN_ANSWER = "Write an answer";

export function fillInWords(labels: readonly string[]): string {
  return `Fill in ${labels.join(", ")}`;
}

export const INBOX_MISSING = {
  OPTION: "option",
  FIELD: "field",
  WORDS: "words",
} as const;

export type InboxMissing =
  | { readonly kind: typeof INBOX_MISSING.OPTION }
  | { readonly kind: typeof INBOX_MISSING.FIELD; readonly label: string }
  | { readonly kind: typeof INBOX_MISSING.WORDS };

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
