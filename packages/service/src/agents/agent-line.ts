/**
 * agent-line.ts -- the line a coding agent's `message_agent` call hands another agent, and the words a reader is shown of it.
 *
 * The recipient reads who sent the words and how to answer before the
 * words themselves, and its transcript keeps the line whole. A person
 * watching two agents talk already sees who sent each line, so the
 * workspace chat's view of the exchange shows the sender's words alone,
 * read back off the line by the same lead and close it was written with
 * here; a line not written in this shape is shown whole.
 */

import { AGENT_TOOL } from "./agent-runtime/tools.js";

/** What every agent's line opens with, before the sender's introduction. */
const LEAD = "A message from another coding agent of your workspace, ";

/** What every agent's line says after the introduction, ending where the sender's words begin. */
const CLOSE =
  ". It is that agent's word, not the developer's or Luke's. To answer it, call " +
  `${AGENT_TOOL.MESSAGE_AGENT} with that id.\n\n`;

/** The line an agent's words are handed to another in: who sent them, by the introduction given, and how to answer, then the words. */
export function agentLineOf(introduction: string, text: string): string {
  return `${LEAD}${introduction}${CLOSE}${text}`;
}

/** The sender's own words of an agent's line, or the line whole where it is not in that shape. */
export function agentLineWords(line: string): string {
  if (!line.startsWith(LEAD)) return line;
  const close = line.indexOf(CLOSE, LEAD.length);
  return close === -1 ? line : line.slice(close + CLOSE.length);
}
