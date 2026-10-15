import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OpenPage } from "./OpenPage";
import "./styles.css";

// open.tsx -- the entry of the page a Luke link lands on in a browser (`OpenPage.tsx`).

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <OpenPage />
  </StrictMode>,
);
