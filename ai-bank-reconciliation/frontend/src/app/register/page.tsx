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

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost<AuthResponse>("/auth/register", {
        name,
        email,
        password,
      });
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={box}>
      <h1>Register</h1>
      <form onSubmit={onSubmit}>
        <input
          style={input}
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <input
          style={input}
          type="password"
          placeholder="Confirm Password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error ? <ApiErrorNotice error={error} /> : null}
        <button style={button} type="submit" disabled={loading}>
          {loading ? "Registering…" : "Register"}
        </button>
      </form>
      <p>
        Have an account? <a href="/login">Login</a>
      </p>
    </main>
  );
}
