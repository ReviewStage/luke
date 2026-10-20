/**
 * coder-tool-files.test.ts -- the coding agent's tool files offer exactly its tools, each in its own words, and a file that needs no host bundles none of it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { emitJsonSchema } from "@luke/wire/effect";
import type { Schema } from "effect";
import { expect, test } from "vitest";
import developerTools from "../../../../../apps/dev/tools/developer.js";
import reachTools from "../../../../../apps/dev/tools/reach.js";
import workspaceTools from "../../../../../apps/dev/tools/workspace.js";
import { bundleAuthoredModuleCode } from "../../../node_modules/eve/dist/src/internal/authored-module-loader.js";
import { LOOK_AT_PICTURE_TOOL } from "../../tasks/picture-look.js";
import { INBOX_TOOLS } from "../coder-host/inbox.js";
import { OPEN_PULL_REQUEST_TOOL } from "../coder-host/pull-request.js";
import { SHOW_IMAGE_TOOL } from "../coder-host/show-image.js";
import { CODER_TOOL } from "../coder-host/tool-set.js";
import {
  CODER_READ_AGENT_TOOL,
  LIST_AGENTS_TOOL,
  LIST_MODELS_TOOL,
  LIST_TASKS_TOOL,
  MESSAGE_AGENT_TOOL,
  READ_PAGE_TOOL,
  START_AGENT_TOOL,
  STOP_AGENT_TOOL,
  UPDATE_AGENT_TOOL,
  UPDATE_TASK_TOOL,
} from "../coding-agent-tools.js";
import {
  CREATE_ISSUE_TOOL,
  LIST_ISSUES_TOOL,
  READ_ISSUE_TOOL,
  UPDATE_ISSUE_TOOL,
} from "../issue-tools.js";
import { RUN_ON_MAC_TOOL } from "../mac-command.js";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../public-research.js";
import { CREATE_SECTION_TOOL, DELETE_SECTION_TOOL } from "../task-section-tools.js";
import { CREATE_TASK_TOOL, READ_TASK_TOOL } from "../task-tools.js";
import { AGENT_EXTERNAL_DEPENDENCIES } from "./build.js";

const CODER_ROOT = fileURLToPath(new URL("../../../../../apps/dev/", import.meta.url));

/** The coding agent's tool directories: its own, and its worker's. */
const TOOL_DIRECTORIES = ["tools", "subagents/worker/tools"] as const;

/** The packages that are the store and the auth service, which only the host's own files reach. */
const HOST_RUNTIME_PACKAGES = ["better-auth", "drizzle-orm", "pg"] as const;

/** What a resolver is handed as a session starts, for the resolvers that read none of it. */
const SESSION_START = {
  model: null,
  session: { id: "coder-session", auth: { current: null, initiator: null } },
  channel: {},
  messages: [],
} as const;

/** What each tool the agent is offered once its session starts is described by, as its own file once wrote it. */
const SESSION_TOOL_DESCRIPTORS = new Map<
  string,
  { readonly description: string; readonly inputSchema: Schema.Top }
>([
  [CODER_TOOL.CLOSE_INBOX_ITEM, INBOX_TOOLS.CLOSE],
  [CODER_TOOL.CREATE_ISSUE, CREATE_ISSUE_TOOL],
  [CODER_TOOL.CREATE_SECTION, CREATE_SECTION_TOOL],
  [CODER_TOOL.CREATE_TASK, CREATE_TASK_TOOL],
  [CODER_TOOL.DELETE_SECTION, DELETE_SECTION_TOOL],
  [CODER_TOOL.LIST_AGENTS, LIST_AGENTS_TOOL],
  [CODER_TOOL.LIST_ISSUES, LIST_ISSUES_TOOL],
  [CODER_TOOL.LIST_MODELS, LIST_MODELS_TOOL],
  [CODER_TOOL.LIST_TASKS, LIST_TASKS_TOOL],
  [CODER_TOOL.LOOK_AT_PICTURE, LOOK_AT_PICTURE_TOOL],
  [CODER_TOOL.MESSAGE_AGENT, MESSAGE_AGENT_TOOL],
  [CODER_TOOL.OPEN_PULL_REQUEST, OPEN_PULL_REQUEST_TOOL],
  [CODER_TOOL.POST_TO_INBOX, INBOX_TOOLS.POST],
  [CODER_TOOL.READ_AGENT, CODER_READ_AGENT_TOOL],
  [CODER_TOOL.READ_INBOX, INBOX_TOOLS.READ],
  [CODER_TOOL.READ_ISSUE, READ_ISSUE_TOOL],
  [CODER_TOOL.READ_PAGE, READ_PAGE_TOOL],
  [CODER_TOOL.READ_TASK, READ_TASK_TOOL],
  [CODER_TOOL.READ_WEB_PAGE, READ_WEB_PAGE_TOOL],
  [CODER_TOOL.REPLY_INBOX, INBOX_TOOLS.REPLY],
  [CODER_TOOL.RUN_ON_MAC, RUN_ON_MAC_TOOL],
  [CODER_TOOL.SEARCH_WEB, SEARCH_WEB_TOOL],
  [CODER_TOOL.SHOW_IMAGE, SHOW_IMAGE_TOOL],
  [CODER_TOOL.START_AGENT, START_AGENT_TOOL],
  [CODER_TOOL.STOP_AGENT, STOP_AGENT_TOOL],
  [CODER_TOOL.UPDATE_AGENT, UPDATE_AGENT_TOOL],
  [CODER_TOOL.UPDATE_ISSUE, UPDATE_ISSUE_TOOL],
  [CODER_TOOL.UPDATE_TASK, UPDATE_TASK_TOOL],
]);

/** The files of one tool directory, by their path from the agent's root. */
function toolFiles(directory: string): readonly string[] {
  return readdirSync(`${CODER_ROOT}${directory}`)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}/${name}`);
}

/**
 * The tool names one file offers, as eve names them: a file whose resolvers
 * answer a map of tools offers each under its key, written as a member of
 * `CODER_TOOL`; any other offers one tool, named by the file.
 */
function namesOffered(file: string): readonly string[] {
  const source = readFileSync(`${CODER_ROOT}${file}`, "utf8");
  const keyed = [...source.matchAll(/\[CODER_TOOL\.(\w+)\]: defineTool\(/gu)].map(
    ([, member]) =>
      Object.entries(CODER_TOOL).find(([name]) => name === member)?.[1] ??
      `${file}: CODER_TOOL.${member}`,
  );
  return keyed.length > 0 ? keyed : [basename(file, ".ts")];
}

/** The packages a bundle imports, each by the name of its directory under `node_modules`. */
function packagesImported(code: string): ReadonlySet<string> {
  const specifiers = [...code.matchAll(/\bfrom\s*"([^"]+)"|\bimport\s*\(?\s*"([^"]+)"/gu)].map(
    ([, from, bare]) => from ?? bare ?? "",
  );
  const packages = specifiers.map((specifier) => {
    const directories = [...specifier.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//gu)];
    return directories.at(-1)?.[1] ?? specifier;
  });
  return new Set(packages);
}

/**
 * eve names a tool by its file, or a map's tools by their keys, and a name
 * dropped or doubled in the move from a file each to a few maps would leave
 * the agent short of a tool, or fail its session, with nothing else to say
 * so. The set is the one the store writer registers.
 */
test("the coding agent's tool files offer each of its tools once, and nothing else", () => {
  const offered = toolFiles("tools").flatMap(namesOffered).sort();

  expect(offered).toEqual(Object.values(CODER_TOOL).sort());
});

/**
 * The tools the agent is offered once its session starts were a file each,
 * each told to the model in its own descriptor's words and schema; folded
 * into maps, each must still be, under its own name rather than a
 * neighbour's.
 */
test("each tool resolved at a session's start is described by its own descriptor", async () => {
  const resolved = new Map(
    Object.entries({
      ...(await developerTools.events["session.started"]?.(undefined, SESSION_START)),
      ...(await reachTools.events["session.started"]?.(undefined, SESSION_START)),
      ...(await workspaceTools.events["session.started"]?.(undefined, SESSION_START)),
    }),
  );

  expect([...resolved.keys()].sort()).toEqual([...SESSION_TOOL_DESCRIPTORS.keys()].sort());
  for (const [name, descriptor] of SESSION_TOOL_DESCRIPTORS) {
    const tool = resolved.get(name);
    expect({ name, description: tool?.description, inputSchema: tool?.inputSchema }).toEqual({
      name,
      description: descriptor.description,
      inputSchema: emitJsonSchema(descriptor.inputSchema),
    });
  }
});

/**
 * eve bundles and evaluates each authored file on its own as it builds, so
 * a tool that needs nothing of the host but reaches the store or the auth
 * service through a constant it imports carries that runtime into its
 * bundle and runs it at build time, as `bash` once did through the
 * checkout's path. Only a file that runs through the host may reach them.
 */
test("a tool file that runs nothing through the host bundles neither the store nor the auth service", async () => {
  const reaching: string[] = [];
  for (const file of TOOL_DIRECTORIES.flatMap(toolFiles)) {
    if (readFileSync(`${CODER_ROOT}${file}`, "utf8").includes("host.js")) continue;
    const code = await bundleAuthoredModuleCode(`${CODER_ROOT}${file}`, {
      externalDependencies: AGENT_EXTERNAL_DEPENDENCIES,
    });
    const imported = packagesImported(code);
    reaching.push(
      ...HOST_RUNTIME_PACKAGES.filter((name) => imported.has(name)).map(
        (name) => `${file}: ${name}`,
      ),
    );
  }

  expect(reaching).toEqual([]);
}, 120_000);
