import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "vitest";
import { temporaryDirectory } from "../testing/temporary-directory.js";
import { activeOrganizationId } from "./config.js";

/**
 * A file Superset wrote, read as the JSON it is. Every unreadable shape
 * answers nothing rather than throwing: the previous build's `plutil` exit
 * code said exactly this, at the cost of a process on every observation pass.
 */
const CONFIG_CASE: readonly {
  readonly name: string;
  readonly contents?: string;
  readonly organizationId?: string;
}[] = [
  {
    name: "reads the organization the configuration names",
    contents: '{"organizationId":"org-1","other":"ignored"}',
    organizationId: "org-1",
  },
  { name: "answers nothing where there is no configuration file" },
  { name: "answers nothing for a file that is not JSON", contents: "not json" },
  { name: "answers nothing for a JSON document that is not an object", contents: '["org-1"]' },
  { name: "answers nothing where the field is absent", contents: '{"other":"org-1"}' },
  { name: "answers nothing where the field is not a string", contents: '{"organizationId":7}' },
  { name: "answers nothing for a blank organization", contents: '{"organizationId":"   "}' },
];

for (const configCase of CONFIG_CASE) {
  test(configCase.name, async (t: TestContext) => {
    const home = await temporaryDirectory(t, "luke-superset-config-");
    if (configCase.contents !== undefined) {
      await fs.writeFile(path.join(home, "config.json"), configCase.contents);
    }

    assert.equal(await activeOrganizationId(home), configCase.organizationId);
  });
}
