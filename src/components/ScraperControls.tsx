import { useState } from 'react';
import { startScrapeJob, type ScrapeJob } from '../lib/supabase';

type Props = {
  latestJob: ScrapeJob | null;
  onJobStart: () => void;
};

export default function ScraperControls({ latestJob, onJobStart }: Props) {
  const [open, setOpen] = useState(false);
  const [consoleSlug, setConsoleSlug] = useState('');
  const [limit, setLimit] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isRunning = latestJob?.status === 'running';

  async function startScrape() {
    setLoading(true);
    setError('');
    try {
      await startScrapeJob({
        console: consoleSlug.trim() || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      setOpen(false);
      setConsoleSlug('');
      setLimit('');
      onJobStart();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-scraper-btn
        onClick={() => setOpen(o => !o)}
        disabled={isRunning}
        style={{
          background: isRunning ? 'var(--surface-2)' : 'var(--accent)',
          color: isRunning ? 'var(--text-2)' : '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: '7px 16px',
          fontWeight: 600,
          fontSize: 13,
          cursor: isRunning ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 7,
          transition: 'background 0.15s, opacity 0.15s',
        }}
      >
        {isRunning ? (
          <>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: 'var(--warning)', animation: 'blink 1s ease-in-out infinite',
            }}/>
            Scraping…
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4 3v14l12-7L4 3z"/>
            </svg>
            Run Scraper
          </>
        )}
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)',
            padding: 20,
            width: 300,
            zIndex: 200,
            boxShadow: 'var(--shadow-lg)',
            animation: 'slide-down 0.15s ease',
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 18 }}>Scraper Options</div>

            <Field label="Console slug (optional)">
              <input
                type="text"
                placeholder="e.g. gameboy-color"
                value={consoleSlug}
                onChange={e => setConsoleSlug(e.target.value)}
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                Leave empty to scrape all consoles
              </div>
            </Field>

            <Field label="ROM limit per console (optional)">
              <input
                type="number"
                placeholder="e.g. 50"
                value={limit}
                onChange={e => setLimit(e.target.value)}
                min="1"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                Leave empty to scrape all ROMs
              </div>
            </Field>

            <div style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '9px 12px',
              fontSize: 12, color: 'var(--text-2)', marginBottom: 16,
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span style={{ color: 'var(--success)', fontSize: 14, flexShrink: 0 }}>✓</span>
              Download links are always included automatically.
            </div>

            {error && (
              <div style={{
                color: 'var(--error)', fontSize: 12, marginBottom: 12,
                padding: '8px 12px', background: 'var(--error-dim)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(239,68,68,0.2)',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setOpen(false)}
                style={{
                  flex: 1, background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-2)',
                  padding: '8px', fontSize: 13, cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={startScrape}
                disabled={loading}
                style={{
                  flex: 1, background: 'var(--accent)',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  color: '#fff', padding: '8px', fontSize: 13,
                  fontWeight: 600, cursor: loading ? 'default' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {loading ? 'Starting…' : 'Start Scraping'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
