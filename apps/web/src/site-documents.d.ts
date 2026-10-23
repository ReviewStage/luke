/**
 * site-documents.d.ts -- the modules `scripts/site-markdown.ts` answers with the site's Markdown documents drawn at build time.
 */

declare module "virtual:luke/changelog-releases" {
  const releases: readonly import("./changelog-releases").Release[];
  export default releases;
}

declare module "virtual:luke/privacy-policy" {
  const policy: import("./site-markdown").Policy;
  export default policy;
}
