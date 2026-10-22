/**
 * inbox.ts -- shot D, "The Inbox": three threads the plan's coding agents opened, each ending with an ask, waiting on the plan's Inbox tab, and the sidebar's Inbox counting them.
 *
 * Throwaway (`README.md`). SPEC: sidebar open with the Inbox count badge;
 * the plan's column on its Inbox tab; side panel closed. Three threads from
 * the plan's two coding agents (`coding-agent.ts`), oldest first as the
 * board orders them, each drawn from its version 5 `thread`: a `decide`
 * whose message names the exact lines of `src/members/invite.ts` it is
 * about, with a question from Dean and the agent's answer after it; an
 * `answer` whose message draws a screenshot the agent took in its sandbox
 * of the expired invite page; and a `do` with its steps and a link. Each
 * item keeps the version 4 fields the service writes beside its thread for
 * an older desktop. The inbox read is answered once from its start and held
 * after, since its loop asks again as soon as an answer lands; the code
 * block's lines are answered through `TASKS_FILE` and the picture through
 * `CODING_AGENTS_INBOX_ATTACHMENT` (`expired-invite-picture.ts`).
 */

import type { CodeToken } from "@luke/features/tasks-view";
import { inboxAttachmentAddress } from "@luke/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BLOCK,
  INBOX_CURSOR_START,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxAnswer,
  type InboxItem,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { MAIN_TAB } from "../tasks/use-main-tabs";
import { ago } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { EXPIRED_INVITE_PNG_BASE64 } from "./expired-invite-picture";
import { TASK_REPOSITORY, SHOT_ID, shotTasksView } from "./plan-document";
import { NEVER, type ShotSpec } from "./shot-spec";

/** The items waiting, by id; the answer to the inbox read must carry the same ids. */
export const INBOX_ITEM_IDS = [
  "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f",
  "d2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60",
  "e3f4a5b6-c7d8-4e9f-8a1b-2c3d4e5f6071",
] as const;

/** The picture the question carries, as the service keeps it. */
const ATTACHMENT_ID = "f4a5b6c7-d8e9-4fa0-9b1c-3d4e5f607182";

/** The workspace the shots' plan stands in, as a picture's address names it (`account.ts`). */
const WORKSPACE_SLUG = "acme";

/** Each thread's messages, by id. */
const MESSAGE_ID = {
  DECISION: "a1c2e3f4-0b1d-4e2f-8a3b-4c5d6e7f8091",
  DECISION_QUESTION: "a2c3e4f5-1b2d-4e3f-9a4b-5c6d7e8f90a2",
  DECISION_REPLY: "a3c4e5f6-2b3d-4e4f-8a5b-6c7d8e9f0ab3",
  QUESTION: "b1d2f3a4-3c4e-4f5a-9b6c-7d8e9f0a1bc4",
  STEP: "c1e2a3b4-4d5f-4a6b-8c7d-8e9f0a1b2cd5",
} as const;

/** Dean, as a member's message names him (`account.ts`). */
const DEAN = { userId: "user-dean", name: "Dean Stratakos" } as const;

/** The vercel page the manual step is done on. */
const ENVIRONMENT_URL = "https://vercel.com/acme/relay/settings/environment-variables";

/** The cursor the one read of the inbox ends on. */
const READ_THROUGH = "1";

/** The commit the finished agent read `invite.ts` at, on its branch. */
const INVITE_SHA = "3f9c2b7e1d4a6058c9e2f1b3a7d6e4c0b8a5f219";

const INVITE_PATH = "src/members/invite.ts";

/** The line of `invite.ts` the decision is about. */
const TTL_LINE = 6;

/** The colours the host's highlighter gives TypeScript, in GitHub's dark and light themes. */
const KEYWORD = { color: "#ff7b72", lightColor: "#cf222e" } as const;
const FUNCTION = { color: "#d2a8ff", lightColor: "#8250df" } as const;
const STRING = { color: "#a5d6ff", lightColor: "#0a3069" } as const;
const COMMENT = { color: "#8b949e", lightColor: "#6e7781" } as const;
const CONSTANT = { color: "#79c0ff", lightColor: "#0550ae" } as const;

/** One line from its runs, a bare string drawn in the theme's own foreground. */
function line(...runs: readonly (string | CodeToken)[]): CodeToken[] {
  return runs.map((part) => (typeof part === "string" ? { text: part } : part));
}

/** One coloured run. */
function run(text: string, colours: Omit<CodeToken, "text">): CodeToken {
  return { text, ...colours };
}

/** `src/members/invite.ts` as it stood at {@link INVITE_SHA}, every line coloured. */
const INVITE_FILE: readonly CodeToken[][] = [
  line(run("import", KEYWORD), " { db } ", run("from", KEYWORD), " ", run('"../db"', STRING), ";"),
  line(
    run("import", KEYWORD),
    " { mail } ",
    run("from", KEYWORD),
    " ",
    run('"../mail"', STRING),
    ";",
  ),
  line(
    run("import", KEYWORD),
    " { DAY_MS, randomToken } ",
    run("from", KEYWORD),
    " ",
    run('"../util"', STRING),
    ";",
  ),
  [],
  line(run("// How long an invite link stays good: the plan's open question.", COMMENT)),
  line(
    run("export", KEYWORD),
    " ",
    run("const", KEYWORD),
    " ",
    run("INVITE_TTL_MS", CONSTANT),
    " = ",
    run("7", CONSTANT),
    " * ",
    run("DAY_MS", CONSTANT),
    ";",
  ),
  [],
  line(
    run("export", KEYWORD),
    " ",
    run("async", KEYWORD),
    " ",
    run("function", KEYWORD),
    " ",
    run("inviteMember", FUNCTION),
    "(workspaceId: ",
    run("string", CONSTANT),
    ", email: ",
    run("string", CONSTANT),
    ") {",
  ),
  line("  ", run("const", KEYWORD), " token = ", run("randomToken", FUNCTION), "();"),
  line(
    "  ",
    run("const", KEYWORD),
    " expiresAt = ",
    run("new", KEYWORD),
    " ",
    run("Date", FUNCTION),
    "(Date.",
    run("now", FUNCTION),
    "() + ",
    run("INVITE_TTL_MS", CONSTANT),
    ");",
  ),
  line(
    "  ",
    run("const", KEYWORD),
    " membership = ",
    run("await", KEYWORD),
    " db.memberships.",
    run("insert", FUNCTION),
    "({ workspaceId, email, state: ",
    run('"pending"', STRING),
    ", inviteToken: token, expiresAt });",
  ),
  line(
    "  ",
    run("await", KEYWORD),
    " mail.",
    run("invite", FUNCTION),
    "(email, ",
    run("acceptUrl", FUNCTION),
    "(token));",
  ),
  line("  ", run("return", KEYWORD), " membership;"),
  line("}"),
];

/** One item waiting on the developer, first posted `minutes` before launch and changed last as its thread's latest message was written. */
function waiting(
  item: Pick<InboxItem, "id" | "agentId" | "key" | "title" | "blocks" | "response"> & {
    readonly thread: readonly InboxMessage[];
  },
  minutes: number,
): InboxItem {
  return {
    ...item,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: ago(minutes),
    updatedAt: item.thread.at(-1)?.createdAt ?? ago(minutes),
  };
}

/** The agent's message, written `minutes` before launch, ending with the ask given where it asks. */
function agentSaid(
  id: string,
  text: string,
  minutes: number,
  ask?: InboxMessage["ask"],
): InboxMessage {
  return {
    id,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text,
    ...(ask === undefined ? undefined : { ask }),
    createdAt: ago(minutes),
  };
}

/** The picture the question draws, by its address under its item. */
function questionPicture(itemId: string): string {
  const address = inboxAttachmentAddress(
    { kind: LINK_PLACE.INBOX_ITEM, planId: SHOT_ID.TASK, itemId },
    ATTACHMENT_ID,
    WORKSPACE_SLUG,
  );
  return `![The expired invite page: This invite is no longer valid](<${address}> "/invites/:token, a day after the link expired")`;
}

/** The three items, as the service answers the plan's inbox. */
function shotInboxItems(): InboxItem[] {
  const [decision, question, step] = INBOX_ITEM_IDS;
  return [
    waiting(
      {
        id: step,
        agentId: SHOT_ID.AGENT_2,
        key: "postmark-staging-token",
        title: "Add POSTMARK_SERVER_TOKEN to the staging environment",
        blocks: [
          {
            type: INBOX_BLOCK.MARKDOWN,
            text: "Staging can't send the invite email without it. Use the token of the **Relay staging** server in Postmark; I can't reach the project's settings from the sandbox.",
          },
          {
            type: INBOX_BLOCK.LINK,
            url: ENVIRONMENT_URL,
            label: "acme/relay › Settings › Environment Variables",
          },
        ],
        response: { type: INBOX_RESPONSE.TODO },
        thread: [
          agentSaid(
            MESSAGE_ID.STEP,
            "Staging can't send the invite email without it. Use the token of the **Relay staging** server in Postmark; I can't reach the project's settings from the sandbox.",
            3,
            {
              type: INBOX_ASK.DO,
              steps: [
                `Open [acme/relay › Settings › Environment Variables](${ENVIRONMENT_URL})`,
                "Add `POSTMARK_SERVER_TOKEN` for **Preview** with the **Relay staging** token",
                "Redeploy staging",
              ],
              status: INBOX_ASK_STATUS.OPEN,
            },
          ),
        ],
      },
      3,
    ),
    waiting(
      {
        id: question,
        agentId: SHOT_ID.AGENT,
        key: "expired-invite-page",
        title: "What should an expired invite link offer?",
        blocks: [
          {
            type: INBOX_BLOCK.MARKDOWN,
            text: "This is `/invites/:token` once a link has expired. It sends the visitor to an admin; should it let them ask for a new invite in one press instead?",
          },
          {
            type: INBOX_BLOCK.IMAGE,
            attachmentId: ATTACHMENT_ID,
            alt: "The expired invite page: This invite is no longer valid",
          },
        ],
        response: { type: INBOX_RESPONSE.TEXT, placeholder: "What the page should offer" },
        thread: [
          agentSaid(
            MESSAGE_ID.QUESTION,
            `This is \`/invites/:token\` once a link has expired. It sends the visitor to an admin; should it let them ask for a new invite in one press instead?\n\n${questionPicture(question)}`,
            16,
            { type: INBOX_ASK.ANSWER, status: INBOX_ASK_STATUS.OPEN },
          ),
        ],
      },
      16,
    ),
    waiting(
      {
        id: decision,
        agentId: SHOT_ID.AGENT,
        key: "invite-ttl",
        title: "Invite links expire after 7 days or 14?",
        blocks: [
          {
            type: INBOX_BLOCK.MARKDOWN,
            text: "The plan leaves this open. I set 7 days, its assumption, so the tests have something to hold; your answer changes this one line.",
          },
          {
            type: INBOX_BLOCK.CODE,
            repo: TASK_REPOSITORY,
            path: INVITE_PATH,
            startLine: TTL_LINE,
            endLine: TTL_LINE,
            sha: INVITE_SHA,
          },
        ],
        response: {
          type: INBOX_RESPONSE.CHOICE,
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
          recommended: "7 days",
        },
        thread: [
          agentSaid(
            MESSAGE_ID.DECISION,
            `The plan leaves this open. I set 7 days, its assumption, so the tests have something to hold; your answer changes [@invite.ts:${TTL_LINE}](https://github.com/${TASK_REPOSITORY}/blob/${INVITE_SHA}/${INVITE_PATH}#L${TTL_LINE}).`,
            24,
            {
              type: INBOX_ASK.DECIDE,
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
              recommended: "7 days",
              status: INBOX_ASK_STATUS.OPEN,
            },
          ),
          {
            id: MESSAGE_ID.DECISION_QUESTION,
            author: INBOX_MESSAGE_AUTHOR.MEMBER,
            member: DEAN,
            text: "Can an admin resend an expired one, or does the teammate start over?",
            createdAt: ago(19),
          },
          agentSaid(
            MESSAGE_ID.DECISION_REPLY,
            "An admin resends it from **Members**, which mints a new link and keeps the pending seat, so a shorter window costs one press.",
            18,
          ),
        ],
      },
      24,
    ),
  ];
}

/** The plan's inbox read past `after`: every item from the start, then held, since nothing changes. */
function inboxPage(taskId: string, after: string): InboxAnswer | typeof NEVER {
  if (after !== INBOX_CURSOR_START) return NEVER;
  return { items: taskId === SHOT_ID.TASK ? shotInboxItems() : [], cursor: READ_THROUGH };
}

export function inboxShot(): ShotSpec {
  return {
    tasks: shotTasksView({}),
    sidePanel: FIXTURE_CLOSED_PANEL,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.CODING_AGENTS_INBOX]: (payload) => inboxPage(payload.taskId, payload.after),
      [ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: (payload) =>
        payload.attachmentId === ATTACHMENT_ID
          ? { contentType: INBOX_IMAGE_TYPE.PNG, base64: EXPIRED_INVITE_PNG_BASE64 }
          : undefined,
      // Note that the window is answered as the agent's commit held it, the block's line lit in it.
      [ACT_KIND.TASKS_FILE]: (payload) => {
        if (payload.path !== INVITE_PATH) return undefined;
        const firstLine = Math.max(1, payload.firstLine);
        const lastLine = Math.min(INVITE_FILE.length, payload.lastLine);
        return {
          file: {
            path: INVITE_PATH,
            repository: TASK_REPOSITORY,
            branch: "luke/teammate-invitations",
            firstLine,
            lineCount: INVITE_FILE.length,
            lines: INVITE_FILE.slice(firstLine - 1, lastLine),
          },
        };
      },
    },
    inbox: {
      waiting: [
        {
          taskId: SHOT_ID.TASK,
          items: shotInboxItems().map(({ id, agentId, title, postedAt }) => ({
            id,
            agentId,
            title,
            postedAt,
          })),
        },
      ],
      tasks: [{ taskId: SHOT_ID.TASK, items: INBOX_ITEM_IDS.length, updatedAt: ago(3) }],
    },
    layout: { mainTab: MAIN_TAB.INBOX },
  };
}
