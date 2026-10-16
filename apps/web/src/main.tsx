import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles/global.css";
import { registerServiceWorker } from "./lib/register-service-worker";

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </TooltipProvider>
);
