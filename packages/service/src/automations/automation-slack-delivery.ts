/**
 * automation-slack-delivery.ts -- what an automation run's result says when it is sent to its owner on Slack by the workspace's own bot.
 *
 * An automation that delivers to Slack (`automation.slack_delivery`) has
 * each run's result sent to its owner from the workspace's bot
 * (`../slack/slack-bot.ts`), so the run's agent needs no Slack write of its
 * own, which matters for one that reads untrusted input. The settle of the
 * run's turn posts it, on the one path every turn bound for Slack takes
 * (`../slack/slack-agent-starts.ts`'s `postTurnToSlack`), which claims the
 * run, writes the DM, and keeps its thread as the agent's. This says the
 * DM: a finished run's final message in a `markdown` block, which Slack
 * draws as standard Markdown, a failed one that it failed and why, and a
 * stopped one that it was stopped, each with a link to the agent.
 */

import type { SettledAgentTurn } from "@repo/database/models/writer";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TURN_STATUS } from "@repo/wire";
import type { SlackBlock, SlackMessageContent } from "../slack/slack-bot.js";
import { slackClipped, slackEscaped, slackMarkdownBlock } from "../slack/slack-markdown.js";

/** The most characters of the final message the notification's plain text says; the blocks hold more. */
const NOTIFICATION_CHARS = 2500;

/** What the message says of the run: its final message where it finished, that it failed and why, or that it was stopped. */
function outcomeOf(
  turn: SettledAgentTurn,
  words: string | undefined,
): { readonly plain: string; readonly words?: string } {
  if (turn.status === TURN_STATUS.FAILED) {
    return { plain: turn.failure === null ? "Run failed." : `Run failed: ${turn.failure}.` };
  }
  if (turn.status === TURN_STATUS.CANCELED) return { plain: "Run stopped." };
  if (words === undefined) return { plain: "Run finished." };
  return { plain: slackClipped(words, NOTIFICATION_CHARS), words };
}

/**
 * The run's result as its owner's DM says it: the automation's name over
 * the run's outcome, the agent's final message as Markdown where it
 * finished, and a link to the agent.
 */
export function runResultContent(
  automationName: string,
  link: string,
  turn: SettledAgentTurn,
  words: string | undefined,
): SlackMessageContent {
  const outcome = outcomeOf(turn, words);
  const heading = `*${slackEscaped(automationName)}*`;
  const said: SlackBlock[] =
    outcome.words === undefined
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: `${heading}\n${slackEscaped(outcome.plain)}` },
          },
        ]
      : [
          { type: "section", text: { type: "mrkdwn", text: heading } },
          slackMarkdownBlock(outcome.words),
        ];
  return {
    text: `${automationName}: ${outcome.plain}`,
    blocks: [
      ...said,
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `<${link}|Open in ${PRODUCT_NAME}>` }],
      },
    ],
  };
}
