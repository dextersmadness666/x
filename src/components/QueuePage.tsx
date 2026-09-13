import { useState, useEffect, useCallback } from 'react';
import {
  type ConsoleWithStats, type ScrapeJob,
  getJobs, createQueuedJob, startJob, cancelJob, deleteJob,
} from '../lib/api';

type Props = { consoles: ConsoleWithStats[] };

const STATUS_COLOR: Record<string, string> = {
  queued:    '#6b7280',
  running:   '#3b82f6',
  completed: '#22c55e',
  failed:    '#ef4444',
  cancelled: '#f59e0b',
};
const STATUS_BG: Record<string, string> = {
  queued:    'rgba(107,114,128,0.12)',
  running:   'rgba(59,130,246,0.12)',
  completed: 'rgba(34,197,94,0.12)',
  failed:    'rgba(239,68,68,0.12)',
  cancelled: 'rgba(245,158,11,0.12)',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
      textTransform: 'uppercase',
      color: STATUS_COLOR[status] ?? 'var(--text-3)',
      background: STATUS_BG[status] ?? 'var(--surface-2)',
      border: `1px solid ${STATUS_COLOR[status] ?? 'var(--border)'}30`,
      borderRadius: 99, padding: '2px 9px',
    }}>
      {status === 'running' && (
        <span style={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: '#3b82f6', animation: 'blink 1s ease-in-out infinite',
        }} />
      )}
      {status}
    </span>
  );
}

function Spinner({ size = 13 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      border: '2px solid var(--border)',
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
      flexShrink: 0,
    }} />
  );
}

function JobCard({
  job,
  onStart, onCancel, onDelete,
  pending,
}: {
  job: ScrapeJob;
  onStart: () => void;
  onCancel: () => void;
  onDelete: () => void;
  pending: string | undefined;
}) {
  const label     = job.target_label ?? 'Scrape job';
  const isRunning = job.status === 'running';
  const isQueued  = job.status === 'queued';
  const isDone    = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${isRunning ? 'rgba(59,130,246,0.3)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      transition: 'border-color 0.15s',
    }}>
      {/* Top row: status + label + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusBadge status={job.status} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {isQueued && (
            <ActionBtn
              label="Start"
              color="accent"
              loading={pending === 'start'}
              onClick={onStart}
            />
          )}
          {isRunning && (
            <ActionBtn
              label="Cancel"
              color="danger"
              loading={pending === 'cancel'}
              onClick={onCancel}
            />
          )}
          {(isDone || isQueued) && (
            <ActionBtn
              label="Delete"
              color="muted"
              loading={pending === 'delete'}
              onClick={onDelete}
            />
          )}
        </div>
      </div>

      {/* Progress row for running jobs */}
      {isRunning && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {job.current_console && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
              <Spinner size={11} />
              <span style={{ color: 'var(--text-3)' }}>Scraping:</span>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{job.current_console}</span>
              {job.pages_total > 0 && (
                <span style={{ color: 'var(--text-3)' }}>— page {job.pages_done}/{job.pages_total}</span>
              )}
              {job.urls_total > 0 && (
                <span style={{ color: 'var(--text-3)' }}>— URLs {job.urls_done}/{job.urls_total}</span>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <span style={{ color: 'var(--text-3)' }}>
              ROMs saved: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{job.roms_scraped.toLocaleString()}</span>
            </span>
            {job.consoles_scraped > 0 && (
              <span style={{ color: 'var(--text-3)' }}>
                Target: <span style={{ color: 'var(--text)' }}>{job.consoles_scraped} console{job.consoles_scraped !== 1 ? 's' : ''}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Completed stats */}
      {job.status === 'completed' && job.roms_scraped > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          Saved <span style={{ color: '#22c55e', fontWeight: 600 }}>{job.roms_scraped.toLocaleString()}</span> ROMs
        </div>
      )}

      {/* Error message */}
      {(job.status === 'failed' || job.error_msg) && job.error_msg && (
        <div style={{
          fontSize: 11, color: '#ef4444',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {job.error_msg}
        </div>
      )}

      {/* Timestamp */}
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {job.status === 'queued' ? 'Added' : 'Created'}: {new Date(job.created_at).toLocaleString()}
        {job.completed_at && (
          <> &middot; Finished: {new Date(job.completed_at).toLocaleString()}</>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  label, color, loading, onClick,
}: {
  label: string;
  color: 'accent' | 'danger' | 'muted';
  loading: boolean;
  onClick: () => void;
}) {
  const bg = color === 'accent' ? 'var(--accent)'
    : color === 'danger'  ? 'rgba(239,68,68,0.15)'
    : 'var(--surface-2)';
  const textColor = color === 'accent' ? '#fff'
    : color === 'danger' ? '#ef4444'
    : 'var(--text-2)';
  const border = color === 'accent' ? 'none'
    : color === 'danger' ? '1px solid rgba(239,68,68,0.3)'
    : '1px solid var(--border)';

  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        background: bg, color: textColor, border,
        borderRadius: 'var(--radius-sm)',
        padding: '5px 12px',
        fontSize: 12, fontWeight: 600,
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.6 : 1,
        display: 'flex', alignItems: 'center', gap: 5,
        transition: 'opacity 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      {loading && <Spinner size={10} />}
      {label}
    </button>
  );
}

export default function QueuePage({ consoles }: Props) {
  const [jobs, setJobs]         = useState<ScrapeJob[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch]     = useState('');
  const [consolesOnly, setConsolesOnly] = useState(false);
  const [limitVal, setLimitVal] = useState('');
  const [adding, setAdding]     = useState(false);
  const [startingAll, setStartingAll] = useState(false);
  const [pending, setPending]   = useState<Record<string, string>>({});
  const [filter, setFilter]     = useState<'all' | 'active' | 'done'>('all');

  const fetchJobs = useCallback(async () => {
    const data = await getJobs().catch(() => [] as ScrapeJob[]);
    setJobs(data);
  }, []);

  useEffect(() => {
    fetchJobs();
    const id = setInterval(fetchJobs, 2000);
    return () => clearInterval(id);
  }, [fetchJobs]);

  const filtered = consoles.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.slug.includes(search.toLowerCase())
  );

  const toggle = (slug: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(slug) ? s.delete(slug) : s.add(slug); return s; });

  const selectAll = () => setSelected(new Set(filtered.map(c => c.slug)));
  const clearSel  = () => setSelected(new Set());

  const handleAddToQueue = async () => {
    if (!selected.size || adding) return;
    setAdding(true);
    try {
      const slugs = [...selected];
      const label = slugs.length === 1
        ? (consoles.find(c => c.slug === slugs[0])?.name ?? slugs[0])
        : `${slugs.length} console${slugs.length > 1 ? 's' : ''}`;
      await createQueuedJob({
        label,
        params: {
          consoles: slugs,
          consolesOnly,
          limit: limitVal ? parseInt(limitVal, 10) : undefined,
        },
      });
      setSelected(new Set());
      await fetchJobs();
    } finally {
      setAdding(false);
    }
  };

  const act = async (jobId: string, action: string, fn: () => Promise<void>) => {
    setPending(p => ({ ...p, [jobId]: action }));
    try { await fn(); await fetchJobs(); }
    finally { setPending(p => { const n = { ...p }; delete n[jobId]; return n; }); }
  };

  const handleStartAll = async () => {
    const queued = jobs.filter(j => j.status === 'queued');
    if (!queued.length || startingAll) return;
    setStartingAll(true);
    try {
      for (const j of queued) await startJob(j.id).catch(() => {});
      await fetchJobs();
    } finally {
      setStartingAll(false);
    }
  };

  const displayedJobs = jobs.filter(j => {
    if (filter === 'active') return j.status === 'running' || j.status === 'queued';
    if (filter === 'done')   return j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled';
    return true;
  });

  const queuedCount  = jobs.filter(j => j.status === 'queued').length;
  const runningCount = jobs.filter(j => j.status === 'running').length;

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

      {/* ── Left: Console picker ─────────────────────────────────── */}
      <div style={{
        width: 320, flexShrink: 0,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        position: 'sticky', top: 82,
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Add to Queue</div>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }}
              width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="8" cy="8" r="6"/><path d="M14 14l4 4"/>
            </svg>
            <input
              type="text"
              placeholder="Filter consoles…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text)',
                padding: '6px 10px 6px 28px', fontSize: 13, outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>
        </div>

        {/* Console list */}
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-3)', textAlign: 'center' }}>
              No consoles found
            </div>
          ) : (
            filtered.map(c => {
              const sel = selected.has(c.slug);
              return (
                <button
                  key={c.slug}
                  onClick={() => toggle(c.slug)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 16px', border: 'none',
                    background: sel ? 'rgba(59,130,246,0.08)' : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {/* Checkbox */}
                  <div style={{
                    width: 15, height: 15, borderRadius: 3, flexShrink: 0,
                    border: `2px solid ${sel ? 'var(--accent)' : 'var(--border-2)'}`,
                    background: sel ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.1s',
                  }}>
                    {sel && (
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6l3 3 5-5"/>
                      </svg>
                    )}
                  </div>
                  {/* Image */}
                  <div style={{
                    width: 28, height: 20, flexShrink: 0, borderRadius: 3,
                    background: 'var(--surface-3)', overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {c.image_url
                      ? <img src={c.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 2 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <span style={{ fontSize: 10 }}>🎮</span>
                    }
                  </div>
                  {/* Name */}
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </span>
                  {/* Scraped count */}
                  {c.scraped_count > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                      {c.scraped_count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Select all / clear */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={selectAll} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Select all ({filtered.length})
          </button>
          {selected.size > 0 && (
            <>
              <span style={{ color: 'var(--border)' }}>·</span>
              <button onClick={clearSel} style={{ fontSize: 12, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Clear
              </button>
            </>
          )}
        </div>

        {/* Options */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={consolesOnly}
              onChange={e => setConsolesOnly(e.target.checked)}
              style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
            />
            <span style={{ color: 'var(--text-2)' }}>Consoles only (no ROMs)</span>
          </label>

          {!consolesOnly && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                ROM limit per console (optional)
              </label>
              <input
                type="number"
                placeholder="e.g. 100"
                value={limitVal}
                onChange={e => setLimitVal(e.target.value)}
                min="1"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text)',
                  padding: '6px 10px', fontSize: 13, outline: 'none',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>
          )}

          <button
            onClick={handleAddToQueue}
            disabled={selected.size === 0 || adding}
            style={{
              background: selected.size === 0 ? 'var(--surface-2)' : 'var(--accent)',
              color: selected.size === 0 ? 'var(--text-3)' : '#fff',
              border: 'none', borderRadius: 'var(--radius-sm)',
              padding: '8px 14px', fontSize: 13, fontWeight: 600,
              cursor: selected.size === 0 || adding ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              transition: 'background 0.15s',
            }}
          >
            {adding ? <><Spinner size={12} />Adding…</> : (
              <>
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M10 4v12M4 10h12"/>
                </svg>
                {selected.size > 0 ? `Add ${selected.size} to Queue` : 'Select consoles above'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Right: Job queue ─────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Queue header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Job Queue</h2>

          {/* Status summary chips */}
          {runningCount > 0 && (
            <span style={{ fontSize: 12, color: '#3b82f6', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 99, padding: '2px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', display: 'inline-block', animation: 'blink 1s ease-in-out infinite' }} />
              {runningCount} running
            </span>
          )}
          {queuedCount > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 99, padding: '2px 10px' }}>
              {queuedCount} queued
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
            {(['all', 'active', 'done'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                background: filter === f ? 'var(--surface-3)' : 'transparent',
                color: filter === f ? 'var(--text)' : 'var(--text-3)',
                border: filter === f ? '1px solid var(--border-2)' : '1px solid transparent',
                borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: filter === f ? 600 : 400,
                cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.1s',
              }}>
                {f}
              </button>
            ))}
          </div>

          {queuedCount > 0 && (
            <button
              onClick={handleStartAll}
              disabled={startingAll}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius-sm)', padding: '6px 14px',
                fontSize: 12, fontWeight: 600, cursor: startingAll ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: startingAll ? 0.7 : 1,
              }}
            >
              {startingAll ? <Spinner size={11} /> : (
                <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3v14l12-7L4 3z"/></svg>
              )}
              Start All ({queuedCount})
            </button>
          )}
        </div>

        {/* Job list */}
        {displayedJobs.length === 0 ? (
          <div style={{
            padding: '48px 24px',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)',
            textAlign: 'center',
            color: 'var(--text-3)',
            fontSize: 14,
          }}>
            {filter === 'all' ? 'No jobs yet — select consoles and add them to the queue.' : `No ${filter} jobs.`}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayedJobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                pending={pending[job.id]}
                onStart={() => act(job.id, 'start', () => startJob(job.id))}
                onCancel={() => act(job.id, 'cancel', () => cancelJob(job.id))}
                onDelete={() => act(job.id, 'delete', () => deleteJob(job.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
