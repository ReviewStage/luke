import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GITHUB_AUTHOR_ASSOCIATION,
  githubIssueRefIn,
  isOutsideAuthor,
} from "./github-repositories-wire.js";

test("words name an issue whole: a link to its page, owner/name#N, or #N of the repository chosen, and nothing else", () => {
  assert.deepEqual(githubIssueRefIn(" https://github.com/acme/relay/issues/312 ", null), {
    repository: "acme/relay",
    number: 312,
  });
  assert.deepEqual(githubIssueRefIn("acme/relay#7", "octo/other"), {
    repository: "acme/relay",
    number: 7,
  });
  assert.deepEqual(githubIssueRefIn("#7", "acme/relay"), { repository: "acme/relay", number: 7 });
  assert.equal(githubIssueRefIn("#7", null), undefined);
  assert.equal(githubIssueRefIn("#0", "acme/relay"), undefined);
  assert.equal(githubIssueRefIn("fix #7", "acme/relay"), undefined);
  assert.equal(githubIssueRefIn("acme/../relay#7", null), undefined);
  assert.equal(githubIssueRefIn("https://github.com/acme/relay/pull/7", null), undefined);
  assert.equal(githubIssueRefIn(`${"!/".repeat(50_000)}#7`, null), undefined);
  assert.equal(githubIssueRefIn("acme/relay/extra#7", null), undefined);
});

test("an issue's author is outside unless GitHub names them its owner, a member, or a collaborator, a value it adds later among the outside", () => {
  assert.deepEqual(
    Object.values(GITHUB_AUTHOR_ASSOCIATION).filter((association) => !isOutsideAuthor(association)),
    [
      GITHUB_AUTHOR_ASSOCIATION.OWNER,
      GITHUB_AUTHOR_ASSOCIATION.MEMBER,
      GITHUB_AUTHOR_ASSOCIATION.COLLABORATOR,
    ],
  );
  assert.equal(isOutsideAuthor("SPONSOR"), true);
});
