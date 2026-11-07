/**
 * agent-inbox.ts -- the Inbox's asks of the host, declared, and the live follow of a task's or an agent's inbox beside them.
 *
 * What a task's coding agents need of the developer: a task's or an agent's
 * inbox held followed, and read again, and every item the account reaches read again; one item answered,
 * closed, messaged, or marked, a thread started, every item marked read, and
 * an item's image and an agent's picture.
 *
 * Each output is its view schema's type side (`EffectSchema.toType`) rather
 * than the view flipped, as the agents' acts' are. The only difference
 * between a view's two sides here is the phantom brand on a block, a
 * response this build does not know (`UnknownInboxType` in
 * `inbox-wire.ts`), so encoding is the
 * identity; flipped, the window would read the encoded side, whose
 * unbranded `{ type: string }` swallows the union every reader narrows. The
 * output check still runs each view's checks and leaves out a key the view
 * does not name.
 *
 * Only a panel draws the Inbox, so every act is the panel's alone, and a
 * refusal or a defect of the host's is drawn as the coding-agent calls'
 * unanswered failure, as every one was before it was declared, or, for a
 * held close let go, as one no longer held. A task's or an agent's inbox
 * is a live follow, declared once (`live-follow.ts`), not a plain act.
 */

import {
  AGENT_CALL_FAILURE,
  agentInboxAnsweredViewSchema,
  agentInboxAnswerParamsSchema,
  agentInboxAttachmentParamsSchema,
  agentInboxAttachmentViewSchema,
  agentInboxCloseParamsSchema,
  agentInboxCloseReleasedViewSchema,
  agentInboxCloseReleaseParamsSchema,
  agentInboxItemHomeParamsSchema,
  agentInboxItemHomeViewSchema,
  agentInboxMessagedViewSchema,
  agentInboxMessageParamsSchema,
  agentInboxReadAllParamsSchema,
  agentInboxReadAllViewSchema,
  agentInboxReadStateParamsSchema,
  agentInboxReadStateViewSchema,
  agentInboxRemindParamsSchema,
  agentInboxScopeSchema,
  agentInboxStartParamsSchema,
  agentPictureParamsSchema,
} from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/** What the window draws for an act the host could not answer. */
const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The Inbox's plain acts, each answered by the agents' composer. */
export const AGENT_INBOX_ACTS = declaredActs({
  AGENTS_INBOX_ANSWER: hostAct({
    input: agentInboxAnswerParamsSchema,
    output: EffectSchema.toType(agentInboxAnsweredViewSchema),
    refusal: "Could not acknowledge the inbox item on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AGENTS_INBOX_CLOSE: hostAct({
    input: agentInboxCloseParamsSchema,
    output: EffectSchema.toType(agentInboxAnsweredViewSchema),
    refusal: "Could not close the inbox item on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  // Note that a release the host could not answer reads as a close no longer held, as it did before it was declared.
  AGENTS_INBOX_CLOSE_RELEASE: hostAct({
    input: agentInboxCloseReleaseParamsSchema,
    output: agentInboxCloseReleasedViewSchema,
    refusal: "Could not undo resolving the inbox item on this system.",
    panelOnly: true,
    door: ACT.LOCAL_WRITE,
    unanswered: { held: false },
  }),
  AGENTS_INBOX_MESSAGE: hostAct({
    input: agentInboxMessageParamsSchema,
    output: EffectSchema.toType(agentInboxMessagedViewSchema),
    refusal: "Could not send the message on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AGENTS_INBOX_START: hostAct({
    input: agentInboxStartParamsSchema,
    output: EffectSchema.toType(agentInboxMessagedViewSchema),
    refusal: "Could not start the thread on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  AGENTS_INBOX_READ_STATE: hostAct({
    input: agentInboxReadStateParamsSchema,
    output: EffectSchema.toType(agentInboxReadStateViewSchema),
    refusal: "Could not mark the inbox item on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AGENTS_INBOX_REMIND: hostAct({
    input: agentInboxRemindParamsSchema,
    output: EffectSchema.toType(agentInboxReadStateViewSchema),
    refusal: "Could not set the inbox item's reminder on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AGENTS_INBOX_ITEM_HOME: hostAct({
    input: agentInboxItemHomeParamsSchema,
    output: EffectSchema.toType(agentInboxItemHomeViewSchema),
    refusal: "Could not find the inbox item on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  AGENTS_INBOX_READ_ALL: hostAct({
    input: agentInboxReadAllParamsSchema,
    output: EffectSchema.toType(agentInboxReadAllViewSchema),
    refusal: "Could not mark the inbox read on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AGENTS_INBOX_ATTACHMENT: hostAct({
    input: agentInboxAttachmentParamsSchema,
    output: EffectSchema.toType(agentInboxAttachmentViewSchema),
    refusal: "Could not read the inbox item's image on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  AGENTS_PICTURE: hostAct({
    input: agentPictureParamsSchema,
    output: EffectSchema.toType(agentInboxAttachmentViewSchema),
    refusal: "Could not read the agent's picture on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  // The account's inbox items, which the host holds for the session, asked again at once, as Try again asks.
  AGENTS_INBOX_ITEMS_RETRY: hostAct({
    input: EffectSchema.Undefined,
    output: EffectSchema.Void,
    refusal: "Could not read the inbox again on this system.",
    panelOnly: true,
    door: ACT.READ,
  }),
});

/** The Inbox's live read the host follows for the windows: one task's or one agent's inbox. */
export const AGENT_INBOX_FOLLOWS = liveFollows({
  AGENTS_INBOX_FOLLOW: liveFollow({
    slice: LIVE_READ.HOLDER_INBOX,
    hold: HOLD.WINDOW,
    key: agentInboxScopeSchema,
    refusal: "Could not follow the inbox on this system.",
    panelOnly: true,
    retry: {
      name: "AGENTS_INBOX_RETRY",
      refusal: "Could not read the inbox again on this system.",
    },
  }),
});

export const agentInboxActsContract = {
  ...contractOf(AGENT_INBOX_ACTS),
  ...followsContractOf(AGENT_INBOX_FOLLOWS),
};
