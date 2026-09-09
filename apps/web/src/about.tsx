import { AboutPage } from "./AboutPage";
import { startSiteAnalytics } from "./analytics";
import { mountPrerenderedPage } from "./mount-page";
import "./styles.css";

startSiteAnalytics();

mountPrerenderedPage(<AboutPage />);
