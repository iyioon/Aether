import { useState, type FormEvent } from "react";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { ApiError, login } from "../api/client";
import { BrandMark } from "./BrandMark";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface LoginScreenProps {
  notice?: string | null;
  onAuthenticated: () => void;
}

export function LoginScreen({ notice, onAuthenticated }: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(password);
      onAuthenticated();
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.code === "password_not_configured"
      ) {
        setError("Password is not configured on this server.");
      } else if (
        caught instanceof ApiError &&
        caught.code === "too_many_login_attempts"
      ) {
        setError("Too many attempts. Try again later.");
      } else if (
        caught instanceof ApiError &&
        caught.code === "invalid_credentials"
      ) {
        setError("The password was not accepted.");
      } else {
        setError("Aether could not reach the server. Try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form
        className="w-full max-w-[390px]"
        aria-busy={isSubmitting}
        onSubmit={handleSubmit}
      >
        <Card>
          <CardHeader>
            <BrandMark className="login-brand-logo" />
            <h1 className="leading-none font-semibold">Aether</h1>
            <CardDescription>
              Where memories gather, preserved beyond time.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-5">
            <label className="sr-only" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              className="sr-only"
              readOnly
              tabIndex={-1}
              value="aether"
            />

            {notice && !error ? (
              <Alert id="login-notice">
                <CircleAlert />
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  className="pr-10"
                  disabled={isSubmitting}
                  type={isPasswordVisible ? "text" : "password"}
                  value={password}
                  aria-describedby={
                    error ? "login-error" : notice ? "login-notice" : undefined
                  }
                  aria-invalid={Boolean(error)}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) {
                      setError(null);
                    }
                  }}
                />
                <Button
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  aria-label={
                    isPasswordVisible ? "Hide password" : "Show password"
                  }
                  aria-pressed={isPasswordVisible}
                  disabled={isSubmitting}
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                >
                  {isPasswordVisible ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>

            {error ? (
              <Alert id="login-error" variant="destructive">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              className="w-full"
              disabled={isSubmitting || !password}
              size="lg"
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                  Opening...
                </>
              ) : (
                "Enter"
              )}
            </Button>
          </CardContent>
        </Card>
      </form>
    </main>
  );
}
