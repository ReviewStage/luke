/**
 * release-meta.ts -- the deployment's commit written into the web app's page, which a tab left open across a release reads to know it is stale.
 *
 * The app's page (`app.html`) is what every Luke link serves, so the copy a
 * deployment serves names the release it runs: a `<meta>` holding Vercel's
 * `VERCEL_GIT_COMMIT_SHA`, the commit the tab's own build carries as its
 * release (`vite.config.ts`'s defines). A tab compares the two as it comes
 * back to the front (`src/app/stale-release.ts`). The commit is the
 * repository's public history and says nothing of anyone's account; a build
 * that names none, a development server's among them, writes nothing, and
 * no other page carries it.
 */

import type { HtmlTagDescriptor, Plugin } from "vite";
import { RELEASE_META } from "./release-meta-name";

/** The page the release is written into: the app's, by its file's name. */
const APP_PAGE = "app.html";

/** The tags written into the page built from `filename`: the release's `<meta>` on the app's page, where the build names one. */
export function releaseTags(release: string, filename: string): HtmlTagDescriptor[] {
  if (release === "" || !filename.endsWith(`/${APP_PAGE}`)) return [];
  return [{ tag: "meta", attrs: { name: RELEASE_META, content: release }, injectTo: "head" }];
}

/** Writes `release` into the app's page as its `<meta>`. */
export function releaseMeta(release: string): Plugin {
  return {
    name: "luke-release-meta",
    transformIndexHtml: (_html, context) => releaseTags(release, context.filename),
  };
}
