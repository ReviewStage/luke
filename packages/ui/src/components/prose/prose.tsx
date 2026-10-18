/**
 * prose.tsx -- a generated document drawn as the site reads one: Markdown a
 * page parsed at build time, handed over as its HTML.
 *
 * The markup is generated, so there is no call site to write a class on: the
 * document's typography is drawn from its root, the rules the window's own
 * Markdown shares (`PROSE_CLASS`) under the site's document rhythm. The HTML
 * is the caller's to vouch for, as it is wherever it was parsed; nothing a
 * visitor wrote reaches it.
 *
 * Where a root is drawn by something no component can stand around, an
 * editor engine's own element or a rendered tree whose root its place's
 * rules reach as a child, that root wears `PROSE_CLASS` itself.
 */

/** The class the shared prose rules are drawn from, for a root no component can wrap. */
export const PROSE_CLASS = "luke-prose";

/** A generated document's HTML, in the site's document type and rhythm. */
export function Prose({ html }: { html: string }): React.JSX.Element {
  return (
    <div
      className={`${PROSE_CLASS} luke-prose-document`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
