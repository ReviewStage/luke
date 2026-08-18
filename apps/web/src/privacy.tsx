import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivacyPage } from "./PrivacyPage";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <PrivacyPage />
  </StrictMode>,
);
