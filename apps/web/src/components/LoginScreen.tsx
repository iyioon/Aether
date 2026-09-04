import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { ApiError, login } from "../api/client";

interface LoginScreenProps {
  onAuthenticated: () => void;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(password);
      onAuthenticated();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "password_not_configured") {
        setError("Password is not configured on this server.");
      } else if (
        caught instanceof ApiError &&
        caught.code === "too_many_login_attempts"
      ) {
        setError("Too many attempts. Try again later.");
      } else {
        setError("The password was not accepted.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-mark" aria-hidden="true">
          <LockKeyhole size={22} />
        </div>
        <div>
          <h1>Aether</h1>
          <p>Where memories gather, preserved beyond time.</p>
        </div>
        <label className="field">
          <span>Password</span>
          <input
            autoFocus
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-action" disabled={isSubmitting || !password}>
          {isSubmitting ? "Opening..." : "Enter"}
        </button>
      </form>
    </main>
  );
}
