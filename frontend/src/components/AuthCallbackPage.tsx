// frontend/src/components/AuthCallbackPage.tsx

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';


export default function AuthCallbackPage() {
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      const qs   = new URLSearchParams(window.location.search);
      const code = qs.get('code');
      const token = qs.get('token');
      const type  = qs.get('type');           // 'signup' | 'invite'
      const email = qs.get('email');          // may be null

      try {
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        } else if (token && (type === 'signup' || type === 'invite')) {
          // build params only with defined fields
          const params: Record<string, string> = {
            type,           // 'signup' | 'invite'
            token,
          };
          if (email) params.email = email;

          const { error } = await supabase.auth.verifyOtp(params as any);
          if (error) throw error;
        }
      } catch {
        /* ignore – will fall back to /login */
      } finally {
        nav('/', { replace: true });
      }
    })();
  }, [nav]);

  return null;
}
