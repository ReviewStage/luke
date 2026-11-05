/**
 * index.ts -- every `vespin` command, in the order `--help` lists them.
 *
 * A command group is a file of its own in this folder exporting its
 * commands, built on `../output.js` (the answer, notes, `-F` input) and
 * `../session.js` (the service, the bearer, `askService`), and registered
 * by one line below. A group takes the global flags (`../flags.js`) from
 * the context rather than declaring them.
 */

import { ACCOUNT_COMMANDS } from "./account.js";
import { apiCommand } from "./api.js";
import { inboxCommand } from "./inbox.js";
import { mcpCommand } from "./mcp.js";
import { modelsCommand } from "./models.js";
import { versionCommand } from "./version.js";
import { workspaceCommand } from "./workspace.js";

export const COMMANDS = [
  ...ACCOUNT_COMMANDS,
  workspaceCommand,
  inboxCommand,
  modelsCommand,
  mcpCommand,
  apiCommand,
  versionCommand,
] as const;
