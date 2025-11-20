// frontend/src/components/AuthPage.tsx

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "../services/supabase";

type Mode = "signin" | "signup";
const DEMO = process.env.REACT_APP_DEMO_MODE === "true";

function DemoAuth() {
  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <h2 className="mt-0 text-2xl font-semibold">Demo mode</h2>
      <p className="mt-2 text-gray-700">No login required.</p>
      <p className="mt-4">
        <Link
          to="/managers"
          className="inline-flex items-center rounded-md bg-black px-4 py-2 text-white transition hover:opacity-90 active:scale-[0.98]"
        >
          Enter the demo
        </Link>
      </p>
    </div>
  );
}

function AuthPageReal() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState(""); // confirm-password

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const redirectTo = sp.get("redirect") || "/";

  const formReady =
    email.trim() !== "" &&
    pw.trim() !== "" &&
    (mode === "signin" || (pw2.trim() !== "" && pw === pw2));

  useEffect(() => {
    setErr(null);
    setMsg(null);
  }, [mode]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (!formReady) {
      setErr(
        mode === "signin"
          ? "Enter email & password."
          : "Fill all fields and make sure passwords match."
      );
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: pw,
        });
        if (error) throw error;
        navigate(redirectTo, { replace: true });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password: pw,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?email=${encodeURIComponent(
              email
            )}`,
          },
        });
        if (error) throw error;
        setMsg("Almost there! Check your inbox to confirm your email, then log in.");
        setMode("signin");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <h2 className="mt-0 text-2xl font-semibold">
        {mode === "signin" ? "Log in" : "Create account"}
      </h2>

      {/* mode toggle */}
      <div className="mt-3 inline-flex rounded-md border border-gray-300 p-1">
        <button
          type="button"
          onClick={() => setMode("signin")}
          disabled={mode === "signin"}
          className={[
            "px-4 py-2 text-sm rounded-md transition",
            mode === "signin"
              ? "bg-black text-white cursor-default"
              : "bg-white text-gray-900 hover:bg-gray-100 active:scale-[0.98]",
          ].join(" ")}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          disabled={mode === "signup"}
          className={[
            "ml-1 px-4 py-2 text-sm rounded-md transition",
            mode === "signup"
              ? "bg-black text-white cursor-default"
              : "bg-white text-gray-900 hover:bg-gray-100 active:scale-[0.98]",
          ].join(" ")}
        >
          Sign up
        </button>
      </div>

      {msg && <div className="mt-3 text-green-600">{msg}</div>}
      {err && <div className="mt-3 text-red-600">{err}</div>}

      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <label className="text-sm">
          <div className="mb-1">Email</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
          />
        </label>

        <label className="text-sm">
          <div className="mb-1">Password</div>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
          />
        </label>

        {mode === "signup" && (
          <label className="text-sm">
            <div className="mb-1">Confirm password</div>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy || !formReady}
          className={[
            "mt-1 inline-flex items-center justify-center rounded-md px-4 py-2 font-medium transition",
            "bg-black text-white hover:opacity-90 active:scale-[0.98]",
            (busy || !formReady) && "opacity-50 pointer-events-none",
          ].join(" ")}
        >
          {busy ? "Please wait…" : mode === "signin" ? "Log in" : "Sign up"}
        </button>

        {mode === "signin" && (
          <div className="mt-1 text-[13px] text-gray-700">
            Forgot your password?{" "}
            <Link to="/reset" className="text-blue-600 underline-offset-2 hover:underline">
              Reset it
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}

export default function AuthPage() {
  return DEMO ? <DemoAuth /> : <AuthPageReal />;
}
