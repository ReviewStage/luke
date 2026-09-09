import { startSiteAnalytics } from "./analytics";
import { mountPrerenderedPage } from "./mount-page";
import { PrivacyPage } from "./PrivacyPage";
import "./styles.css";

startSiteAnalytics();

mountPrerenderedPage(<PrivacyPage />);
