import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "./i18n";
import "./index.css";
import { ThemeProvider } from "@/lib/theme";
import { ViewAsProvider } from "@/lib/viewAs";
import { LiveBackendProvider } from "@/lib/liveBackend";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Root element "#root" not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <ViewAsProvider>
        <LiveBackendProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LiveBackendProvider>
      </ViewAsProvider>
    </ThemeProvider>
  </StrictMode>,
);
