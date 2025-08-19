// frontend/src/pane/panes/CreativePaneCreditsTab.tsx

import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import type { CSSProperties } from 'react';
import AddCreditModal from '../../modals/AddCreditModal';
import ScrapeImdbCreditsModal from '../../modals/ScrapeImdbCreditsModal';

interface RawProjectRow {
  id: string;
  title: string;
  year: number | null;
  media_type: string | null;
  status: string | null;
  role: string;                // ONE role per DB row
  involvement_rating: number | null;
  interest_rating:    number | null;
}

interface ProjectWithRoles {
    id: string;
    title: string;
    year?: number | null;
    media_type?: string | null;
    status?: string | null;
    involvement_rating: number | null;
    interest_rating:    number | null;
    roles: string[];
  }

const ROLE_ORDER = [
  "Creator",
  "Director",
  "Writer",
  "Producer",
  "Actor",
  "Production Manager",
  "Production Designer",
  "Cinematographer",
  "Editor",
  "Composer",
  "Casting Director",
  "Art Director",
  "Costume Department",
  "Music Department",
  "Sound Department",
  "Special Effects",
  "Visual Effects",
  "Camera and Electrical Department",
  "Camera Department",
  "Art Department",
  "Editorial Department",
  "Script And Continuity Department",
  "Second Unit Or Assistant Director",
  "Casting Department",
  "Location Management",
  "Animation Department",
  "Archive Footage",
  "Additional Crew",
  "Stunts",
  "Thanks",
  "Soundtrack",
  "Self",
];

const INVOLV_TEXT = [
  "This project is virtually irrelevant to my current/future career.",
  "This was just a job I had; not super relevant to my current/future career.",
  "I played a significant role in this project; it’s part of my professional identity.",
  "This project was my baby.",
];

const INTEREST_TEXT = [
  "Not at all interested. I’ll never do anything like this again.",
  "I wouldn’t rule out working on something like this again.",
  "I would like to do something similar again.",
  "This is my thing. This is exactly the type of thing I’d love to do again.",
];

function RatingCell({
  creativeId,       //  ← NEW
  projectId,
  rating,
  labelArr,
  field,            // 'involvement' | 'interest'
  onSaved,
}: {
  creativeId: string;             //  ← NEW
  projectId: string;
  rating: number | null;
  labelArr: string[];
  field: 'involvement' | 'interest';
  onSaved: () => void;
}) {
  const [editing, setEditing]   = React.useState(false);
  const [value, setValue]       = React.useState<number | ''>(rating ?? '');

  async function save() {
    try {
      await api.patch(
        `/creatives/${creativeId}/project-ratings/${projectId}`,
        { field, value }
      );
      onSaved();
      setEditing(false);
    } catch (e) {
      alert('Save failed');
    }
  }

  return (
    <td style={td} className="tipWrap">
      {editing ? (
        <div className="ratingCellInner">
          <select
            value={value}
            onChange={e => setValue(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">–</option>
            {[4,3,2,1].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button className="ratingSaveBtn"   onClick={save}>Save</button>
          <button className="ratingCancelBtn" onClick={()=>setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div
          className="ratingCellInner"
          onMouseEnter={() => {/* just to trigger :hover for bubble */}}
        >
          {rating ?? '—'}
          {rating !== null && (
            <>
              <span className="bubble">{labelArr[rating-1]}</span>
              <button
                className="ratingEditBtn"
                onClick={() => setEditing(true)}
                title="Edit rating"
              >
                Edit
              </button>
            </>
          )}
        </div>
      )}
    </td>
  );
}


const mediumLabel = (m?: string | null) =>
  !m ? '—'
  : m === 'Movie' || m === 'Feature' ? 'Feature'
  : m === 'TV Series' ? 'TV Series'
  : m;                               // pass through others

export default function CreditsTab({
  creativeId,
  onOpen,
}: {
  creativeId: string;
  onOpen: (p: { kind: 'project'; id: string }) => void;
}) {
  /* ---------- load & reshape ---------- */
  const [raw, setRaw] = useState<RawProjectRow[] | null>(null);
  const [showAddCredit, setShowAddCredit] = useState(false);
  const [showScrape, setShowScrape] = useState(false);

  const [confirmPid, setConfirmPid]   = useState<string|null>(null);
  const [deletingPid, setDeletingPid] = useState<string|null>(null);

  
  
  async function handleConfirmDelete(pid: string) {
    if (deletingPid) return;
    setDeletingPid(pid);
    try {
      await api.delete(`/creatives/${creativeId}/projects/${pid}`); // correct route
    } catch (e: any) {
      // Treat 404 as idempotent success
      if (e?.response?.status !== 404) {
        alert('Failed to delete credit');
      }
    } finally {
      await reload();          // keep spinner until the row is actually gone
      setDeletingPid(null);
      setConfirmPid(null);
    }
  }

  const reload = React.useCallback(() => {
    return api                                  // ← return the promise
      .get<any[]>(`/creatives/${creativeId}/projects_roles`)
      .then(r => {
        const mapped: RawProjectRow[] = r.data.map(row => ({
          id:                row.project_id,
          title:             row.project_title,
          year:              row.year ?? null,
          media_type:        row.media_type ?? null,
          status:            row.status ?? null,
          role:              row.role ?? '',
          involvement_rating:row.involvement_rating ?? null,
          interest_rating:   row.interest_rating   ?? null,
        }));
        setRaw(mapped);
      });
  }, [creativeId]);

  useEffect(() => { reload(); }, [reload]);

  // merge rows that share the same project id
  const projects = useMemo<ProjectWithRoles[] | null>(() => {
    if (!raw) return null;
    const map = new Map<string, ProjectWithRoles>();
    raw.forEach(r => {
      const key = r.id;
      const entry = map.get(key) ?? {
        id: r.id,
        title: r.title,
        year: r.year,
        media_type: r.media_type,
        status: r.status,
        involvement_rating: r.involvement_rating,
        interest_rating:    r.interest_rating,
        roles: [],
      };

      if (!entry.roles.includes(r.role)) entry.roles.push(r.role);
      // keep first non-null status if some rows lack it
      if (!entry.status && r.status) entry.status = r.status;
      map.set(key, entry);
    });
    // enforce canonical role ordering
    const ordered: ProjectWithRoles[] = Array.from(map.values()).map(p => ({
      ...p,
      roles: [...p.roles].sort(
        (a, b) =>
          (ROLE_ORDER.indexOf(a) === -1 ? 999 : ROLE_ORDER.indexOf(a)) -
          (ROLE_ORDER.indexOf(b) === -1 ? 999 : ROLE_ORDER.indexOf(b)),
      ),
    }));
    return ordered;
  }, [raw]);

  /* ---------- filters & sort ---------- */
  const [mediumFilter, setMediumFilter] = useState('Any');
  const [titleSearch,  setTitleSearch]  = useState('');
  const [roleFilter,   setRoleFilter]   = useState('Any');
  const [statusFilter, setStatusFilter] = useState('Any');
  const [yearDesc,     setYearDesc]     = useState(true); // newest first
  const [involvFilter,   setInvolvFilter]   = useState('Any');
  const [interestFilter, setInterestFilter] = useState('Any');


  const passNum = (val: number | null, choice: string) => {
    if (choice === 'Any' || val == null) return true;
    switch (choice) {
      case '4':  return val === 4;
      case '3+': return val >= 3;
      case '2+': return val >= 2;
      case '≤2': return val <= 2;
      case '1':  return val === 1;
      default:   return true;
    }
  };

  // derive lists for combo-boxes from the data
  const roleChoices = useMemo<string[]>(() => {
    if (!raw) return ['Any'];
    const all = raw.map(r => r.role);
    const uniq = Array.from(new Set(all));
    return ['Any', ...uniq];
  }, [raw]);

  const statusChoices = useMemo<string[]>(() => {
    if (!projects) return ['Any'];
    // filter out nulls before de-duping
    const all = projects
      .map(p => p.status)
      .filter((s): s is string => !!s);
    const uniq = Array.from(new Set(all));
    return ['Any', ...uniq];
  }, [projects]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    return projects
      .filter(p => {
        const mediumOk =
          mediumFilter === 'Any'
            ? true
            : mediumFilter === 'Other'
              ? !['Feature', 'Movie', 'TV Series'].includes(p.media_type ?? '')
              : mediumLabel(p.media_type) === mediumFilter;
        const titleOk =
          !titleSearch || p.title.toLowerCase().includes(titleSearch.toLowerCase());
        const roleOk =
          roleFilter === 'Any' || p.roles.includes(roleFilter);
        const statusOk =
          statusFilter === 'Any' || p.status === statusFilter;
        const involvOk  = passNum(p.involvement_rating, involvFilter);
        const interestOk= passNum(p.interest_rating,   interestFilter);
        return mediumOk && titleOk && roleOk && statusOk && involvOk && interestOk;
      })
      .sort((a, b) => {
        const ay = a.year ?? 0;
        const by = b.year ?? 0;
        return yearDesc ? by - ay : ay - by;
      });
  }, [projects, mediumFilter, titleSearch, roleFilter, statusFilter, yearDesc, interestFilter, involvFilter]);

  if (!projects) return <>Loading…</>;

  /* ---------- render ---------- */
  return (
    <>
      <style>{`
        /* ────────────── tooltip bubble ────────────── */
        .tipWrap { position: relative; }

        .tipWrap .bubble {
          display:none;
          position:absolute;
          bottom:100%;                 /* above the cell  */
          left:50%;                    /* anchor: cell center */
          transform:translateX(-100%); /* right edge = mid-point */
          margin-bottom:6px;
          min-width:15ch;
          max-width:40ch;              /* no wider than ~25 chars */
          white-space:normal;
          background:#fff;
          border:1px solid #ddd;
          padding:6px 8px;
          border-radius:6px;
          box-shadow:0 4px 12px rgba(0,0,0,.15);
          z-index:1000;
        }

        .tipWrap:hover .bubble { display:block; }

        /* ────────────── edit controls ────────────── */
        .ratingEditBtn,
        .ratingSaveBtn,
        .ratingCancelBtn {
          background:none;
          border:none;
          font-size:11px;
          color:#046A38;
          cursor:pointer;
          padding:0 4px;
        }
        .ratingSaveBtn   { font-weight:600; }

        .ratingCellInner { display:flex; justify-content:flex-end; gap:4px; }

        tr:hover .hover-delete { visibility: visible; }
        .hover-delete { visibility: hidden; }

      `}</style>

      <div style={{ display:'flex', gap:8, alignItems:'center', margin: '0 0 14px 0' }}>
        <button className="tab" onClick={() => setShowAddCredit(true)}>
          Add New Credit
        </button>

        <button
          className="tab"
          onClick={() => setShowScrape(true)}
          title="Scrape all credits from IMDb and import (with progress)"
        >
          Scrape all credits from IMDb
        </button>
      </div>

      <small style={{ display:'block', marginBottom:4 }}>
        {filtered.length} row{filtered.length === 1 ? '' : 's'}
      </small>

      <AddCreditModal
        isOpen={showAddCredit}
        onClose={() => setShowAddCredit(false)}
        defaultCreativeId={creativeId}
        onSaved={() => {
          setShowAddCredit(false);
          reload();
        }}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
        <thead>
          <tr>
            {/* ─── Medium ─── */}
            <th style={th}>
              <div>Media Type</div>
              <select
                style={{ marginTop: 4 }}
                value={mediumFilter}
                onChange={e => setMediumFilter(e.target.value)}
              >
                {['Any', 'Feature', 'TV Series', 'Other'].map(opt => (
                  <option key={opt}>{opt}</option>
                ))}
              </select>
            </th>

            {/* ─── Title ─── */}
            <th style={th}>
              <div>Title</div>
              <input
                type="text"
                placeholder="Search…"
                value={titleSearch}
                onChange={e => setTitleSearch(e.target.value)}
                style={{ marginTop: 4, width: '90%' }}
              />
            </th>

            {/* ─── Year (sortable) ─── */}
            <th style={th}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Year
                <button
                  className="btn"
                  onClick={() => setYearDesc(!yearDesc)}
                  title="Toggle sort order"
                  style={{ padding: '2px 6px' }}
                >
                  ↕︎
                </button>
              </div>
            </th>

            {/* ─── Role ─── */}
            <th style={th}>
              <div>Role</div>
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                style={{ marginTop: 4 }}
              >
                {roleChoices.map(r => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </th>

            {/* ─── Status ─── */}
            <th style={th}>
              <div>Status</div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{ marginTop: 4 }}
              >
                {statusChoices.map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </th>

            {/* ─── Involvement ─── */}
            <th style={th}>
              <div>Involvement</div>
              <select
                value={involvFilter}
                onChange={e => setInvolvFilter(e.target.value)}
                style={{ marginTop: 4 }}
              >
                {['Any', '4', '3+', '2+', '≤2', '1'].map(v => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </th>

            {/* ─── Interest ─── */}
            <th style={th}>
              <div>Interest</div>
              <select
                value={interestFilter}
                onChange={e => setInterestFilter(e.target.value)}
                style={{ marginTop: 4 }}
              >
                {['Any', '4', '3+', '2+', '≤2', '1'].map(v => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </th>

            {/* Actions */}
            <th style={{ ...th, width: '1%' }} />

          </tr>
        </thead>

        <tbody>
          {filtered.map(p => (
            <tr
              key={p.id}
              onMouseLeave={() => { setConfirmPid(null); }}
            >
              <td style={td}>{mediumLabel(p.media_type)}</td>

              <td
                className="clickable"
                style={td}
                onClick={() => onOpen({ kind: 'project', id: p.id })}
              >
                {p.title}
              </td>

              <td style={td}>{p.year ?? '—'}</td>
              <td style={td}>{p.roles.join(', ')}</td>
              <td style={td}>{p.status ?? '—'}</td>

              {/* Involvement cell */}
              <RatingCell
                creativeId={creativeId}
                projectId={p.id}
                rating={p.involvement_rating}
                labelArr={INVOLV_TEXT}
                field="involvement"
                onSaved={reload}
              />

              {/* Interest cell */}
              <RatingCell
                creativeId={creativeId}
                projectId={p.id}
                rating={p.interest_rating}
                labelArr={INTEREST_TEXT}
                field="interest"
                onSaved={reload}
              />

              {/* Actions */}
              <td style={{ ...td, width: 1, whiteSpace: 'nowrap', textAlign:'right' }}>
                {confirmPid === p.id ? (
                  deletingPid === p.id ? (
                    <span className="mini-spinner" aria-label="Deleting…" />
                  ) : (
                    <>
                      <button className="btn confirm-remove" onClick={() => handleConfirmDelete(p.id)}>
                        Confirm
                      </button>
                      <button className="btn" style={{ marginLeft: 6 }} onClick={() => setConfirmPid(null)}>
                        Cancel
                      </button>
                    </>
                  )
                ) : (
                  <button
                    className="btn hover-delete"
                    onClick={() => setConfirmPid(p.id)}
                    disabled={!!deletingPid}         // avoid multiple concurrent deletes
                    title="Delete all roles for this project"
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ScrapeImdbCreditsModal
        isOpen={showScrape}
        creativeId={creativeId}
        onClose={() => setShowScrape(false)}
        onFinished={() => {
          setShowScrape(false);
          reload();               // refresh credits once the job finishes
        }}
      />

    </>
  );
}

/* ---------- styles ---------- */
const th: CSSProperties = {
  textAlign: 'left',
  padding: 6,
  border: '1px solid #ddd',
  verticalAlign: 'bottom',
};
const td: CSSProperties = { ...th };
