/**
 * coverage.ts -- the hosted procedures that do what each member MCP tool does, so a client of the hosted API reaches everything an outside agent does.
 *
 * The member MCP server and the hosted API are two front ends over the
 * service's operations: the tools are written for a model, the procedures
 * for the desktop, the web app, and the command-line tool. Neither calls the
 * other, so this table is what keeps them level. Every tool named in
 * `MEMBER_MCP_TOOL` has a row, and a tool added without one does not build;
 * each row names the procedures, by their declarations in the contract
 * itself, that together do what the tool does, a read a write needs among
 * them, such as the description a comment is anchored in. A procedure may answer in
 * other words and shapes than its tool, and may take several calls where the
 * tool takes one, but no tool may do what no procedure reaches. Where a
 * procedure the tool needs does not exist, it is added to the contract
 * before the tool's row can name it.
 */

import { hostedContract } from "@repo/features/contract";
import { MEMBER_MCP_TOOL, type MemberMcpToolName } from "./tools.js";

type HostedContract = typeof hostedContract;

/** One procedure of the hosted contract, as the contract declares it. */
type HostedProcedure = {
  [Resource in keyof HostedContract]: HostedContract[Resource][keyof HostedContract[Resource]];
}[keyof HostedContract];

const { account, agentPullRequests, agents, automations, inbox, messages, models } = hostedContract;
const { descriptionComments, plans, taskFiles, agentPages, taskSections, workspaces } =
  hostedContract;

/** Each tool's procedures: at least one, so no row stands empty. */
export const MEMBER_MCP_COVERAGE = {
  [MEMBER_MCP_TOOL.LIST_WORKSPACES]: [workspaces.list],
  [MEMBER_MCP_TOOL.LIST_TASKS]: [plans.list, taskSections.list],
  [MEMBER_MCP_TOOL.READ_TASK]: [plans.open],
  [MEMBER_MCP_TOOL.LIST_AGENTS]: [agents.listOfWorkspace, agents.listOfTask],
  [MEMBER_MCP_TOOL.READ_AGENT]: [agents.read, agentPullRequests.pullRequest, messages.agentNewest],
  [MEMBER_MCP_TOOL.READ_AGENT_CHANGES]: [agentPullRequests.pullRequest, agents.changes],
  [MEMBER_MCP_TOOL.LIST_MODELS]: [models.list, account.preferences],
  [MEMBER_MCP_TOOL.READ_PAGE]: [
    taskFiles.pages,
    taskFiles.page,
    agentPages.list,
    agentPages.version,
  ],
  [MEMBER_MCP_TOOL.CREATE_TASK]: [plans.create, plans.edit],
  [MEMBER_MCP_TOOL.UPDATE_TASK]: [plans.update, plans.parent, plans.block, taskSections.write],
  [MEMBER_MCP_TOOL.EDIT_DESCRIPTION]: [plans.open, plans.edit],
  [MEMBER_MCP_TOOL.CREATE_SECTION]: [taskSections.write],
  [MEMBER_MCP_TOOL.DELETE_SECTION]: [taskSections.write],
  [MEMBER_MCP_TOOL.START_AGENT]: [agents.start, agents.startFrom, plans.create],
  [MEMBER_MCP_TOOL.MESSAGE_AGENT]: [messages.send],
  [MEMBER_MCP_TOOL.STOP_AGENT]: [agents.stop],
  [MEMBER_MCP_TOOL.UPDATE_AGENT]: [agents.change],
  [MEMBER_MCP_TOOL.READ_INBOX]: [inbox.account, inbox.task, inbox.agent],
  [MEMBER_MCP_TOOL.ANSWER_ASK]: [inbox.message],
  [MEMBER_MCP_TOOL.REPLY_TO_THREAD]: [inbox.message],
  [MEMBER_MCP_TOOL.CLOSE_THREAD]: [inbox.close],
  [MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION]: [agentPullRequests.action],
  [MEMBER_MCP_TOOL.READ_COMMENTS]: [descriptionComments.read],
  [MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION]: [plans.open, descriptionComments.start],
  [MEMBER_MCP_TOOL.REPLY_TO_COMMENT]: [descriptionComments.act],
  [MEMBER_MCP_TOOL.UPDATE_COMMENT]: [descriptionComments.act],
  [MEMBER_MCP_TOOL.SEARCH_MEMORY]: [account.searchMemories],
  [MEMBER_MCP_TOOL.SAVE_MEMORY]: [account.saveMemory],
  [MEMBER_MCP_TOOL.FORGET_MEMORY]: [account.forgetMemory],
  [MEMBER_MCP_TOOL.LIST_AUTOMATIONS]: [automations.list, automations.read, automations.runs],
  [MEMBER_MCP_TOOL.CREATE_AUTOMATION]: [automations.create],
  [MEMBER_MCP_TOOL.UPDATE_AUTOMATION]: [automations.read, automations.change],
  [MEMBER_MCP_TOOL.RUN_AUTOMATION]: [automations.run],
  [MEMBER_MCP_TOOL.DELETE_AUTOMATION]: [automations.remove],
} as const satisfies Record<MemberMcpToolName, readonly [HostedProcedure, ...HostedProcedure[]]>;
