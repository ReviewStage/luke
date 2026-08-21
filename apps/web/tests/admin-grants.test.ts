import assert from "node:assert/strict";
import test from "node:test";
import { adminSeedEmailsFromEnv, USER_ROLE } from "../server/admin/admin-access";
import { promoteSeededAdmin, seedAdminsFromEnv } from "../server/admin/admin-grants";

type GrantDatabase = Parameters<typeof promoteSeededAdmin>[0];

interface Account {
  id: string;
  email: string;
  role: string | null;
}

/** A sweep grant database: the whole user table, recording each role written. */
function sweepDatabase(accounts: Account[], written: string[]): GrantDatabase {
  const double = {
    select: () => ({ from: async () => accounts.map((account) => ({ ...account })) }),
    update: () => ({
      set: (value: { role: string }) => ({
        where: async () => {
          written.push(value.role);
        },
      }),
    }),
  };
  // SAFETY: the double implements only the select-all-then-update chain seedAdminsFromEnv exercises.
  return double as unknown as GrantDatabase;
}

/** A single-account grant database, recording the id and role written. */
function singleAccountDatabase(account: Account | undefined, promoted: string[]): GrantDatabase {
  const double = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (account ? [{ ...account }] : []) }),
      }),
    }),
    update: () => ({
      set: (value: { role: string }) => ({
        where: async () => {
          promoted.push(`${account?.id ?? "?"}:${value.role}`);
        },
      }),
    }),
  };
  // SAFETY: the double implements only the select-by-id-then-update chain promoteSeededAdmin exercises.
  return double as unknown as GrantDatabase;
}

test("a seeded, non-admin account is promoted on sign-in", async () => {
  const promoted: string[] = [];
  await promoteSeededAdmin(
    singleAccountDatabase(
      { id: "user-1", email: "dean@example.com", role: USER_ROLE.USER },
      promoted,
    ),
    { userId: "user-1", seedEmails: adminSeedEmailsFromEnv("dean@example.com") },
  );
  assert.deepEqual(promoted, [`user-1:${USER_ROLE.ADMIN}`]);
});

test("an unseeded account, or one already admin, is not written", async () => {
  const unseeded: string[] = [];
  await promoteSeededAdmin(
    singleAccountDatabase(
      { id: "user-2", email: "stranger@example.com", role: USER_ROLE.USER },
      unseeded,
    ),
    { userId: "user-2", seedEmails: adminSeedEmailsFromEnv("dean@example.com") },
  );
  assert.deepEqual(unseeded, []);

  const already: string[] = [];
  await promoteSeededAdmin(
    singleAccountDatabase(
      { id: "user-1", email: "dean@example.com", role: USER_ROLE.ADMIN },
      already,
    ),
    { userId: "user-1", seedEmails: adminSeedEmailsFromEnv("dean@example.com") },
  );
  assert.deepEqual(already, []);
});

test("promotion with an empty seed list touches nothing", async () => {
  const promoted: string[] = [];
  await promoteSeededAdmin(
    singleAccountDatabase(
      { id: "user-1", email: "dean@example.com", role: USER_ROLE.USER },
      promoted,
    ),
    { userId: "user-1", seedEmails: adminSeedEmailsFromEnv(undefined) },
  );
  assert.deepEqual(promoted, []);
});

test("the build seed grants the admin role to exactly the listed accounts", async () => {
  const written: string[] = [];
  const granted = await seedAdminsFromEnv(
    sweepDatabase(
      [
        { id: "user-1", email: "Dean@example.com", role: USER_ROLE.USER },
        { id: "user-2", email: "stranger@example.com", role: USER_ROLE.USER },
        { id: "user-3", email: "charles@example.com", role: USER_ROLE.ADMIN },
      ],
      written,
    ),
    adminSeedEmailsFromEnv("dean@example.com, charles@example.com"),
  );
  // Both listed accounts count as granted; only the one not already admin is written.
  assert.equal(granted, 2);
  assert.deepEqual(written, [USER_ROLE.ADMIN]);
});

test("the build seed with an empty list makes no query and grants nothing", async () => {
  const written: string[] = [];
  const granted = await seedAdminsFromEnv(sweepDatabase([], written), adminSeedEmailsFromEnv(""));
  assert.equal(granted, 0);
  assert.deepEqual(written, []);
});
