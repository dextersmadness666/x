import type { ScrapeJob } from '../lib/api';

type Props = {
  job: ScrapeJob;
  onRefresh: () => void;
};

const STATUS_MAP: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  running:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  dot: '#f59e0b', label: 'Running'   },
  completed: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   dot: '#22c55e', label: 'Completed' },
  failed:    { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   dot: '#ef4444', label: 'Failed'    },
  pending:   { color: '#7b879e', bg: 'rgba(123,135,158,0.08)', dot: '#7b879e', label: 'Pending'   },
};

function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function ProgressBar({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <span style={{ color: 'var(--text-3)', minWidth: 44, textAlign: 'right', fontWeight: 500 }}>{label}</span>
      <div style={{
        flex: 1, height: 4, background: 'var(--surface-3)',
        borderRadius: 99, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: color,
          borderRadius: 99,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ color: 'var(--text-2)', minWidth: 80, fontVariantNumeric: 'tabular-nums' }}>
        {done.toLocaleString()} / {total.toLocaleString()}
      </span>
    </div>
  );
}

export default function JobStatus({ job, onRefresh }: Props) {
  const s = STATUS_MAP[job.status] ?? STATUS_MAP.pending;

  const durationMs = job.completed_at
    ? new Date(job.completed_at).getTime() - new Date(job.started_at ?? job.created_at).getTime()
    : null;

  const showPages = job.status === 'running' && job.pages_total > 0;
  const showUrls  = job.status === 'running' && job.urls_total > 0;
  const showProgress = showPages || showUrls;

  return (
    <div style={{
      background: s.bg,
      borderBottom: '1px solid var(--border)',
      padding: showProgress ? '7px 24px 10px' : '7px 24px',
    }}>
      {/* Main row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        fontSize: 13, flexWrap: 'wrap',
      }}>
        {/* Status dot + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: s.dot,
            animation: job.status === 'running' ? 'blink 1s ease-in-out infinite' : 'none',
            boxShadow: job.status === 'running' ? `0 0 6px ${s.dot}` : 'none',
          }} />
          <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
        </div>

        {/* Current console */}
        {job.status === 'running' && job.current_console && (
          <span style={{ color: 'var(--text-2)' }}>
            Scraping <span style={{ color: 'var(--text)', fontWeight: 500 }}>{job.current_console}</span>
          </span>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, color: 'var(--text-2)' }}>
          {job.consoles_scraped > 0 && (
            <span>
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{job.consoles_scraped}</strong> consoles
            </span>
          )}
          {job.roms_scraped > 0 && (
            <span>
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{job.roms_scraped.toLocaleString()}</strong> ROMs
            </span>
          )}
        </div>

        {/* Duration */}
        {durationMs !== null && (
          <span style={{ color: 'var(--text-3)' }}>{fmtDuration(durationMs)}</span>
        )}

        {/* Error */}
        {job.error_msg && (
          <span style={{
            color: 'var(--error)', fontFamily: 'ui-monospace, monospace',
            fontSize: 12, maxWidth: 400, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {job.error_msg}
          </span>
        )}

        {/* Refresh / live indicator */}
        {job.status === 'running' ? (
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 12 }}>
            Live
          </span>
        ) : (
          <button
            onClick={onRefresh}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-2)',
              padding: '3px 10px',
              fontSize: 12, cursor: 'pointer',
              transition: 'border-color 0.12s, color 0.12s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-2)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
            }}
          >
            Refresh
          </button>
        )}
      </div>

      {/* Progress bars */}
      {showProgress && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {showPages && (
            <ProgressBar
              label="Pages"
              done={job.pages_done}
              total={job.pages_total}
              color="var(--accent)"
            />
          )}
          {showUrls && (
            <ProgressBar
              label="URLs"
              done={job.urls_done}
              total={job.urls_total}
              color="#22c55e"
            />
          )}
        </div>
      )}
    </div>
  );
}
