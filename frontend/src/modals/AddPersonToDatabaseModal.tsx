// frontend/src/modals/AddPersonToDatabaseModal.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { Modal } from './Modal';
import api from '../services/api';
import AddCompanyToDatabaseModal from "./AddCompanyToDatabaseModal";

/* ══════ Enums / helpers ══════ */
const ROLES = ['creative', 'executive', 'external_rep'] as const;
type Role = typeof ROLES[number];
// type CompanyKind = "network" | "studio" | "prodco" | "agency";

const CLIENT_STATUSES = [
  'client',
  'prospective client',
  'non-client',
  'ex-client',
] as const;
type ClientStatus = typeof CLIENT_STATUSES[number];

const WRITER_LEVEL_LABEL: Record<number, string> = {
  0: `Writer’s Assistant`, 0.5: `Writer's Asst / Staff Writer`, 1: `Staff Writer`,
  1.5: `Staff Writer / Story Editor`, 2: `Story Editor`, 2.5: `Story Editor / Exec Story Editor`,
  3: `Exec Story Editor`, 3.5: `Exec Story Editor / Co-Producer`, 4: `Co-Producer`,
  4.5: `Co-Producer / Producer`, 5: `Producer`, 5.5: `Producer / Supervising Producer`,
  6: `Supervising Producer`, 6.5: `Supervising Producer / Co-EP`, 7: `Co-EP`,
  7.5: `Co-EP / EP`, 8: `EP`, 8.5: `EP / Showrunner`, 9: `Showrunner`,
};

/* ══════ Props ══════ */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Optional pre‑selected role ‑– e.g. “executive” if opened from Exec tab */
  initialRole?: Role;
}

/* ══════ Component ══════ */
export default function AddPersonToDatabaseModal({
  isOpen,
  onClose,
  initialRole,
}: Props) {
  /* ────────────────────────────────────────────────
   *  Shared state
   * ────────────────────────────────────────────────*/
  const [role, setRole] = useState<Role | ''>(initialRole ?? '');
  const [stepAck, setStepAck] = useState(false);        // “I acknowledge” toggle for IMDb absent
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [errors, setErrors] = useState<Record<string,string>>({});

  /* ════════════════ CREATIVE form state ════════════════ */
  const [crName, setCrName]                 = useState('');
  const [crImdb, setCrImdb]                 = useState('');
  const [crWarnExists, setCrWarnExists]     = useState<string | null>(null); // if duplicate
  const [clientStatus, setClientStatus]     = useState<ClientStatus | ''>('');
  const [isDir, setIsDir]                   = useState<'yes' | 'no' | ''>('');
  const [hasDirectedFeature, setHasDirFeat] = useState<'yes' | 'no' | ''>('');
  const [isWriter, setIsWriter]             = useState<'yes' | 'no' | ''>('');
  const [writerLevel, setWriterLevel]       = useState<number | ''>('');
  const [tvAcceptable, setTvAcceptable]     = useState<'tv_features' | 'features_only' | ''>('');
  const [crPronouns, setCrPronouns]         = useState('');
  const [crBirthday, setCrBirthday]         = useState('');
  const bParts = splitBirthday(crBirthday);
  const birthdayStr = bParts?.birthday   ?? null;  // "MM/DD/9999" or null
  const birthYear   = bParts?.birth_year ?? null;  // 4‑digit number or null
  const [crLocation, setCrLocation]         = useState('');
  const [crPhone, setCrPhone]               = useState('');
  const [crEmail, setCrEmail]               = useState('');
  const [crAddress, setCrAddress]           = useState('');
  const [crNotes, setCrNotes]               = useState('');

  /* ════════════════ EXECUTIVE  state ════════════════ */
  const [tvNetwork, setTvNetwork]       = useState('');
  const [studio, setStudio]             = useState('');
  const [prodCo, setProdCo]             = useState('');
  const [execListed, setExecListed]     = useState<boolean | null>(null);
  const [execName, setExecName]         = useState('');
  const [execEmail, setExecEmail]       = useState('');
  const [execPhone, setExecPhone]       = useState('');
  const [execTableRows, setExecTable]   = useState<{name:string; email:string}[]>([]);
  const [networks, setNetworks] = useState<{id:string; name:string}[]>([]);
  const [studiosList, setStudiosList] = useState<{id:string; name:string}[]>([]);
  const [prodcos, setProdcos] = useState<{id:string; name:string}[]>([]);
  useEffect(() => {
    if (!isOpen || (networks.length && studiosList.length && prodcos.length)) return;
    Promise.all([
      api.get('/companies/tv_networks'),
      api.get('/companies/studios'),
      api.get('/companies/production_companies'),
    ]).then(([n, s, p]) => {
      setNetworks(n.data);
      setStudiosList(s.data);
      setProdcos(p.data);
    }).catch(console.error);
  }, [isOpen, role, networks.length, prodcos.length, studiosList.length]);
  const someChosen = !!tvNetwork || !!studio || !!prodCo;

  /* ════════════════ EXTERNAL‑REP state ════════════════ */
  const [repListed, setRepListed]   = useState<boolean | null>(null);
  const [repName, setRepName]       = useState('');
  const [repAgencyId, setRepAgencyId] = useState('');
  const [repEmail, setRepEmail]     = useState('');
  const [repPhone, setRepPhone]     = useState('');
  const [agencies, setAgencies] = useState<{id:string; name:string}[]>([]);
  type RepRow = {
    id: string;
    name: string;
    agency: { id: string; name: string } | null;
    email: string | null;
  };
  const [repTableRows, setRepTable] = useState<RepRow[]>([]);

  useEffect(() => {
    if (!isOpen || agencies.length) return;
    api.get("/companies/external_agencies")
       .then(r => setAgencies(r.data))
       .catch(console.error);
  }, [isOpen, agencies.length]);



  // ─── nested modal (“Add company”) control ──────────────────────────────------────────────▲
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [companyModalKind, setCompanyModalKind] = useState<
    "network" | "studio" | "prodco" | "agency" | undefined
  >(undefined);

  /* ─── reusable fetchers ─────────────────────────────────── */
  const loadAgencies = useCallback(() => {
    api
      .get<{ id: string; name: string }[]>("/companies/external_agencies")
      .then((r) => setAgencies(r.data))
      .catch(console.error);
  }, []);

  const loadCompanies = useCallback(() => {
    Promise.all([
      api.get("/companies/tv_networks"),
      api.get("/companies/studios"),
      api.get("/companies/production_companies"),
    ])
      .then(([n, s, p]) => {
        setNetworks(n.data);
        setStudiosList(s.data);
        setProdcos(p.data);
      })
      .catch(console.error);
  }, []);

  /* initial population (runs once per open) */
  useEffect(() => {
    if (isOpen && !agencies.length) loadAgencies();
  }, [isOpen, loadAgencies, agencies.length]);

  useEffect(() => {
    if (
      isOpen &&
      !(networks.length && studiosList.length && prodcos.length)
    )
      loadCompanies();
  }, [isOpen, loadCompanies, networks.length, prodcos.length, studiosList.length]);

  /* after child‑modal closes, refresh what could have changed */
  function handleCompanyModalClose() {
    setShowAddCompany(false);
    if (companyModalKind === "agency") loadAgencies();
    else loadCompanies();
  }


  // ─── Wizard control ───────────────────────────------───────────────▲
  const [step, setStep]       = useState(0);      // 0 = role picked, 1…n = per‑role
  const bumpStep = () => setStep(s => Math.max(s, s + 1));
  
  /* keep step in sync */
  useEffect(() => {                       // a) Name + IMDb acknowledged
    if (role==='creative' && crName.trim() && (isValidImdb(crImdb) || stepAck))
      bumpStep();
  }, [role, crName, crImdb, stepAck]);

  useEffect(() => {                       // b) client‑status chosen
    if (role==='creative' && clientStatus) bumpStep();
  }, [role, clientStatus]);

  useEffect(() => {                       // c) full‑client picks complete
    if (role==='creative' && clientStatus==='client') {
      const okay =
        isDir!=='' && isWriter!=='' && tvAcceptable!=='' &&
        (isDir==='no'   || hasDirectedFeature!=='') &&
        (isWriter==='no' || writerLevel!=='');
      if (okay) bumpStep();
    }
  }, [role, clientStatus, isDir, hasDirectedFeature,
      isWriter, writerLevel, tvAcceptable]);

  useEffect(() => {                       // d) pronouns typed → final step
    if (role==='creative' && crPronouns.trim()) bumpStep();
  }, [role, crPronouns]);

  const showImdbHint =
    role === 'creative' &&
    crName.trim() &&                 // user has started filling step 1
    !isValidImdb(crImdb) &&          // URL still invalid / empty
    !stepAck;                        // hasn’t acknowledged the risk

  /* ───────────────────────── Reset when closed ───────────────────────── */
  useEffect(() => {
    if (!isOpen) {
      setRole(initialRole ?? '');
      setStepAck(false); setSubmitAttempted(false); setErrors({});
      setCrName(''); setCrImdb(''); setCrWarnExists(null);
      setClientStatus(''); setIsDir(''); setHasDirFeat(''); setIsWriter('');
      setWriterLevel(''); setTvAcceptable('');
      setCrPronouns(''); setCrBirthday(''); setCrLocation('');
      setCrPhone(''); setCrEmail(''); setCrAddress(''); setCrNotes('');
      setTvNetwork(''); setStudio(''); setProdCo(''); setExecListed(null);
      setExecName(''); setExecEmail(''); setExecPhone(''); setExecTable([]);
      setRepListed(null); setRepName(''); setRepEmail('');
      setRepPhone(''); setRepTable([]);
    }
  }, [isOpen, initialRole]);


  
  /* ───────────────────────── Helpers ───────────────────────── */
  function isValidImdb(u: string) {
    return /^https?:\/\/(www\.)?imdb\.com\/name\/nm\d+\/?$/.test(u.trim());
  }

  /* ───────── birthday helpers ───────── */
  type BirthdayParts = { birthday: string; birth_year: number } | null;

  function splitBirthday(str: string): BirthdayParts {
    // Accept “M/D/YYYY” or “MM‑DD‑YYYY” – any / or ‑ separator
    const parts = str.trim().split(/[/-]/).filter(Boolean);
    if (parts.length !== 3) return null;                 // still typing

    const [m, d, y] = parts;
    // basic sanity checks
    if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d) || !/^\d{2,4}$/.test(y))
      return null;

    const month = m.padStart(2, "0");
    const day   = d.padStart(2, "0");
    return { birthday: `${month}/${day}/9999`, birth_year: +y };
  }


  async function checkDuplicateImdb(url: string) {
    const slug = url.trim().replace(/\/+$/,'').split('/').pop(); // “nm1234567”
    if (!slug) return;
    // TODO call your backend
    const { data } = await api.get<{ exists:boolean; name?:string }>(`/creatives/exists_imdb/${slug}`);
    if (data.exists) setCrWarnExists(data.name ?? 'Unknown Name');
    else setCrWarnExists(null);
  }

  /* Fire duplicate‑check on blur */
  useEffect(() => { if (isValidImdb(crImdb)) checkDuplicateImdb(crImdb); }, [crImdb]);

  /* Exec: load table when a company pick changes */
  useEffect(() => {
    const company = tvNetwork || studio || prodCo;
    if (!company) { setExecTable([]); return; }
  
    api.get<{name:string; email:string}[]>(`/executives/company/${company}`)
       .then(r => setExecTable(r.data))
       .catch(console.error);
  }, [tvNetwork, studio, prodCo]);

  /* Rep table fetch (once when modal opens) */
  useEffect(() => {
    if (!isOpen || role !== "external_rep") return;
  
    api
      .get<
        {
          id: string;
          name: string;
          agency: { id: string; name: string } | null;
          email: string | null;
        }[]
      >("/external_reps")
      .then((r) => setRepTable(r.data))
      .catch(console.error);
  }, [isOpen, role]);
  
  const canSaveCreative = () => step>=4;             // pronouns field now visible
  
  // function imdbOk() {
  //   return isValidImdb(crImdb);
  // }
  
  /* … EXEC & REP helpers if you later add multi‑step UI for them … */
  
  /**
   * handleNext ────────────────────────────────────────────
   */
  function handleNext() {
    if (!validate()) return;
    bumpStep();
  }

  /* ───────────────────────── Validation ───────────────────────── */
  function validate(): boolean {
    const next: Record<string,string> = {};

    if (!role) next.role = 'Choose a role';

    if (role === 'creative') {
      if (!crName.trim())               next.crName = 'Enter name';
      if (!crImdb.trim() && !stepAck)   next.crImdb = 'IMDb URL missing';
      if (isValidImdb(crImdb) && crWarnExists) next.crImdb = 'Creative already exists';
      if (clientStatus === '')          next.clientStatus = 'Pick client status';
      if (clientStatus === 'client') {
        if (isDir === '')               next.isDir = 'Director?';
        if (isWriter === '')            next.isWriter = 'Writer?';
        if (isDir === 'yes' && hasDirectedFeature === '') next.hasDir = 'Has directed feature?';
        if (isWriter === 'yes' && writerLevel === '')     next.wlvl  = 'Pick level';
        if (tvAcceptable === '')        next.medium = 'Pick medium';
      }
    }

    if (role === 'executive') {
      if (!tvNetwork && !studio && !prodCo) next.company = 'Select one company';
      if (execListed === null)              next.execListed = 'Answer listed?';
      if (execListed === false && execName.trim().length < 4) next.execName = 'Provide name';
    }

    if (role === 'external_rep') {
      if (repListed === null)                 next.repListed = 'Answer listed?';
      if (repListed === false) {
        if (repName.trim().length < 4)        next.repName = 'Provide name';
        if (!repAgencyId)                     next.repAgencyId = 'Choose agency';
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /* ───────────────────────── Save handler ───────────────────────── */
  async function handleSave() {
    setSubmitAttempted(true);
    if (!validate()) return;
    setSaving(true);
    try {
      // Build payload per role
      let body: any = { role };

      if (role === "creative") {
        body = {
          ...body,
          name: crName.trim(),
          imdb_id: crImdb.trim() || null,

          /* client info */
          client_status: clientStatus || null,
          is_director: isDir === "yes",
          has_directed_feature:
            isDir === "yes" ? hasDirectedFeature === "yes" : null,
          is_writer: isWriter === "yes",
          writer_level: isWriter === "yes" ? writerLevel : null,
          tv_acceptable:
            tvAcceptable === "tv_features"
              ? true
              : tvAcceptable === "features_only"
              ? false
              : null,

          /* optional personal details */
          pronouns: crPronouns.trim() || null,
          birthday: birthdayStr,          // <-- uses helper output
          birth_year: birthYear,          // <-- uses helper output
          location: crLocation.trim() || null,
          phone: crPhone.trim() || null,
          email: crEmail.trim() || null,
          address: crAddress.trim() || null,
          industry_notes: crNotes.trim() || null,
        };
      }

      if (role === 'executive') {
        body = {
          ...body,
          company_type: tvNetwork ? 'network' : studio ? 'studio' : 'prodco',
          company_id: tvNetwork || studio || prodCo,
          name: execName.trim() || null,
          email: execEmail.trim() || null,
          phone: execPhone.trim() || null,
        };
      }
      if (role === 'external_rep') {
        body = {
          ...body,
          name   : repName.trim() || null,
          agency_id: repAgencyId,
          email  : repEmail.trim() || null,
          phone  : repPhone.trim() || null,
        };
      }

      /* ────────── SAVE ────────── */
      let endpoint = '';
      if (role === 'creative')      endpoint = '/creatives';
      else if (role === 'executive')endpoint = '/executives';
      else if (role === 'external_rep') endpoint = '/external_reps';
      await api.post(endpoint, body);

      onClose();
    } catch (err) {
      alert('Failed to save');
      console.error(err);
    } finally { setSaving(false); }
  }

  /* ════════════════════════════════ RENDER ════════════════════════════════ */
  const invalidGlow: React.CSSProperties = {
    outline:'2px solid #e00', outlineOffset:1, boxShadow:'0 0 0 2px rgba(255,0,0,.4)',
  };

  return (
    <>
      {/* ────────── Add‑Company nested modal ────────── */}
      <AddCompanyToDatabaseModal
        isOpen={showAddCompany}
        initialKind={companyModalKind}
        onClose={handleCompanyModalClose}
      />

      {/* ────────── ORIGINAL (parent) Modal ────────── */}
      <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Add person" staticBackdrop>
        <h2 className="text-2xl font-semibold mb-4">Add Person to Database</h2>

        {/* ────────── ROLE PICKER ────────── */}
        <label style={{ display:'block', marginBottom:8, ...(submitAttempted&&errors.role?invalidGlow:null) }}>
          Role
          <select
            style={{ marginLeft:8 }}
            value={role}
            onChange={e => { setRole(e.target.value as Role); setSubmitAttempted(false); }}
          >
            <option value="">— choose —</option>
            <option value="creative">Creative</option>
            <option value="executive">Executive</option>
            <option value="external_rep">External Talent Rep</option>
          </select>
        </label>

        {/* ═════════════ CREATIVE SECTION ═════════════ */}
        {role === 'creative' && (
          <>
            <label style={{ display:'block', marginTop:12, ...(submitAttempted&&errors.crName?invalidGlow:null) }}>
              Name <input value={crName} onChange={e=>setCrName(e.target.value)} style={{ marginLeft:8, width:'60%' }}/>
            </label>

            <label style={{ display:'block', marginTop:8, ...(submitAttempted&&errors.crImdb?invalidGlow:null) }}>
              IMDb URL
              <input
                value={crImdb}
                onChange={e=>{ setCrImdb(e.target.value); setStepAck(false); }}
                placeholder="https://www.imdb.com/name/nm1234567/"
                style={{ marginLeft:8, width:'60%' }}
              />
            </label>

            {crWarnExists && (
              <p style={{ color:'#e00', fontSize:12, marginTop:4 }}>
                This IMDb ID already exists as “{crWarnExists}”.
              </p>
            )}

            {showImdbHint && (
              <div style={{ marginTop:4, fontSize:12, color:'#c60' }}>
                Supplying a valid IMDb URL helps prevent duplicates.
                {!stepAck ? (
                  <button className="tab" style={{ marginLeft:8,padding:'2px 6px',fontSize:'0.75rem' }}
                          onClick={()=>setStepAck(true)}>
                    I acknowledge this risk
                  </button>
                ) : <span style={{ marginLeft:8, color:'#080' }}>Acknowledged</span>}
              </div>
            )}

            {/* NEXT group appears when either IMDb valid or user acknowledged */}
            {(isValidImdb(crImdb) || stepAck) && (
              <>
                <label style={{ display:'block', marginTop:16, ...(submitAttempted&&errors.clientStatus?invalidGlow:null) }}>
                  Client Status
                  <select value={clientStatus}
                    onChange={e=>setClientStatus(e.target.value as ClientStatus)}
                    style={{ marginLeft:8 }}>
                    <option value="">— choose —</option>
                    {CLIENT_STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </label>

                {/* Only show writer/dir etc. for full clients */}
                {clientStatus === 'client' && (
                  <>
                    <label style={{ marginTop:8, display:'block', ...(submitAttempted&&errors.isDir?invalidGlow:null) }}>
                      Is Director?
                      <select value={isDir} onChange={e=>{setIsDir(e.target.value as any); if(e.target.value==='no')setHasDirFeat('');}} style={{ marginLeft:8 }}>
                        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                      </select>
                    </label>

                    <label style={{ marginTop:8, display:'block', ...(submitAttempted&&errors.hasDir?invalidGlow:null) }}>
                      Has Directed Feature?
                      <select value={hasDirectedFeature} disabled={isDir!=='yes'}
                              onChange={e=>setHasDirFeat(e.target.value as any)} style={{ marginLeft:8 }}>
                        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                      </select>
                    </label>

                    <label style={{ marginTop:8, display:'block', ...(submitAttempted&&errors.isWriter?invalidGlow:null) }}>
                      Is Writer?
                      <select value={isWriter} onChange={e=>{setIsWriter(e.target.value as any); if(e.target.value==='no')setWriterLevel('');}} style={{ marginLeft:8 }}>
                        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                      </select>
                    </label>

                    <label style={{ marginTop:8, display:'block', ...(submitAttempted&&errors.wlvl?invalidGlow:null) }}>
                      Writer Level
                      <select value={writerLevel} disabled={isWriter!=='yes'}
                              onChange={e=>setWriterLevel(+e.target.value)} style={{ marginLeft:8 }}>
                        <option value="">—</option>
                        {Object.entries(WRITER_LEVEL_LABEL).map(([num,lab])=>(
                          <option key={num} value={num}>{lab}</option>
                        ))}
                      </select>
                    </label>

                    <label style={{ marginTop:8, display:'block', ...(submitAttempted&&errors.medium?invalidGlow:null) }}>
                      Media Type
                      <select value={tvAcceptable} onChange={e=>setTvAcceptable(e.target.value as any)} style={{ marginLeft:8 }}>
                        <option value="">—</option>
                        <option value="tv_features">TV / Features</option>
                        <option value="features_only">Features Only</option>
                      </select>
                    </label>
                  </>
                )}

                {/* Optional details */}
                <details style={{ marginTop:16 }}>
                  <summary className="clickable">Optional Details</summary>
                  <label style={{ display:'block', marginTop:8 }}>Pronouns
                    <input value={crPronouns} onChange={e=>setCrPronouns(e.target.value)} style={{ marginLeft:8 }}/>
                  </label>
                  <label style={{ display:"block", marginTop:8 }}>
                    Birthday (MM/DD/YYYY)
                    <input
                      value={crBirthday}
                      placeholder="12/25/1958"
                      onChange={e => setCrBirthday(e.target.value)}
                      style={{ marginLeft:8 }}
                    />
                  </label>
                  <label style={{ display:'block',marginTop:8 }}>Location
                    <input value={crLocation} onChange={e=>setCrLocation(e.target.value)} style={{ marginLeft:8 }}/>
                  </label>
                  <label style={{ display:'block',marginTop:8 }}>Phone
                    <input value={crPhone} onChange={e=>setCrPhone(e.target.value)} style={{ marginLeft:8 }}/>
                  </label>
                  <label style={{ display:'block',marginTop:8 }}>Email
                    <input value={crEmail} onChange={e=>setCrEmail(e.target.value)} style={{ marginLeft:8 }}/>
                  </label>
                  <label style={{ display:'block',marginTop:8 }}>Address
                    <input value={crAddress} onChange={e=>setCrAddress(e.target.value)} style={{ marginLeft:8, width:'70%' }}/>
                  </label>
                  <label style={{ display:'block', marginTop:8 }}>Industry Notes
                    <textarea value={crNotes} onChange={e=>setCrNotes(e.target.value)} style={{ marginLeft:8, width:'100%' }}/>
                  </label>
                </details>
              </>
            )}
          </>
        )}

        {/* ═════════ EXECUTIVE SECTION ═════════ */}
        {role === 'executive' && (
          <>
            {/* Row of three dropdowns */}
            <div style={{ display:'flex', gap:12, marginTop:12 }}>

              <select
                value={tvNetwork}
                onChange={e => {                // choose a network ➜ clear others
                  setTvNetwork(e.target.value);
                  setStudio('');
                  setProdCo('');
                }}
                style={{ opacity: tvNetwork ? 1 : (someChosen && !tvNetwork ? .45 : 1) }}
              >
                <option value="">TV Network</option>
                {networks.map(n => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>

              <select
                value={studio}
                onChange={e => {
                  setStudio(e.target.value);
                  setTvNetwork('');
                  setProdCo('');
                }}
                style={{ opacity: studio ? 1 : (someChosen && !studio ? .45 : 1) }}
              >
                <option value="">Studio</option>
                {studiosList.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={prodCo}
                onChange={e => {
                  setProdCo(e.target.value);
                  setTvNetwork('');
                  setStudio('');
                }}
                style={{ opacity: prodCo ? 1 : (someChosen && !prodCo ? .45 : 1) }}
              >
                <option value="">Production Company</option>
                {prodcos.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

            </div>
            {submitAttempted && errors.company && (
              <div style={{color:'#e00',fontSize:12}}>{errors.company}</div>
            )}

            {/* quick add link */}
            <p style={{ fontSize: 12, marginTop: 6 }}>
              Network&nbsp;/&nbsp;Studio&nbsp;/&nbsp;Prod.&nbsp;Co. not listed?{" "}
              <span
                style={{ color: "#06c", cursor: "pointer", textDecoration: "underline" }}
                onClick={() => {
                  setCompanyModalKind(undefined);   // let user choose type
                  setShowAddCompany(true);
                }}
              >
                Add new company to database
              </span>
            </p>

            {/* Exec table */}
            {execTableRows.length > 0 && (
              <table style={{ borderCollapse:'collapse', marginTop:16 }}>
                <thead><tr><th style={{padding:4,border:'1px solid #ddd'}}>Name</th><th style={{padding:4,border:'1px solid #ddd'}}>Email</th></tr></thead>
                <tbody>
                  {execTableRows.map(r=>(
                    <tr key={r.email}>
                      <td style={{padding:4,border:'1px solid #eee'}}>{r.name}</td>
                      <td style={{padding:4,border:'1px solid #eee'}}>{r.email??'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Listed?  Yes / No chips */}
            { (tvNetwork || studio || prodCo) && (
              <div style={{ marginTop: 12 }}>
                <span style={{ marginRight: 8 }}>Executive listed above?</span>

                <button
                  className={`tab ${execListed===false ? 'active' : ''}`}
                  onClick={() => setExecListed(false)}
                  style={{ padding:'4px 12px', fontSize:'0.8rem' }}
                >
                  No
                </button>

                <button
                  className={`tab ${execListed===true ? 'active' : ''}`}
                  onClick={() => setExecListed(true)}
                  style={{ padding:'4px 12px', fontSize:'0.8rem', marginLeft:4 }}
                >
                  Yes
                </button>
              </div>
            )}
            {submitAttempted && errors.execListed && (
              <div style={{ color:'#e00', fontSize:12 }}>{errors.execListed}</div>
            )}

            {/* New‑exec fields */}
            {execListed===false && (
              <>
                <label style={{ display:'block', marginTop:12, ...(submitAttempted&&errors.execName?invalidGlow:null) }}>
                  Executive Name
                  <input value={execName} onChange={e=>setExecName(e.target.value)} style={{ marginLeft:8, width:'60%' }}/>
                </label>
                <label style={{ display:'block', marginTop:8 }}>
                  Email <input value={execEmail} onChange={e=>setExecEmail(e.target.value)} style={{ marginLeft:8 }}/>
                </label>
                <label style={{ display:'block', marginTop:8 }}>
                  Phone <input value={execPhone} onChange={e=>setExecPhone(e.target.value)} style={{ marginLeft:8 }}/>
                </label>
              </>
            )}
          </>
        )}

        {/* ═════════ EXTERNAL‑REP SECTION ═════════ */}
        {role === 'external_rep' && (
          <>
            {/* Table of reps */}
            {repTableRows.length > 0 && (
              <table style={{ borderCollapse:'collapse', marginTop:16 }}>
                <thead><tr>
                  <th style={{padding:4,border:'1px solid #ddd'}}>Name</th>
                  <th style={{padding:4,border:'1px solid #ddd'}}>Agency</th>
                  <th style={{padding:4,border:'1px solid #ddd'}}>Email</th>
                </tr></thead>
                <tbody>
                  {repTableRows.map(r=>(
                    <tr key={r.email}>
                      <td style={{padding:4,border:'1px solid #eee'}}>{r.name}</td>
                      <td style={{padding:4,border:'1px solid #eee'}}>{r.agency ? r.agency.name : "—"}</td>
                      <td style={{padding:4,border:'1px solid #eee'}}>{r.email??'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Listed?  Yes / No chips */}
            {repTableRows.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span style={{ marginRight: 8 }}>Rep listed above?</span>

                <button
                  className={`tab ${repListed === false ? 'active' : ''}`}
                  onClick={() => setRepListed(false)}
                  style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                >
                  No
                </button>

                <button
                  className={`tab ${repListed === true ? 'active' : ''}`}
                  onClick={() => setRepListed(true)}
                  style={{ padding: '4px 12px', fontSize: '0.8rem', marginLeft: 4 }}
                >
                  Yes
                </button>
              </div>
            )}

            {submitAttempted && errors.repListed && (
              <div style={{ color: '#e00', fontSize: 12 }}>{errors.repListed}</div>
            )}

            {/* New rep */}
            {repListed===false && (
              <>
                <label style={{ display:'block', marginTop:12, ...(submitAttempted&&errors.repName?invalidGlow:null) }}>
                  Rep Name
                  <input value={repName} onChange={e=>setRepName(e.target.value)} style={{ marginLeft:8, width:'60%' }}/>
                </label>
                <label style={{ display:'block', marginTop:8 }}>
                  Agency&nbsp;
                  <select
                    value={repAgencyId}
                    onChange={e => setRepAgencyId(e.target.value)}
                    style={{ marginLeft:8 }}
                  >
                    <option value="">— choose —</option>
                    {agencies.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
                <p style={{ fontSize: 12, marginTop: 6 }}>
                  Agency not listed?{" "}
                  <span
                    style={{ color: "#06c", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => {
                      setCompanyModalKind("agency");   // pre‑select External Agency
                      setShowAddCompany(true);
                    }}
                  >
                    Add new agency to database
                  </span>
                </p>
                <label style={{ display:'block', marginTop:8 }}>
                  Email <input value={repEmail} onChange={e=>setRepEmail(e.target.value)} style={{ marginLeft:8 }}/>
                </label>
                <label style={{ display:'block', marginTop:8 }}>
                  Phone <input value={repPhone} onChange={e=>setRepPhone(e.target.value)} style={{ marginLeft:8 }}/>
                </label>
              </>
            )}
          </>
        )}

        {/* ────────── ACTIONS ────────── */}
        {submitAttempted && Object.keys(errors).length>0 && (
          <div style={{ color:'#e00', fontSize:12, marginTop:8 }}>Fix the highlighted fields.</div>
        )}
        {(role==='executive'&&execListed===true) && (
          <p style={{color:'#c00', marginTop:8}}>
            Executive already in database. Please cancel request.
          </p>
        )}
        {(role==='external_rep'&&repListed===true) && (
          <p style={{color:'#c00', marginTop:8}}>
            Rep already in database. Please cancel request.
          </p>
        )}

        <div style={{ marginTop:24, display:'flex', justifyContent:'flex-end', gap:12 }}>
          <button className="tab" onClick={onClose}>Cancel</button>

          {/* NEXT visible until final step; Save afterwards */}
          {role==='creative' && !canSaveCreative() && (
            <button className="tab" onClick={handleNext}>Next</button>
          )}

          {role==='creative' && canSaveCreative() && (
            <button className="tab" disabled={saving} onClick={handleSave}>
              {saving?'Saving…':'Save'}
            </button>
          )}

          {/* Exec / Rep: simple rule ‑ show Save after required name len ≥4 */}
          {role==='executive' && execListed===false && execName.trim().length>=4 && (
            <button className="tab" disabled={saving} onClick={handleSave}>
              {saving?'Saving…':'Save'}
            </button>
          )}
          {role==='external_rep'
          && repListed===false
          && repName.trim().length>=4
          && repAgencyId
          && (
            <button className="tab" disabled={saving} onClick={handleSave}>
              {saving?'Saving…':'Save'}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
