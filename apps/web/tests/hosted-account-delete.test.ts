import assert from "node:assert/strict";
import test from "node:test";
import { handleAccountDelete } from "../server/hosted/account-delete";
import { HOSTED_API_ERROR } from "../server/hosted/http";

function deleteRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/account/delete", {
    method: "POST",
    headers: { authorization: "Bearer token-1", ...headers },
  });
}

function options(overrides: Partial<Parameters<typeof handleAccountDelete>[0]> = {}) {
  return {
    request: deleteRequest(),
    resolveUserId: async () => "user-1",
    deleteUser: async () => {},
    ...overrides,
  };
}

test("a delete erases exactly the user behind the bearer token", async () => {
  const deleted: string[] = [];
  const response = await handleAccountDelete(
    options({
      deleteUser: async (userId) => {
        deleted.push(userId);
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(deleted, ["user-1"]);
});

test("only POST reaches the resolver, and no token deletes nothing", async () => {
  let resolved = 0;
  let deleted = 0;
  const counting = {
    resolveUserId: async (): Promise<string | undefined> => {
      resolved += 1;
      return "user-1";
    },
    deleteUser: async () => {
      deleted += 1;
    },
  };

  const wrongMethod = await handleAccountDelete(
    options({
      ...counting,
      request: new Request("https://luke.test/api/account/delete", { method: "GET" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
  assert.equal(resolved, 0);

  const anonymous = await handleAccountDelete(
    options({ ...counting, resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(deleted, 0);
});
