import { Schema as EffectSchema, Option } from "effect";
import { PLAN_SECTION_BOUNDS } from "./plan-wire.js";

/**
 * mention-link.ts -- a mention as what it names, and the link it is written into words as: the one module that knows the link's form.
 *
 * A mention is written into a message's or a plan's markdown as a link
 * whose label starts with `@` (`[@Rollout](<target>)`), so the words stay
 * one string that reads as plain markdown anywhere chips are not drawn,
 * and the `@` is what marks the link as a mention rather than a link.
 * What the target looks like is decided here and nowhere else: every
 * caller holds a `Mention`, which names its subject and nothing of the
 * form, and goes through `encodeMention` and `decodeMention` to write and
 * read one. The form is provisional until the link format is settled
 * (`docs/proposals/at-mentions.md`, "Pending: the link format"); changing
 * it changes this file and its tests alone.
 *
 * A plan is named by its id, and one of its sections by the plan and the
 * heading's own words, as the plan's sections are known by their headings
 * everywhere else (`planSections`): a mention of a heading two sections
 * share names the first, and one of a heading since renamed or deleted
 * names nothing, which its reader says.
 */

export const MENTION_KIND = {
  PLAN: "plan",
  SECTION: "section",
} as const;

const MENTION_BOUNDS = {
  /** The most characters a mention's target may spell: a plan's id and a heading at its bound, encoded, and then some. */
  MAX_TARGET_CHARS: 4_000,
  /** The most characters a plan's id may spell; the service mints them far shorter. */
  MAX_PLAN_ID_CHARS: 200,
} as const;

/** What marks a link's label as a mention's. */
const MENTION_SIGIL = "@";

/** The provisional form: `luke://plan/<planId>`, and `#<heading>` after it for a section, each percent-encoded. */
const LINK = {
  PROTOCOL: "luke:",
  PLAN_HOST: "plan",
} as const;

/** The characters a markdown link's label must escape to stay one label. */
const LABEL_SPECIAL = /[[\]\\]/gu;

/** The characters `encodeURIComponent` leaves that would end or break a markdown link's target. */
const TARGET_SPECIAL = /[()!'*]/gu;

const planIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_PLAN_ID_CHARS),
);

const mentionSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PLAN),
    planId: planIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.SECTION),
    planId: planIdSchema,
    heading: EffectSchema.String.check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS),
    ),
  }),
]);

export type Mention = typeof mentionSchema.Type;

const readMention = EffectSchema.decodeUnknownOption(mentionSchema);

/** A part of a target percent-encoded, parentheses included, so the target stays one in a markdown link. */
function encodedPart(part: string): string {
  return encodeURIComponent(part).replace(
    TARGET_SPECIAL,
    (special) => `%${special.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A percent-encoded part read back, or nothing where its encoding is broken. */
function decodedPart(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/** The fields a target spells, for the schema to read; nothing where it is no target of this form. */
function fieldsOf(target: string) {
  const url = URL.parse(target);
  if (url === null || url.protocol !== LINK.PROTOCOL || url.host !== LINK.PLAN_HOST) {
    return undefined;
  }
  const planId = decodedPart(url.pathname.replace(/^\//u, ""));
  if (url.hash === "") return { kind: MENTION_KIND.PLAN, planId };
  return { kind: MENTION_KIND.SECTION, planId, heading: decodedPart(url.hash.slice(1)) };
}

/** The target a mention is written with. */
export function encodeMention(mention: Mention): string {
  const plan = `${LINK.PROTOCOL}//${LINK.PLAN_HOST}/${encodedPart(mention.planId)}`;
  if (mention.kind === MENTION_KIND.PLAN) return plan;
  return `${plan}#${encodedPart(mention.heading)}`;
}

/** The mention a link's target names; nothing where it names none, or is no target of a mention. */
export function decodeMention(target: string): Mention | undefined {
  if (target.length > MENTION_BOUNDS.MAX_TARGET_CHARS) return undefined;
  return Option.getOrUndefined(readMention(fieldsOf(target)));
}

/** Whether a link's label is a mention's: it starts with `@`. */
export function isMentionLabel(label: string): boolean {
  return label.startsWith(MENTION_SIGIL) && label.length > MENTION_SIGIL.length;
}

/** A mention's label without its `@`, as its chip says it. */
export function mentionName(label: string): string {
  return isMentionLabel(label) ? label.slice(MENTION_SIGIL.length) : label;
}

/** The mention written into markdown as a link: `[@label](target)`, its label's brackets and backslashes escaped. */
export function mentionMarkdown(mention: Mention, name: string): string {
  const label = `${MENTION_SIGIL}${name}`.replace(LABEL_SPECIAL, (special) => `\\${special}`);
  return `[${label}](${encodeMention(mention)})`;
}
