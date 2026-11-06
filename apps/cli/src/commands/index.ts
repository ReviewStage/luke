import { ACCOUNT_COMMANDS } from "./account.js";
import { agentCommand } from "./agent.js";
import { apiCommand } from "./api.js";
import { descriptionCommand } from "./description.js";
import { inboxCommand } from "./inbox.js";
import { mcpCommand } from "./mcp.js";
import { modelsCommand } from "./models.js";
import { taskCommand } from "./task.js";
import { updateCommand } from "./update.js";
import { versionCommand } from "./version.js";
import { workspaceCommand } from "./workspace.js";

export const COMMANDS = [
  ...ACCOUNT_COMMANDS,
  taskCommand,
  descriptionCommand,
  agentCommand,
  workspaceCommand,
  inboxCommand,
  modelsCommand,
  mcpCommand,
  apiCommand,
  updateCommand,
  versionCommand,
] as const;
