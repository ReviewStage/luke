import assert from "node:assert/strict";
import { test } from "vitest";
import { currentCommandLine } from "./plan.js";

// Note that the regression this catches is a script written against `vespin plan` failing as an
// unknown command before the cutover retires the old name.
test("a command line leading with plan is read as description, its global flags kept", () => {
  assert.deepEqual(currentCommandLine(["--json", "plan", "show", "ACME-42"]), [
    "--json",
    "description",
    "show",
    "ACME-42",
  ]);
});

test("plan as a global flag's value or a later word is left as it is", () => {
  assert.deepEqual(currentCommandLine(["-w", "plan", "task", "show", "plan"]), [
    "-w",
    "plan",
    "task",
    "show",
    "plan",
  ]);
});
