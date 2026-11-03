/**
 * automation-slack-delivery.ts -- an automation run's result sent to its owner on Slack by the workspace's own bot, once its agent's turn settles.
 *
 * An automation that delivers to Slack (`automation.slack_delivery`) has
 * each run's result sent to its owner from the workspace's bot
 * (`../slack/slack-bot.ts`), so the run's agent needs no Slack write of its
 * own, which matters for one that reads untrusted input. An agent's one
 * turn is its whole run, so the store writer's settle of that turn
 * (`SettledTurnListener`, `../agents/coder-host/settled-turns.ts`) is the
 * run's end: a finished run sends the agent's final message, converted from
 * Markdown to Slack's mrkdwn, a failed one that it failed and why, and a
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
import { SlackBot, type SlackMessageContent } from "../slack/slack-bot.js";

/** The most characters of the final message a Slack section holds, inside Slack's own bound of 3000 with room for the escapes. */
const RESULT_CHARS = 2500;

/** What the cut end of a long final message says; the link reads the rest. */
const CUT_MARK = "…";

/** Markdown's code, fenced or inline, which mrkdwn writes as Markdown does, so nothing inside it is converted. */
const MARKDOWN_CODE = /(```[\s\S]*?```|`[^`\n]*`)/u;

/** Marks a bold run while italics are converted, since both end as asterisks. */
const BOLD_MARK = "\u0000";

/** Text as Slack reads it literally: its three control characters escaped. */
function slackEscaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Prose outside code, from Markdown to mrkdwn: links, emphasis, strikes, headings, bullets, and quotes. */
function proseMrkdwn(prose: string): string {
  return (
    slackEscaped(prose)
      // A link, an image, or a mention chip; a chip's label drops its @, which Slack would not read as ours.
      .replace(
        /!?\[([^\]\n]*)\]\(([^)\s]+)\)/gu,
        (_, label: string, url: string) => `<${url}|${label.replace(/^@/u, "") || url}>`,
      )
      .replace(/^(\s*)[-*+]\s+/gmu, "$1• ")
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/gu, `${BOLD_MARK}$2${BOLD_MARK}`)
      .replace(/(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/gu, "_$1_")
      .replace(
        /^#{1,6}\s+(.+)$/gmu,
        (_, heading: string) => `${BOLD_MARK}${heading.replaceAll(BOLD_MARK, "")}${BOLD_MARK}`,
      )
      .replaceAll(BOLD_MARK, "*")
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/gu, "~$1~")
      // A quote's mark is the one control character mrkdwn reads unescaped, at a line's start.
      .replace(/^&gt; /gmu, "> ")
  );
}

/** Markdown as Slack's mrkdwn writes it, code kept as written but for Slack's escapes. */
function slackMrkdwn(markdown: string): string {
  // Note that a split on a capturing pattern leaves the code at the odd places.
  return markdown
    .split(MARKDOWN_CODE)
    .map((part, index) => (index % 2 === 1 ? slackEscaped(part) : proseMrkdwn(part)))
    .join("");
}

/** The final message, cut to what one section holds. */
function cut(words: string): string {
  return words.length > RESULT_CHARS
    ? `${words.slice(0, RESULT_CHARS - CUT_MARK.length)}${CUT_MARK}`
    : words;
}

/** What the message says of the run: its final message where it finished, that it failed and why, or that it was stopped. */
function outcomeOf(
  turn: SettledAgentTurn,
  words: string | undefined,
): { readonly plain: string; readonly mrkdwn: string } {
  if (turn.status === TURN_STATUS.FAILED) {
    const plain = turn.failure === null ? "Run failed." : `Run failed: ${turn.failure}.`;
    return { plain, mrkdwn: slackEscaped(plain) };
  }
  if (turn.status === TURN_STATUS.CANCELLED) {
    return { plain: "Run stopped.", mrkdwn: "Run stopped." };
  }
  if (words === undefined) return { plain: "Run finished.", mrkdwn: "Run finished." };
  return { plain: cut(words), mrkdwn: slackMrkdwn(cut(words)) };
}

/** The message: the automation's name over the run's outcome, and a link to the agent. */
function deliveryContent(
  automationName: string,
  link: string,
  outcome: { readonly plain: string; readonly mrkdwn: string },
): SlackMessageContent {
  return {
    text: `${automationName}: ${outcome.plain}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${slackEscaped(automationName)}*\n${outcome.mrkdwn}` },
      },
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
