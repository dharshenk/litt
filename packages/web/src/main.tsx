import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { mockRequested } from "./mock/flag.js";
import "./styles/global.css";

async function boot() {
  let DevPanel: ComponentType | undefined;
  // Production builds drop this branch (and the fake server chunk) unless built with VITE_MOCK=1.
  if ((import.meta.env.DEV || import.meta.env.VITE_MOCK === "1") && mockRequested()) {
    // Loaded on demand so the fake server never ships in the main bundle.
    const mock = await import("./mock/index.js");
    DevPanel = mock.installMock();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App DevPanel={DevPanel} />
    </StrictMode>,
  );
}

void boot();
