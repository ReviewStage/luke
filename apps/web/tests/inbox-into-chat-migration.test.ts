import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@luke/database/testing";
import { INBOX_REPLY, INBOX_STATUS } from "@luke/features/inbox-wire";
import {
  accountPlanlessItems,
  planInboxItems,
  readInboxAttachment,
  withdrawInboxAnswer,
} from "@luke/service/inbox/inbox-store";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The copy of the inbox into chat over a database holding inbox items from
 * before it: each item lands as its agent's ask in its plan's chat channel
 * under its own id, answered or open as it stood, with its picture, so the
 * Inbox reads it through the chat store as it read it before, a copied
 * answer withdrawn by its key alone; a plan whose channel's name is held
 * already is named apart rather than stopping the copy; an item of an
 * agent with no plan lands in its workspace's general channel; an answer
 * whose answerer the item names names them in chat; and the copy run
 * again adds nothing. Synthetic accounts, plans, and words throughout.
 */

const COPY = "20261015150750_inbox_into_chat";

const ANSWERED_ITEM = "11111111-1111-4111-8111-111111111111";
const OPEN_ITEM = "22222222-2222-4222-8222-222222222222";
const PICTURE = "33333333-3333-4333-8333-333333333333";
const RELEASE_PLAN = "77777777-7777-4777-8777-777777777777";
const RELEASE_ITEM = "88888888-8888-4888-8888-888888888888";
const PLANLESS_ITEM = "99999999-9999-4999-8999-999999999999";
const NAMED_ANSWER_ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** A migrations folder holding every migration named before the copy, and none after. */
const foldersBeforeCopy = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-copy-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(COPY) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

/** The copy's own statements, as the migrator splits them. */
const copyStatements = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const text = yield* fileSystem.readFileString(
    path.join(MIGRATIONS_FOLDER, COPY, "migration.sql"),
  );
  return text.split("--> statement-breakpoint").map((statement) => statement.trim());
});

/** An account, its workspace, a plan in it, an agent on the plan, and two items the agent posted, one answered and one open with a picture, as the inbox left them. */
const seedInbox = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`insert into "user" (id, name, email, created_at, updated_at)
    values ('ada', 'Ada', 'ada@luke.test', now(), now())`;
  yield* sql`insert into organization (id, name, slug, created_at)
    values ('acme', 'Acme', 'acme', now())`;
  yield* sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('owner', 'acme', 'ada', 'owner', now())`;
  yield* sql`insert into plan (id, user_id, organization_id, name, document)
    values ('44444444-4444-4444-8444-444444444444', 'ada', 'acme', 'Teammate invitations', '')`;
  yield* sql`insert into conversations (id, user_id, kind)
    values ('55555555-5555-4555-8555-555555555555', 'ada', 'coding_agent')`;
  yield* sql`insert into coding_agent (id, plan_id, user_id, conversation_id, model, effort, repository, idempotency_key, plan_snapshot)
    values ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444', 'ada',
      '55555555-5555-4555-8555-555555555555', 'anthropic/claude-opus-5.5', 'high', 'acme/relay', 'start-1', '# Plan')`;
  yield* sql`insert into inbox_item (id, user_id, plan_id, agent_id, key, revision, version, title, blocks,
      response, needs_reply, status, answer, answer_key, posted_at, updated_at)
    values (${ANSWERED_ITEM}, 'ada', '44444444-4444-4444-8444-444444444444', '66666666-6666-4666-8666-666666666666',
      'invite-expiry', 2, 4, 'Invite expiry', '[{"type":"markdown","text":"Seven or five?"}]',
      '{"type":"text"}', true, 'answered', '{"reply":"answered","note":"Seven days."}', 'answer-1',
      '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z')`;
  yield* sql`insert into inbox_item (id, user_id, plan_id, agent_id, key, revision, version, title, blocks,
      response, needs_reply, status, posted_at, updated_at)
    values (${OPEN_ITEM}, 'ada', '44444444-4444-4444-8444-444444444444', '66666666-6666-4666-8666-666666666666',
      'branch-rules', 1, 4, 'Require a review on main',
      ${`[{"type":"image","attachmentId":"${PICTURE}","alt":"The settings page."}]`},
      '{"type":"task"}', false, 'open', '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z')`;
  // A second plan, whose slug, the slug with its id after it, and `plan-` with its id are all held by topics already.
  yield* sql`insert into plan (id, user_id, organization_id, name, document)
    values (${RELEASE_PLAN}, 'ada', 'acme', 'Release', '')`;
  yield* sql`insert into chat_channel (organization_id, kind, name, created_at)
    values ('acme', 'topic', 'release', now()), ('acme', 'topic', ${`release-${RELEASE_PLAN}`}, now()),
      ('acme', 'topic', ${`plan-${RELEASE_PLAN}`}, now())`;
  yield* sql`insert into inbox_item (id, user_id, plan_id, agent_id, key, revision, version, title, blocks,
      response, needs_reply, status, posted_at, updated_at)
    values (${RELEASE_ITEM}, 'ada', ${RELEASE_PLAN}, '66666666-6666-4666-8666-666666666666',
      'release-notes', 1, 4, 'Who writes the notes?', '[]', '{"type":"text"}', true, 'open',
      '2026-10-01T13:00:00Z', '2026-10-01T13:00:00Z')`;
  // An agent an automation started with no plan, and the item it posted to its workspace.
  yield* sql`insert into conversations (id, user_id, kind)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ada', 'coding_agent')`;
  yield* sql`insert into coding_agent (id, plan_id, organization_id, user_id, conversation_id, model, effort, repository, idempotency_key, task)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'acme', 'ada',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'anthropic/claude-opus-5.5', 'high', 'acme/relay', 'start-2', 'Sweep flaky tests.')`;
  yield* sql`insert into inbox_item (id, user_id, plan_id, organization_id, agent_id, key, revision, version, title, blocks,
      response, needs_reply, status, posted_at, updated_at)
    values (${PLANLESS_ITEM}, 'ada', null, 'acme', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'flaky', 1, 4, 'Quarantine the flaky test?', '[]', '{"type":"approval"}', true, 'open',
      '2026-10-01T14:00:00Z', '2026-10-01T14:00:00Z')`;
  // An item a teammate answered, whose name slugs to a handle an agent holds, so the copy mints them one apart.
  yield* sql`insert into "user" (id, name, email, created_at, updated_at)
    values ('grace', 'Agent 1', 'grace@luke.test', now(), now())`;
  yield* sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('teammate', 'acme', 'grace', 'member', now())`;
  yield* sql`insert into inbox_item (id, user_id, plan_id, agent_id, key, revision, version, title, blocks,
      response, needs_reply, status, answer, answer_key, answered_by, posted_at, updated_at)
    values (${NAMED_ANSWER_ITEM}, 'ada', '44444444-4444-4444-8444-444444444444', '66666666-6666-4666-8666-666666666666',
      'release-date', 1, 4, 'Ship Friday?', '[]', '{"type":"text"}', true, 'answered',
      '{"reply":"answered","note":"Friday."}', 'answer-2', 'grace',
      '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z')`;
  yield* sql`insert into inbox_attachment (id, user_id, plan_id, item_id, content_type, byte_count, bytes, created_at)
    values (${PICTURE}, 'ada', '44444444-4444-4444-8444-444444444444', ${OPEN_ITEM}, 'image/png', 3,
      decode('010203', 'hex'), '2026-10-01T12:00:00Z')`;
});

const ChatCounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [counted] = yield* sql<{
    readonly members: number;
    readonly channels: number;
    readonly messages: number;
    readonly pictures: number;
    readonly next: number;
  }>`select
      (select count(*)::int from chat_member) as members,
      (select count(*)::int from chat_channel) as channels,
      (select count(*)::int from chat_message) as messages,
      (select count(*)::int from chat_attachment) as pictures,
      (select next_seq from workspace_chat where organization_id = 'acme') as next`;
  return counted;
});

it.effect(
  "an answered item lands as an answered ask and an open one as an open ask with its picture, read by the Inbox as before, and the copy run again adds nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBeforeCopy);
        yield* seedInbox;

        yield* runWebMigrations();

        const asks = yield* sql<{
          readonly id: string;
          readonly seq: number;
          readonly ask_status: string;
          readonly ask_revision: number;
          readonly answer_key: string | null;
          readonly handle: string;
          readonly name: string;
        }>`select chat_message.id, chat_message.seq, ask_status, ask_revision, answer_key, chat_member.handle, chat_channel.name
          from chat_message
          join chat_member on chat_member.id = chat_message.author_member_id
          join chat_channel on chat_channel.id = chat_message.channel_id
          order by chat_message.seq`;
        assert.deepEqual(
          asks.map((row) => [
            row.id,
            row.seq,
            row.ask_status,
            row.ask_revision,
            row.answer_key,
            row.handle,
            row.name,
          ]),
          [
            [
              ANSWERED_ITEM,
              1,
              INBOX_STATUS.ANSWERED,
              2,
              "answer-1",
              "agent-1",
              "teammate-invitations",
            ],
            [OPEN_ITEM, 2, INBOX_STATUS.OPEN, 1, null, "agent-1", "teammate-invitations"],
            [RELEASE_ITEM, 3, INBOX_STATUS.OPEN, 1, null, "agent-1", `plan-${RELEASE_PLAN}-2`],
            [PLANLESS_ITEM, 4, INBOX_STATUS.OPEN, 1, null, "agent-2", "general"],
            [
              NAMED_ANSWER_ITEM,
              5,
              INBOX_STATUS.ANSWERED,
              1,
              "answer-2",
              "agent-1",
              "teammate-invitations",
            ],
          ],
        );

        const items = yield* planInboxItems("ada", "44444444-4444-4444-8444-444444444444");
        assert.deepEqual(
          items.map((item) => [item.id, item.title, item.status, item.needsReply, item.answer]),
          [
            [OPEN_ITEM, "Require a review on main", INBOX_STATUS.OPEN, false, undefined],
            [
              NAMED_ANSWER_ITEM,
              "Ship Friday?",
              INBOX_STATUS.ANSWERED,
              true,
              { reply: INBOX_REPLY.ANSWERED, note: "Friday." },
            ],
            [
              ANSWERED_ITEM,
              "Invite expiry",
              INBOX_STATUS.ANSWERED,
              true,
              { reply: INBOX_REPLY.ANSWERED, note: "Seven days." },
            ],
          ],
        );
        assert.deepEqual(
          items.map((item) => item.updatedAt),
          [
            Date.parse("2026-10-01T12:00:00Z"),
            Date.parse("2026-10-01T15:00:00Z"),
            Date.parse("2026-10-01T11:00:00Z"),
          ],
        );
        const picture = Option.getOrThrow(yield* readInboxAttachment("ada", OPEN_ITEM, PICTURE));
        assert.deepEqual([picture.contentType, [...picture.bytes]], ["image/png", [1, 2, 3]]);

        const before = yield* ChatCounts;
        assert.deepEqual(before, { members: 3, channels: 6, messages: 5, pictures: 1, next: 6 });
        for (const statement of yield* copyStatements) yield* sql.unsafe(statement);
        assert.deepEqual(yield* ChatCounts, before);

        assert.deepEqual(
          (yield* accountPlanlessItems("ada")).map((item) => [item.id, item.title]),
          [[PLANLESS_ITEM, "Quarantine the flaky test?"]],
        );

        // A copied answer the item named an answerer for names them, through the member minted for them.
        assert.deepEqual(items[1]?.answeredBy, { userId: "grace", name: "Agent 1" });
        const [answerer] = yield* sql<{ readonly handle: string }>`select handle from chat_member
          where user_id = 'grace' and organization_id = 'acme'`;
        assert.equal(answerer?.handle, "agent-1-2");

        // A copied answer that names no answerer is withdrawn by its key.
        const reopened = yield* withdrawInboxAnswer("ada", ANSWERED_ITEM, "answer-1");
        assert.equal(Option.getOrUndefined(reopened)?.status, INBOX_STATUS.OPEN);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
