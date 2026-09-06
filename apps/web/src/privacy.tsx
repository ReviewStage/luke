import { startSiteAnalytics } from "./analytics";
import { mountPrerenderedPage } from "./mount-page";
import { PrivacyPage } from "./PrivacyPage";
import "./styles.css";

// Every page the site builds, not only the landing one: a funnel that saw
// the landing page alone would undercount everyone who arrived by a link.
startSiteAnalytics();

mountPrerenderedPage(<PrivacyPage />);
