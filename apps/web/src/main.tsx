import { App } from "./App";
import { startSiteAnalytics } from "./analytics";
import { mountPrerenderedPage } from "./mount-page";
import "./styles.css";

startSiteAnalytics();

mountPrerenderedPage(<App />);
