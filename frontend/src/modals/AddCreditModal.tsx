//frontend/src/modals/AddCreditModal.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import api from '../services/api';
import { SearchDropdown } from '../components/SearchDropdown';
import CreateProjectModal from './CreateProjectModal';

export interface AddCreditModalProps {
  isOpen: boolean;
  onClose: () => void;

  /** Optional pre-selects */
  defaultCreativeId?: string;
  defaultProjectId?: string;

  /** Call after successful save so parent can refresh */
  onSaved?: () => void;
}

type Option = { id: string; label: string; group?: string };

const ROLE_MASTER = [
  'Creative Developer', // stored value; shown as “Creator / Creative Developer”
  'Creator',
  'Director',
  'Writer',
  'Producer',
  'Actor',
  'Production Manager',
  'Production Designer',
  'Cinematographer',
  'Editor',
  'Composer',
  'Casting Director',
  'Art Director',
  'Costume Department',
  'Music Department',
  'Sound Department',
  'Special Effects',
  'Visual Effects',
  'Camera and Electrical Department',
  'Camera Department',
  'Art Department',
  'Editorial Department',
  'Script And Continuity Department',
  'Second Unit Or Assistant Director',
  'Casting Department',
  'Location Management',
  'Animation Department',
  'Archive Footage',
  'Additional Crew',
  'Stunts',
  'Thanks',
  'Soundtrack',
  'Self',
];

export default function AddCreditModal({
  isOpen,
  onClose,
  defaultCreativeId,
  defaultProjectId,
  onSaved,
}: AddCreditModalProps) {
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [creative, setCreative] = useState<Option | null>(null);
  const [project, setProject] = useState<Option | null>(null);

  const [isPersonal, setIsPersonal] = useState<'' | 'yes' | 'no'>('');
  const [roles, setRoles] = useState<string[]>([]);

  const [showCreateProject, setShowCreateProject] = useState(false);

  /* ───────── fetch helpers ───────── */

  const fetchCreativeOptions = useCallback(async (q: string) => {
    const { data } = await api.get('/creatives', { params: { q } });
    return data.map((c: any) => ({ id: c.id, label: c.name })) as Option[];
  }, []);

  const fetchProjectOptions = useCallback(async (q: string) => {
    const { data } = await api.get('/projects', { params: { q } });
    const items = Array.isArray(data) ? data : (data?.items ?? []);
    const hits: Option[] = items.map((p: any) => ({
      id: p.id,
      label: p.title,
      group: p.media_type || undefined,
    }));
    // Put the “Add New Project” sentinel on top
    return [{ id: '__new__', label: '➕ Add New Project to Database' }, ...hits];
  }, []);

  /* ───────── preload defaults ───────── */

  const preloadedOnce = useRef(false);
  useEffect(() => {
    if (!isOpen || preloadedOnce.current) return;
    preloadedOnce.current = true;

    (async () => {
      try {
        if (defaultCreativeId) {
          const { data } = await api.get(`/creatives/${defaultCreativeId}`);
          setCreative({ id: data.id, label: data.name });
        }
        if (defaultProjectId) {
          const { data } = await api.get(`/projects/${defaultProjectId}`);
          setProject({ id: data.id, label: data.title });
        }
      } catch (e) {
        // non-fatal; user can still search/select
        console.warn('Preload failed', e);
      }
    })();
  }, [isOpen, defaultCreativeId, defaultProjectId]);

  /* ───────── personal ⇒ lock Creative Developer ───────── */

  const hasCreativeDev = roles.includes('Creative Developer');
  useEffect(() => {
    if (isPersonal === 'yes' && !hasCreativeDev) {
      setRoles((rs) => ['Creative Developer', ...rs]);
    }
    if (isPersonal === 'no' && hasCreativeDev) {
      // user toggled away from personal; keep roles but allow removal
      // (we won’t auto-remove to avoid surprise; user can click “×”)
    }
  }, [isPersonal, hasCreativeDev]);

  const addRole = (role: string) =>
    setRoles((rs) => (rs.includes(role) ? rs : [...rs, role]));

  const removeRole = (role: string) =>
    setRoles((rs) => rs.filter((r) => r !== role));

  const roleOptions = useMemo(() => {
    // unique, sorted by ROLE_MASTER order then alpha fallback
    const uniq = Array.from(new Set(ROLE_MASTER));
    return uniq.map((r) => ({ id: r, label: r }));
  }, []);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!creative) e.creative = 'x';
    if (!project) e.project = 'x';
    if (!isPersonal) e.personal = 'x';
    if ((isPersonal === 'yes' && roles.length < 1) || (isPersonal === 'no' && roles.length < 1)) {
      e.roles = 'x';
    }
    return e;
  }, [creative, project, isPersonal, roles.length]);

  const ready = Object.keys(errors).length === 0;

  /* ───────── save ───────── */
  const save = async () => {
    setSubmitAttempted(true);
    if (!ready || !creative || !project) return;

    setSaving(true);
    try {
      const creativeId = creative.id;
      const projectId  = project.id;
      const uniqRoles  = Array.from(new Set(roles));

      // helper: treat 409 as success (role already exists)
      const swallow409 = (err: any) => {
        if (err?.response?.status === 409) return; // ok
        throw err;
      };

      const reqs: Promise<any>[] = [];

      if (isPersonal === 'yes') {
        // adds "Creative Developer"
        reqs.push(
          api.post(`/creatives/${creativeId}/personal-projects/${projectId}`)
             .catch(swallow409)
        );
      }

      for (const r of uniqRoles) {
        // if personal, "Creative Developer" was already added by the endpoint above
        if (isPersonal === 'yes' && r === 'Creative Developer') continue;
        reqs.push(
          api.post(`/creatives/${creativeId}/projects/${projectId}`, { role: r })
             .catch(swallow409)
        );
      }

      await Promise.all(reqs);

      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to add credit – please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* ───────── reset on close ───────── */
  useEffect(() => {
    if (!isOpen) {
      setSaving(false);
      setSubmitAttempted(false);
      setCreative(null);
      setProject(null);
      setIsPersonal('');
      setRoles([]);
      setShowCreateProject(false);
      preloadedOnce.current = false;
    }
  }, [isOpen]);

  /* ───────── render ───────── */
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Add Credit" staticBackdrop>
      <div style={{ minHeight: 420, overflow: 'visible' }}>
        <h2 className="text-2xl font-semibold mb-4">Add Credit</h2>

        {/* Creative */}
        <section style={{ marginTop: 8 }}>
          <label style={submitAttempted && errors.creative ? { outline: '2px solid #e00', outlineOffset: 1 } : undefined}>
            Creative*<br />
            <SearchDropdown
              placeholder="Search creatives"
              fetchOptions={fetchCreativeOptions}
              onSelect={(o) => setCreative(o)}
              groupSort="alpha"
              style={{ width: 420 }}
            />
          </label>
          {creative && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Selected: <strong>{creative.label}</strong>{' '}
              <span className="clickable" onClick={() => setCreative(null)}>× clear</span>
            </div>
          )}
        </section>

        {/* Project */}
        <section style={{ marginTop: 16 }}>
          <label style={submitAttempted && errors.project ? { outline: '2px solid #e00', outlineOffset: 1 } : undefined}>
            Project*<br />
            <SearchDropdown
              placeholder="Search projects"
              fetchOptions={fetchProjectOptions}
              onSelect={(o) => {
                if (o.id === '__new__') {
                  setShowCreateProject(true);
                  return;
                }
                setProject(o);
              }}
              groupSort="alpha"
              style={{ width: 420 }}
            />
          </label>
          {project && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Selected: <strong>{project.label}</strong>{' '}
              <span className="clickable" onClick={() => setProject(null)}>× clear</span>
            </div>
          )}
        </section>

        {/* Personal? */}
        {creative && project && (
          <section style={{ marginTop: 16 }}>
            <label style={submitAttempted && errors.personal ? { outline: '2px solid #e00', outlineOffset: 1 } : undefined}>
              Is <strong>{project.label}</strong> a personal project of <strong>{creative.label}</strong>?<br />
              <select
                value={isPersonal}
                onChange={(e) => setIsPersonal(e.target.value as 'yes' | 'no' | '')}
                style={{ width: 180, marginTop: 4 }}
              >
                <option value="">— choose —</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </section>
        )}

        {/* Roles */}
        {creative && project && (
          <section style={{ marginTop: 16 }}>
            <label style={submitAttempted && errors.roles ? { outline: '2px solid #e00', outlineOffset: 1 } : undefined}>
              Role(s)*<br />
              <SearchDropdown
                placeholder="Add role"
                fetchOptions={async (q) => {
                  const base = roleOptions.filter((r) =>
                    r.label.toLowerCase().includes(q.toLowerCase()),
                  );
                  return [{ id: '__custom__', label: 'Add Custom Role' }, ...base];
                }}
                onSelect={(o) => {
                  if (o.id === '__custom__') {
                    const name = prompt('Custom role name?')?.trim();
                    if (name) addRole(name);
                    return;
                  }
                  // store “Creative Developer” as our canonical value
                  addRole(o.id === 'Creator / Creative Developer' ? 'Creative Developer' : o.label);
                }}
                groupSort="none"
                style={{ width: 420 }}
              />
            </label>

            {/* Pills */}
            <div style={{ marginTop: 8 }}>
              {roles.map((r) => {
                const isLocked = isPersonal === 'yes' && r === 'Creative Developer';
                const label = r === 'Creative Developer' && isPersonal === 'yes'
                  ? 'Creator / Creative Developer (locked)'
                  : r === 'Creative Developer'
                    ? 'Creator / Creative Developer'
                    : r;

                return (
                  <span
                    key={r}
                    style={{
                      background: '#eee',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 12,
                      marginRight: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {label}
                    {!isLocked && (
                      <span style={{ cursor: 'pointer' }} onClick={() => removeRole(r)}>×</span>
                    )}
                  </span>
                );
              })}
            </div>
          </section>
        )}

        {/* Actions */}
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button className="tab" onClick={onClose}>Cancel</button>
          <button className="tab" disabled={saving || !ready} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Nested “Create Project” modal */}
      <CreateProjectModal
        isOpen={showCreateProject}
        onClose={() => setShowCreateProject(false)}
      />
    </Modal>
  );
}
