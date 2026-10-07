import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { mockRequested } from "./mock/flag.js";
import "./styles/global.css";

async function boot() {
  let DevPanel: ComponentType | undefined;
  if (mockRequested()) {
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
