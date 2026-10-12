/**
 * workspace-slug.ts -- the slug a new workspace is created under, from the name typed for it.
 *
 * Better Auth's organization plugin keeps `organization.slug` unique across
 * the whole service, not per account, so two teams that both call themselves
 * "Acme" would refuse each other on a slug drawn from the name alone. The
 * slug is the name made address-safe with a short random tail; nothing in
 * Luke reads it back, since every call names a workspace by id.
 */

/** The longest stretch of the name a slug keeps, before its tail. */
const SLUG_NAME_LIMIT = 40;

/** The stem a name with nothing address-safe in it falls back to. */
const SLUG_FALLBACK = "workspace";

/** The random tail's length, in base-36 characters. */
const SLUG_TAIL_LENGTH = 6;

const COMBINING_MARKS = /\p{M}+/gu;
const UNSAFE_RUNS = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

/** A fresh random tail: lowercase letters and digits from the browser's own generator. */
export function slugTail(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_TAIL_LENGTH));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

/**
 * The slug for a workspace named `name`: diacritics dropped, lowercased, every
 * run of anything else one dash, cut to a bounded stem, and `tail` appended.
 * Note that the tail is what keeps the slug clear of `personal-<account id>`,
 * the one slug shape the server reserves for itself.
 */
export function workspaceSlug(name: string, tail: string): string {
  const stem = name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(UNSAFE_RUNS, "-")
    .replace(EDGE_DASHES, "")
    .slice(0, SLUG_NAME_LIMIT)
    .replace(EDGE_DASHES, "");
  return `${stem || SLUG_FALLBACK}-${tail}`;
}
