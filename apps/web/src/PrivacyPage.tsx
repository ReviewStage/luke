import { PublicPage, PublicSection } from "@luke/ui";
import { marked, Parser, type Token, type Tokens } from "marked";
import privacyMarkdown from "../../../PRIVACY.md?raw";
import { SITE_PAGE, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

/** One `##` section of the policy, its heading and body as HTML; the opening one has no heading. */
type PolicySection = { readonly title: string | null; readonly html: string };

/** The policy cut at its headings: the `#` title, and the sections under it. */
type Policy = { readonly title: string; readonly sections: readonly PolicySection[] };

/** Whether a token is a heading of the given depth. */
function isHeading(token: Token, depth: number): token is Tokens.Heading {
  return token.type === "heading" && token.depth === depth;
}

/** Whether a token draws anything, which blank lines between blocks do not. */
function said(token: Token): boolean {
  return token.type !== "space";
}

/**
 * Cut the document at its `#` and `##` headings, so the page draws the title
 * and each section itself and the generated markup is only what lies between.
 */
function policyOf(markdown: string): Policy {
  let title: string | null = null;
  const sections: { title: string | null; tokens: Token[] }[] = [{ title: null, tokens: [] }];
  for (const token of marked.lexer(markdown)) {
    if (isHeading(token, 1)) title = Parser.parseInline(token.tokens);
    else if (isHeading(token, 2))
      sections.push({ title: Parser.parseInline(token.tokens), tokens: [] });
    else sections.at(-1)?.tokens.push(token);
  }
  if (title === null) throw new Error("PRIVACY.md has no `#` title");
  return {
    title,
    sections: sections
      .filter((section) => section.title !== null || section.tokens.some(said))
      .map((section) => ({ title: section.title, html: Parser.parse(section.tokens) })),
  };
}

/** Generated inline markup, for a heading the page sets itself. */
function Inline({ html }: { html: string }): React.JSX.Element {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * PRIVACY.md at the repo root is the only place this text is written — it
 * makes claims about what the app does, and a copy pasted into JSX would
 * drift from it. Parsed once at module load since the document is fixed at
 * build time.
 */
const POLICY = policyOf(privacyMarkdown);

export function PrivacyPage(): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation current={{ page: SITE_PAGE.PRIVACY }} />}
      footer={<SiteFooterLinks current={{ page: SITE_PAGE.PRIVACY }} />}
      title={<Inline html={POLICY.title} />}
    >
      {POLICY.sections.map((section) => (
        <PublicSection
          key={section.title ?? ""}
          title={section.title === null ? undefined : <Inline html={section.title} />}
        >
          <div className="document" dangerouslySetInnerHTML={{ __html: section.html }} />
        </PublicSection>
      ))}
    </PublicPage>
  );
}
