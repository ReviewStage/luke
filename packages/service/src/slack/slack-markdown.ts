import { mentionLinksIn, mentionName } from "@repo/features/mention-link";
import type { SlackBlock } from "./slack-bot.js";

const SLACK_MARKDOWN_CHARS = 12_000;

const CUT_MARK = "…";

const WEB_LINK = /^https?:\/\//iu;

export function slackEscaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function slackClipped(words: string, bound: number): string {
  return words.length <= bound ? words : `${words.slice(0, bound - CUT_MARK.length)}${CUT_MARK}`;
}

function withPlainMentions(markdown: string): string {
  let out = "";
  let at = 0;
  for (const link of mentionLinksIn(markdown)) {
    const written = WEB_LINK.test(link.target)
      ? `[${markdown.slice(link.start + 2, link.end)}`
      : mentionName(link.label);
    out += markdown.slice(at, link.start) + written;
    at = link.end;
  }
  return out + markdown.slice(at);
}

export function slackMarkdownBlock(markdown: string, bound = SLACK_MARKDOWN_CHARS): SlackBlock {
  return {
    type: "markdown",
    text: slackClipped(withPlainMentions(markdown), Math.min(bound, SLACK_MARKDOWN_CHARS)),
  };
}
