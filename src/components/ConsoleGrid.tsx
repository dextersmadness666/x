import { useState, useCallback } from 'react';
import type { ConsoleWithStats, ScrapeJob } from '../lib/supabase';

type Props = {
  consoles: ConsoleWithStats[];
  latestJob: ScrapeJob | null;
  onSelect: (c: ConsoleWithStats) => void;
  onScrapeConsole: (slug: string) => Promise<void>;
  onScrapeConsoles: (slugs: string[]) => Promise<void>;
};

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

type ScrapeStatus = 'none' | 'partial' | 'full';

function getStatus(c: ConsoleWithStats): ScrapeStatus {
  if (c.scraped_count === 0) return 'none';
  if (c.rom_count > 0 && c.scraped_count < c.rom_count) return 'partial';
  return 'full';
}

function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange(); }}
      style={{
        width: 16, height: 16, borderRadius: 4,
        border: `2px solid ${checked || indeterminate ? 'var(--accent)' : 'var(--border-2)'}`,
        background: checked ? 'var(--accent)' : indeterminate ? 'var(--accent-dim)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6l3 3 5-5"/>
        </svg>
      )}
      {indeterminate && !checked && (
        <div style={{ width: 6, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
      )}
    </div>
  );
}

export default function ConsoleGrid({ consoles, latestJob, onSelect, onScrapeConsole, onScrapeConsoles }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [scrapingId, setScrapingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scrapingBulk, setScrapingBulk] = useState(false);

  const jobRunning = latestJob?.status === 'running';

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allSelected = consoles.length > 0 && selected.size === consoles.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(consoles.map(c => c.id)));
  }, [allSelected, consoles]);

  async function handleScrape(e: React.MouseEvent, c: ConsoleWithStats) {
    e.stopPropagation();
    if (jobRunning || scrapingId) return;
    setScrapingId(c.id);
    try { await onScrapeConsole(c.slug); }
    finally { setScrapingId(null); }
  }

  async function handleScrapeSelected() {
    if (jobRunning || scrapingBulk) return;
    setScrapingBulk(true);
    try {
      const slugs = consoles.filter(c => selected.has(c.id)).map(c => c.slug);
      await onScrapeConsoles(slugs);
      setSelected(new Set());
    } finally {
      setScrapingBulk(false);
    }
  }

  const stats = consoles.reduce(
    (acc, c) => ({ total: acc.total + c.rom_count, scraped: acc.scraped + c.scraped_count }),
    { total: 0, scraped: 0 }
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={toggleSelectAll}
        />
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Consoles</h1>
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
          {consoles.length} platforms
        </span>
        {stats.scraped > 0 && (
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
            ·{' '}
            <span style={{ color: stats.scraped >= stats.total ? 'var(--success)' : 'var(--warning)' }}>
              {stats.scraped.toLocaleString()}
            </span>
            {' '}/ {stats.total.toLocaleString()} ROMs in DB
          </span>
        )}
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 10,
        paddingBottom: selected.size > 0 ? 80 : 0,
      }}>
        {consoles.map(c => {
          const hov = hoveredId === c.id;
          const sel = selected.has(c.id);
          const status = getStatus(c);
          const isThisRunning = jobRunning && latestJob?.current_console === c.name;
          const isScrapingNow = scrapingId === c.id || isThisRunning;
          const fillPct = c.rom_count > 0 ? Math.min(100, (c.scraped_count / c.rom_count) * 100) : 0;

          return (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                background: sel ? 'rgba(59,130,246,0.06)' : hov ? 'var(--surface-2)' : 'var(--surface)',
                border: `1px solid ${sel ? 'rgba(59,130,246,0.4)' : isThisRunning ? 'rgba(245,158,11,0.4)' : hov ? 'var(--border-2)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                padding: '14px 14px 0 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.12s, border-color 0.12s, box-shadow 0.12s',
                boxShadow: sel ? '0 0 0 1px rgba(59,130,246,0.15)' : hov ? '0 4px 16px rgba(0,0,0,0.3)' : 'none',
                overflow: 'hidden',
              }}
            >
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Checkbox */}
                <div style={{ opacity: sel || hov ? 1 : 0, transition: 'opacity 0.12s' }}>
                  <Checkbox checked={sel} onChange={() => toggleSelect(c.id)} />
                </div>

                {/* Console image */}
                <div style={{
                  width: 48, height: 32,
                  background: 'var(--surface-3)',
                  borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, overflow: 'hidden',
                }}>
                  {c.image_url ? (
                    <img
                      src={c.image_url}
                      alt={c.name}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span style={{ fontSize: 16 }}>🎮</span>
                  )}
                </div>

                {/* Name + counts */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontWeight: 600, fontSize: 13, color: 'var(--text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginBottom: 4,
                  }}>
                    {c.name}
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--text-2)' }}>
                    <span>{fmtNum(c.rom_count)} ROMs</span>
                    <span style={{ color: 'var(--text-3)' }}>·</span>
                    <span>{fmtNum(c.total_downloads)} DLs</span>
                  </div>
                </div>

                {/* Scrape action */}
                <div onClick={e => handleScrape(e, c)} style={{ flexShrink: 0 }}>
                  {isScrapingNow ? (
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: 'var(--warning-dim)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{
                        width: 13, height: 13,
                        border: '2px solid rgba(245,158,11,0.3)',
                        borderTopColor: 'var(--warning)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }}/>
                    </div>
                  ) : status === 'none' ? (
                    <ScrapeBtn label="Scrape" disabled={!!jobRunning} color="accent" />
                  ) : status === 'partial' ? (
                    <ScrapeBtn label="Resume" disabled={!!jobRunning} color="accent" />
                  ) : (
                    <ScrapeBtn label="↻" disabled={!!jobRunning} color="muted" title="Re-scrape" />
                  )}
                </div>
              </div>

              {/* Status / progress row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {status === 'none' ? (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', paddingBottom: 10 }}>
                    Not scraped yet
                  </span>
                ) : (
                  <div style={{ flex: 1, paddingBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>
                      <span>
                        {status === 'full'
                          ? <span style={{ color: 'var(--success)' }}>✓ Fully scraped</span>
                          : <span><span style={{ color: 'var(--text-2)' }}>{c.scraped_count.toLocaleString()}</span> / {c.rom_count.toLocaleString()} scraped</span>
                        }
                      </span>
                      {status === 'partial' && (
                        <span style={{ color: 'var(--warning)' }}>{Math.round(fillPct)}%</span>
                      )}
                    </div>
                    <div style={{ height: 3, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${fillPct}%`, borderRadius: 99,
                        background: status === 'full' ? 'var(--success)' : 'var(--accent)',
                        transition: 'width 0.3s ease',
                      }}/>
                    </div>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          zIndex: 200,
          animation: 'slide-up 0.15s ease',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 80 }}>
            {selected.size} selected
          </span>

          <div style={{ width: 1, height: 18, background: 'var(--border)' }} />

          <button
            onClick={handleScrapeSelected}
            disabled={jobRunning || scrapingBulk}
            style={{
              background: jobRunning || scrapingBulk ? 'var(--surface-2)' : 'var(--accent)',
              color: jobRunning || scrapingBulk ? 'var(--text-3)' : '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 14px',
              fontSize: 13, fontWeight: 600,
              cursor: jobRunning || scrapingBulk ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.12s',
            }}
          >
            {scrapingBulk ? (
              <>
                <div style={{
                  width: 11, height: 11,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}/>
                Starting…
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M4 3v14l12-7L4 3z"/>
                </svg>
                Scrape Selected
              </>
            )}
          </button>

          <button
            onClick={() => setSelected(new Set())}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-3)',
              padding: '6px 10px',
              fontSize: 12, cursor: 'pointer',
              transition: 'border-color 0.12s, color 0.12s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-2)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function ScrapeBtn({ label, disabled, color, title }: {
  label: string;
  disabled: boolean;
  color: 'accent' | 'muted';
  title?: string;
}) {
  const [hov, setHov] = useState(false);
  const isAccent = color === 'accent';
  return (
    <div
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 28,
        minWidth: 28,
        padding: '0 8px',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s, border-color 0.12s',
        background: isAccent
          ? hov && !disabled ? 'var(--accent)' : 'var(--accent-dim)'
          : hov && !disabled ? 'var(--surface-3)' : 'transparent',
        border: `1px solid ${isAccent ? 'rgba(59,130,246,0.35)' : 'var(--border)'}`,
        color: isAccent ? 'var(--accent)' : 'var(--text-3)',
        whiteSpace: 'nowrap',
      }}
    >
      {isAccent && !hov && (
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" style={{ marginRight: label !== '↻' ? 4 : 0, flexShrink: 0 }}>
          <path d="M4 3v14l12-7L4 3z"/>
        </svg>
      )}
      {label}
    </div>
  );
}
