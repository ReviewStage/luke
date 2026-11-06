import "./app.css";
import { mountWebApp } from "./web-root";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The app's root element is missing");
void mountWebApp(rootElement);
