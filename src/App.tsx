import { useEffect, useState, useCallback } from 'react';
import { supabase, startScrapeJob, type Console, type ConsoleWithStats, type Rom, type ScrapeJob } from './lib/supabase';
import ConsoleGrid from './components/ConsoleGrid';
import RomTable from './components/RomTable';
import JobStatus from './components/JobStatus';
import ScraperControls from './components/ScraperControls';

type View = 'consoles' | 'roms';

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
    const [{ data }, { data: counts }] = await Promise.all([
      supabase.from('consoles').select('*').order('total_downloads', { ascending: false }),
      supabase.rpc('get_console_rom_counts'),
    ]);
    const countMap = new Map(
      (counts ?? []).map((r: { slug: string; scraped_count: number }) => [r.slug, Number(r.scraped_count)])
    );
    setConsoles(
      (data ?? []).map(c => ({ ...c, scraped_count: countMap.get(c.slug) ?? 0 }))
    );
    setLoading(false);
  }, []);

  const fetchTotalRoms = useCallback(async () => {
    const { count } = await supabase
      .from('roms')
      .select('*', { count: 'exact', head: true });
    setTotalDbRoms(count ?? 0);
  }, []);

  const fetchRoms = useCallback(async (consoleSel: Console | null, q: string, p: number) => {
    setRomsLoading(true);
    let query = supabase
      .from('roms')
      .select('*', { count: 'exact' })
      .order('download_count', { ascending: false })
      .range(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE - 1);

    if (consoleSel) query = query.eq('console_slug', consoleSel.slug);
    if (q.trim()) query = query.ilike('title', `%${q.trim()}%`);

    const { data, count } = await query;
    setRoms(data ?? []);
    setTotalRoms(count ?? 0);
    setRomsLoading(false);
  }, []);

  const fetchLatestJob = useCallback(async () => {
    const { data } = await supabase
      .from('scrape_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
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
            {(['consoles', 'roms'] as View[]).map(v => (
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

          <ScraperControls
            latestJob={latestJob}
            onJobStart={() => { fetchLatestJob(); fetchConsoles(); fetchTotalRoms(); }}
          />
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

      {/* Empty state */}
      {!loading && !isScraped && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 20, padding: 40,
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
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>No data yet</div>
            <div style={{ fontSize: 14, color: 'var(--text-2)', maxWidth: 420, lineHeight: 1.6 }}>
              Run the scraper to populate the database with consoles and ROMs from Romspedia.
            </div>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '18px 24px',
            fontFamily: 'ui-monospace, "Cascadia Code", monospace',
            fontSize: 13,
            lineHeight: 2,
            minWidth: 360,
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
      {!loading && isScraped && (
        <main style={{ flex: 1, padding: '24px', maxWidth: 1440, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {view === 'consoles' && (
            <ConsoleGrid
              consoles={consoles}
              latestJob={latestJob}
              onSelect={handleConsoleSelect}
              onScrapeConsole={handleScrapeConsole}
              onScrapeConsoles={handleScrapeConsoles}
            />
          )}
          {view === 'roms' && (
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
              onFetchAllMatching={async () => {
                let query = supabase
                  .from('roms')
                  .select('id, title, download_url')
                  .order('download_count', { ascending: false });
                if (selectedConsole) query = query.eq('console_slug', selectedConsole.slug);
                if (search.trim()) query = query.ilike('title', `%${search.trim()}%`);
                const { data } = await query;
                return (data ?? []) as Array<{ id: string; title: string; download_url: string | null }>;
              }}
            />
          )}
        </main>
      )}
    </div>
  );
}
