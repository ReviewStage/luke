import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startSiteAnalytics } from "./analytics";
import { PrivacyPage } from "./PrivacyPage";
import "./styles.css";

// Every page the site builds, not only the landing one: a funnel that saw
// the landing page alone would undercount everyone who arrived by a link.
startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <PrivacyPage />
  </StrictMode>,
);
