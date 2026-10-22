/**
 * main.tsx -- the web app's entry, loaded by `app.html`: the panel's stylesheet, and the panel drawn into the page's root.
 */

import "./app.css";
import { mountWebApp } from "./web-root";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The app's root element is missing");
void mountWebApp(rootElement);
