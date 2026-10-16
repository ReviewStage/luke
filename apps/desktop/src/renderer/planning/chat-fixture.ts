import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_TARGET_SIGIL,
  type ChatAnswer,
  type ChatChannel,
  type ChatMessage,
  formValueLines,
  GENERAL_CHANNEL,
  MEMBER_KIND,
  mentionedHandles,
  PLANNER_HANDLE,
  replyWords,
} from "@luke/features/chat-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { TaskAgentLine } from "@luke/features/task-wire";
import type { ChatAskAnswer, ChatPost } from "@luke/ui/chat-model";
import { FIXTURE_PLAN_ID } from "./planning-fixture";

/**
 * chat-fixture.ts -- the synthetic chat a fixture run's Chat draws in place of the service's.
 *
 * A fixture run reads no chat, so its Chat would stand empty. It draws this
 * one instead: the reference journey's plan, Teammate invitations, with two
 * coding agents on it settling who owns the `memberships` table between
 * them in the plan's channel, a thread on it, an ask of each's, a direct
 * message from one to the developer, and Luke mentioning the developer, so
 * For you, the rail's unread counts, and a folded thread all draw. Every
 * name here is invented; nothing is read from an account. Each message is
 * stamped some minutes before the moment the run asks for it, so the times
 * read as a morning's talk whenever the capture is taken.
 *
 * A post or an answer made in a fixture run lands in this chat alone, as
 * the service would answer it: a post as the developer's next message in
 * the place it names, mentioning the members its words name; an answer as
 * the ask answered at the revision read and the developer's reply in its
 * thread. Neither moves the developer's cursor. Nothing leaves the window.
 */

/** The agents the fixture's chat names, as a plan's summary would list them. */
const AGENT_ONE: TaskAgentLine = {
  id: "5f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0",
  title: "Add teammate invitations",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  status: CODING_AGENT_STATUS.RUNNING,
};
const AGENT_TWO: TaskAgentLine = {
  id: "6a2f3e4d-5c6b-4a79-9887-b6c5d4e3f2a1",
  title: "Invite emails",
  model: "openai/gpt-6.1-sol",
  effort: "medium",
  status: CODING_AGENT_STATUS.RUNNING,
};

/** The members, by the ids the messages name them by. */
const MEMBER = {
  DEAN: "0c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5",
  MARIA: "1d2e3f4a-5b6c-4d7e-9f80-b1c2d3e4f5a6",
  LUKE: "2e3f4a5b-6c7d-4e8f-a091-c2d3e4f5a6b7",
  AGENT_ONE: "3f4a5b6c-7d8e-4f90-b1a2-d3e4f5a6b7c8",
  AGENT_TWO: "4a5b6c7d-8e9f-4a01-82b3-e4f5a6b7c8d9",
} as const;

/** The channels, by the ids the messages name them by. */
const CHANNEL = {
  GENERAL: "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
  INVITES: "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
  BILLING: "9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a",
  SCHEMA: "0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b",
  WITH_AGENT_TWO: "1f2a3b4c-5d6e-4f7a-9b8c-9d0e1f2a3b4c",
  WITH_LUKE: "2a3b4c5d-6e7f-4a8b-8c9d-0e1f2a3b4c5d",
  WITH_AGENT_ONE: "3b4c5d6e-7f8a-4b9c-9d0e-1f2a3b4c5d6e",
  WITH_MARIA: "4c5d6e7f-8a9b-4c0d-8e1f-2a3b4c5d6e7f",
} as const;

/** The fixture plan's other plan, whose channel stands quiet. */
const BILLING_PLAN_ID = "1a7b3d5f-9c2e-4f40-8b68-2d3e4f5a6b71";

/** The commit the agent's code block points at. */
const AGENT_ONE_COMMIT = "4be1c0de9a8f7e6d5c4b3a29180f7e6d5c4b3a29";

/** How far the developer has read: everything up to Agent one's ask. */
const READ_SEQ = 46;

/** One message as the service answers it, posted some minutes before `at`. */
function said(
  at: number,
  minutesAgo: number,
  message: Omit<ChatMessage, "touchedSeq" | "postedAt" | "mentions"> &
    Partial<Pick<ChatMessage, "mentions">>,
): ChatMessage {
  return {
    touchedSeq: message.seq,
    postedAt: at - minutesAgo * 60_000,
    mentions: [],
    ...message,
  };
}

function words(text: string): ChatMessage["blocks"] {
  return [{ type: CHAT_BLOCK.MARKDOWN, text }];
}

/** The messages, in the order posted. */
function messages(at: number): readonly ChatMessage[] {
  return [
    said(at, 190, {
      id: "a0000000-0000-4000-8000-000000000037",
      seq: 37,
      channelId: CHANNEL.GENERAL,
      authorId: MEMBER.MARIA,
      blocks: words("Morning. Plan channels open as each plan starts, so post there first."),
    }),
    said(at, 55, {
      id: "a0000000-0000-4000-8000-000000000038",
      seq: 38,
      channelId: CHANNEL.SCHEMA,
      authorId: MEMBER.AGENT_ONE,
      blocks: words("`memberships` gains `invite_token`, nullable until the backfill."),
    }),
    said(at, 42, {
      id: "a0000000-0000-4000-8000-000000000040",
      seq: 40,
      channelId: CHANNEL.INVITES,
      authorId: MEMBER.AGENT_ONE,
      blocks: words(
        "On `luke/teammate-invitations`. An invite is a `memberships` row with `state = pending`; " +
          "`POST /invites` creates it and mails a one-time link. I'm adding `invite_token` to the " +
          "table, so anyone touching `memberships` should know.",
      ),
    }),
    said(at, 38, {
      id: "a0000000-0000-4000-8000-000000000041",
      seq: 41,
      channelId: CHANNEL.WITH_LUKE,
      authorId: MEMBER.DEAN,
      blocks: words("Which agent is touching the members table right now?"),
    }),
    said(at, 37, {
      id: "a0000000-0000-4000-8000-000000000042",
      seq: 42,
      channelId: CHANNEL.WITH_LUKE,
      authorId: MEMBER.LUKE,
      mentions: [MEMBER.AGENT_ONE, MEMBER.AGENT_TWO],
      blocks: words(
        "@agent-1 is adding `invite_token` to `memberships` on `luke/teammate-invitations`, " +
          "migration pushed. @agent-2 only reads it and based its branch on that migration.",
      ),
    }),
    said(at, 31, {
      id: "a0000000-0000-4000-8000-000000000043",
      seq: 43,
      channelId: CHANNEL.INVITES,
      authorId: MEMBER.AGENT_TWO,
      mentions: [MEMBER.AGENT_ONE],
      blocks: words(
        "@agent-1 are you changing `memberships` columns? My template reads `invite_token` and " +
          "I'd rather import your migration than write one.",
      ),
    }),
    said(at, 29, {
      id: "a0000000-0000-4000-8000-000000000044",
      seq: 44,
      channelId: CHANNEL.INVITES,
      parentId: "a0000000-0000-4000-8000-000000000043",
      authorId: MEMBER.AGENT_ONE,
      blocks: words(
        "Yes, `0042_invite_token.sql` on my branch, pushed. Base on it; the column is nullable " +
          "until the backfill.",
      ),
    }),
    said(at, 27, {
      id: "a0000000-0000-4000-8000-000000000045",
      seq: 45,
      channelId: CHANNEL.INVITES,
      parentId: "a0000000-0000-4000-8000-000000000043",
      authorId: MEMBER.AGENT_TWO,
      blocks: words("Based. Thanks."),
    }),
    said(at, 24, {
      id: "a0000000-0000-4000-8000-000000000046",
      seq: 46,
      channelId: CHANNEL.INVITES,
      authorId: MEMBER.AGENT_ONE,
      blocks: [
        {
          type: CHAT_BLOCK.MARKDOWN,
          text:
            "The plan leaves this open. I set 7 days, its assumption, so the tests have " +
            "something to hold; your answer changes this one line.",
        },
        {
          type: CHAT_BLOCK.CODE,
          repo: "acme/relay",
          path: "src/members/invite.ts",
          startLine: 5,
          endLine: 6,
          sha: AGENT_ONE_COMMIT,
        },
      ],
      ask: {
        key: "invite-expiry",
        revision: 1,
        status: ASK_STATUS.OPEN,
        title: "Invite links expire after 7 days or 14?",
        needsReply: true,
        response: {
          type: CHAT_ASK.CHOICE,
          recommended: "7 days",
          options: [
            {
              label: "7 days",
              detail: "Matches password reset links; a forwarded link goes stale sooner.",
            },
            {
              label: "14 days",
              detail:
                "Fewer resends for teammates slow to join, but a forwarded link works for two weeks.",
            },
          ],
        },
      },
    }),
    said(at, 16, {
      id: "a0000000-0000-4000-8000-000000000047",
      seq: 47,
      channelId: CHANNEL.WITH_AGENT_TWO,
      authorId: MEMBER.AGENT_TWO,
      mentions: [MEMBER.AGENT_ONE],
      blocks: words(
        "Can I take `src/members/invite.ts` too? The email template needs the token format, and " +
          "@agent-1 is still on it. If you'd rather, I'll wait for #214 and base on it.",
      ),
    }),
    said(at, 9, {
      id: "a0000000-0000-4000-8000-000000000048",
      seq: 48,
      channelId: CHANNEL.INVITES,
      authorId: MEMBER.LUKE,
      mentions: [MEMBER.DEAN, MEMBER.AGENT_TWO],
      blocks: words(
        "@dean two agents are both changing the `memberships` table. I told @agent-2 to wait for " +
          "#214; say if you'd rather they split it another way.",
      ),
    }),
    said(at, 8, {
      id: "a0000000-0000-4000-8000-000000000049",
      seq: 49,
      channelId: CHANNEL.INVITES,
      parentId: "a0000000-0000-4000-8000-000000000048",
      authorId: MEMBER.MARIA,
      blocks: words("Fine by me. I'll keep off `memberships` until it lands."),
    }),
    said(at, 6, {
      id: "a0000000-0000-4000-8000-000000000050",
      seq: 50,
      channelId: CHANNEL.INVITES,
      parentId: "a0000000-0000-4000-8000-000000000048",
      authorId: MEMBER.AGENT_TWO,
      blocks: words("Holding the template until #214 merges; doing the resend endpoint meanwhile."),
    }),
    said(at, 3, {
      id: "a0000000-0000-4000-8000-000000000051",
      seq: 51,
      channelId: CHANNEL.INVITES,
      authorId: MEMBER.AGENT_TWO,
      blocks: words(
        "Two invites to one address in one workspace would otherwise both go pending. It's one " +
          "migration, online, and nothing writes the pair twice today.",
      ),
      ask: {
        key: "membership-unique-index",
        revision: 1,
        status: ASK_STATUS.OPEN,
        title: "Add a unique index on (organization_id, email) to memberships?",
        needsReply: true,
        response: { type: CHAT_ASK.APPROVAL },
      },
    }),
    said(at, 2, {
      id: "a0000000-0000-4000-8000-000000000052",
      seq: 52,
      channelId: CHANNEL.INVITES,
      authorId: MEMBER.DEAN,
      mentions: [MEMBER.AGENT_ONE, MEMBER.AGENT_TWO],
      blocks: words(
        "Split it: @agent-1 owns the schema, @agent-2 only reads it. @agent-2, wait for #214 " +
          "before you touch the template.",
      ),
    }),
  ];
}

/** The chat a fixture run reads: its answer as the service would give it, and the agent lines that name its agents. */
export interface FixtureChat {
  readonly answer: ChatAnswer;
  readonly agents: readonly TaskAgentLine[];
}

/** The chat a fixture run draws, its messages stamped before `at`; nothing for a live run, which reads its own. */
export function fixtureChat(
  run: { readonly fixtureMode: boolean },
  at: number,
): FixtureChat | undefined {
  if (!run.fixtureMode) return undefined;
  const dm = (id: string, other: string) => ({
    id,
    kind: CHANNEL_KIND.DM,
    members: [MEMBER.DEAN, other],
    archived: false,
  });
  const answer: ChatAnswer = {
    self: MEMBER.DEAN,
    readSeq: READ_SEQ,
    members: [
      { id: MEMBER.DEAN, kind: MEMBER_KIND.HUMAN, handle: "dean", userId: "dean", left: false },
      { id: MEMBER.MARIA, kind: MEMBER_KIND.HUMAN, handle: "maria", userId: "maria", left: false },
      {
        id: MEMBER.LUKE,
        kind: MEMBER_KIND.PLANNER,
        handle: PLANNER_HANDLE,
        planId: FIXTURE_PLAN_ID,
        left: false,
      },
      {
        id: MEMBER.AGENT_ONE,
        kind: MEMBER_KIND.AGENT,
        handle: "agent-1",
        agentId: AGENT_ONE.id,
        planId: FIXTURE_PLAN_ID,
        left: false,
      },
      {
        id: MEMBER.AGENT_TWO,
        kind: MEMBER_KIND.AGENT,
        handle: "agent-2",
        agentId: AGENT_TWO.id,
        planId: FIXTURE_PLAN_ID,
        left: false,
      },
    ],
    channels: [
      { id: CHANNEL.GENERAL, kind: CHANNEL_KIND.GENERAL, name: GENERAL_CHANNEL, archived: false },
      {
        id: CHANNEL.INVITES,
        kind: CHANNEL_KIND.PLAN,
        name: "teammate-invitations",
        planId: FIXTURE_PLAN_ID,
        archived: false,
      },
      {
        id: CHANNEL.BILLING,
        kind: CHANNEL_KIND.PLAN,
        name: "billing-export",
        planId: BILLING_PLAN_ID,
        archived: false,
      },
      { id: CHANNEL.SCHEMA, kind: CHANNEL_KIND.TOPIC, name: "members-schema", archived: false },
      dm(CHANNEL.WITH_AGENT_TWO, MEMBER.AGENT_TWO),
      dm(CHANNEL.WITH_LUKE, MEMBER.LUKE),
      dm(CHANNEL.WITH_AGENT_ONE, MEMBER.AGENT_ONE),
      dm(CHANNEL.WITH_MARIA, MEMBER.MARIA),
    ],
    messages: messages(at),
    cursor: "52",
  };
  return { answer, agents: [AGENT_ONE, AGENT_TWO] };
}

/** A fixture's post or answer as it landed: the chat with it in, or why it was refused. */
export type Staged = { readonly chat: FixtureChat } | { readonly refused: string };

/** What a fixture's post or answer refuses with: a place, a message, or a revision that is not the chat's. */
const STAGED_REFUSAL = {
  NO_PLACE: "There is no such channel or member.",
  NO_MESSAGE: "That message is not in this chat.",
  STALE: "The ask changed since you read it.",
} as const;

/** The channel a post goes to: its thread's, a channel by `#name`, or the developer's DM with a member by `@handle`. */
function placeOf(chat: ChatAnswer, post: ChatPost): ChatChannel | undefined {
  if (post.replyTo !== undefined) {
    const root = chat.messages.find((message) => message.seq === post.replyTo);
    return chat.channels.find((channel) => channel.id === root?.channelId);
  }
  const to = post.to ?? "";
  const name = to.slice(1);
  if (to.startsWith(CHAT_TARGET_SIGIL.CHANNEL)) {
    return chat.channels.find(
      (channel) => channel.kind !== CHANNEL_KIND.DM && channel.name === name,
    );
  }
  const member = chat.members.find((each) => each.handle === name);
  return chat.channels.find(
    (channel) =>
      channel.kind === CHANNEL_KIND.DM &&
      member !== undefined &&
      (channel.members ?? []).includes(member.id) &&
      (channel.members ?? []).includes(chat.self),
  );
}

/** The chat with one more message of the developer's at the next place in its sequence, which their own unread counts never count. */
function withMessage(
  chat: ChatAnswer,
  at: number,
  message: {
    readonly channelId: string;
    readonly parentId: string | undefined;
    readonly blocks: ChatMessage["blocks"];
  },
  touched: (seq: number) => readonly ChatMessage[],
): ChatAnswer {
  const seq = Math.max(0, ...chat.messages.map((each) => each.touchedSeq)) + 1;
  const words = message.blocks.flatMap((block) => ("text" in block ? [block.text] : []));
  const mentions = mentionedHandles(words.join("\n")).flatMap(
    (handle) => chat.members.find((member) => member.handle === handle)?.id ?? [],
  );
  const posted: ChatMessage = {
    id: crypto.randomUUID(),
    seq,
    touchedSeq: seq,
    channelId: message.channelId,
    authorId: chat.self,
    blocks: message.blocks,
    mentions,
    postedAt: at,
  };
  // A root carries no parent at all, as the service answers one.
  const placed =
    message.parentId === undefined ? posted : { ...posted, parentId: message.parentId };
  return {
    ...chat,
    messages: [...touched(seq), placed],
    cursor: String(seq),
  };
}

/** The fixture's chat with the developer's post in it, or why it was refused. */
export function stagedPost(read: FixtureChat, post: ChatPost, at: number): Staged {
  const chat = read.answer;
  const channel = placeOf(chat, post);
  if (channel === undefined) return { refused: STAGED_REFUSAL.NO_PLACE };
  // Note that a reply to a reply joins its root's thread, as every thread has one root.
  const replied = chat.messages.find((message) => message.seq === post.replyTo);
  const parentId = replied === undefined ? undefined : (replied.parentId ?? replied.id);
  const answer = withMessage(
    chat,
    at,
    { channelId: channel.id, blocks: words(post.text), parentId },
    () => chat.messages,
  );
  return { chat: { ...read, answer } };
}

/** The fixture's chat with the ask answered and the developer's reply in its thread, or why it was refused. */
export function stagedAnswer(read: FixtureChat, answered: ChatAskAnswer, at: number): Staged {
  const chat = read.answer;
  const asked = chat.messages.find((message) => message.seq === answered.seq);
  if (asked?.ask === undefined) return { refused: STAGED_REFUSAL.NO_MESSAGE };
  if (asked.ask.revision !== answered.revision || asked.ask.status !== ASK_STATUS.OPEN) {
    return { refused: STAGED_REFUSAL.STALE };
  }
  const { reply } = answered;
  // The reply in the thread says what the card says: the answer, a form's fields, and the note.
  const text = [
    replyWords(reply),
    ...(reply.values === undefined ? [] : [formValueLines(reply.values)]),
    ...(reply.note === undefined ? [] : [reply.note]),
  ].join("\n\n");
  const answer = withMessage(
    chat,
    at,
    { channelId: asked.channelId, blocks: words(text), parentId: asked.parentId ?? asked.id },
    (seq) =>
      chat.messages.map((message) =>
        message.id !== asked.id || message.ask === undefined
          ? message
          : {
              ...message,
              touchedSeq: seq,
              ask: {
                ...message.ask,
                status: ASK_STATUS.ANSWERED,
                answer: reply,
                answeredBy: chat.self,
              },
            },
      ),
  );
  return { chat: { ...read, answer } };
}
