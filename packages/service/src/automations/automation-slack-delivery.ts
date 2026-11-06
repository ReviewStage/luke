import type { SettledAgentTurn } from "@repo/database/models/writer";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TURN_STATUS } from "@repo/wire";
import type { SlackBlock, SlackMessageContent } from "../slack/slack-bot.js";
import { slackClipped, slackEscaped, slackMarkdownBlock } from "../slack/slack-markdown.js";

const NOTIFICATION_CHARS = 2500;

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
