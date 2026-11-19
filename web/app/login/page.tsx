"use client";

import { useState } from "react";
import { api, ApiError } from "../lib/api";

export default function LoginPage() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api.login(user, password);
      window.location.href = "/";
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 380 }}>
      <header className="app">
        <h1>ORTEX</h1>
        <span className="badge">authorized lab use only</span>
      </header>
      <div className="card">
        <h2>Operator sign-in</h2>
        <form onSubmit={submit}>
          <label htmlFor="user">Operator</label>
          <input id="user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {err && <p className="err">{err}</p>}
          <div style={{ marginTop: 14 }}>
            <button disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
