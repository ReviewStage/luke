import {
  CHAT_ASK,
  CHAT_BOUNDS,
  CHAT_FIELD,
  CHAT_REPLY,
  type ChatFieldValue,
  type ChatForm,
  type ChatFormValue,
  type ChatReadResponse,
  type ChatReply,
  type ChatReplyKind,
  knownResponse,
  replyRefusal,
} from "@luke/features/chat-wire";
import { isWireString } from "@luke/wire";

/**
 * chat-answer.ts -- an ask's answer as pure decisions: what the developer has put on its card, and the answer that holds, if any.
 *
 * A card's answer is held to the same rule the service holds it to
 * (`chat-wire.ts`'s `replyRefusal`), so a press the service would refuse is
 * never offered; an ask of a response this build does not know holds no
 * answer at all. A choice is answered by its options, with the note beside
 * them, or by the developer's own words; an approval, a task, and an ask of
 * nothing by their presses, with the note beside them; words by words; a
 * form by its fields, with the note beside them. Nothing here draws.
 */

/** What the developer has put on a card so far: the options picked on a choice, the fields filled on a form, and their note. */
export interface ChatDraft {
  readonly choices: readonly string[];
  readonly values: readonly ChatFormValue[];
  readonly note: string;
}

export const EMPTY_CHAT_DRAFT: ChatDraft = { choices: [], values: [], note: "" };

/** The draft with the option pressed: picked where it was not, let go where it was; one at a time unless the choice allows several. */
export function withChoice(draft: ChatDraft, label: string, multiple: boolean): ChatDraft {
  const picked = draft.choices.includes(label);
  if (picked) return { ...draft, choices: draft.choices.filter((each) => each !== label) };
  return { ...draft, choices: multiple ? [...draft.choices, label] : [label] };
}

/** What the draft holds for the field, or nothing where it is untouched. */
export function fieldValueOf(draft: ChatDraft, label: string): ChatFieldValue | undefined {
  return draft.values.find((each) => each.label === label)?.value;
}

/** The draft with the field set to the value, or cleared where none. */
export function withValue(
  draft: ChatDraft,
  label: string,
  value: ChatFieldValue | undefined,
): ChatDraft {
  const others = draft.values.filter((each) => each.label !== label);
  return { ...draft, values: value === undefined ? others : [...others, { label, value }] };
}

/** The answer's kind for what the card holds: a press where the response is answered by one, else the options picked, the form filled, or the developer's words. */
function replyKindOf(
  response: ChatReadResponse,
  draft: ChatDraft,
  press: ChatReplyKind | undefined,
): ChatReplyKind | undefined {
  if (press !== undefined) return press;
  if (response.type === CHAT_ASK.CHOICE && draft.choices.length > 0) return CHAT_REPLY.CHOSE;
  if (response.type === CHAT_ASK.FORM) return CHAT_REPLY.SUBMITTED;
  return draft.note.trim() === "" ? undefined : CHAT_REPLY.ANSWERED;
}

/** A form's values as sent, in the form's own order: words trimmed, a field left blank left out, and a switch left alone sent as no. */
function sentValues(form: ChatForm, draft: ChatDraft): readonly ChatFormValue[] {
  return form.fields.flatMap((field) => {
    const held = fieldValueOf(draft, field.label);
    const value =
      held === undefined ? (field.type === CHAT_FIELD.BOOLEAN ? false : undefined) : held;
    if (value === undefined) return [];
    const sent = isWireString(value) ? value.trim() : value;
    return sent === "" ? [] : [{ label: field.label, value: sent }];
  });
}

/** The answer the card holds for the response, or nothing where it holds none the ask takes. */
export function chatReply(
  response: ChatReadResponse,
  draft: ChatDraft,
  press?: ChatReplyKind,
): ChatReply | undefined {
  if (!knownResponse(response)) return undefined;
  const reply = replyKindOf(response, draft, press);
  if (reply === undefined) return undefined;
  const note = draft.note.trim();
  // A note past the wire's bound is no answer the service would take, so the card offers no send for it.
  if (note.length > CHAT_BOUNDS.MAX_NOTE_CHARS) return undefined;
  const answer: ChatReply = {
    reply,
    ...(reply === CHAT_REPLY.CHOSE ? { choices: draft.choices } : undefined),
    ...(response.type === CHAT_ASK.FORM ? { values: sentValues(response, draft) } : undefined),
    ...(note === "" ? undefined : { note }),
  };
  return replyRefusal(response, answer) === undefined ? answer : undefined;
}

/** The presses each response answered by a press offers: the one that holds back where there is one, then the one that goes ahead. */
const CHAT_PRESSES = {
  [CHAT_ASK.APPROVAL]: {
    back: { reply: CHAT_REPLY.DECLINED, label: "Decline" },
    ahead: { reply: CHAT_REPLY.APPROVED, label: "Approve" },
  },
  [CHAT_ASK.TASK]: {
    back: { reply: CHAT_REPLY.NOT_DONE, label: "Can't do this" },
    ahead: { reply: CHAT_REPLY.DONE, label: "Done" },
  },
  [CHAT_ASK.NONE]: {
    back: undefined,
    ahead: { reply: CHAT_REPLY.ACKNOWLEDGED, label: "Got it" },
  },
} as const;

/** The presses that answer the response, or nothing where words, a pick, or a form answer it. */
export function pressesOf(
  response: ChatReadResponse,
): (typeof CHAT_PRESSES)[keyof typeof CHAT_PRESSES] | undefined {
  if (!knownResponse(response)) return undefined;
  switch (response.type) {
    case CHAT_ASK.APPROVAL:
    case CHAT_ASK.TASK:
    case CHAT_ASK.NONE:
      return CHAT_PRESSES[response.type];
    default:
      return undefined;
  }
}
