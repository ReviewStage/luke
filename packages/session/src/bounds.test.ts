import assert from "node:assert/strict";
import { sessionChangeNumber } from "@sidecar/session";
import { test } from "vitest";

test("reads the pull request's number off every host's address shape", () => {
  assert.equal(sessionChangeNumber("https://github.com/reviewstage/luke/pull/245"), 245);
  assert.equal(
    sessionChangeNumber("https://gitlab.com/reviewstage/group/sidecar-web/-/merge_requests/3"),
    3,
  );
  assert.equal(
    sessionChangeNumber("https://bitbucket.org/reviewstage/sidecar-native/pull-requests/9"),
    9,
  );
});

test("an address whose tail names no number yields none rather than a guess", () => {
  assert.equal(sessionChangeNumber("https://github.com/reviewstage/luke/pulls"), undefined);
  assert.equal(
    sessionChangeNumber("https://github.com/reviewstage/luke/pull/245/files"),
    undefined,
  );
  assert.equal(sessionChangeNumber("not an address"), undefined);
});
