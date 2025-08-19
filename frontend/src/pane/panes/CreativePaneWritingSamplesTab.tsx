// frontend/src/pane/panes/CreativePaneWritingSamplesTab.tsx
import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';
import api from '../../services/api';
import '../../styles/global.css';
import UploadWritingSampleModal from "../../modals/UploadWritingSampleModal";


/* ──────────────────────────────────────────────────────────── */
/* Types that match the API payload                             */
/* ──────────────────────────────────────────────────────────── */
interface SampleRow {
  id:              string;
  filename:        string;
  file_type:       string;          // e.g. “application/pdf”
  size_bytes:      number;
  uploaded_at:     string;          // ISO timestamp
  project_title:   string | null;   // may be null → “—”
  file_description: string | null;  // optional
  sub_count:       number;          // join‑table count
  download_url:    string;          // pre‑signed URL
}

// interface Props {
//   /** if this tab is for a single creative, you’ll have it here */
//   creativeId?: string;
//   /** if it’s for a single project, you’ll have it here */
//   projectId?: string;
// }

/* ──────────────────────────────────────────────────────────── */
/* Helpers                                                      */
/* ──────────────────────────────────────────────────────────── */
const fmtSize = (bytes: number): string =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)}  MB`
    : `${Math.round(bytes / 1_000)}  KB`;

const trimType = (mime?: string | null): string =>
  mime?.includes('pdf')
    ? 'pdf'
    : mime?.includes('wordprocessingml')
      ? 'word doc'
      : mime ?? '—';

/* ──────────────────────────────────────────────────────────── */
/* Component                                                    */
/* ──────────────────────────────────────────────────────────── */
export default function WritingSamplesTab({
  creativeId,
  onOpen,
}: {
  creativeId: string;
  onOpen: (o: { kind: 'writingSample'; id: string }) => void;
}) {
  const [rows, setRows] = useState<SampleRow[] | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  /* fetch once on mount / ID change */
  useEffect(() => {
    setRows(null);                                    // show “Loading…”
    api
      .get<SampleRow[]>(`/creatives/${creativeId}/samples`)
      .then(r => setRows(r.data));
  }, [creativeId]);

  /* distinct filter options */
  const { projects, types } = useMemo(() => {
    const proj = new Set<string>();
    const mime = new Set<string>();
    (rows ?? []).forEach(r => {
      if (r.project_title) proj.add(r.project_title);
      mime.add(trimType(r.file_type));
    });
    return {
      projects: Array.from(proj).sort(),
      types:     Array.from(mime).sort(),
    };
  }, [rows]);

  /* filter + sort state */
  const [projFilter, setProjFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [subFilter , setSubFilter ] = useState<'all'|'0'|'1+' >('all');
  const [sortKey, setSortKey]       = useState<'project'|'size'|'subs'>('project');
  const [asc, setAsc]               = useState<boolean>(true);

  /* derived dataset */
  const data = useMemo(() => {
    if (!rows) return [];

    let out = rows;

    /* apply filters */
    if (projFilter)  out = out.filter(r => r.project_title === projFilter);
    if (typeFilter)  out = out.filter(r => trimType(r.file_type) === typeFilter);
    if (subFilter === '0')  out = out.filter(r => r.sub_count === 0);
    if (subFilter === '1+') out = out.filter(r => r.sub_count > 0);

    /* apply sort */
    out = [...out].sort((a, b) => {
      let vA: number | string | null = '';
      let vB: number | string | null = '';

      if (sortKey === 'project') {
        vA = a.project_title ?? '';
        vB = b.project_title ?? '';
      } else if (sortKey === 'size') {
        vA = a.size_bytes;
        vB = b.size_bytes;
      } else if (sortKey === 'subs') {
        vA = a.sub_count;
        vB = b.sub_count;
      }

      /* string vs number compare */
      if (typeof vA === 'string' && typeof vB === 'string') {
        return asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
      }
      return asc ? (Number(vA) - Number(vB)) : (Number(vB) - Number(vA));
    });

    return out;
  }, [rows, projFilter, typeFilter, subFilter, sortKey, asc]);

  /* UI helpers */
  const clickSort = (k: typeof sortKey) => {
    setSortKey(prev => (prev === k ? prev : k));
    setAsc(prev => (sortKey === k ? !prev : true));
  };

  /* loading guard */
  if (rows === null) return <>Loading…</>;

  return (
    <>

      {/* Add Writing Sample button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <button
          className="tab"
          onClick={() => setModalOpen(true)}
        >
          Add Writing Sample
        </button>
        <small>
          {data.length} row{data.length === 1 ? '' : 's'}
        </small>
      </div>

      <small>{data.length} row{data.length === 1 ? '' : 's'}</small>

      {/* little CSS snippet to show the download icon only on hover */}
      <style>{`
        .sample-row:hover .download-link { visibility: visible; }
        .download-link { visibility: hidden; text-decoration:none; }
      `}</style>

      <table style={{ width:'100%', borderCollapse:'collapse', marginTop:4 }}>

        <thead>
          <tr>
            {/* Download column — no filter or sort */}
            <th style={{ ...th, textAlign: 'center' }}>
              <img src="/download.png" alt="Download" style={{ width: 20, height: 20 }} />
            </th>

            {/* Project — sortable + filter */}
            <th
              style={th}
              className="clickable"
              onClick={() => clickSort('project')}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  userSelect: 'none',
                }}
              >
                <span>Project</span>
                {sortKey === 'project' ? (
                  <span style={{ marginLeft: 4 }}>{asc ? '▲' : '▼'}</span>
                ) : (
                  <img
                    src="/sortable.png"
                    alt="sortable"
                    style={{ marginLeft: 4, width: 12, height: 12 }}
                  />
                )}
              </div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={projFilter}
                  onChange={e => setProjFilter(e.target.value)}
                  onClick={e => e.stopPropagation()}   // ← prevent sort on dropdown click
                  style={{ width: '100%' }}
                >
                  <option value="">All Projects</option>
                  {projects.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </th>

            {/* File Name — no filter or sort */}
            <th style={th}>
              <div>File Name</div>
              <div style={{ marginTop: 4 }}>&nbsp;</div>
            </th>

            {/* Type — filter only */}
            <th style={th}>
              <div>Type</div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '100%' }}
                >
                  <option value="">All Types</option>
                  {types.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </th>

            {/* Size — sort only */}
            <th
              style={th}
              className="clickable"
              onClick={() => clickSort('size')}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  userSelect: 'none',
                }}
              >
                <span>Size</span>
                {sortKey === 'size' ? (
                  <span style={{ marginLeft: 4 }}>{asc ? '▲' : '▼'}</span>
                ) : (
                  <img
                    src="/sortable.png"
                    alt="sortable"
                    style={{ marginLeft: 4, width: 12, height: 12 }}
                  />
                )}
              </div>
              <div style={{ marginTop: 4 }}>&nbsp;</div>
            </th>

            {/* File Description — no filter or sort */}
            <th style={th}>
              <div>File Description</div>
              <div style={{ marginTop: 4 }}>&nbsp;</div>
            </th>

            {/* Sub Count — sortable + filter */}
            <th
              style={th}
              className="clickable"
              onClick={() => clickSort('subs')}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  userSelect: 'none',
                }}
              >
                <span>Sub Count</span>
                {sortKey === 'subs' ? (
                  <span style={{ marginLeft: 4 }}>{asc ? '▲' : '▼'}</span>
                ) : (
                  <img
                    src="/sortable.png"
                    alt="sortable"
                    style={{ marginLeft: 4, width: 12, height: 12 }}
                  />
                )}
              </div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={subFilter}
                  onChange={e => setSubFilter(e.target.value as any)}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '100%' }}
                >
                  <option value="all">Any</option>
                  <option value="0">0 subs</option>
                  <option value="1+">1+ subs</option>
                </select>
              </div>
            </th>
          </tr>
        </thead>

        <tbody>
          {data.map(r => (
            <tr key={r.id} className="sample-row">

              {/* Download */}
              <td style={{ ...td, textAlign: 'center' }}>
                <button
                  type="button"
                  className="download-link"
                  title="Download"
                  aria-label={`Download ${r.filename}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const res = await api.get<{ url: string }>(`/writing_samples/${r.id}/download`);
                      window.open(res.data.url, "_blank");
                    } catch (err) {
                      console.error("Download failed", err);
                    }
                  }}
                  style={{ background:'none', border:0, padding:0, cursor:'pointer' }}
                >
                  <img src="/download.png" alt="" aria-hidden="true" style={{ width:16, height:16 }} />
                </button>
              </td>

              {/* Project */}
              <td style={{ ...td, cursor:'text' }}>{r.project_title ?? '—'}</td>

              {/* Filename → open WritingSamplePane for this writing sample */}
              <td
                className="clickable"
                style={{ ...td, cursor: 'pointer' }}
                onClick={() => onOpen({ kind: 'writingSample', id: r.id })}
              >
                {r.filename}
              </td>

              {/* File type */}
              <td style={{ ...td, cursor:'text' }}>{trimType(r.file_type)}</td>

              {/* Size */}
              <td style={{ ...td, cursor:'text' }}>{fmtSize(r.size_bytes)}</td>

              {/* Description */}
              <td style={{ ...td, whiteSpace:'pre-line', cursor:'text' }}>
                {r.file_description ?? '—'}
              </td>

              {/* Sub count */}
              <td style={{ ...td, cursor:'text' }}>{r.sub_count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <UploadWritingSampleModal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          // re-fetch after successful save
          api.get<SampleRow[]>(`/creatives/${creativeId}/samples`)
            .then(r => setRows(r.data));
        }}
        initialCreativeId={creativeId}
        initialProjectId={null}
      />

    </>
  );
}

/* simple cell styles that match global.css look */
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: 6,
  border: '1px solid #ddd',
  cursor: 'default',
};
const td: React.CSSProperties = { ...th };
