import assert from "node:assert/strict";
import { test } from "vitest";
import { sandboxVcpus } from "./bounds.js";

test("a repository that asks for no size opens its agent's sandbox at two vCPUs", () => {
  assert.equal(sandboxVcpus("acme/app"), 2);
});

test("an agent with no repository opens its sandbox at two vCPUs", () => {
  assert.equal(sandboxVcpus(null), 2);
});

test("Luke's own repository asks for four vCPUs, however GitHub's name for it is cased", () => {
  assert.equal(sandboxVcpus("reviewstage/luke"), 4);
  assert.equal(sandboxVcpus("ReviewStage/luke"), 4);
});
