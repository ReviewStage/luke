import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminDashboard } from "./AdminDashboard";
import { followAppTheme } from "./admin/admin-appearance";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

// The admin wears the theme the app keeps, for as long as the page is open.
followAppTheme();

createRoot(rootElement).render(
  <StrictMode>
    <AdminDashboard />
  </StrictMode>,
);
