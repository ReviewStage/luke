/**
 * automation-slack-delivery.ts -- an automation run's result sent to its owner on Slack by the workspace's own bot, once its agent's turn settles.
 *
 * An automation that delivers to Slack (`automation.slack_delivery`) has
 * each run's result sent to its owner from the workspace's bot
 * (`../slack/slack-bot.ts`), so the run's agent needs no Slack write of its
 * own, which matters for one that reads untrusted input. An agent's one
 * turn is its whole run, so the store writer's settle of that turn
 * (`SettledTurnListener`, `../agents/coder-host/settled-turns.ts`) is the
 * run's end: a finished run sends the agent's final message in a `markdown`
 * block, which Slack draws as standard Markdown, a failed one that it failed and why, and a
 * stopped one that it was stopped, each with a link to the agent.
 *
 * The run is claimed before anything is sent
 * (`@repo/database/models/automation-store`'s `claimRunSlackDelivery`), so a
 * run sends once however often its agent's turns settle or a settle is
 * heard; a send Slack refused is logged by the bot and not tried again.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentOfConversation } from "@repo/database/models/agent-store";
import { claimRunSlackDelivery } from "@repo/database/models/automation-store";
import { readMessageByClientId } from "@repo/database/models/message-reads";
import type { SettledAgentTurn } from "@repo/database/models/writer";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { causeKind } from "@repo/runtime/effect";
import { TURN_STATUS } from "@repo/wire";
import { Effect, Option } from "effect";
import { lastSaid } from "../agents/coder-host/starter-report.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { workspaceStepOf } from "../agents/written-mentions.js";
import { type SlackBlock, SlackBot, type SlackMessageContent } from "../slack/slack-bot.js";
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

/** The message: the automation's name over the run's outcome, the agent's words as Markdown, and a link to the agent. */
function deliveryContent(
  automationName: string,
  link: string,
  outcome: { readonly plain: string; readonly words?: string },
): SlackMessageContent {
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

/**
 * Sends the settled turn's run result to its automation's owner, as the
 * header says, or nothing where the turn is no automation run's that
 * delivers to Slack; a failure is logged by its kind alone, never answered,
 * so nothing of the run rides the log line.
 */
export function deliverRunToSlack(
  turn: SettledAgentTurn,
): Effect.Effect<void, never, DatabaseServices | SlackBot> {
  return Effect.gen(function* () {
    const bot = yield* SlackBot;
    if (!bot.configured) return;
    const agent = yield* readAgentOfConversation(turn.userId, turn.conversationId);
    if (Option.isNone(agent)) return;
    const run = yield* claimRunSlackDelivery(agent.value.id);
    if (Option.isNone(run)) return;
    const journal = yield* readMessageByClientId(
      turn.userId,
      turn.conversationId,
      CODER_TOOL_SET,
      turn.turnId,
    );
    const [newest] = journal.ok ? journal.value : [];
    const words = newest === undefined ? undefined : lastSaid(newest.message);
    const { userId, organizationId, automationName } = run.value;
    const step = yield* workspaceStepOf(userId, organizationId);
    const link = linkOf({ kind: LINK_PLACE.AGENT, agentId: agent.value.id }, step);
    yield* bot.dm(
      organizationId,
      userId,
      deliveryContent(automationName, link, outcomeOf(turn, words)),
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("an automation run's result was not sent on Slack", {
        failure: causeKind(cause),
      }),
    ),
  );
}
