/**
 * pr-214.ts -- #214 "Add teammate invitations" as its Files changed, Chapters, and review threads read it: nine files of acme/relay with whole patches, the head commit they were read at, and Dana's review thread on invite.ts.
 *
 * Throwaway (`README.md`). Shared by the shots of the Pull request tab, so
 * Files changed, Chapters, and the row over the composer agree on one
 * change. Each patch is written out line by line, so every file's counts are
 * the patch's own and every thread lands on a line the patch holds.
 */

import type { AgentChangesAnswerView } from "@luke/features/agent-view";

export const PR_URL = "https://github.com/acme/relay/pull/214";
export const HEAD_SHA = "4f1c2a9e7b3d5f60a8c1e2d3b4a5968778f9a0b1";
export const BASE_SHA = "9a0b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3";

/** One file of the change: where, what became of it, its hunks, and the counts they make. */
export interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified";
  readonly patch: string;
  readonly additions: number;
  readonly deletions: number;
}

/** A hunk: where it starts on each side, and its lines, each led by "+", "-", or " ". */
interface Hunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly header?: string;
  readonly lines: readonly string[];
}

function hunkText(hunk: Hunk): string {
  const old = hunk.lines.filter((line) => !line.startsWith("+")).length;
  const now = hunk.lines.filter((line) => !line.startsWith("-")).length;
  const head = `@@ -${hunk.oldStart},${old} +${hunk.newStart},${now} @@${hunk.header === undefined ? "" : ` ${hunk.header}`}`;
  return [head, ...hunk.lines].join("\n");
}

function file(path: string, status: "added" | "modified", hunks: readonly Hunk[]): ChangedFile {
  const lines = hunks.flatMap((hunk) => hunk.lines);
  return {
    path,
    status,
    patch: hunks.map(hunkText).join("\n"),
    additions: lines.filter((line) => line.startsWith("+")).length,
    deletions: lines.filter((line) => line.startsWith("-")).length,
  };
}

/** A new file, every line added. */
function added(path: string, lines: readonly string[]): ChangedFile {
  return file(path, "added", [{ oldStart: 0, newStart: 1, lines: lines.map((line) => `+${line}`) }]);
}

export const INVITE_PATH = "src/members/invite.ts";

/** `src/members/invite.ts` as #214 adds it. */
export const INVITE_LINES = [
  'import { db } from "../db";',
  'import { mail } from "../mail";',
  'import { DAY_MS, randomToken } from "../util";',
  "",
  "// How long an invite link stays good.",
  "export const INVITE_TTL_MS = 7 * DAY_MS;",
  "",
  "export async function inviteMember(workspaceId: string, email: string, by: Member) {",
  "  const token = randomToken();",
  "  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);",
  "  const membership = await db.memberships.insert({",
  '    workspaceId, email, state: "pending", inviteToken: token, invitedBy: by.id, expiresAt,',
  "  });",
  "  await mail.invite(email, acceptUrl(token));",
  "  return membership;",
  "}",
  "",
  "export async function withdrawInvite(inviteId: string, by: Member) {",
  "  const invite = await db.memberships.find(inviteId);",
  "  assertSenderOrAdmin(invite, by);",
  '  await db.memberships.update(inviteId, { state: "withdrawn", inviteToken: null });',
  "}",
];

/** The line of invite.ts Dana's thread is on: the withdraw's update. */
export const THREAD_LINE = 21;

export const FILES: readonly ChangedFile[] = [
  added("src/db/migrations/20261013_memberships_state.sql", [
    "ALTER TABLE memberships ADD COLUMN state text NOT NULL DEFAULT 'active';",
    "ALTER TABLE memberships ADD COLUMN invite_token text UNIQUE;",
    "ALTER TABLE memberships ADD COLUMN invited_by uuid REFERENCES users(id);",
    "ALTER TABLE memberships ADD COLUMN expires_at timestamptz;",
    "CREATE INDEX memberships_pending ON memberships (workspace_id) WHERE state = 'pending';",
  ]),
  file("src/db/schema/memberships.ts", "modified", [
    {
      oldStart: 6,
      newStart: 6,
      header: "export const memberships = pgTable('memberships', {",
      lines: [
        "   workspaceId: uuid('workspace_id').notNull(),",
        "   userId: uuid('user_id'),",
        "   role: text('role').notNull(),",
        "+  state: text('state', { enum: ['pending', 'active', 'withdrawn'] }).notNull().default('active'),",
        "+  inviteToken: text('invite_token').unique(),",
        "+  invitedBy: uuid('invited_by'),",
        "+  expiresAt: timestamp('expires_at'),",
        "   createdAt: timestamp('created_at').defaultNow(),",
        " });",
      ],
    },
  ]),
  added(INVITE_PATH, INVITE_LINES),
  added("src/members/accept.ts", [
    'import { db } from "../db";',
    'import { InviteRefused } from "./errors";',
    "",
    "export async function acceptInvite(token: string, userId: string) {",
    "  const invite = await db.memberships.findByToken(token);",
    '  if (invite === undefined || invite.state !== "pending") throw new InviteRefused();',
    "  if (invite.expiresAt < new Date()) throw new InviteRefused();",
    "  return db.memberships.update(invite.id, {",
    '    state: "active",',
    "    userId,",
    "    inviteToken: null,",
    "  });",
    "}",
  ]),
  added("src/routes/invites.ts", [
    'import { Hono } from "hono";',
    'import { acceptInvite } from "../members/accept";',
    'import { inviteMember, withdrawInvite } from "../members/invite";',
    'import { InviteRefused } from "../members/errors";',
    "",
    "export const invites = new Hono<Env>();",
    "",
    'invites.post("/", async (c) => {',
    "  const { email } = await c.req.json<{ email: string }>();",
    '  const invite = await inviteMember(c.get("workspaceId"), email, c.get("member"));',
    "  return c.json(invite, 201);",
    "});",
    "",
    'invites.get("/:token", async (c) => {',
    "  try {",
    '    await acceptInvite(c.req.param("token"), c.get("userId"));',
    '    return c.redirect("/");',
    "  } catch (error) {",
    '    if (error instanceof InviteRefused) return c.html(noLongerValid(), 410);',
    "    throw error;",
    "  }",
    "});",
    "",
    'invites.delete("/:id", async (c) => {',
    '  await withdrawInvite(c.req.param("id"), c.get("member"));',
    "  return c.body(null, 204);",
    "});",
  ]),
  file("src/members/list.ts", "modified", [
    {
      oldStart: 5,
      newStart: 5,
      header: "export function listMembers(id: string) {",
      lines: [
        "-  return db.select().from(memberships).where(eq(memberships.workspaceId, id));",
        "+  return db",
        "+    .select()",
        "+    .from(memberships)",
        "+    .where(and(eq(memberships.workspaceId, id), eq(memberships.state, 'active')));",
        " }",
      ],
    },
  ]),
  file("src/billing/seats.ts", "modified", [
    {
      oldStart: 19,
      newStart: 19,
      header: "export async function seatCount(workspaceId: string) {",
      lines: [
        "   const rows = await db",
        "     .select({ count: count() })",
        "     .from(memberships)",
        "-    .where(eq(memberships.workspaceId, workspaceId));",
        "+    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.state, 'active')));",
        "   return rows[0]?.count ?? 0;",
      ],
    },
  ]),
  file("src/auth/workspace-access.ts", "modified", [
    {
      oldStart: 32,
      newStart: 32,
      header: "export async function memberOf(workspaceId: string, userId: string) {",
      lines: [
        "   const membership = await db.query.memberships.findFirst({",
        "-    where: and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)),",
        "+    where: and(",
        "+      eq(memberships.workspaceId, workspaceId),",
        "+      eq(memberships.userId, userId),",
        "+      eq(memberships.state, 'active'),",
        "+    ),",
        "   });",
      ],
    },
  ]),
  added("src/members/invite.test.ts", [
    'import { describe, expect, it } from "vitest";',
    'import { acceptInvite } from "./accept";',
    'import { inviteMember, withdrawInvite } from "./invite";',
    'import { admin, member, workspace } from "../../test/builders";',
    "",
    'describe("invites", () => {',
    '  it("creates a pending membership and mails the link", async () => {',
    '    const invite = await inviteMember(workspace.id, "sam@acme.dev", admin);',
    '    expect(invite.state).toBe("pending");',
    "    expect(mailbox.last().to).toBe(\"sam@acme.dev\");",
    "  });",
    "",
    '  it("turns the membership active when the link is opened", async () => {',
    '    const invite = await inviteMember(workspace.id, "sam@acme.dev", admin);',
    "    const joined = await acceptInvite(invite.inviteToken, member.id);",
    '    expect(joined.state).toBe("active");',
    "  });",
    "",
    '  it("refuses a withdrawn link", async () => {',
    '    const invite = await inviteMember(workspace.id, "sam@acme.dev", admin);',
    "    await withdrawInvite(invite.id, admin);",
    "    await expect(acceptInvite(invite.inviteToken, member.id)).rejects.toThrow();",
    "  });",
    "});",
  ]),
];

export const TOTALS = {
  additions: FILES.reduce((sum, each) => sum + each.additions, 0),
  deletions: FILES.reduce((sum, each) => sum + each.deletions, 0),
  files: FILES.length,
};

/** #214's Files changed, read at its head. */
export function pr214Changes(): AgentChangesAnswerView {
  return {
    pullRequest: {
      url: PR_URL,
      truncated: false,
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      files: FILES.map((each) => ({
        path: each.path,
        previousPath: null,
        status: each.status,
        additions: each.additions,
        deletions: each.deletions,
        patch: each.patch,
        omitted: null,
      })),
    },
  };
}

/** The hunk of invite.ts a thread on {@link THREAD_LINE} quotes, as GitHub cuts it. */
export const INVITE_HUNK = `@@ -0,0 +1,${String(THREAD_LINE)} @@\n${INVITE_LINES.slice(0, THREAD_LINE)
  .map((line) => `+${line}`)
  .join("\n")}`;
