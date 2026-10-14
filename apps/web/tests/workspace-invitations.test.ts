import assert from "node:assert/strict";
import { PERSONAL_WORKSPACE_METADATA } from "@sidecar/database/models/workspace-seams";
import { openMigratedPglite } from "@sidecar/database/testing";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Schema } from "effect";
import { test } from "vitest";
import { authDatabaseAdapter } from "../server/auth-database";
import {
  DISABLED_AUTH_PATHS,
  INVITATION_REFUSAL,
  ORGANIZATION_OPTIONS,
} from "../server/auth-policy";

/**
 * Workspace invitations over HTTP, as the invite and accept pages reach them
 * from a browser session, on Luke's own organization policy over a migrated
 * PGlite. Email and password sign-up stands in for the Google or GitHub
 * sign-in, whose provider verifies the address, so an account is marked
 * verified the way a provider's sign-in would mark it. Synthetic accounts
 * throughout.
 */

const BASE_URL = "http://127.0.0.1";

const InvitationSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  status: Schema.String,
});

const ReadInvitationSchema = Schema.Struct({
  id: Schema.String,
  organizationName: Schema.String,
  inviterEmail: Schema.String,
});

const AcceptedSchema = Schema.Struct({
  member: Schema.Struct({ organizationId: Schema.String, role: Schema.String }),
});

const OrganizationsSchema = Schema.Array(Schema.Struct({ id: Schema.String }));

const RefusalSchema = Schema.Struct({ code: Schema.String });

function invitationAuth(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  return betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: BASE_URL,
    secret: "workspace-invitations-test-secret-of-enough-length",
    emailAndPassword: { enabled: true },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [organization(ORGANIZATION_OPTIONS)],
  });
}

type Auth = ReturnType<typeof invitationAuth>;

interface Account {
  readonly id: string;
  readonly email: string;
  readonly cookie: string;
}

async function withAuth(body: (auth: Auth) => Promise<void>): Promise<void> {
  const client = await openMigratedPglite();
  try {
    await body(invitationAuth(client));
  } finally {
    await client.close();
  }
}

/** An account signed up and signed in; verified unless asked otherwise, as a provider's sign-in leaves it. */
async function signUp(auth: Auth, name: string, verified = true): Promise<Account> {
  const email = `${name}@example.com`;
  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email, password: "a-password-long-enough" },
    returnHeaders: true,
  });
  if (verified) await verify(auth, response.user.id);
  // A browser sends back each cookie's name and value, and none of its attributes.
  const cookie = headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return { id: response.user.id, email, cookie };
}

async function verify(auth: Auth, userId: string): Promise<void> {
  const context = await auth.$context;
  await context.internalAdapter.updateUser(userId, { emailVerified: true });
}

/** A workspace the server made for its owner, as Luke's own routes make one. */
async function workspaceOf(auth: Auth, owner: Account, personal = false): Promise<string> {
  const created = await auth.api.createOrganization({
    body: {
      name: personal ? "Owner" : "Acme",
      slug: personal ? `personal-${owner.id}` : "acme",
      userId: owner.id,
      metadata: personal ? { ...PERSONAL_WORKSPACE_METADATA } : {},
    },
  });
  assert.ok(created);
  return created.id;
}

/** A browser's request to the auth service under the account's cookie. */
async function call(
  auth: Auth,
  account: Account,
  path: string,
  body?: Readonly<Record<string, string>>,
): Promise<Response> {
  const headers = { origin: BASE_URL, cookie: account.cookie, "content-type": "application/json" };
  const request =
    body === undefined
      ? new Request(`${BASE_URL}/api/auth${path}`, { headers })
      : new Request(`${BASE_URL}/api/auth${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
  return auth.handler(request);
}

async function invite(auth: Auth, inviter: Account, workspaceId: string, email: string) {
  return call(auth, inviter, "/organization/invite-member", {
    email,
    role: "member",
    organizationId: workspaceId,
  });
}

async function refusal(response: Response): Promise<{ status: number; code: string }> {
  const { code } = Schema.decodeUnknownSync(RefusalSchema)(await response.json());
  return { status: response.status, code };
}

test("an admin invites by address, and the invitee reads the invitation and accepts it as a member", async () => {
  await withAuth(async (auth) => {
    const owner = await signUp(auth, "owner");
    const admin = await signUp(auth, "admin");
    const invitee = await signUp(auth, "invitee");
    const workspaceId = await workspaceOf(auth, owner);
    await auth.api.addMember({
      body: { userId: admin.id, organizationId: workspaceId, role: "admin" },
    });

    const invited = await invite(auth, admin, workspaceId, invitee.email);
    assert.equal(invited.status, 200);
    const invitation = Schema.decodeUnknownSync(InvitationSchema)(await invited.json());

    const listed = await call(
      auth,
      admin,
      `/organization/list-invitations?organizationId=${workspaceId}`,
    );
    assert.deepEqual(
      Schema.decodeUnknownSync(Schema.Array(InvitationSchema))(await listed.json()),
      [{ id: invitation.id, email: invitee.email, status: "pending" }],
    );

    const read = await call(auth, invitee, `/organization/get-invitation?id=${invitation.id}`);
    assert.deepEqual(Schema.decodeUnknownSync(ReadInvitationSchema)(await read.json()), {
      id: invitation.id,
      organizationName: "Acme",
      inviterEmail: admin.email,
    });

    const accepted = await call(auth, invitee, "/organization/accept-invitation", {
      invitationId: invitation.id,
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(Schema.decodeUnknownSync(AcceptedSchema)(await accepted.json()).member, {
      organizationId: workspaceId,
      role: "member",
    });

    const organizations = await call(auth, invitee, "/organization/list");
    assert.deepEqual(Schema.decodeUnknownSync(OrganizationsSchema)(await organizations.json()), [
      { id: workspaceId },
    ]);

    // Note that a used invitation reads as no invitation, which is how the page knows to say so.
    const reread = await call(auth, invitee, `/organization/get-invitation?id=${invitation.id}`);
    assert.equal(reread.status, 400);
  });
});

test("a member invites no one and cancels nothing, and an invitation its owner canceled is accepted by no one", async () => {
  await withAuth(async (auth) => {
    const owner = await signUp(auth, "owner");
    const member = await signUp(auth, "member");
    const invitee = await signUp(auth, "invitee");
    const workspaceId = await workspaceOf(auth, owner);
    await auth.api.addMember({
      body: { userId: member.id, organizationId: workspaceId, role: "member" },
    });

    assert.deepEqual(await refusal(await invite(auth, member, workspaceId, invitee.email)), {
      status: 403,
      code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
    });

    const invited = await invite(auth, owner, workspaceId, invitee.email);
    const { id } = Schema.decodeUnknownSync(InvitationSchema)(await invited.json());
    const memberCancel = await call(auth, member, "/organization/cancel-invitation", {
      invitationId: id,
    });
    assert.deepEqual(await refusal(memberCancel), {
      status: 403,
      code: "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION",
    });

    const ownerCancel = await call(auth, owner, "/organization/cancel-invitation", {
      invitationId: id,
    });
    assert.equal(ownerCancel.status, 200);
    const accepted = await call(auth, invitee, "/organization/accept-invitation", {
      invitationId: id,
    });
    assert.deepEqual(await refusal(accepted), { status: 400, code: "INVITATION_NOT_FOUND" });
  });
});

test("a personal workspace takes no invitation, even from its owner", async () => {
  await withAuth(async (auth) => {
    const owner = await signUp(auth, "owner");
    const workspaceId = await workspaceOf(auth, owner, true);

    assert.deepEqual(await refusal(await invite(auth, owner, workspaceId, "friend@example.com")), {
      status: 403,
      code: INVITATION_REFUSAL.PERSONAL_WORKSPACE,
    });
    const listed = await call(
      auth,
      owner,
      `/organization/list-invitations?organizationId=${workspaceId}`,
    );
    assert.deepEqual(await listed.json(), []);
  });
});

test("an invitation is accepted only by the invited address, and only once its provider verified it", async () => {
  await withAuth(async (auth) => {
    const owner = await signUp(auth, "owner");
    const stranger = await signUp(auth, "stranger");
    const invitee = await signUp(auth, "invitee", false);
    const workspaceId = await workspaceOf(auth, owner);
    const invited = await invite(auth, owner, workspaceId, invitee.email);
    const { id } = Schema.decodeUnknownSync(InvitationSchema)(await invited.json());
    const accept = (account: Account) =>
      call(auth, account, "/organization/accept-invitation", { invitationId: id });

    assert.deepEqual(await refusal(await accept(stranger)), {
      status: 403,
      code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
    });
    assert.deepEqual(await refusal(await accept(invitee)), {
      status: 403,
      code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
    });

    await verify(auth, invitee.id);
    assert.equal((await accept(invitee)).status, 200);
  });
});
