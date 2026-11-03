/**
 * slack-mrkdwn.ts -- Markdown an agent wrote, as Slack's mrkdwn draws it, for what our Slack bot posts of an agent's words.
 */

/** Markdown's code, fenced or inline, which mrkdwn writes as Markdown does, so nothing inside it is converted. */
const MARKDOWN_CODE = /(```[\s\S]*?```|`[^`\n]*`)/u;

/** Marks a bold run while italics are converted, since both end as asterisks. */
const BOLD_MARK = "\u0000";

/** Text as Slack reads it literally: its three control characters escaped. */
export function slackEscaped(text: string): string {
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
export function slackMrkdwn(markdown: string): string {
  // Note that a split on a capturing pattern leaves the code at the odd places.
  return markdown
    .split(MARKDOWN_CODE)
    .map((part, index) => (index % 2 === 1 ? slackEscaped(part) : proseMrkdwn(part)))
    .join("");
}
