import { describe, expect, it } from "vitest";
import {
  CLI_WORKSPACE_SOURCE,
  CLI_WORKSPACE_UNSETTLED,
  resolveCliWorkspace,
} from "./cli-workspace.js";

const ACME = { id: "ws-acme", slug: "acme", formerSlugs: ["acme-old"] };
const LABS = { id: "ws-labs", slug: "labs" };

describe("resolveCliWorkspace", () => {
  it.each([
    [
      "-w over the environment and config",
      { flag: "labs", environment: "acme", config: "acme" },
      [ACME, LABS],
      LABS,
      CLI_WORKSPACE_SOURCE.FLAG,
    ],
    [
      "the environment over config",
      { environment: "ws-acme", config: "labs" },
      [ACME, LABS],
      ACME,
      CLI_WORKSPACE_SOURCE.ENVIRONMENT,
    ],
    [
      "the config default, by a former slug",
      { config: "ACME-OLD" },
      [ACME, LABS],
      ACME,
      CLI_WORKSPACE_SOURCE.CONFIG,
    ],
    ["the only workspace where none is named", {}, [LABS], LABS, CLI_WORKSPACE_SOURCE.ONLY],
  ])("settles on %s", (_case, names, workspaces, workspace, source) => {
    expect(resolveCliWorkspace(names, workspaces)).toEqual({ workspace, source });
  });

  it.each([
    [
      "a name the member is not in, over the next in line",
      { flag: "nope", config: "acme" },
      [ACME, LABS],
      {
        unsettled: CLI_WORKSPACE_UNSETTLED.UNKNOWN,
        named: { name: "nope", source: CLI_WORKSPACE_SOURCE.FLAG },
      },
    ],
    ["no name among several", {}, [ACME, LABS], { unsettled: CLI_WORKSPACE_UNSETTLED.UNNAMED }],
  ])("settles on nothing for %s", (_case, names, workspaces, unsettled) => {
    expect(resolveCliWorkspace(names, workspaces)).toEqual(unsettled);
  });
});
