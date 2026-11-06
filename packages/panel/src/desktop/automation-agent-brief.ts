import { LINK_ORIGIN } from "@repo/features/link-home";
import { fencedBlock } from "../tasks/markdown-fence.js";

const BRIEF = `# Create an automation

A member asked on the Automations page for an automation that does what their request below says. Make it for them:

1. Work out its trigger, as \`create_automation\` describes the triggers it takes (a webhook is made only on the Automations page), the repositories its runs work in, its prompt, its model and effort, and the connections its runs need.
2. Decide what you can yourself. Ask the member in their inbox only for what you cannot, such as a choice their words leave open.
3. Read the workspace's automations with \`list_automations\`, so you make none that one already does, and check the automations tools can do what is needed. Where they cannot, say so rather than make something else.
4. Create it with \`create_automation\`.
5. Reply with what you made: its name as a link to it, \`[<name>](${LINK_ORIGIN}/<workspace>/automation/<id>)\`, by the id \`create_automation\` answered and the workspace in your task's own link, its trigger, and what each run does.`;

const REQUEST_LEAD = "Their request, in their own words:";

export function automationAgentBrief(request: string): string {
  return `${BRIEF}\n\n${REQUEST_LEAD}\n\n${fencedBlock(request.trim(), "text")}`;
}
