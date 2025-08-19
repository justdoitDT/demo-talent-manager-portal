// frontend/src/modals/AttachNeedsModal.tsx
import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import api from '../services/api';

/* ──────────────────────── types ──────────────────────── */
interface Option {
  id:          string;
  label:       string;
  description?: string;
}

interface Props {
  isOpen: boolean;
  projectId: string;
  initiallySelectedIds?: string[];
  onClose: () => void;
  /**
   * (selected, allCreated) – `selected` is the one that should be pre-chosen
   * in CreateSubModal; `allCreated` is the entire batch (parent may ignore it).
   */
  onSaved?: (selected: Option, allCreated?: Option[]) => void;
}

interface NeedRow {
  need: string;
  description: string;
  existing?: boolean;
}

/* ──────────────────────── constants ──────────────────────── */
const NEED_CODES = [
  'Director (Any)',
  'Director (Has Directed Feature)',
  'Writer (Any)',
  'Writer (Upper)',
  'Writer (Mid - Upper)',
  'Writer (Mid)',
  'Writer (Lower - Mid)',
  'Writer (Low)',
] as const;

const errorCSS: React.CSSProperties = { outline: '2px solid #e00', outlineOffset: 1 };

/* ──────────────────────── component ──────────────────────── */
const AttachNeedsModal: React.FC<Props> = ({
  projectId,
  isOpen,
  onClose,
  onSaved,
}) => {
  /* state */
  const [rows,   setRows]   = useState<NeedRow[]>([]);
  const [dirty,  setDirty]  = useState(false);
  const [saving, setSaving] = useState(false);

  /* load existing needs */
  useEffect(() => {
    if (!isOpen) return;

    (async () => {
      try {
        const { data } = await api.get(`/projects/${projectId}/needs`);
        setRows(
          data.map((n: any) => ({
            need: n.qualifications,
            description: n.description ?? '',
            existing: true,
          })),
        );
      } catch (err) {
        console.error('Failed to fetch project needs', err);
      }
    })();
  }, [isOpen, projectId]);

  /* row helpers */
  const addRow      = () => setRows(r => [...r, { need: '', description: '' }]);
  const removeRow   = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));
  const updateRow   = (i: number, p: Partial<NeedRow>) =>
    setRows(r => r.map((row, idx) => (idx === i ? { ...row, ...p } : row)));

  const dupIdx = (): number[] => {
    const seen = new Set<string>();
    const out: number[] = [];
    rows.forEach((r, i) => {
      if (r.need && seen.has(r.need)) out.push(i);
      seen.add(r.need);
    });
    return out;
  };
  const badIdx = (): number[] =>
    rows.flatMap((r, i) => (!r.need.trim() ? [i] : []));

  /* save */
  const handleSave = async () => {
    setDirty(true);
    if (dupIdx().length || badIdx().length) return;

    /* only brand-new needs get POSTed */
    const newRows = rows.filter(r => !r.existing);
    if (!newRows.length) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const created = await Promise.all(
        newRows.map(r =>
          api.post(`/projects/${projectId}/needs`, {
            qualifications: r.need,
            description: r.description || null,
            project_types: [],
          }).then(res => res.data),
        ),
      );

      /* transform API rows → Option[] */
      const opts: Option[] = created.map((n: any) => ({
        id: n.id,
        label: n.qualifications,
        description: n.description ?? '',
      }));

      /* first item is the one to pre-select */
      onSaved?.(opts[0], opts);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to save – please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* reset when closed */
  useEffect(() => {
    if (!isOpen) {
      setRows([]);
      setDirty(false);
      setSaving(false);
    }
  }, [isOpen]);

  /* ─────────────── render ─────────────── */
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Attach Project Needs" staticBackdrop>
      <h2 className="text-2xl font-semibold mb-4">Attach Project Needs</h2>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 8 }}>Need</th>
            <th style={{ textAlign: 'left', paddingBottom: 8 }}>Description</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const dup = dirty && dupIdx().includes(i);
            const bad = dirty && badIdx().includes(i);
            return (
              <tr key={i}>
                {/* qualifications dropdown */}
                <td style={{ padding: 4 }}>
                  <select
                    style={{ width: 260, ...(dup || bad ? errorCSS : undefined) }}
                    value={r.need}
                    onChange={e => updateRow(i, { need: e.target.value })}
                  >
                    <option value="">— choose —</option>
                    {NEED_CODES.map(c => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>

                {/* free-text description */}
                <td style={{ padding: 4 }}>
                  <input
                    style={{ width: '100%' }}
                    value={r.description}
                    onChange={e => updateRow(i, { description: e.target.value })}
                  />
                </td>

                {/* remove */}
                <td style={{ padding: 4 }}>
                  {!r.existing && (
                    <button className="tab" onClick={() => removeRow(i)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* validation hints */}
      {dirty && dupIdx().length > 0 && (
        <div style={{ color: '#e00', fontSize: 12, marginTop: 8 }}>
          Duplicate needs were ignored – choose each need only once.
        </div>
      )}
      {dirty && badIdx().length > 0 && (
        <div style={{ color: '#e00', fontSize: 12, marginTop: 4 }}>
          Select a need for every row, or remove unused rows.
        </div>
      )}

      {/* add row */}
      <button className="tab" style={{ marginTop: 16 }} onClick={addRow}>
        + Add Need
      </button>

      {/* footer */}
      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <button className="tab" onClick={onClose}>Cancel</button>
        <button className="tab" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
};

export default AttachNeedsModal;
