import { createRoot } from "react-dom/client";
import { App } from "./app";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Renderer root element is missing");
createRoot(rootElement).render(<App />);
