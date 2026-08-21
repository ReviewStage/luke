import assert from "node:assert/strict";
import test from "node:test";
import {
  adminSeedEmailsFromEnv,
  isAdminRole,
  isSeededAdminEmail,
  USER_ROLE,
} from "../server/admin/admin-access";

test("only the admin role passes the gate; user, empty, and absent do not", () => {
  assert.equal(isAdminRole(USER_ROLE.ADMIN), true);
  assert.equal(isAdminRole(USER_ROLE.USER), false);
  assert.equal(isAdminRole("administrator"), false);
  assert.equal(isAdminRole(""), false);
  assert.equal(isAdminRole(null), false);
  assert.equal(isAdminRole(undefined), false);
});

test("the seed list parses comma-separated, case- and space-insensitively", () => {
  const seeds = adminSeedEmailsFromEnv("  Dean@Example.com , charles@example.com ");
  assert.equal(isSeededAdminEmail("dean@example.com", seeds), true);
  assert.equal(isSeededAdminEmail("CHARLES@EXAMPLE.COM", seeds), true);
  assert.equal(isSeededAdminEmail("intruder@example.com", seeds), false);
});

test("a blank or absent seed value is an empty set, never a wildcard", () => {
  assert.equal(adminSeedEmailsFromEnv(undefined).size, 0);
  assert.equal(adminSeedEmailsFromEnv("   ").size, 0);
  assert.equal(adminSeedEmailsFromEnv(",, ,").size, 0);
  assert.equal(isSeededAdminEmail("anyone@example.com", adminSeedEmailsFromEnv("")), false);
});

test("an absent address is never seeded, even against a non-empty list", () => {
  const seeds = adminSeedEmailsFromEnv("dean@example.com");
  assert.equal(isSeededAdminEmail(undefined, seeds), false);
  assert.equal(isSeededAdminEmail("", seeds), false);
  assert.equal(isSeededAdminEmail("   ", seeds), false);
});
