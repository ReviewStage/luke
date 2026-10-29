import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { UNMIGRATED_FOLLOWS } from "../shared/host-read-guard.ts";
import { noFollowOutsideHostReadRule } from "./no-follow-outside-host-read.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const HOOK_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/use-host-read.ts");
const NEW_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/not-on-the-list.ts");
const LISTED_FILE = path.join(REPOSITORY_ROOT, Object.keys(UNMIGRATED_FOLLOWS)[0] ?? "");
const STREAM = "streamFrom(() => askAct(ACT_KIND.CHANNELS_FOLLOW, { workspaceId }), take);\n";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-follow-outside-host-read", noFollowOutsideHostReadRule, {
  valid: [
    // The hook's own module opens what it reads.
    { code: STREAM, filename: HOOK_FILE },
    // A file on the list, until its step moves it.
    { code: STREAM, filename: LISTED_FILE },
    // An act that opens no follow, and a follow kind a fixture answers rather than opens.
    { code: "askAct(ACT_KIND.CHANNELS_LIST, { workspaceId });", filename: NEW_FILE },
    { code: "const answers = { [ACT_KIND.CHANNELS_FOLLOW]: () => pushed };", filename: NEW_FILE },
    // A test stands in for the host.
    {
      code: STREAM,
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/use-channels.test.ts"),
    },
    // Code outside the panel is no business of the rule's.
    { code: STREAM, filename: path.join(REPOSITORY_ROOT, "packages/host/src/example.ts") },
  ],
  invalid: [
    // A follow opened through either helper, and an act of a follow kind however it is sent.
    {
      code: STREAM,
      filename: NEW_FILE,
      errors: [{ messageId: "newFollow" }, { messageId: "newFollow" }],
    },
    {
      code: "followStream(open, take);",
      filename: NEW_FILE,
      errors: [{ messageId: "newFollow" }],
    },
    {
      code: "act(ACT_KIND.TASKS_HISTORY_FOLLOW, { taskId });",
      filename: NEW_FILE,
      errors: [{ messageId: "newFollow" }],
    },
    {
      code: "actPort()[ACT_KIND.WORKSPACE_PEOPLE]({ workspaceId });",
      filename: NEW_FILE,
      errors: [{ messageId: "newFollow" }],
    },
    // A one-shot read whose rows a host read already carries.
    {
      code: "askAct(ACT_KIND.AGENTS_LIST, { taskId });",
      filename: NEW_FILE,
      errors: [{ messageId: "newFollow" }],
    },
    // A file on the list that opens no follow any more.
    {
      code: "export const nothing = 1;",
      filename: LISTED_FILE,
      errors: [{ messageId: "staleListed" }],
    },
  ],
});
