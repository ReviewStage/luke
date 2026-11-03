import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { UNMIGRATED_READS } from "../shared/host-read-guard.ts";
import { noFollowOutsideHostReadRule } from "./no-follow-outside-host-read.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const HOOK_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/use-host-read.ts");
const NEW_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/not-on-the-list.ts");
const NEW_UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/not-on-the-list.ts");
const LISTED_FILE = path.join(REPOSITORY_ROOT, Object.keys(UNMIGRATED_READS)[0] ?? "");
const STREAM = "streamFrom(() => askAct(ACT_KIND.AUTOMATIONS_FOLLOW, { workspaceId }), take);\n";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-follow-outside-host-read", noFollowOutsideHostReadRule, {
  valid: [
    // The hook's own module opens what it reads.
    { code: STREAM, filename: HOOK_FILE },
    // A file on the list, until its step moves it.
    { code: STREAM, filename: LISTED_FILE },
    // A write and a fetch read nothing a surface shows.
    { code: "act(ACT_KIND.TASKS_RENAME, { taskId, name });", filename: NEW_FILE },
    { code: "act(ACT_KIND.TASKS_FILE, { taskId, path });", filename: NEW_FILE },
    // A read kind a fixture answers, tells apart, or types, rather than reads.
    {
      code: [
        "const answers = { [ACT_KIND.AUTOMATIONS_FOLLOW]: () => pushed };",
        "const comments = kind === ACT_KIND.TASKS_COMMENTS;",
        "type Asked = PortActPayload<typeof ACT_KIND.TASKS_COMMENTS>;",
      ].join("\n"),
      filename: NEW_FILE,
    },
    // A clock's tick repeats an effect, but no promise.
    {
      code: "Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(wait));",
      filename: NEW_UI_FILE,
    },
    // A test stands in for the host.
    {
      code: STREAM,
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/use-automations.test.ts"),
    },
    // Code outside the panel is no business of the rule's.
    { code: STREAM, filename: path.join(REPOSITORY_ROOT, "packages/host/src/example.ts") },
  ],
  invalid: [
    // A follow opened through either helper, and an act of a read kind however it is sent.
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
      code: "actPort()[ACT_KIND.WORKSPACE_PEOPLE]({ workspaceId });",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    // A one-shot read, and a read kind kept in a local to send later.
    {
      code: "askAct(ACT_KIND.TASKS_PAGES, place);",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    {
      code: "const kind = ACT_KIND.TASKS_COMMENTS;",
      filename: NEW_FILE,
      errors: [{ messageId: "newRead" }],
    },
    // A design-system loop over a reader a panel file hands it.
    {
      code: "const once = Effect.tryPromise(read);\nEffect.forever(once);",
      filename: NEW_UI_FILE,
      errors: [{ messageId: "newPoll" }],
    },
    // A file on the list that reads nothing any more.
    {
      code: "export const nothing = 1;",
      filename: LISTED_FILE,
      errors: [{ messageId: "staleListed" }],
    },
  ],
});
