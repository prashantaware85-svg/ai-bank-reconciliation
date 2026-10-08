"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";

interface AuthResponse {
  user: { id: string; name: string; email: string };
  accessToken: string;
  refreshToken: string;
}

const box: React.CSSProperties = {
  maxWidth: 400,
  margin: "80px auto",
  padding: 24,
  border: "1px solid #ddd",
  borderRadius: 8,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: 8,
  margin: "8px 0",
  boxSizing: "border-box",
};
const button: React.CSSProperties = {
  width: "100%",
  padding: 10,
  marginTop: 12,
  cursor: "pointer",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost<AuthResponse>("/auth/login", {
        email,
        password,
      });
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={box}>
      <h1>Login</h1>
      <form onSubmit={onSubmit}>
        <input
          style={input}
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          style={input}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error ? <ApiErrorNotice error={error} /> : null}
        <button style={button} type="submit" disabled={loading}>
          {loading ? "Logging in…" : "Login"}
        </button>
      </form>
      <p>
        No account? <a href="/register">Register</a>
      </p>
    </main>
  );
}
