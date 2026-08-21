import assert from "node:assert/strict";
import test from "node:test";
import { isAdminRole, USER_ROLE } from "../server/admin/admin-access";

test("only the admin role passes the gate; user, empty, and absent do not", () => {
  assert.equal(isAdminRole(USER_ROLE.ADMIN), true);
  assert.equal(isAdminRole(USER_ROLE.USER), false);
  assert.equal(isAdminRole("administrator"), false);
  assert.equal(isAdminRole(""), false);
  assert.equal(isAdminRole(null), false);
  assert.equal(isAdminRole(undefined), false);
});
