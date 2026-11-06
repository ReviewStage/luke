import { startSiteAnalytics } from "./analytics";
import { ChangelogPage, RELEASES } from "./ChangelogPage";
import { CHANGELOG_PATH, changelogViewForPath } from "./changelog-releases";
import { mountPrerenderedPage } from "./mount-page";
import "./styles.css";

startSiteAnalytics();

const view =
  changelogViewForPath(RELEASES, window.location.pathname) ??
  changelogViewForPath(RELEASES, CHANGELOG_PATH);

if (view === undefined) throw new Error("The changelog has no first page");

mountPrerenderedPage(<ChangelogPage view={view} />);
