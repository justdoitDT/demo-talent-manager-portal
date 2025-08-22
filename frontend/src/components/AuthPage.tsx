// frontend/src/components/AuthPage.tsx

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';

type Mode = 'signin' | 'signup';
const DEMO = process.env.REACT_APP_DEMO_MODE === 'true';

function DemoAuth() {
  return (
    <div style={{ maxWidth: 420, margin: '60px auto', padding: 16 }}>
      <h2>Demo mode</h2>
      <p>No login required.</p>
      <p><Link className="btn" to="/managers">Enter the demo</Link></p>
    </div>
  );
}

function AuthPageReal() {
  const [mode, setMode] = useState<Mode>('signin');

  const [email, setEmail] = useState('');
  const [pw,   setPw]  = useState('');
  const [pw2,  setPw2] = useState(''); // confirm-password

  const [msg,  setMsg]  = useState<string | null>(null);
  const [err,  setErr]  = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sp] = useSearchParams();
  const navigate   = useNavigate();
  const redirectTo = sp.get('redirect') || '/';

  const formReady =
    email.trim() !== '' &&
    pw.trim()    !== '' &&
    (mode === 'signin' || (pw2.trim() !== '' && pw === pw2));

  useEffect(() => { setErr(null); setMsg(null); }, [mode]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null);

    if (!formReady) {
      setErr(
        mode === 'signin'
          ? 'Enter email & password.'
          : 'Fill all fields and make sure passwords match.',
      );
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        navigate(redirectTo, { replace: true });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password: pw,
          options: {
            emailRedirectTo:
              `${window.location.origin}/auth/callback?email=${encodeURIComponent(email)}`,
          },
        });
        if (error) throw error;
        setMsg('Almost there! Check your inbox to confirm your email, then log in.');
        setMode('signin');
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '60px auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>
        {mode === 'signin' ? 'Log in' : 'Create account'}
      </h2>

      <div style={{ marginBottom: 12 }}>
        <button
          className="btn"
          onClick={() => setMode('signin')}
          disabled={mode === 'signin'}
          style={{ marginRight: 8 }}
        >
          Log in
        </button>
        <button
          className="btn"
          onClick={() => setMode('signup')}
          disabled={mode === 'signup'}
        >
          Sign up
        </button>
      </div>

      {msg && <div style={{ color: 'green',   marginBottom: 10 }}>{msg}</div>}
      {err && <div style={{ color: 'crimson', marginBottom: 10 }}>{err}</div>}

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
        <label>
          <div>Email</div>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
            style={{ width: '100%' }}
          />
        </label>

        <label>
          <div>Password</div>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            style={{ width: '100%' }}
          />
        </label>

        {mode === 'signup' && (
          <label>
            <div>Confirm password</div>
            <input
              type="password"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              autoComplete="new-password"
              required
              style={{ width: '100%' }}
            />
          </label>
        )}

        <button className="btn" type="submit" disabled={busy || !formReady}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Log in' : 'Sign up'}
        </button>

        {mode === 'signin' && (
          <div style={{ marginTop: 6, fontSize: 13 }}>
            Forgot your password? <Link to="/reset">Reset it</Link>
          </div>
        )}
      </form>
    </div>
  );
}

export default function AuthPage() {
  return DEMO ? <DemoAuth /> : <AuthPageReal />;
}
