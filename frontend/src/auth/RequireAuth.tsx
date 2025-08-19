//frontend/src/auth/RequireAuth.tsx

import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';


export default function RequireAuth() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    unsub = () => sub.subscription.unsubscribe();

    return () => { unsub?.(); };
  }, []);

  if (loading) return null; // or a spinner
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}
