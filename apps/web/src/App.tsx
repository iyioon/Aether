import { useEffect, useState } from "react";
import { getMe } from "./api/client";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";

type AuthStatus = "checking" | "anonymous" | "authenticated";

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");

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
    return <LoginScreen onAuthenticated={() => setAuthStatus("authenticated")} />;
  }

  return <AppShell onLogout={() => setAuthStatus("anonymous")} />;
}
