import { useEffect, useState } from "react";
import { getMe } from "./api/client";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";
import { clearSessionScrollPositions } from "./components/scroll-restoration";
import { useAppearanceSettings } from "./components/settings/useAppearanceSettings";
import { Toaster } from "./components/ui/sonner";

type AuthStatus = "checking" | "anonymous" | "authenticated";

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const appearance = useAppearanceSettings();

  useEffect(() => {
    let active = true;

    getMe()
      .then(() => {
        if (active) {
          setAuthStatus("authenticated");
        }
      })
      .catch(() => {
        if (active) {
          setAuthStatus("anonymous");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (authStatus === "checking") {
    return (
      <main className="boot-screen">
        <div className="boot-mark" />
      </main>
    );
  }

  if (authStatus === "anonymous") {
    return (
      <LoginScreen
        onAuthenticated={() => {
          clearSessionScrollPositions();
          setAuthStatus("authenticated");
        }}
      />
    );
  }

  return (
    <>
      <AppShell
        appearance={appearance}
        onLogout={() => setAuthStatus("anonymous")}
      />
      <Toaster
        closeButton
        position="top-center"
        theme={appearance.theme}
      />
    </>
  );
}
