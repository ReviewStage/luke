/**
 * changes-files.ts -- #214's files as GitHub would list them: each file before and after the agent's change, and the unified diff between them.
 *
 * Throwaway (`README.md`). Each file is written out whole on both sides
 * and its patch is the diff jsdiff finds between them, three lines of
 * context, headed as git heads a hunk, so every hunk's counts and every
 * file's added and removed lines agree with what it shows. The files sum
 * to the totals #214 names (`coding-agent.ts`): 9 files, +412 −38.
 */

import type { CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import { structuredPatch } from "diff";

/** One changed file as written: its path, and its text before (none where it is new) and after. */
interface WrittenFile {
  readonly path: string;
  readonly before?: string;
  readonly after: string;
}

/** A hunk's header as git writes it: a side with no lines counts from the line before it. */
function hunkHeader(hunk: {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}): string {
  const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart;
  const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
  return `@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@`;
}

/** One written file as the changes answer carries it: its patch, and the lines that adds and removes. */
function changedFile(file: WrittenFile): CodingAgentChangedFile {
  const before = file.before ?? "";
  const diff = structuredPatch(file.path, file.path, before, file.after, "", "", { context: 3 });
  const lines = diff.hunks.flatMap((hunk) => hunk.lines);
  return {
    path: file.path,
    previousPath: null,
    status: file.before === undefined ? "added" : "modified",
    additions: lines.filter((line) => line.startsWith("+")).length,
    deletions: lines.filter((line) => line.startsWith("-")).length,
    patch: diff.hunks.map((hunk) => [hunkHeader(hunk), ...hunk.lines].join("\n")).join("\n"),
    omitted: null,
  };
}

const SCHEMA_BEFORE = `import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users, workspaces } from './core';

// One row per user per workspace.
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('memberships_workspace_idx').on(table.workspaceId),
  uniqueIndex('memberships_user_idx').on(table.workspaceId, table.userId),
]);

export type Membership = typeof memberships.$inferSelect;
`;

const SCHEMA_AFTER = `import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users, workspaces } from './core';

/** A pending membership is an invite: it has an email and a token, no user yet. */
export const MEMBERSHIP_STATES = ['pending', 'active'] as const;

// One row per person per workspace: a member, or an invite still pending.
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
  state: text('state', { enum: MEMBERSHIP_STATES }).notNull().default('active'),
  inviteToken: text('invite_token').unique(),
  inviteExpiresAt: timestamp('invite_expires_at'),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('memberships_workspace_idx').on(table.workspaceId),
  uniqueIndex('memberships_user_idx')
    .on(table.workspaceId, table.userId)
    .where(sql\`\${table.userId} is not null\`),
  uniqueIndex('memberships_email_idx').on(table.workspaceId, table.email),
]);

export type Membership = typeof memberships.$inferSelect;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
`;

const MIGRATION = `-- An invite is a pending membership: an email and a one-time token, no user yet.
ALTER TABLE memberships ADD COLUMN state text NOT NULL DEFAULT 'active';
ALTER TABLE memberships ADD COLUMN email text;
ALTER TABLE memberships ADD COLUMN invite_token text UNIQUE;
ALTER TABLE memberships ADD COLUMN invite_expires_at timestamp;
ALTER TABLE memberships ADD COLUMN invited_by uuid REFERENCES users(id);

UPDATE memberships m SET email = u.email FROM users u WHERE u.id = m.user_id;
ALTER TABLE memberships ALTER COLUMN email SET NOT NULL;
ALTER TABLE memberships ALTER COLUMN user_id DROP NOT NULL;

DROP INDEX memberships_user_idx;
CREATE UNIQUE INDEX memberships_user_idx ON memberships (workspace_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX memberships_email_idx ON memberships (workspace_id, email);
`;

const INVITE = `import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import { sendInviteEmail } from '../emails/invite';
import { assertAdmin, type Member } from './access';

/** How long an invite link stays good. */
export const INVITE_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InviteFailure = 'already-member' | 'expired' | 'not-found';

export class InviteError extends Error {
  constructor(readonly reason: InviteFailure) {
    super(\`Invite \${reason}\`);
  }
}

function inviteToken(): string {
  return randomBytes(24).toString('base64url');
}

function expiry(from: Date): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * DAY_MS);
}

/**
 * Invites \`email\` to the workspace: a pending membership with a one-time
 * token, and an email with the link that accepts it. Inviting the same
 * address again sends a fresh link and voids the old one.
 */
export async function inviteMember(workspaceId: string, email: string, by: Member) {
  assertAdmin(by);
  const [existing] = await db
    .select({ state: memberships.state })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.email, email)));
  if (existing?.state === 'active') throw new InviteError('already-member');

  const token = inviteToken();
  const expiresAt = expiry(new Date());
  const [invite] = await db
    .insert(memberships)
    .values({
      workspaceId,
      email,
      role: 'member',
      state: 'pending',
      inviteToken: token,
      inviteExpiresAt: expiresAt,
      invitedBy: by.userId,
    })
    .onConflictDoUpdate({
      target: [memberships.workspaceId, memberships.email],
      set: { inviteToken: token, inviteExpiresAt: expiresAt, invitedBy: by.userId },
    })
    .returning();

  await sendInviteEmail({ to: email, workspaceId, inviter: by.name, token, expiresAt });
  return invite;
}

/** Turns the pending membership behind \`token\` active for the signed-in user. */
export async function acceptInvite(token: string, userId: string) {
  const [invite] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.inviteToken, token), eq(memberships.state, 'pending')));
  if (invite === undefined) throw new InviteError('not-found');
  if (invite.inviteExpiresAt !== null && invite.inviteExpiresAt < new Date()) {
    throw new InviteError('expired');
  }

  const [member] = await db
    .update(memberships)
    .set({ userId, state: 'active', inviteToken: null, inviteExpiresAt: null })
    .where(eq(memberships.id, invite.id))
    .returning();
  return member;
}
`;

const ROUTES = `import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireMember, requireSession } from '../auth/session';
import { acceptInvite, InviteError, inviteMember } from '../members/invite';
import { listPendingInvites } from '../members/list';
import { withdrawInvite } from '../members/remove';

const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email(),
});

/** What each way an invite can fail answers. */
const FAILURE_STATUS = {
  'already-member': 409,
  expired: 410,
  'not-found': 404,
} as const;

export const invites = new Hono();

invites.onError((error, c) => {
  if (!(error instanceof InviteError)) throw error;
  return c.json({ error: error.reason }, FAILURE_STATUS[error.reason]);
});

invites.get('/workspaces/:workspaceId/invites', requireMember, async (c) => {
  const pending = await listPendingInvites(c.req.param('workspaceId'));
  return c.json({ invites: pending });
});

invites.post(
  '/workspaces/:workspaceId/invites',
  requireMember,
  zValidator('json', inviteBody),
  async (c) => {
    const { email } = c.req.valid('json');
    const invite = await inviteMember(c.req.param('workspaceId'), email, c.get('member'));
    return c.json({ id: invite.id, email: invite.email, state: invite.state }, 201);
  },
);

invites.delete('/workspaces/:workspaceId/invites/:id', requireMember, async (c) => {
  const { workspaceId, id } = c.req.param();
  const withdrawn = await withdrawInvite(workspaceId, id, c.get('member'));
  return withdrawn ? c.body(null, 204) : c.json({ error: 'not-found' }, 404);
});

invites.post('/invites/:token/accept', requireSession, async (c) => {
  const member = await acceptInvite(c.req.param('token'), c.get('session').userId);
  return c.json({ workspaceId: member.workspaceId, role: member.role });
});
`;

const EMAIL = `import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components';
import { appUrl } from '../config';
import { mailer } from './mailer';
import { workspaceName } from '../workspaces/name';

interface InviteEmailProps {
  readonly workspace: string;
  readonly inviter: string;
  readonly acceptUrl: string;
  readonly expiresAt: Date;
}

export function InviteEmail({ workspace, inviter, acceptUrl, expiresAt }: InviteEmailProps) {
  const until = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return (
    <Html>
      <Head />
      <Preview>{inviter} invited you to {workspace} on Relay</Preview>
      <Body style={{ fontFamily: 'Inter, sans-serif', background: '#f6f6f7' }}>
        <Container style={{ padding: 32, background: '#ffffff', borderRadius: 12 }}>
          <Heading as="h2">Join {workspace} on Relay</Heading>
          <Text>
            {inviter} invited you to work with them in {workspace}.
          </Text>
          <Button href={acceptUrl} style={{ padding: '10px 18px', borderRadius: 8 }}>
            Accept invitation
          </Button>
          <Text style={{ color: '#6b6b76', fontSize: 13 }}>
            This link works once and expires on {until}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function sendInviteEmail(invite: {
  to: string;
  workspaceId: string;
  inviter: string;
  token: string;
  expiresAt: Date;
}) {
  const workspace = await workspaceName(invite.workspaceId);
  await mailer.send({
    to: invite.to,
    subject: \`\${invite.inviter} invited you to \${workspace}\`,
    react: (
      <InviteEmail
        workspace={workspace}
        inviter={invite.inviter}
        acceptUrl={appUrl(\`/invites/\${invite.token}\`)}
        expiresAt={invite.expiresAt}
      />
    ),
  });
}
`;

const REMOVE_BEFORE = `import { eq } from 'drizzle-orm';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import { assertAdmin, type Member } from './access';

/** Removes a member from the workspace. */
export async function removeMember(member: Member, by: Member) {
  assertAdmin(by);
  await db.delete(memberships).where(eq(memberships.id, member.id));
}
`;

const REMOVE_AFTER = `import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import { assertAdmin, type Member } from './access';

/** Removes an active member; a pending invite is withdrawn instead. */
export async function removeMember(member: Member, by: Member) {
  assertAdmin(by);
  await db
    .delete(memberships)
    .where(and(eq(memberships.id, member.id), eq(memberships.state, 'active')));
}

/** Withdraws a pending invite, so its link stops working; false if there was none. */
export async function withdrawInvite(workspaceId: string, id: string, by: Member) {
  assertAdmin(by);
  const withdrawn = await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.id, id),
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.state, 'pending'),
      ),
    )
    .returning({ id: memberships.id });
  return withdrawn.length > 0;
}
`;

const LIST_BEFORE = `import { eq } from 'drizzle-orm';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import { users } from '../db/schema/core';

// Every row is a member: there is no other kind of membership.
export function listMembers(id: string) {
  return db.select().from(memberships).where(eq(memberships.workspaceId, id));
}

export async function listMembersWithNames(id: string) {
  const rows = await db
    .select({ membership: memberships, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, id));
  return rows
    .map((row) => ({ ...row.membership, name: row.name, email: row.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findMemberByEmail(id: string, email: string) {
  const rows = await listMembersWithNames(id);
  const match = rows.find((row) => row.email.toLowerCase() === email.toLowerCase());
  if (match === undefined) {
    return null;
  }
  return match;
}

export async function countAdmins(id: string) {
  const rows = await db.select().from(memberships).where(eq(memberships.workspaceId, id));
  return rows.filter((row) => row.role === 'admin' || row.role === 'owner').length;
}

export async function countMembers(id: string) {
  const rows = await db.select().from(memberships).where(eq(memberships.workspaceId, id));
  return rows.length;
}
`;

const LIST_AFTER = `import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import { users } from '../db/schema/core';

/** A workspace's members: its active memberships, never an invite still pending. */
function activeIn(id: string) {
  return and(eq(memberships.workspaceId, id), eq(memberships.state, 'active'));
}

export function listMembers(id: string) {
  return db.select().from(memberships).where(activeIn(id));
}

export function listMembersWithNames(id: string) {
  return db
    .select({ id: memberships.id, role: memberships.role, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(activeIn(id))
    .orderBy(asc(users.name));
}

export async function findMemberByEmail(id: string, email: string) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(activeIn(id), eq(memberships.email, email.toLowerCase())));
  return row ?? null;
}

export async function countAdmins(id: string) {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(activeIn(id), inArray(memberships.role, ['owner', 'admin'])));
  return row?.n ?? 0;
}

export async function countMembers(id: string) {
  const [row] = await db.select({ n: count() }).from(memberships).where(activeIn(id));
  return row?.n ?? 0;
}

/** The invites a workspace is still waiting on, newest first. */
export function listPendingInvites(id: string) {
  return db
    .select({
      id: memberships.id,
      email: memberships.email,
      invitedBy: memberships.invitedBy,
      expiresAt: memberships.inviteExpiresAt,
    })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, id), eq(memberships.state, 'pending')))
    .orderBy(asc(memberships.createdAt));
}
`;

const SEATS_BEFORE = `import { eq } from 'drizzle-orm';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import { plans } from './plans';
import { stripe } from './stripe';

/** The seats a workspace pays for: one per member, at least its plan's minimum. */
export async function billableSeats(workspaceId: string, plan: keyof typeof plans) {
  const rows = await db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.workspaceId, workspaceId));
  let seats = 0;
  for (const row of rows) {
    if (row.role === 'owner' || row.role === 'admin' || row.role === 'member') {
      seats += 1;
    }
  }
  return Math.max(seats, plans[plan].minimumSeats);
}

export async function syncSeats(workspaceId: string, subscriptionId: string, plan: keyof typeof plans) {
  const quantity = await billableSeats(workspaceId, plan);
  await stripe.subscriptions.update(subscriptionId, { quantity });
}
`;

const SEATS_AFTER = `import { and, count, eq } from 'drizzle-orm';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import { plans } from './plans';
import { stripe } from './stripe';

/**
 * The seats a workspace pays for: one per active member, at least its
 * plan's minimum. A pending invite takes no seat until it is accepted.
 */
export async function billableSeats(workspaceId: string, plan: keyof typeof plans) {
  const [row] = await db
    .select({ seats: count() })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.state, 'active')));
  return Math.max(row?.seats ?? 0, plans[plan].minimumSeats);
}

export async function syncSeats(workspaceId: string, subscriptionId: string, plan: keyof typeof plans) {
  const quantity = await billableSeats(workspaceId, plan);
  await stripe.subscriptions.update(subscriptionId, { quantity });
}
`;

const TEST = `import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { memberships } from '../db/schema/memberships';
import * as email from '../emails/invite';
import { countMembers, listMembers, listPendingInvites } from './list';
import { acceptInvite, INVITE_TTL_DAYS, InviteError, inviteMember } from './invite';
import { withdrawInvite } from './remove';
import { createUser, createWorkspace, resetDatabase } from '../../test/factories';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('invites', () => {
  let workspaceId: string;
  let admin: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await resetDatabase();
    vi.spyOn(email, 'sendInviteEmail').mockResolvedValue();
    admin = await createUser({ name: 'Dana Ortiz', role: 'admin' });
    workspaceId = await createWorkspace({ owner: admin });
  });

  it('creates a pending membership and mails its link', async () => {
    const invite = await inviteMember(workspaceId, 'sam@acme.dev', admin);

    expect(invite.state).toBe('pending');
    expect(invite.userId).toBeNull();
    expect(email.sendInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sam@acme.dev', token: invite.inviteToken }),
    );
  });

  it('does not count a pending invite as a member', async () => {
    await inviteMember(workspaceId, 'sam@acme.dev', admin);

    expect(await countMembers(workspaceId)).toBe(1);
    expect(await listMembers(workspaceId)).toHaveLength(1);
    expect(await listPendingInvites(workspaceId)).toHaveLength(1);
  });

  it('turns the membership active once accepted', async () => {
    const invite = await inviteMember(workspaceId, 'sam@acme.dev', admin);
    const sam = await createUser({ name: 'Sam Lee', email: 'sam@acme.dev' });

    const member = await acceptInvite(invite.inviteToken!, sam.userId);

    expect(member.state).toBe('active');
    expect(member.userId).toBe(sam.userId);
    expect(await countMembers(workspaceId)).toBe(2);
  });

  it('accepts a link only once', async () => {
    const invite = await inviteMember(workspaceId, 'sam@acme.dev', admin);
    const sam = await createUser({ name: 'Sam Lee', email: 'sam@acme.dev' });
    await acceptInvite(invite.inviteToken!, sam.userId);

    await expect(acceptInvite(invite.inviteToken!, sam.userId)).rejects.toThrow(
      new InviteError('not-found'),
    );
  });

  it('refuses a link past its expiry', async () => {
    const invite = await inviteMember(workspaceId, 'sam@acme.dev', admin);
    vi.setSystemTime(Date.now() + (INVITE_TTL_DAYS + 1) * DAY_MS);

    await expect(acceptInvite(invite.inviteToken!, admin.userId)).rejects.toThrow(
      new InviteError('expired'),
    );
    vi.useRealTimers();
  });

  it('sends a fresh link when the same address is invited again', async () => {
    const first = await inviteMember(workspaceId, 'sam@acme.dev', admin);
    const second = await inviteMember(workspaceId, 'sam@acme.dev', admin);

    expect(second.id).toBe(first.id);
    expect(second.inviteToken).not.toBe(first.inviteToken);
    await expect(acceptInvite(first.inviteToken!, admin.userId)).rejects.toThrow();
  });

  it('refuses to invite someone who is already a member', async () => {
    await expect(inviteMember(workspaceId, admin.email, admin)).rejects.toThrow(
      new InviteError('already-member'),
    );
  });

  it('lists pending invites with who sent them', async () => {
    await inviteMember(workspaceId, 'sam@acme.dev', admin);
    await inviteMember(workspaceId, 'kai@acme.dev', admin);

    const pending = await listPendingInvites(workspaceId);

    expect(pending.map((invite) => invite.email)).toEqual(['sam@acme.dev', 'kai@acme.dev']);
    expect(pending.every((invite) => invite.invitedBy === admin.userId)).toBe(true);
  });

  it('lets only an admin invite', async () => {
    const sam = await createUser({ name: 'Sam Lee', role: 'member' });

    await expect(inviteMember(workspaceId, 'kai@acme.dev', sam)).rejects.toThrow(
      'Admins only',
    );
    expect(await listPendingInvites(workspaceId)).toHaveLength(0);
    expect(email.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('withdraws a pending invite so its link stops working', async () => {
    const invite = await inviteMember(workspaceId, 'sam@acme.dev', admin);

    expect(await withdrawInvite(workspaceId, invite.id, admin)).toBe(true);
    expect(await db.select().from(memberships)).toHaveLength(1);
    await expect(acceptInvite(invite.inviteToken!, admin.userId)).rejects.toThrow();
  });
});
`;

/** #214's files in the order GitHub lists them, the schema first so the tab opens on it. */
const WRITTEN: readonly WrittenFile[] = [
  { path: "src/db/schema/memberships.ts", before: SCHEMA_BEFORE, after: SCHEMA_AFTER },
  { path: "src/db/migrations/20261013_memberships_state.sql", after: MIGRATION },
  { path: "src/members/invite.ts", after: INVITE },
  { path: "src/routes/invites.ts", after: ROUTES },
  { path: "src/emails/invite.tsx", after: EMAIL },
  { path: "src/members/remove.ts", before: REMOVE_BEFORE, after: REMOVE_AFTER },
  { path: "src/members/list.ts", before: LIST_BEFORE, after: LIST_AFTER },
  { path: "src/billing/seats.ts", before: SEATS_BEFORE, after: SEATS_AFTER },
  { path: "src/members/invite.test.ts", after: TEST },
];

/** #214's changed files, each with its patch. */
export function pullRequestFiles(): CodingAgentChangedFile[] {
  return WRITTEN.map(changedFile);
}
