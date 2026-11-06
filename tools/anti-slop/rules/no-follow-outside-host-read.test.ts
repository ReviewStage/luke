import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noFollowOutsideHostReadRule } from "./no-follow-outside-host-read.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const HOOK_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/use-host-read.ts");
const LIVE_READS_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/live-reads.ts");
const DOOR_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/act-stream.ts");
const NEW_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/not-on-the-list.ts");
const NEW_UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/not-on-the-list.ts");
const STREAM = "streamFrom(() => askAct(ACT_KIND.AUTOMATIONS_FOLLOW, { workspaceId }), take);\n";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-follow-outside-host-read", noFollowOutsideHostReadRule, {
  valid: [
    { code: STREAM, filename: HOOK_FILE },
    { code: STREAM, filename: LIVE_READS_FILE },
    {
      code: [
        "const next = Effect.tryPromise({ try: () => stream.next(), catch: unheard });",
        "Effect.forever(next);",
        "rendererFork(followStream(open, take));",
      ].join("\n"),
      filename: DOOR_FILE,
    },
    { code: "act(ACT_KIND.TASKS_RENAME, { taskId, name });", filename: NEW_FILE },
    { code: "act(ACT_KIND.TASKS_FILE, { taskId, path });", filename: NEW_FILE },
    {
      code: [
        "const answers = { [ACT_KIND.AUTOMATIONS_FOLLOW]: () => pushed };",
        "const comments = kind === ACT_KIND.TASKS_COMMENTS_FOLLOW;",
        "type Asked = PortActPayload<typeof ACT_KIND.TASKS_COMMENTS_FOLLOW>;",
      ].join("\n"),
      filename: NEW_FILE,
    },
    {
      code: "Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(wait));",
      filename: NEW_UI_FILE,
    },
    {
      code: STREAM,
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/use-automations.test.ts"),
    },
    { code: STREAM, filename: path.join(REPOSITORY_ROOT, "packages/host/src/example.ts") },
  ],
  invalid: [
    {
      code: STREAM,
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }, { messageId: "newRead" }],
    },
    {
      code: "followStream(open, take);",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    {
      code: "act(ACT_KIND.TASKS_HISTORY_FOLLOW, { taskId });",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    {
      code: "actPort()[ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW]({ workspaceId });",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    {
      code: "askAct(ACT_KIND.AGENTS_LIST, { taskId });",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    {
      code: "const kind = ACT_KIND.TASKS_COMMENTS_FOLLOW;",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    {
      code: "const once = Effect.tryPromise(read);\nEffect.forever(once);",
      filename: NEW_UI_FILE,
      errors: [{ messageId: "newPoll" }],
    },
    {
      code: [
        'import { streamFrom as hold } from "../act-stream.js";',
        'export { followStream } from "../act-stream.js";',
        'const door = import("../act-stream.js");',
        'const required = require("../act-stream.js");',
      ].join("\n"),
      filename: NEW_FILE,
      errors: [
        { messageId: "doorImport" },
        { messageId: "doorImport" },
        { messageId: "doorImport" },
        { messageId: "doorImport" },
      ],
    },
  ],
});
