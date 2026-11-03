/**
 * slack-markdown.ts -- an agent's words as Slack draws Markdown, in a `markdown` block, and a plain line as a `mrkdwn` field reads it literally.
 */

import { mentionLinksIn, mentionName } from "@repo/features/mention-link";
import type { SlackBlock } from "./slack-bot.js";

/** Slack's bound on the text of every `markdown` block in one message together; each message holds one. */
const SLACK_MARKDOWN_CHARS = 12_000;

/** What the cut end of words too long for Slack says; the message's link reads the rest. */
const CUT_MARK = "…";

/** A target Slack opens as a link; an app-only one, a date's among them, leads nowhere there. */
const WEB_LINK = /^https?:\/\//iu;

/** Text as Slack reads it literally in a `mrkdwn` field: its three control characters escaped. */
export function slackEscaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The words cut to the bound, the cut mark where they ran past it. */
export function slackClipped(words: string, bound: number): string {
  return words.length <= bound ? words : `${words.slice(0, bound - CUT_MARK.length)}${CUT_MARK}`;
}

/** The words with each mention chip written as a plain link without its `@`, or its name alone where its target is no web address. */
function withPlainMentions(markdown: string): string {
  let out = "";
  let at = 0;
  for (const link of mentionLinksIn(markdown)) {
    // Note that the link is kept as written but for its `@`, so a label's escapes still hold.
    const written = WEB_LINK.test(link.target)
      ? `[${markdown.slice(link.start + 2, link.end)}`
      : mentionName(link.label);
    out += markdown.slice(at, link.start) + written;
    at = link.end;
  }
  return out + markdown.slice(at);
}

/** An agent's Markdown as one `markdown` block, which Slack draws as standard Markdown, clipped to Slack's bound. */
export function slackMarkdownBlock(markdown: string): SlackBlock {
  return {
    type: "markdown",
    text: slackClipped(withPlainMentions(markdown), SLACK_MARKDOWN_CHARS),
  };
}
