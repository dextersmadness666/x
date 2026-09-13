import { useEffect, useState, useCallback } from 'react';
import {
  getConsoles, getRoms, getTotalRoms, getLatestJob, startScrapeJob, getAllMatchingRoms,
  type Console, type ConsoleWithStats, type Rom, type ScrapeJob,
} from './lib/supabase';
import ConsoleGrid from './components/ConsoleGrid';
import RomTable from './components/RomTable';
import JobStatus from './components/JobStatus';
import ScraperControls from './components/ScraperControls';
import QueuePage from './components/QueuePage';

type View = 'consoles' | 'roms' | 'queue';

export default function App() {
  const [view, setView] = useState<View>('consoles');
  const [consoles, setConsoles] = useState<ConsoleWithStats[]>([]);
  const [selectedConsole, setSelectedConsole] = useState<ConsoleWithStats | null>(null);
  const [roms, setRoms] = useState<Rom[]>([]);
  const [search, setSearch] = useState('');
  const [latestJob, setLatestJob] = useState<ScrapeJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [romsLoading, setRomsLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [totalRoms, setTotalRoms] = useState(0);
  const [totalDbRoms, setTotalDbRoms] = useState(0);
  const PAGE_SIZE = 50;

  const fetchConsoles = useCallback(async () => {
    try {
      const data = await getConsoles();
      setConsoles(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTotalRoms = useCallback(async () => {
    const total = await getTotalRoms();
    setTotalDbRoms(total);
  }, []);

  const fetchRoms = useCallback(async (consoleSel: Console | null, q: string, p: number) => {
    setRomsLoading(true);
    try {
      const { data, total } = await getRoms({
        console: consoleSel?.slug ?? null,
        search: q,
        page: p,
        pageSize: PAGE_SIZE,
      });
      setRoms(data);
      setTotalRoms(total);
    } finally {
      setRomsLoading(false);
    }
  }, []);

  const fetchLatestJob = useCallback(async () => {
    const data = await getLatestJob();
    setLatestJob(data);
  }, []);

  useEffect(() => {
    fetchConsoles();
    fetchTotalRoms();
    fetchLatestJob();
  }, [fetchConsoles, fetchTotalRoms, fetchLatestJob]);

  useEffect(() => {
    if (view === 'roms') fetchRoms(selectedConsole, search, page);
  }, [view, selectedConsole, search, page, fetchRoms]);

  useEffect(() => {
    if (latestJob?.status !== 'running') return;
    const id = setInterval(async () => {
      await fetchLatestJob();
      await fetchConsoles();
      await fetchTotalRoms();
    }, 2000);
    return () => clearInterval(id);
  }, [latestJob?.status, fetchLatestJob, fetchConsoles, fetchTotalRoms]);

  const handleConsoleSelect = (c: ConsoleWithStats) => {
    setSelectedConsole(c);
    setSearch('');
    setPage(0);
    setView('roms');
  };

  const handleSearch = (q: string) => {
    setSearch(q);
    setPage(0);
  };

  const handleScrapeConsole = useCallback(async (slug: string) => {
    await startScrapeJob({ console: slug });
    await fetchLatestJob();
    await fetchConsoles();
  }, [fetchLatestJob, fetchConsoles]);

  const handleScrapeConsoles = useCallback(async (slugs: string[]) => {
    await startScrapeJob({ consoles: slugs });
    await fetchLatestJob();
    await fetchConsoles();
  }, [fetchLatestJob, fetchConsoles]);

  const isScraped = consoles.length > 0;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 58,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, flexShrink: 0,
            }}>🎮</div>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>
              RomScraper
            </span>
          </div>

          {/* Nav tabs */}
          <nav style={{ display: 'flex', gap: 2 }}>
            {(['consoles', 'roms', 'queue'] as View[]).map(v => (
              <button
                key={v}
                onClick={() => { setView(v); if (v === 'consoles') setSelectedConsole(null); }}
                style={{
                  background: view === v ? 'var(--surface-3)' : 'transparent',
                  color: view === v ? 'var(--text)' : 'var(--text-2)',
                  border: '1px solid',
                  borderColor: view === v ? 'var(--border-2)' : 'transparent',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 13px',
                  fontWeight: view === v ? 600 : 400,
                  fontSize: 13,
                  textTransform: 'capitalize',
                  transition: 'all 0.12s',
                }}
              >
                {v === 'consoles'
                  ? `Consoles${consoles.length ? ` (${consoles.length})` : ''}`
                  : v === 'queue'
                  ? 'Queue'
                  : 'ROMs'}
              </button>
            ))}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {view === 'roms' && (
            <div style={{ position: 'relative' }}>
              <svg
                style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.35, pointerEvents: 'none' }}
                width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <circle cx="8" cy="8" r="6"/><path d="M14 14l4 4"/>
              </svg>
              <input
                type="text"
                placeholder="Search ROMs…"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text)',
                  padding: '6px 12px 6px 28px',
                  fontSize: 13,
                  width: 220,
                  outline: 'none',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>
          )}

          {isScraped && (
            <div style={{
              fontSize: 12, color: 'var(--text-2)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 99,
              padding: '4px 12px',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                {totalDbRoms.toLocaleString()}
              </span>{' '}ROMs in DB
            </div>
          )}

          {view !== 'queue' && (
            <ScraperControls
              latestJob={latestJob}
              onJobStart={() => { fetchLatestJob(); fetchConsoles(); fetchTotalRoms(); }}
            />
          )}
        </div>
      </header>

      {/* Job Status Banner */}
      {latestJob && (
        <JobStatus
          job={latestJob}
          onRefresh={() => { fetchLatestJob(); fetchConsoles(); fetchTotalRoms(); }}
        />
      )}

      {/* Loading state */}
      {loading && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, color: 'var(--text-3)',
        }}>
          <div style={{
            width: 18, height: 18,
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}/>
          Loading…
        </div>
      )}

      {/* Empty state (only for consoles/roms view) */}
      {!loading && !isScraped && view !== 'queue' && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 24, padding: 40,
          animation: 'fade-in 0.3s ease',
        }}>
          <div style={{
            width: 72, height: 72,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34,
          }}>🎮</div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>No consoles imported yet</div>
            <div style={{ fontSize: 14, color: 'var(--text-2)', maxWidth: 400, lineHeight: 1.6 }}>
              Import the console list to populate the grid, then select which consoles to scrape ROMs for.
            </div>
          </div>

          <EmptyImportBtn
            running={latestJob?.status === 'running'}
            onImport={async () => {
              await startScrapeJob({ consolesOnly: true });
              fetchLatestJob();
              fetchConsoles();
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 400 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>or use the CLI</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '16px 20px',
            fontFamily: 'ui-monospace, "Cascadia Code", monospace',
            fontSize: 13,
            lineHeight: 2,
            width: '100%',
            maxWidth: 400,
          }}>
            <div style={{ color: 'var(--text-3)' }}># Quick start — single console</div>
            <div>cd scraper &amp;&amp; npm install</div>
            <div style={{ color: 'var(--accent)' }}>node index.js --console=gameboy-color --limit=20</div>
            <div style={{ color: 'var(--text-3)', marginTop: 4 }}># Full scrape</div>
            <div>node index.js</div>
          </div>
        </div>
      )}

      {/* Main content */}
      {!loading && (
        <main style={{ flex: 1, padding: '24px', maxWidth: 1440, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {view === 'queue' && (
            <QueuePage consoles={consoles} />
          )}
          {view === 'consoles' && isScraped && (
            <ConsoleGrid
              consoles={consoles}
              latestJob={latestJob}
              onSelect={handleConsoleSelect}
              onScrapeConsole={handleScrapeConsole}
              onScrapeConsoles={handleScrapeConsoles}
            />
          )}
          {view === 'roms' && isScraped && (
            <RomTable
              roms={roms}
              loading={romsLoading}
              total={totalRoms}
              page={page}
              pageSize={PAGE_SIZE}
              onPage={setPage}
              selectedConsole={selectedConsole}
              onClearConsole={() => { setSelectedConsole(null); setPage(0); }}
              filterKey={(selectedConsole?.id ?? '') + '|' + search}
              onFetchAllMatching={() => getAllMatchingRoms({
                console: selectedConsole?.slug ?? null,
                search,
              })}
            />
          )}
        </main>
      )}
    </div>
  );
}

function EmptyImportBtn({ running, onImport }: { running: boolean | undefined; onImport: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const disabled = running || loading;

  async function handle() {
    if (disabled) return;
    setLoading(true);
    try { await onImport(); } finally { setLoading(false); }
  }

  return (
    <button
      onClick={handle}
      disabled={disabled}
      style={{
        background: disabled ? 'var(--surface-2)' : 'var(--accent)',
        color: disabled ? 'var(--text-3)' : '#fff',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 28px',
        fontSize: 14, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 8,
        transition: 'background 0.15s',
      }}
    >
      {loading ? (
        <>
          <div style={{
            width: 13, height: 13,
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}/>
          Importing…
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3v10M5 13l5 5 5-5"/>
            <path d="M3 17h14"/>
          </svg>
          Import Console List
        </>
      )}
    </button>
  );
}
