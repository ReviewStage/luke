import { PLAN_EMPTY_TEXT } from "@sidecar/hosted/plan-template";
import {
  MARKDOWN_MARK,
  type MarkdownEdit,
  type MarkdownMark,
  MarkdownMessage,
} from "../markdown-message";

/**
 * plan-rule.tsx -- one unit of the plan's body drawn as the document reads it, a rule as an item of a numbered list.
 *
 * The body holds each rule as the formatter writes it, `### Rule 2:` and the
 * statement over its examples, which is what Copy hands a coding agent and
 * what the chase types in. Drawn as written, every statement was a bold
 * heading. A rule is drawn instead as Linear or Notion draw a numbered list:
 * the number muted in a gutter, the statement in the body's own weight, and
 * its examples beneath it as a compact block, each Given, When, and Then on
 * its own line behind a muted label. The heading's words are the number
 * alone; the list markers a rule saved before the formatter dropped them
 * still carries behind it are left out, and so is the line saying a rule has
 * no examples, so a rule without examples draws nothing beneath it. The
 * edit the chase draws, or the marks a version draws, stand on the unit's
 * words and are carried over the cut, so the caret and a change land where
 * they did. Every other unit is drawn as its Markdown.
 */

/** What a rule's heading opens with, before its number. */
const RULE_PREFIX = "### Rule ";

/** A rule's heading: its number, which is empty for the moment the chase has erased one and not typed the next, then any list markers behind it. */
const RULE_HEADING = /^### Rule (\d*): (?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/u;

/** What a rule with no examples carries after its statement. */
const NO_EXAMPLES = `\n\n${PLAN_EMPTY_TEXT.NO_EXAMPLES}`;

/** A stretch of the unit's words. */
interface Span {
  readonly from: number;
  readonly to: number;
}

/** A rule unit as it is drawn: its number, the Markdown under it, and the edit carried onto that Markdown. */
interface RuleDrawn {
  readonly number: string;
  readonly words: string;
  readonly edit: MarkdownEdit | undefined;
}

function within(span: Span | undefined, at: number): boolean {
  return span !== undefined && span.from <= at && at < span.to;
}

/** An offset in the unit's words as an offset in the words drawn, held inside them. */
function shifted(at: number, cut: Span): number {
  return Math.min(Math.max(at, cut.from), cut.to) - cut.from;
}

/** A span of the unit's words as a span of the words drawn; nothing where none of it is drawn. */
function shiftedSpan<S extends Span>(span: S | undefined, cut: Span): S | undefined {
  if (span === undefined) return undefined;
  const from = shifted(span.from, cut);
  const to = shifted(span.to, cut);
  return from < to ? { ...span, from, to } : undefined;
}

function shiftedEdit(edit: MarkdownEdit | undefined, cut: Span): MarkdownEdit | undefined {
  if (edit === undefined) return undefined;
  const marks = (edit.marks ?? []).flatMap((mark: MarkdownMark) => {
    const span = shiftedSpan(mark, cut);
    return span === undefined ? [] : [span];
  });
  return {
    hidden: shiftedSpan(edit.hidden, cut),
    selection: shiftedSpan(edit.selection, cut),
    caret: edit.caret === undefined ? undefined : shifted(edit.caret, cut),
    marks,
  };
}

/**
 * The number as it reads now: its digits not yet typed or being erased left
 * out, and in a version, the number it was struck, since a rule renumbered
 * by one struck before it is not a change to the rule.
 */
function numberOf(words: string, digits: Span, edit: MarkdownEdit | undefined): string {
  let number = "";
  for (let at = digits.from; at < digits.to; at += 1) {
    const struck = (edit?.marks ?? []).some(
      (mark) => mark.kind === MARKDOWN_MARK.DELETED && within(mark, at),
    );
    if (!struck && !within(edit?.hidden, at)) number += words[at] ?? "";
  }
  return number;
}

/** A rule unit cut into its number and what is drawn under it; nothing for any other unit. */
function ruleDrawn(words: string, edit: MarkdownEdit | undefined): RuleDrawn | undefined {
  const heading = RULE_HEADING.exec(words);
  if (heading === null) return undefined;
  const digits = { from: RULE_PREFIX.length, to: RULE_PREFIX.length + (heading[1] ?? "").length };
  // The words drawn run past the heading and stop short of the placeholder.
  const end = words.endsWith(NO_EXAMPLES) ? words.length - NO_EXAMPLES.length : words.length;
  const cut = { from: heading[0].length, to: Math.max(heading[0].length, end) };
  return {
    number: numberOf(words, digits, edit),
    words: words.slice(cut.from, cut.to),
    edit: shiftedEdit(edit, cut),
  };
}

/**
 * One unit of the plan's body: a rule as an item of a numbered list, any
 * other unit as its Markdown. `className` is the unit's own, which a rule
 * wears on the item as a whole.
 */
export function PlanUnitWords({
  words,
  className,
  edit,
}: {
  words: string;
  className: string;
  edit: MarkdownEdit | undefined;
}): React.JSX.Element {
  const rule = ruleDrawn(words, edit);
  if (rule === undefined)
    return <MarkdownMessage words={words} className={className} edit={edit} />;
  return (
    <div className={`${className} plan-rule`}>
      <span className="plan-rule-number">{rule.number === "" ? "" : `${rule.number}.`}</span>
      <MarkdownMessage words={rule.words} className="plan-rule-body" edit={rule.edit} />
    </div>
  );
}
