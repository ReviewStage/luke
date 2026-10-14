import { startSiteAnalytics } from "./analytics";
import { ChangelogPage, RELEASES } from "./ChangelogPage";
import { CHANGELOG_PATH, changelogViewForPath } from "./changelog-releases";
import { mountPrerenderedPage } from "./mount-page";
import "./styles.css";

startSiteAnalytics();

/* Every changelog address is served from a file the prerender wrote for it,
   so the address names the view that file holds; hydration must draw the
   same one. An address it has no view for only reaches here from the dev
   server, which serves the source page wherever it is asked. */
const view =
  changelogViewForPath(RELEASES, window.location.pathname) ??
  changelogViewForPath(RELEASES, CHANGELOG_PATH);

if (view === undefined) throw new Error("The changelog has no first page");

mountPrerenderedPage(<ChangelogPage view={view} />);
