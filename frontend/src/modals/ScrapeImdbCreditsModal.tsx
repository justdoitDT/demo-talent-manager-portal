// frontend/src/modals/ScrapeImdbCreditsModal.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import api from '../services/api';

type ProgressEvent =
  | { type: 'init'; creativeName: string; nm_id: string }
  | { type: 'plan'; total: number; role_counts: Record<string, number> }
  | {
      type: 'progress';
      i: number;                   // 1-based index
      total: number;
      ok: number;
      err: number;
      title: string;
      role: string;
      status: 'NEW' | 'OK' | 'WARN' | 'ERR';
      elapsed_ms: number;
    }
  | { type: 'log'; message: string }
  | {
      type: 'done';
      total: number;
      ok: number;
      err: number;
      elapsed_ms: number;
      role_counts: Record<string, number>;
    }
  | { type: 'error'; message: string };

function fmtDuration(sec: number | null) {
  if (sec == null || !isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${mm}m`;
}

/** Find a Bearer token in all the usual places (Axios defaults, your own key, Supabase keys) */
function getAuthHeader(): string | undefined {
  // 1) axios defaults (various casings/locations)
  const d: any = api?.defaults?.headers ?? {};
  const cand =
    d.common?.Authorization ||
    d.common?.authorization ||
    d.Authorization ||
    d.authorization;
  if (typeof cand === 'string' && cand.startsWith('Bearer ')) return cand;

  // 2) explicit localStorage fallback
  const bare = localStorage.getItem('token');
  if (bare) return bare.startsWith('Bearer ') ? bare : `Bearer ${bare}`;

  // 3) Supabase v2: sb-<ref>-auth-token (JSON with {access_token})
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        const tok =
          obj?.access_token ||
          obj?.currentSession?.access_token ||
          obj?.data?.session?.access_token;
        if (tok) return `Bearer ${tok}`;
      } catch {
        /* ignore */
      }
    }
  }

  // 4) Supabase legacy key
  try {
    const legacy = JSON.parse(localStorage.getItem('supabase.auth.token') || 'null');
    const tok = legacy?.currentSession?.access_token;
    if (tok) return `Bearer ${tok}`;
  } catch {
    /* ignore */
  }

  return undefined;
}

/** Minimal SSE client using fetch so we can send headers */
async function fetchSSE(
  url: string,
  opts: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    credentials?: RequestCredentials;
    onopen?: (res: Response) => void | Promise<void>;
    onmessage?: (msg: { event?: string; data: string; id?: string }) => void;
    onerror?: (err: unknown) => void;
    onclose?: () => void;
  }
) {
  const res = await fetch(url, {
    method: 'GET',
    headers: opts.headers,
    signal: opts.signal,
    credentials: opts.credentials ?? 'include',
    mode: 'cors',
    cache: 'no-store',
  });

  try {
    await opts.onopen?.(res);
  } catch {
    // onopen handler asked us to stop
    opts.onclose?.();
    return;
  }

  if (!res.ok || !res.body) {
    opts.onerror?.(new Error(`Bad response: ${res.status}`));
    opts.onclose?.();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  let eventName: string | undefined;
  let dataLines: string[] = [];
  let lastId: string | undefined;

  const flush = () => {
    if (dataLines.length) {
      opts.onmessage?.({ event: eventName, data: dataLines.join('\n'), id: lastId });
      dataLines = [];
      eventName = undefined;
      lastId = undefined;
    }
  };

  const processLine = (line: string) => {
    if (line === '') { flush(); return; }
    if (line.startsWith(':')) return; // comment
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event': eventName = value; break;
      case 'data':  dataLines.push(value); break;
      case 'id':    lastId = value; break;
      // ignore others
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    if (buf) processLine(buf); // flush trailing
    flush();
  } catch (err) {
    opts.onerror?.(err);
  } finally {
    opts.onclose?.();
  }
}

export default function ScrapeImdbCreditsModal({
  isOpen,
  creativeId,
  onClose,
  onFinished,
}: {
  isOpen: boolean;
  creativeId: string;
  onClose: () => void;
  onFinished: () => void; // called when stream reports done
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const [ok, setOk] = useState(0);
  const [err, setErr] = useState(0);
  const [lastTitle, setLastTitle] = useState<string>('');
  const [lastRole, setLastRole] = useState<string>('');
  const [creativeName, setCreativeName] = useState<string>('');
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [aborted, setAborted] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const streamUrl = useMemo(() => {
    const base = (api.defaults.baseURL ?? '').replace(/\/+$/, '');
    return base
      ? `${base}/creatives/${creativeId}/scrape_imdb/stream`
      : `/creatives/${creativeId}/scrape_imdb/stream`;
  }, [creativeId]);

  const percent = useMemo(
    () => (!total || total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100))),
    [done, total]
  );
  const rate = useMemo(
    () => (startedAt ? done / ((Date.now() - startedAt) / 1000) : null),
    [done, startedAt]
  );
  const eta = useMemo(
    () => (total != null && rate && rate > 0 ? Math.max(0, total - done) / rate : null),
    [total, done, rate]
  );

  const pushLog = (s: string) =>
    setLogs((prev) => (prev.length > 500 ? [...prev.slice(-400), s] : [...prev, s]));

  useEffect(() => {
    if (!isOpen) return;

    // reset state
    setStartedAt(Date.now());
    setTotal(null);
    setDone(0);
    setOk(0);
    setErr(0);
    setLastTitle('');
    setLastRole('');
    setCreativeName('');
    setRoleCounts({});
    setLogs([]);
    setStreamErr(null);
    setIsStreaming(true);
    setAborted(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const auth = getAuthHeader();
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      ...(auth ? { Authorization: auth } : {}),
    };

    const handleEvent = (ev: ProgressEvent) => {
      switch (ev.type) {
        case 'init':
          setCreativeName(ev.creativeName);
          pushLog(`Starting scrape for ${ev.creativeName} (${ev.nm_id})`);
          break;
        case 'plan':
          setTotal(ev.total);
          setRoleCounts(ev.role_counts || {});
          pushLog(
            `Planned ${ev.total} credits across ${
              Object.keys(ev.role_counts || {}).length
            } roles.`
          );
          break;
        case 'progress':
          setDone(ev.i);
          setOk(ev.ok);
          setErr(ev.err);
          setLastTitle(ev.title);
          setLastRole(ev.role);
          // Use functional set to avoid stale closure on startedAt
          setStartedAt((prev) => (prev == null ? Date.now() - ev.elapsed_ms : prev));
          pushLog(`${ev.i}/${ev.total} ${ev.status} — ${ev.title} (${ev.role})`);
          break;
        case 'log':
          pushLog(ev.message);
          break;
        case 'done':
          setDone(ev.total);
          setOk(ev.ok);
          setErr(ev.err);
          setRoleCounts(ev.role_counts || {});
          pushLog(`✓ Finished. Imported ${ev.ok} with ${ev.err} errors.`);
          setIsStreaming(false);
          onFinished();
          break;
        case 'error':
          setStreamErr(ev.message);
          pushLog(`⚠ ${ev.message}`);
          setIsStreaming(false);
          break;
      }
    };

    fetchSSE(streamUrl, {
      headers,
      credentials: 'omit',
      signal: ctrl.signal,
      async onopen(res: Response) {
        const ct = res.headers.get('content-type') || '';
        if (res.status === 401) {
          setStreamErr('Unauthorized (401). Please sign in again.');
          setIsStreaming(false);
          throw new Error('Unauthorized');
        }
        if (!res.ok) {
          setStreamErr(`Unexpected response: ${res.status}`);
          setIsStreaming(false);
          throw new Error(`HTTP ${res.status}`);
        }
        if (!ct.includes('text/event-stream')) {
          // Some proxies strip the content-type; still try to read, but warn
          pushLog(`(warn) content-type was "${ct}"`);
        }
      },
      onmessage(msg: { event?: string; data: string; id?: string }) {
        try {
          const parsed = JSON.parse(msg.data) as ProgressEvent;
          handleEvent(parsed);
        } catch {
          pushLog(msg.data || '(message)');
        }
      },
      onerror(err: unknown) {
        if (!aborted) {
          setStreamErr('Stream error. See console for details.');
          setIsStreaming(false);
          // eslint-disable-next-line no-console
          console.error('SSE error', err);
        }
      },
      onclose() {
        if (!aborted) setIsStreaming(false);
      },
    }).catch(() => {
      /* state already updated in handlers */
    });

    return () => {
      ctrl.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, streamUrl]);

  const canClose = !isStreaming;

  return (
    <Modal
      isOpen={isOpen}
      onClose={canClose ? onClose : () => {}}
      ariaLabel="Scrape IMDb credits"
      staticBackdrop={!canClose}
    >
      <h2 className="text-xl font-semibold mb-3">Scrape credits from IMDb</h2>

      <div style={{ fontSize: 13, marginBottom: 8, color: '#444' }}>
        {creativeName ? (
          <>Importing credits for <strong>{creativeName}</strong></>
        ) : (
          'Preparing…'
        )}
      </div>

      {/* Progress Bar */}
      <div style={{ marginTop: 8 }}>
        <div style={{ height: 10, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              background: '#046A38',
              transition: 'width .25s ease',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
          <span>{done}/{total ?? '—'} ({percent}%)</span>
          <span>
            ETA: {fmtDuration(eta)} • Elapsed: {fmtDuration(startedAt ? (Date.now() - startedAt) / 1000 : null)}
          </span>
        </div>
      </div>

      {/* Live stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr 1fr',
          gap: 8,
          marginTop: 12,
          fontSize: 12,
        }}
      >
        <div><strong>OK</strong><div>{ok}</div></div>
        <div><strong>Errors</strong><div>{err}</div></div>
        <div><strong>Rate</strong><div>{rate ? `${(rate * 60).toFixed(1)}/min` : '—'}</div></div>
        <div><strong>Current</strong><div title={lastTitle}>{lastRole ? `${lastRole}: ` : ''}{lastTitle || '—'}</div></div>
      </div>

      {/* Role breakdown */}
      {Object.keys(roleCounts).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 6, color: '#444' }}>Role breakdown</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(roleCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <span
                  key={k}
                  style={{ fontSize: 12, background: '#f5f5f5', padding: '3px 8px', borderRadius: 999 }}
                >
                  {k.replace(/_/g, ' ')}: {v}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Log */}
      <details style={{ marginTop: 12 }}>
        <summary className="clickable">Show details</summary>
        <div
          style={{
            maxHeight: 240,
            overflow: 'auto',
            marginTop: 8,
            padding: 8,
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 6,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: 12,
          }}
        >
          {logs.length === 0 ? <div>(no messages yet)</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </details>

      {streamErr && <div style={{ color: '#b00020', fontSize: 12, marginTop: 8 }}>Error: {streamErr}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        {!canClose && (
          <button
            className="tab"
            onClick={() => {
              setAborted(true);
              abortRef.current?.abort();
              setIsStreaming(false);
            }}
          >
            Stop
          </button>
        )}
        <button className="tab" disabled={!canClose} onClick={onClose}>
          {canClose ? 'Close' : 'Running…'}
        </button>
      </div>
    </Modal>
  );
}
