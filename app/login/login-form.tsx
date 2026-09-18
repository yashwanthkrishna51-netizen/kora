"use client";

import { useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";

/**
 * The sign-in form.
 *
 * Deliberately a plain controlled form rather than a Server Action: the
 * response sets an httpOnly cookie and we need to read the status code to
 * distinguish 401 from 423 (locked) and 429 (throttled), each of which the
 * person needs told apart. A lockout that reads "invalid password" sends
 * someone round in circles retrying a password that is actually correct.
 */

export function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Could not sign in. Please try again.");
        setPassword("");
        setBusy(false);
        return;
      }

      // The cookie is already set. A full navigation rather than a client push,
      // so the proxy re-evaluates and the app shell mounts with a session.
      window.location.assign(next);
    } catch {
      setError("Could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="username" className="k-label">
            Username
          </label>
          <input
            id="username"
            name="username"
            className="k-input"
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
        </div>

        <div>
          <label htmlFor="password" className="k-label">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              className="k-input pr-10"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              // Excluded from the tab order: it is a convenience, and sitting
              // between the password field and the submit button would make
              // keyboard sign-in take an extra keystroke every time.
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-k-mute-2 hover:text-k-mute"
            >
              {showPassword ? (
                <EyeOff size={16} strokeWidth={1.5} />
              ) : (
                <Eye size={16} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-k border border-k-line px-3 py-2.5 text-k-body leading-[1.5]"
            style={{
              background: "var(--k-tint-risk)",
              borderColor: "var(--k-fill-risk)",
              color: "var(--k-text-red)",
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          className="k-btn k-btn-primary k-btn-lg w-full"
          disabled={busy || !username || !password}
        >
          {busy ? (
            <>
              <LoaderCircle size={16} className="animate-spin" strokeWidth={2} />
              Signing in…
            </>
          ) : (
            "Sign In"
          )}
        </button>
      </div>

      <div className="my-5 flex items-center gap-2.5">
        <span className="h-px flex-1 bg-k-line" />
        <span className="text-k-label text-k-mute-2">OR</span>
        <span className="h-px flex-1 bg-k-line" />
      </div>

      {/* A plain link, deliberately: the flow is a server redirect, so there
          is nothing for JavaScript to do and it works with JS disabled. */}
      <a
        href="/api/auth/microsoft/start"
        className="k-btn k-btn-outline k-btn-lg w-full"
      >
        <MicrosoftMark />
        Sign in with Microsoft 365
      </a>
    </form>
  );
}

/** Microsoft's four-square mark. Fixed brand colours — not themed. */
function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
