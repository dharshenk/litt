import type { ComponentType } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toasts.js";
import { Home } from "./pages/Home.js";
import { RoomPage } from "./pages/RoomPage.js";

export function App({ DevPanel }: { DevPanel?: ComponentType }) {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="app">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/r/:code" element={<RoomPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {DevPanel && <DevPanel />}
      </ToastProvider>
    </BrowserRouter>
  );
}
