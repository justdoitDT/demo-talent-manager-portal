// frontend/src/modals/CreateProjectModal.tsx
import React, {
  useCallback, useEffect, useMemo, useState, useRef, memo,
} from 'react';
import { Modal } from './Modal';
import api from '../services/api';
import { SearchDropdown } from '../components/SearchDropdown';

/* ═══════════════════════════════════════════════════════ */
/* Types & Constants                                       */
/* ═══════════════════════════════════════════════════════ */
export interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: report the newly-created project and whether samples were linked here */
  onSaved?: (project: { id: string; title: string }, samplesLinked: boolean) => void;
  /** If provided, preselect this creative as the client (personal project). */
  initialCreativeId?: string;
  /** Default answer for “Is this a personal project?” */
  initialIsPersonal?: 'yes' | 'no';
}

interface Option   { id:string; label:string; group?:string; }
interface NeedRow  { need:string; description:string; }
interface PendingSample {
  file: File;           // the PDF / DOC / DOCX
  description: string;  // “23‑page pilot…”
  summary: string;      // ~400‑word synopsis
}

type Blankable<T extends string> = '' | T;

const MEDIA_TYPES = [
  'Feature','TV Series','Short','Music Video','Podcast Series','TV Mini Series',
  'TV Movie','TV Short','TV Special','Video Game','Other',
] as const;
type MediaType = Blankable<typeof MEDIA_TYPES[number]> | string;   // custom for "Other"

const PRODUCTION_PHASES = [
  'Idea / Concept','In Development','Pitch-Ready','Sold','Archived',
] as const;
type ProdPhase = Blankable<typeof PRODUCTION_PHASES[number]>;

const TRACKING_STATUSES = [
  'Internal / Not Tracking', 'Tracking','Priority Tracking','Deep Tracking','Hot List','Active',
  'Development','Engaged','Archived',
] as const;
type TrackingStatus = Blankable<typeof TRACKING_STATUSES[number]>;

const PROJECT_TYPES = [
  'Staffing','OWA','ODA','Episodic Directing','Re-write','1st in','Pitch',
] as const;

const NEED_CODES = [
  'Director (Any)','Director (Has Directed Feature)',
  'Writer (Any)','Writer (Upper)','Writer (Mid - Upper)',
  'Writer (Mid)','Writer (Lower - Mid)','Writer (Low)',
] as const;

/* ═══════════════════════════════════════════════════════ */
/* Helper components                                       */
/* (memo‑wrapped so React keeps element identity)          */
/* ═══════════════════════════════════════════════════════ */

interface GeneralProps {
  submitAttempted:boolean; errors:Record<string,string>;
  title:string; setTitle:(v:string)=>void;
  imdbUrl:string; setImdbUrl:(v:string)=>void;
  mediaType:MediaType; setMediaType:(v:MediaType)=>void;
  otherMediaType:string; setOtherMediaType:(v:string)=>void;
  year:string; setYear:(v:string)=>void;
  description:string; setDescription:(v:string)=>void;
  prodPhase:ProdPhase; setProdPhase:(v:ProdPhase)=>void;
  tracking:TrackingStatus; setTracking:(v:TrackingStatus)=>void;

  tagMaster:Option[]; tags:Option[]; setTags:(cb:(t:Option[])=>Option[])=>void;
}
const glowStyle = { outline:'2px solid #e00', outlineOffset:1 } as const;

const GeneralStep = memo((p:GeneralProps) => {
  const {
    submitAttempted, errors,
    title, setTitle,
    imdbUrl, setImdbUrl,
    mediaType, setMediaType,
    otherMediaType, setOtherMediaType,
    year, setYear,
    description, setDescription,
    prodPhase, setProdPhase,
    tracking, setTracking,
    tagMaster, tags, setTags,
  } = p;

  const show = (key:string) => (submitAttempted && errors[key]) ? glowStyle : undefined;

  return (
    <section style={{ marginTop:24 }}>
      <h3 className="font-semibold mb-2 text-lg">General Information</h3>

      {/* Title */}
      <label style={show('title')}>
        Title*<br/>
        <input style={{ width:400 }} value={title}
               onChange={e=>setTitle(e.target.value)}/><br/>
      </label>

      {/* IMDb */}
      <label style={{ marginTop:16 }}>
        IMDb URL<br/>
        <input style={{ width:400 }} placeholder="https://www.imdb.com/title/tt0119217"
               value={imdbUrl} onChange={e=>setImdbUrl(e.target.value)}/><br/>
      </label>

      {/* Media Type */}
      <label style={{ marginTop:16, ...show('mediaType') }}>
        Media Type*<br/>
        <select style={{ width:400 }} value={mediaType}
                onChange={e=>setMediaType(e.target.value as MediaType)}>
          <option value="">— choose —</option>
          {MEDIA_TYPES.map(t=><option key={t}>{t}</option>)}
        </select>
      </label>
      {mediaType==='Other' && (
        <input style={{ width:400, marginTop:4 }} placeholder="Custom media type"
               value={otherMediaType} onChange={e=>setOtherMediaType(e.target.value)}/>
      )}

      {/* Year */}
      <br/>
      <label style={{ marginTop:16, ...show('year') }}>
        Year<br/>
        <input style={{ width:120 }} placeholder="YYYY" maxLength={4}
               value={year} onChange={e=>setYear(e.target.value)}/>
      </label>

      {/* Description */}
      <br/>
      <label style={{ marginTop:16 }}>
        Description<br/>
        <textarea style={{ width:600, height:120 }}
                  value={description} onChange={e=>setDescription(e.target.value)}/>
      </label>

      {/* Genre tags */}
      <div style={{ marginTop:16 }}>
        <label style={{ display:'block', marginBottom:4 }}>Genre Tags</label>
        <SearchDropdown
          placeholder="Search genre tags"
          fetchOptions={async q=>{
            const hits = tagMaster.filter(t=>
              t.label.toLowerCase().includes(q.toLowerCase()));
            return [{ id:'__new__', label:'Add New Tag to Database' }, ...hits];
          }}
          onSelect={o=>{
            if (o.id==='__new__') {
              const name = prompt('New genre tag name?')?.trim();
              if (name && !tags.some(t=>t.label===name))
                setTags(ts=>[...ts,{ id:'__new__', label:name }]);
              return;
            }
            if (!tags.some(t=>t.id===o.id)) setTags(ts=>[...ts,o]);
          }}
          groupSort="none"
          style={{ width:400 }}
        />
        <div style={{ marginTop:4 }}>
          {tags.map(t=>(
            <span key={t.label}
                  style={{ background:'#eee', padding:'2px 6px',
                           borderRadius:4, fontSize:12, marginRight:4 }}>
              {t.label}
              <span style={{ cursor:'pointer', marginLeft:4 }}
                    onClick={()=>setTags(ts=>ts.filter(x=>x!==t))}>×</span>
            </span>
          ))}
        </div>
      </div>

      {/* Production Phase */}
      <label style={{ marginTop:16, ...show('prodPhase') }}>
        Production Phase*<br/>
        <select style={{ width:400 }} value={prodPhase}
                onChange={e=>setProdPhase(e.target.value as ProdPhase)}>
          <option value="">— choose —</option>
          {PRODUCTION_PHASES.map(p=><option key={p}>{p}</option>)}
        </select><br/>
      </label>
      
      {/* Tracking */}
      <label style={{ marginTop:16, ...show('tracking') }}>
        Tracking Status*<br/>
        <select style={{ width:400 }} value={tracking}
                onChange={e=>setTracking(e.target.value as TrackingStatus)}>
          <option value="">— choose —</option>
          {TRACKING_STATUSES.map(t=><option key={t}>{t}</option>)}
        </select>
      </label>
    </section>
  );
});
GeneralStep.displayName='GeneralStep';

/* ---- Clients step ---- */
interface ClientProps {
  isPersonal:'yes'|'no'; setIsPersonal:(v:'yes'|'no')=>void;
  clients:Option[]; setClients:(cb:(c:Option[])=>(Option[]))=>void;
  fetchCreativeOptions:(q:string)=>Promise<Option[]>;
  submitAttempted:boolean; missing:boolean;
}
const ClientsStep = memo((p:ClientProps)=>{
  const { isPersonal,setIsPersonal,clients,setClients,
          fetchCreativeOptions,submitAttempted,missing } = p;

  return (
    <section style={{ marginTop:24 }}>
      <h3 className="font-semibold mb-2 text-lg">Clients</h3>

      <label>
        Is this a <strong>Personal Project </strong>
        belonging to a client?
        <br/>
        <select value={isPersonal}
                onChange={e=>setIsPersonal(e.target.value as 'yes'|'no')}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
        <br/>
      </label>

      {isPersonal==='yes' && (
        <>
        
        <div style={{ marginTop:12 }}>
          <label>
            <br/><br/>
            Which client?
          </label>
        </div>

          <div style={{ marginTop:12 }}>
            <SearchDropdown
              placeholder="Search clients"
              fetchOptions={fetchCreativeOptions}
              onSelect={o=>{
                setClients(prev=>prev.some(c=>c.id===o.id)?prev:[...prev,o]);
              }}
              groupSort={['Clients','Other Creatives']}
            />
            {submitAttempted && missing && (
              <div style={{ color:'#e00', fontSize:12 }}>Add at least one client</div>
            )}
          </div>

          <div style={{ marginTop:4 }}>
            {clients.map(c=>(
              <span key={c.id}
                    style={{ background:'#eee', padding:'2px 6px',
                             borderRadius:4, fontSize:12, marginRight:4 }}>
                {c.label}
                <span style={{ cursor:'pointer', marginLeft:4 }}
                      onClick={()=>setClients(cs=>cs.filter(x=>x!==c))}>×</span>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
});
ClientsStep.displayName='ClientsStep';

/* ---- Companies & Execs step ---- */
interface CoProps {
  networks:Option[]; setNetworks:(cb:(n:Option[])=>Option[])=>void;
  studios:Option[];  setStudios:(cb:(s:Option[])=>Option[])=>void;
  prodcos:Option[];  setProdcos:(cb:(p:Option[])=>Option[])=>void;
  execs:Option[];    setExecs:(cb:(e:Option[])=>Option[])=>void;

  fetchNetworkOpts:(q:string)=>Promise<Option[]>;
  fetchStudioOpts :(q:string)=>Promise<Option[]>;
  fetchProdcoOpts :(q:string)=>Promise<Option[]>;
  fetchExecOpts   :(q:string)=>Promise<Option[]>;
}
const CoStep = memo((p:CoProps)=>{
  const {
    networks,setNetworks,
    studios,setStudios,
    prodcos,setProdcos,
    execs,setExecs,
    fetchNetworkOpts,fetchStudioOpts,fetchProdcoOpts,fetchExecOpts,
  } = p;

  const add = (setter:(cb:(x:Option[])=>Option[])=>void)=>
    (o:Option)=>setter(prev=>prev.some(x=>x.id===o.id)?prev:[...prev,o]);

  const remove = (setter:(cb:(x:Option[])=>Option[])=>void)=>
    (o:Option)=>setter(prev=>prev.filter(x=>x!==o));

  const chipList = (arr:Option[], rm:(o:Option)=>void)=>(
    arr.map(o=>(
      <span key={o.id}
            style={{ background:'#eee', padding:'2px 6px',
                     borderRadius:4, fontSize:12, marginRight:4 }}>
        {o.label}
        <span style={{ cursor:'pointer', marginLeft:4 }} onClick={()=>rm(o)}>×</span>
      </span>
    ))
  );

  return (
    <section style={{ marginTop:24 }}>
      <h3 className="font-semibold mb-2 text-lg">Companies & Executives</h3>

      {/* Networks */}
      <label>TV Networks</label>
      <br/>
      <SearchDropdown placeholder="Search networks"
                      fetchOptions={fetchNetworkOpts}
                      onSelect={add(setNetworks)}
                      groupSort="alpha"/>
      <div style={{ margin:'4px 0 12px' }}>{chipList(networks,remove(setNetworks))}</div>

      {/* Studios */}
      <label>Studios</label>
      <br/>
      <SearchDropdown placeholder="Search studios"
                      fetchOptions={fetchStudioOpts}
                      onSelect={add(setStudios)}
                      groupSort="alpha"/>
      <div style={{ margin:'4px 0 12px' }}>{chipList(studios,remove(setStudios))}</div>

      {/* ProdCos */}
      <label>Production Companies</label>
      <br/>
      <SearchDropdown placeholder="Search prodcos"
                      fetchOptions={fetchProdcoOpts}
                      onSelect={add(setProdcos)}
                      groupSort="alpha"/>
      <div style={{ margin:'4px 0 12px' }}>{chipList(prodcos,remove(setProdcos))}</div>

      {/* Execs */}
      <label>Executives</label>
      <br/>
      <SearchDropdown placeholder="Search executives"
                      fetchOptions={fetchExecOpts}
                      onSelect={add(setExecs)}
                      groupSort="alpha"/>
      <div style={{ margin:'4px 0' }}>{chipList(execs,remove(setExecs))}</div>
    </section>
  );
});
CoStep.displayName='CoStep';

/* ---- Needs step ---- */
interface NeedProps {
  projTypes:string[]; setProjTypes:(cb:(p:string[])=>string[])=>void;
  needs:NeedRow[]; setNeeds:(cb:(n:NeedRow[])=>NeedRow[])=>void;
}
const NeedsStep = memo((p:NeedProps)=>{
  const { projTypes,setProjTypes,needs,setNeeds } = p;

  return (
    <section style={{ marginTop:24 }}>
      <h3 className="font-semibold mb-2 text-lg">Project Needs</h3>

      {/* Project types */}
      <strong>Project Type(s)</strong>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:4 }}>
        {PROJECT_TYPES.map(pt=>(
          <label key={pt} style={{ fontSize:13 }}>
            <input type="checkbox"
                   checked={projTypes.includes(pt)}
                   onChange={e=>setProjTypes(prev=>
                     e.target.checked
                       ? [...prev,pt]
                       : prev.filter(x=>x!==pt)
                   )}/> {pt}
          </label>
        ))}
      </div>

      {/* Needs */}
      <div style={{ marginTop:12 }}>
        <strong>Needs</strong>
        {NEED_CODES.map(code=>{
          const row = needs.find(n=>n.need===code);
          return (
            <div key={code} style={{ marginTop:6 }}>
              <label>
                <input type="checkbox"
                       checked={!!row}
                       onChange={e=>{
                         if (e.target.checked) {
                           setNeeds(prev=>[...prev,{ need:code, description:'' }]);
                         } else {
                           setNeeds(prev=>prev.filter(n=>n.need!==code));
                         }
                       }}/>{' '}
                {code}
              </label>
              {row && (
                <input style={{ marginLeft:8, width:400 }}
                       placeholder="ex.) diverse, experienced co‑producer"
                       value={row.description}
                       onChange={e=>{
                         setNeeds(prev=>prev.map(n=>
                           n.need===code ? { ...n, description:e.target.value } : n));
                       }}/>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
});
NeedsStep.displayName='NeedsStep';

/* ---- Writing Samples step (personal projects) ---- */
interface SampProps {
  samples: PendingSample[];
  setSamples: (cb:(s:PendingSample[])=>PendingSample[])=>void;
}
const SampStep = memo((p:SampProps)=>{
  const { samples,setSamples } = p;

  const addFile = (f:File)=>{
    setSamples(arr=>[...arr,{ file:f, description:'', summary:'' }]);
  };
  const rm = (idx:number)=> setSamples(arr=>arr.filter((_,i)=>i!==idx));

  return (
    <section style={{ marginTop:24 }}>
      <h3 className="font-semibold mb-2 text-lg">Writing Samples</h3>

      <input
        type="file"
        accept=".pdf,.doc,.docx"
        onChange={e=>{
          const f=e.target.files?.[0];
          if(f) addFile(f);
          e.target.value='';          // allow same file again
        }}
      />

      {samples.length===0 && (
        <div style={{ color:'#888', marginTop:8 }}>No samples added.</div>
      )}

      {samples.map((s,idx)=>(
        <div key={idx}
             style={{ border:'1px solid #ddd', padding:8, marginTop:12 }}>
          <strong>{s.file.name}</strong>
          <button style={{ float:'right' }} onClick={()=>rm(idx)}>Remove</button>
          <br/><br/>
          <label>Description<br/>
            <input style={{ width:'100%' }}
                   value={s.description}
                   onChange={e=>{
                     const v=e.target.value;
                     setSamples(arr=>arr.map((o,i)=>
                       i===idx?{...o,description:v}:o));
                   }}/>
          </label>
          <br/><br/>
          <label>Summary<br/>
            <textarea style={{ width:'100%',height:80 }}
                      value={s.summary}
                      onChange={e=>{
                        const v=e.target.value;
                        setSamples(arr=>arr.map((o,i)=>
                          i===idx?{...o,summary:v}:o));
                      }}/>
          </label>
        </div>
      ))}
    </section>
  );
});
SampStep.displayName='SampStep';


/* ═══════════════════════════════════════════════════════ */
/* Main modal component                                    */
/* ═══════════════════════════════════════════════════════ */
export default function CreateProjectModal({
  isOpen,
  onClose,
  onSaved,
  initialCreativeId,
  initialIsPersonal,
}: Props) {
  /* ────── state hooks ────── */
  const [step, setStep] = useState(0);

  const [title, setTitle] = useState('');
  const [imdbUrl, setImdbUrl] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('');
  const [otherMediaType, setOtherMediaType] = useState('');
  const [year, setYear] = useState('');
  const [description, setDescription] = useState('');
  const [prodPhase, setProdPhase] = useState<ProdPhase>('');
  const [tracking, setTracking] = useState<TrackingStatus>('');

  const [tagMaster, setTagMaster] = useState<Option[]>([]);
  const [tags, setTags] = useState<Option[]>([]);

  const [isPersonal, setIsPersonal] = useState<'yes' | 'no'>('no');
  const [clients, setClients] = useState<Option[]>([]);

  const [networks, setNetworks] = useState<Option[]>([]);
  const [studios, setStudios] = useState<Option[]>([]);
  const [prodcos, setProdcos] = useState<Option[]>([]);
  const [execs, setExecs] = useState<Option[]>([]);
  const [execMaster, setExecMaster] = useState<Option[]>([]);

  const [projTypes, setProjTypes] = useState<string[]>([]);
  const [needs, setNeeds] = useState<NeedRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  /* ───────── Writing-sample draft objects ───────── */
  interface PendingSample {
    file: File;
    description: string;
    summary: string;
  }
  const [samples, setSamples] = useState<PendingSample[]>([]);

  /* ───────── FLOW MAPS ───────── */
  const STEPS_YES = ['GEN', 'CLI', 'SAMPLES'] as const; // Personal Project = yes
  const STEPS_NO = ['GEN', 'CLI', 'CO', 'NEEDS'] as const; // Personal Project = no
  type StepKey = (typeof STEPS_YES)[number] | (typeof STEPS_NO)[number];

  const STEPS = isPersonal === 'yes' ? STEPS_YES : STEPS_NO;
  const stepKey = STEPS[step] as StepKey;

  /* ────── fetch genre tags once modal opens ────── */
  useEffect(() => {
    if (!isOpen) return;
    api
      .get('/genre_tags')
      .then((r) => setTagMaster(r.data.map((t: any) => ({ id: t.id, label: t.name }))))
      .catch(console.error);
  }, [isOpen]);

  /* ────── Prefill: personal=Yes and client from creativeId (when opened) ────── */
  useEffect(() => {
    if (!isOpen) return;

    // Default the personal flag
    const defaultPersonal = initialIsPersonal ?? (initialCreativeId ? 'yes' : 'no');
    setIsPersonal(defaultPersonal);

    // Pre-populate client if a creative was provided
    (async () => {
      if (initialCreativeId) {
        try {
          const { data } = await api.get(`/creatives/${initialCreativeId}`);
          setClients([{ id: data.id, label: data.name, group: 'Clients' }]);
        } catch (e) {
          console.error('Prefill client failed', e);
          setClients([]); // gracefully continue
        }
      } else {
        setClients([]);
      }
    })();
  }, [isOpen, initialCreativeId, initialIsPersonal]);

  /* ────── dropdown fetch helpers (unchanged) ────── */
  const fetchCreativeOptions = useCallback(async (q: string) => {
    const { data } = await api.get('/creatives', { params: { q } });
    return data.map((c: any) => ({
      id: c.id,
      label: c.name,
      group: c.client_status === 'client' ? 'Clients' : 'Other Creatives',
    }));
  }, []);

  /* company endpoints mapped under /companies/... */
  const fetchNetworkOpts = useCallback(async (q: string) => {
    const { data } = await api.get('/companies/tv_networks', { params: { q } });
    return data.map((n: any) => ({ id: n.id, label: n.name }));
  }, []);
  const fetchStudioOpts = useCallback(async (q: string) => {
    const { data } = await api.get('/companies/studios', { params: { q } });
    return data.map((s: any) => ({ id: s.id, label: s.name }));
  }, []);
  const fetchProdcoOpts = useCallback(async (q: string) => {
    const { data } = await api.get('/companies/production_companies', { params: { q } });
    return data.map((p: any) => ({ id: p.id, label: p.name }));
  }, []);

  /* exec search (same optimisation) */
  const execCache = useRef<Map<string, string>>(new Map());
  const fetchExecOpts = useCallback(
    async (q: string) => {
      const cacheKey = JSON.stringify({
        c: [...networks, ...studios, ...prodcos].map((c) => c.id).sort(),
        q,
      });
      if (execCache.current.has(cacheKey)) {
        return JSON.parse(execCache.current.get(cacheKey)!);
      }

      const hits: Option[] = [];
      const seen = new Set<string>();
      const companies = [...networks, ...studios, ...prodcos];

      for (const c of companies) {
        let subset = execMaster.filter((e) => e.group === c.label);
        if (!subset.length) {
          const { data } = await api.get(`/executives/company/${c.id}`);
          subset = data.map((e: any) => ({ id: e.id, label: e.name, group: c.label }));
          setExecMaster((prev) => {
            const next = [...prev];
            subset.forEach((s) => {
              if (!next.some((p) => p.id === s.id)) next.push(s);
            });
            return next;
          });
        }
        subset.forEach((e) => {
          if (!seen.has(e.id) && (!q || e.label.toLowerCase().includes(q.toLowerCase()))) {
            seen.add(e.id);
            hits.push(e);
          }
        });
      }
      if (!hits.length) {
        const { data } = await api.get('/executives', { params: { q } });
        data.forEach((e: any) => {
          if (!seen.has(e.id)) hits.push({ id: e.id, label: e.name });
        });
      }
      execCache.current.set(cacheKey, JSON.stringify(hits));
      return hits;
    },
    [networks, studios, prodcos, execMaster]
  );

  /* ────── validation helpers ────── */
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (submitAttempted) {
      if (!title) e.title = 'x';
      if (year && !/^\d{4}$/.test(year)) e.year = 'x';
      if (!mediaType) e.mediaType = 'x';
      if (mediaType === 'Other' && !otherMediaType) e.other = 'x';
      if (!prodPhase) e.prodPhase = 'x';
      if (!tracking) e.tracking = 'x';
      if (step === 1 && isPersonal === 'yes' && !clients.length) e.clients = 'x';
    }
    return e;
  }, [
    submitAttempted,
    title,
    year,
    mediaType,
    otherMediaType,
    prodPhase,
    tracking,
    step,
    isPersonal,
    clients.length,
  ]);

  const stepReady = () => {
    if (stepKey === 'GEN') {
      if (!title.trim()) return false;
      if (!mediaType) return false;
      if (mediaType === 'Other' && !otherMediaType.trim()) return false;
      if (!prodPhase || !tracking) return false;
      if (year && !/^\d{4}$/.test(year)) return false;
      return true;
    }
    if (stepKey === 'CLI') return isPersonal === 'no' ? true : clients.length > 0;
    if (stepKey === 'CO') return true;
    if (stepKey === 'NEEDS') return needs.length > 0;
    if (stepKey === 'SAMPLES') return true;
    return true;
  };

  /* ────── step navigation ────── */
  const maxStep = STEPS.length - 1;
  const goNext = () => {
    setSubmitAttempted(true);
    if (stepReady()) setStep((s) => s + 1);
  };
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  /* ────── save ────── */
  const save = async () => {
    setSubmitAttempted(true);
    if (!stepReady()) return;

    setSaving(true);
    try {
      // upsert new genre tag (sentinel)
      let upsertedTagId: string | undefined;
      const newTag = tags.find((t) => t.id === '__new__');
      if (newTag) {
        const { data } = await api.post('/genre_tags', { name: newTag.label });
        upsertedTagId = data.id;
      }
      const genreIds = [
        ...tags.filter((t) => t.id !== '__new__').map((t) => t.id as string),
        ...(upsertedTagId ? [upsertedTagId] : []),
      ];

      /* ---------- ONE request does everything ---------- */
      const payload = {
        title,
        imdb_id: imdbUrl.match(/tt\d{7,}/)?.[0] ?? null,
        media_type: mediaType === 'Other' ? otherMediaType : mediaType,
        year: year ? +year : null,
        description,
        status: prodPhase,
        tracking_status: tracking,

        genre_tag_ids: genreIds,
        network_ids: networks.map((n) => n.id),
        studio_ids: studios.map((s) => s.id),
        prodco_ids: prodcos.map((p) => p.id),
        executive_ids: execs.map((e) => e.id),
        project_types: projTypes,
        needs: needs, // {need,description}

        is_personal: isPersonal === 'yes',
        creative_ids: isPersonal === 'yes' ? clients.map((c) => c.id) : [],
      };

      const { data: project } = await api.post('/projects', payload);

      /* upload pending writing samples (personal projects only) */      
      const willLinkSamples = isPersonal === 'yes' && samples.length > 0;
      if (willLinkSamples) {
        await Promise.all(
          samples.map(async (s) => {
            const form = new FormData();
            form.append('file', s.file);
            form.append('file_description', s.description);
            form.append('synopsis', s.summary);
            form.append('creativeIds', JSON.stringify(clients.map((c) => c.id)));
            form.append('projectIds', JSON.stringify([project.id]));
            await api.post('/writing_samples', form, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
          })
        );
        // Notify parent: samples were linked here; they may close their modal.
        onSaved?.({ id: project.id, title: project.title }, true);
      } else {
        // Notify parent with the new project so they can auto-link it.
        onSaved?.({ id: project.id, title: project.title }, false);
      }

      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to save project – please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* ────── Wipe/reset the modal on close ────── */
  useEffect(() => {
    if (!isOpen) {
      setStep(0);
      setTitle('');
      setImdbUrl('');
      setMediaType('');
      setOtherMediaType('');
      setYear('');
      setDescription('');
      setProdPhase('');
      setTracking('');

      setTags([]);
      setClients([]);

      setNetworks([]);
      setStudios([]);
      setProdcos([]);
      setExecs([]);
      setExecMaster([]);

      setProjTypes([]);
      setNeeds([]);

      setSamples([]);
      setSubmitAttempted(false);
      setSaving(false);
      setIsPersonal('no');
    }
  }, [isOpen]);

  /* ══════════════════════════════════════════════ */
  /* Render                                         */
  /* ══════════════════════════════════════════════ */
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Create Project" staticBackdrop>
      <div style={{ minHeight: 700, overflow: 'visible' }}>
        <h2 className="text-2xl font-semibold mb-4">Create New Project</h2>

        {{
          GEN: (
            <GeneralStep
              submitAttempted={submitAttempted}
              errors={errors}
              title={title}
              setTitle={setTitle}
              imdbUrl={imdbUrl}
              setImdbUrl={setImdbUrl}
              mediaType={mediaType}
              setMediaType={setMediaType}
              otherMediaType={otherMediaType}
              setOtherMediaType={setOtherMediaType}
              year={year}
              setYear={setYear}
              description={description}
              setDescription={setDescription}
              prodPhase={prodPhase}
              setProdPhase={setProdPhase}
              tracking={tracking}
              setTracking={setTracking}
              tagMaster={tagMaster}
              tags={tags}
              setTags={setTags}
            />
          ),
          CLI: (
            <ClientsStep
              isPersonal={isPersonal}
              setIsPersonal={setIsPersonal}
              clients={clients}
              setClients={setClients}
              fetchCreativeOptions={fetchCreativeOptions}
              submitAttempted={submitAttempted}
              missing={!!errors.clients}
            />
          ),
          CO: (
            <CoStep
              networks={networks}
              setNetworks={setNetworks}
              studios={studios}
              setStudios={setStudios}
              prodcos={prodcos}
              setProdcos={setProdcos}
              execs={execs}
              setExecs={setExecs}
              fetchNetworkOpts={fetchNetworkOpts}
              fetchStudioOpts={fetchStudioOpts}
              fetchProdcoOpts={fetchProdcoOpts}
              fetchExecOpts={fetchExecOpts}
            />
          ),
          NEEDS: <NeedsStep projTypes={projTypes} setProjTypes={setProjTypes} needs={needs} setNeeds={setNeeds} />,
          SAMPLES: <SampStep samples={samples} setSamples={setSamples} />,
        }[stepKey]}

        {/* Navigation */}
        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          {step > 0 && <button className="tab" onClick={goPrev}>Back</button>}
          <button className="tab" onClick={onClose}>Cancel</button>
          {step < maxStep && (
            <button className="tab" disabled={!stepReady()} onClick={goNext}>
              Next
            </button>
          )}
          {step === maxStep && (
            <button className="tab" disabled={saving || !stepReady()} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}


/* local CSS‑in‑JS for red outline */
const style = document.createElement('style');
style.textContent = `.glow{outline:2px solid #e00;outline-offset:1px}`;
document.head.appendChild(style);
