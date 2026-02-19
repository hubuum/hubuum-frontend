"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ApiErrorResponse, LoginUser } from "@/lib/api/generated/models";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitLogin() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload: LoginUser = { username, password };
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = "Login failed";
        try {
          const errorPayload = (await response.json()) as ApiErrorResponse;
          message = errorPayload.message ?? message;
        } catch {
          // Keep default message.
        }
        throw new Error(message);
      }

      router.push("/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error");
      setIsSubmitting(false);
    }
  }

  return (
    <form
      action="/api/auth/login"
      aria-label="Login form"
      className="card login-card"
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        void submitLogin();
      }}
    >
      <h1>Welcome back</h1>
      <p className="muted">Sign in with your Hubuum credentials.</p>

      <label htmlFor="username">Username</label>
      <input
        id="username"
        name="username"
        type="text"
        autoComplete="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        required
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
