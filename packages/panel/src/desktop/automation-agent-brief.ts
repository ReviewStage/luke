/**
 * automation-agent-brief.ts -- what the Automations page's Create with an agent hands the agent it starts: a fixed brief, then the member's own words fenced as their request.
 *
 * The brief is the same for every request, written here rather than by a
 * model, so what the agent is told to do, and which automations tools it is
 * told to do it with, changes only with this file. The member's words follow
 * it whole, in a fence longer than any run of backticks they hold, so
 * nothing they wrote closes the fence and reads as the brief.
 */

import { fenceFor } from "../tasks/markdown-edits.js";

/** The brief every Create with an agent opens with, ahead of the request. */
const BRIEF = `# Create an automation

A member asked on the Automations page for an automation that does what their request below says. Make it for them:

1. Work out its trigger (a schedule, as a cron and a timezone, or a GitHub event; there is no webhook), the repositories its runs work in, its prompt, its model and effort, and the connections its runs need.
2. Decide what you can yourself. Ask the member in their inbox only for what you cannot, such as a choice their words leave open.
3. Read the workspace's automations with \`list_automations\`, so you make none that one already does, and check the automations tools can do what is needed. Where they cannot, say so rather than make something else.
4. Create it with \`create_automation\`.
5. Reply with what you made: its name, its trigger, and what each run does.`;

/** What leads the member's words in. */
const REQUEST_LEAD = "Their request, in their own words:";

/** The agent's first message for a request: the brief, then the request fenced, trimmed of the space around it. */
export function automationAgentBrief(request: string): string {
  const words = request.trim();
  const fence = fenceFor(words);
  return `${BRIEF}\n\n${REQUEST_LEAD}\n\n${fence}text\n${words}\n${fence}`;
}
