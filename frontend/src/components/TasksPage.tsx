// frontend/src/components/TasksPage.tsx

import React, { useRef, useState } from 'react';
import AddPersonToDatabaseModal from '../modals/AddPersonToDatabaseModal';
import AddCompanyToDatabaseModal from '../modals/AddCompanyToDatabaseModal';
import CreateSubModal from '../modals/CreateSubModal';
import CreateProjectModal from '../modals/CreateProjectModal';
import api from '../services/api';


type BackfillSummary = {
  processed: number;
  generated: number;
  skipped: number;
  remaining_before: number;
  remaining_after: number;
  limit: number;
  reprocess_existing: boolean;
  tracking_statuses: string[];
};

export default function TasksPage() {
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);

  // Backfill UI state
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    totalDone: number;
    remaining: number | null;
    lastBatch?: BackfillSummary;
    errors?: number;
  }>({ totalDone: 0, remaining: null });
  const [message, setMessage] = useState<string | null>(null);
  const cancelRef = useRef(false);

  function resetProgress() {
    setProgress({ totalDone: 0, remaining: null });
    setMessage(null);
  }

  async function runOneBatch(limit = 50, reprocessExisting = false) {
    const { data } = await api.post<{ summary: BackfillSummary; errors: any[] }>(
      '/ai/recommendations/backfill/needs',
      { limit, reprocess_existing: reprocessExisting }
    );
    return data;
  }

  async function runBackfillLoop() {
    if (!window.confirm('Run AI backfill for eligible needs now?')) return;

    setBusy(true);
    cancelRef.current = false;
    resetProgress();

    let totalDone = 0;
    let totalErrors = 0;
    let remaining: number | null = null;

    try {
      // loop until server says nothing remains, or user cancels
      // you can tweak batch size here if you want
      const BATCH = 50;

      for (;;) {
        if (cancelRef.current) break;

        const { summary, errors } = await runOneBatch(BATCH, false);
        totalDone += summary.generated;
        totalErrors += (errors?.length ?? 0);
        remaining = summary.remaining_after;

        setProgress({
          totalDone,
          remaining,
          lastBatch: summary,
          errors: totalErrors,
        });

        // stop if the server had nothing to process or nothing left
        if (summary.processed === 0 || summary.remaining_after === 0) break;
      }

      const doneMsg = `Backfill complete. Generated ${totalDone} new recommendation set${totalDone === 1 ? '' : 's'}${totalErrors ? `, ${totalErrors} error${totalErrors === 1 ? '' : 's'}` : ''}.`;
      setMessage(doneMsg);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        'Backfill failed.';
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  function cancelBackfill() {
    cancelRef.current = true;
  }

  return (
    <>
      {/* ───────── Modals ───────── */}
      <AddPersonToDatabaseModal
        isOpen={showAddPerson}
        onClose={() => setShowAddPerson(false)}
      />
      <AddCompanyToDatabaseModal
        isOpen={showAddCompany}
        onClose={() => setShowAddCompany(false)}
      />
      <CreateSubModal
        isOpen={showCreateSub}
        onClose={() => setShowCreateSub(false)}
      />
      <CreateProjectModal
        isOpen={showCreateProject}
        onClose={() => setShowCreateProject(false)}
      />

      {/* ───────── Page body ───────── */}
      <div style={{ padding: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Tasks</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>
          Task management coming soon …
        </p>

        <button className="btn" onClick={() => setShowAddPerson(true)}>
          Add Person to Database
        </button>

        <button className="btn" style={{ marginLeft: 12 }} onClick={() => setShowAddCompany(true)}>
          Add Company to Database
        </button>

        <button className="btn" style={{ marginLeft: 12 }} onClick={() => setShowCreateSub(true)}>
          Create Sub
        </button>

        <button className="btn" style={{ marginLeft: 12 }} onClick={() => setShowCreateProject(true)}>
          Create Project
        </button>

        {/* ───────── Run AI Backfill (Needs) ───────── */}
        <div style={{ display:'inline-flex', gap: 8, alignItems:'center', marginLeft: 12 }}>
          <button
            className="btn"
            onClick={runBackfillLoop}
            disabled={busy}
            title="Generate recommendations for all eligible needs in batches."
          >
            {busy ? 'Running Backfill…' : 'Run AI Backfill (Needs)'}
          </button>
          {busy && (
            <button className="btn" onClick={cancelBackfill}>
              Cancel
            </button>
          )}
        </div>

        {/* Progress readout */}
        {(busy || progress.remaining !== null || message) && (
          <div style={{ marginTop: 12 }}>
            {progress.lastBatch && (
              <div style={{ color:'#046A38' }}>
                <b>Batch:</b> processed {progress.lastBatch.processed}, generated {progress.lastBatch.generated}, skipped {progress.lastBatch.skipped}.<br/>
                <b>Progress:</b> done {progress.totalDone}{progress.errors ? `, errors ${progress.errors}` : ''}{progress.remaining !== null ? `, remaining ${progress.remaining}` : ''}.
              </div>
            )}
            {!progress.lastBatch && busy && (
              <div style={{ color:'#666' }}>Starting backfill…</div>
            )}
            {message && (
              <div style={{ marginTop: 8, color: message.startsWith('Backfill complete') ? '#046A38' : '#b00' }}>
                {message}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
