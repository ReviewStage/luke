import { startSiteAnalytics } from "./analytics";
import { ChangelogPage } from "./ChangelogPage";
import { mountPrerenderedPage } from "./mount-page";
import "./styles.css";

startSiteAnalytics();

mountPrerenderedPage(<ChangelogPage />);
