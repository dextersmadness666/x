import { useState, useEffect, useCallback } from 'react';
import type { Rom, Console } from '../lib/api';

type SelectedRom = { title: string; download_url: string | null };

type Props = {
  roms: Rom[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  selectedConsole: Console | null;
  onClearConsole: () => void;
  filterKey: string;
  onFetchAllMatching: () => Promise<Array<{ id: string; title: string; download_url: string | null }>>;
};

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function consoleLabel(slug: string) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function slugColor(slug: string): string {
  const palette = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#06b6d4', '#ef4444', '#84cc16',
  ];
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = slug.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function buildWgetScript(roms: Map<string, SelectedRom>): string {
  const entries = Array.from(roms.values()).filter(r => r.download_url);
  const lines = [
    '#!/bin/bash',
    `# ROM Download Script — ${entries.length} ROMs`,
    '# Usage: chmod +x download_roms.sh && ./download_roms.sh',
    '',
    'mkdir -p roms',
    'pushd roms > /dev/null',
    '',
  ];
  for (const rom of entries) {
    lines.push(`wget -c "${rom.download_url}"`);
  }
  lines.push('', 'popd > /dev/null', 'echo "Done!"');
  return lines.join('\n');
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RomTable({
  roms, loading, total, page, pageSize, onPage,
  selectedConsole, onClearConsole,
  filterKey, onFetchAllMatching,
}: Props) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  // Map of id -> {title, download_url} for all selected ROMs (persists across pages)
  const [selection, setSelection] = useState<Map<string, SelectedRom>>(new Map());
  const [fetchingAll, setFetchingAll] = useState(false);
  const [copied, setCopied] = useState(false);

  // Clear selection when filter changes (different console or search)
  useEffect(() => {
    setSelection(new Map());
  }, [filterKey]);

  const totalPages = Math.ceil(total / pageSize);
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  const currentPageIds = roms.map(r => r.id);
  const selectedOnPage = currentPageIds.filter(id => selection.has(id));
  const allPageSelected = currentPageIds.length > 0 && selectedOnPage.length === currentPageIds.length;
  const somePageSelected = selectedOnPage.length > 0 && !allPageSelected;

  const toggleRow = useCallback((rom: Rom) => {
    setSelection(prev => {
      const next = new Map(prev);
      if (next.has(rom.id)) {
        next.delete(rom.id);
      } else {
        next.set(rom.id, { title: rom.title, download_url: rom.download_url });
      }
      return next;
    });
  }, []);

  const togglePage = useCallback(() => {
    setSelection(prev => {
      const next = new Map(prev);
      if (allPageSelected) {
        for (const id of currentPageIds) next.delete(id);
      } else {
        for (const rom of roms) next.set(rom.id, { title: rom.title, download_url: rom.download_url });
      }
      return next;
    });
  }, [allPageSelected, currentPageIds, roms]);

  const selectAllMatching = useCallback(async () => {
    setFetchingAll(true);
    try {
      const all = await onFetchAllMatching();
      setSelection(prev => {
        const next = new Map(prev);
        for (const r of all) next.set(r.id, { title: r.title, download_url: r.download_url });
        return next;
      });
    } finally {
      setFetchingAll(false);
    }
  }, [onFetchAllMatching]);

  const clearSelection = useCallback(() => setSelection(new Map()), []);

  const handleDownloadScript = useCallback(() => {
    const script = buildWgetScript(selection);
    downloadFile(script, 'download_roms.sh', 'text/plain');
  }, [selection]);

  const handleCopyUrls = useCallback(async () => {
    const urls = Array.from(selection.values())
      .filter(r => r.download_url)
      .map(r => r.download_url)
      .join('\n');
    await navigator.clipboard.writeText(urls);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [selection]);

  const selectionSize = selection.size;
  const withUrls = Array.from(selection.values()).filter(r => r.download_url).length;

  return (
    <div style={{ animation: 'fade-in 0.2s ease', paddingBottom: selectionSize > 0 ? 72 : 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {selectedConsole ? (
          <>
            {selectedConsole.image_url && (
              <img
                src={selectedConsole.image_url}
                alt=""
                style={{ height: 22, objectFit: 'contain' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>
              {selectedConsole.name}
            </span>
            <button
              onClick={onClearConsole}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 99, color: 'var(--text-2)',
                padding: '3px 10px', fontSize: 12, cursor: 'pointer',
              }}
            >
              ← All consoles
            </button>
          </>
        ) : (
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>All ROMs</span>
        )}
        {total > 0 && (
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
            {total.toLocaleString()} results{total > pageSize ? ` · ${from}–${to}` : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {/* Select-all checkbox */}
                <th style={{ padding: '10px 4px 10px 14px', width: 36 }}>
                  <Checkbox
                    checked={allPageSelected}
                    indeterminate={somePageSelected}
                    onChange={togglePage}
                    disabled={loading || roms.length === 0}
                  />
                </th>
                {['', 'Title', 'Console', 'Downloads', 'Download', 'Source'].map((h, i) => (
                  <th key={i} style={{
                    padding: i === 0 ? '10px 8px 10px 6px' : '10px 14px',
                    textAlign: 'left',
                    fontSize: 11, fontWeight: 700,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 4px 8px 14px', width: 36 }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--surface-2)', animation: 'pulse 1.4s ease-in-out infinite' }}/>
                    </td>
                    <td style={{ padding: '8px 8px 8px 6px', width: 48 }}>
                      <div style={{ width: 34, height: 46, borderRadius: 5, background: 'var(--surface-2)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.05}s` }}/>
                    </td>
                    {[160, 100, 50, 65, 40].map((w, j) => (
                      <td key={j} style={{ padding: '8px 14px' }}>
                        <div style={{ height: 12, width: w, borderRadius: 4, background: 'var(--surface-2)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.05 + j * 0.02}s` }}/>
                      </td>
                    ))}
                  </tr>
                ))
              ) : roms.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-2)' }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
                    No ROMs found.
                  </td>
                </tr>
              ) : roms.map((rom, i) => {
                const hov = hoveredRow === rom.id;
                const sel = selection.has(rom.id);
                const color = slugColor(rom.console_slug);
                return (
                  <tr
                    key={rom.id}
                    onMouseEnter={() => setHoveredRow(rom.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => toggleRow(rom)}
                    style={{
                      borderBottom: i < roms.length - 1 ? '1px solid var(--border)' : 'none',
                      background: sel
                        ? 'rgba(59,130,246,0.07)'
                        : hov ? 'var(--surface-2)' : 'transparent',
                      transition: 'background 0.08s',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Row checkbox */}
                    <td style={{ padding: '8px 4px 8px 14px', width: 36 }} onClick={e => e.stopPropagation()}>
                      <Checkbox checked={sel} onChange={() => toggleRow(rom)} />
                    </td>

                    {/* Cover */}
                    <td style={{ padding: '8px 8px 8px 6px', width: 48 }}>
                      <div style={{ width: 34, height: 46, borderRadius: 5, background: 'var(--surface-3)', overflow: 'hidden' }}>
                        {rom.image_url && (
                          <img
                            src={rom.image_url}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                      </div>
                    </td>

                    {/* Title */}
                    <td style={{ padding: '8px 14px', maxWidth: 320 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rom.title}
                      </div>
                    </td>

                    {/* Console badge */}
                    <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        background: `${color}18`, color,
                        border: `1px solid ${color}28`,
                        borderRadius: 99, padding: '2px 8px',
                        fontSize: 11, fontWeight: 600,
                        letterSpacing: '0.01em', display: 'inline-block',
                      }}>
                        {consoleLabel(rom.console_slug)}
                      </span>
                    </td>

                    {/* Downloads */}
                    <td style={{ padding: '8px 14px', fontSize: 13, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                      {rom.download_count > 0
                        ? fmtNum(rom.download_count)
                        : <span style={{ color: 'var(--text-3)' }}>—</span>
                      }
                    </td>

                    {/* Download button */}
                    <td style={{ padding: '8px 14px' }} onClick={e => e.stopPropagation()}>
                      {rom.download_url ? (
                        <a
                          href={rom.download_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            background: 'var(--accent-dim)', color: 'var(--accent)',
                            border: '1px solid rgba(59,130,246,0.22)',
                            borderRadius: 'var(--radius-xs)',
                            padding: '4px 10px', fontSize: 12, fontWeight: 600,
                            whiteSpace: 'nowrap', transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.background = 'rgba(59,130,246,0.2)')}
                          onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.background = 'var(--accent-dim)')}
                        >
                          ↓ Download
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
                      )}
                    </td>

                    {/* Source */}
                    <td style={{ padding: '8px 14px' }} onClick={e => e.stopPropagation()}>
                      {rom.page_url ? (
                        <a
                          href={rom.page_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'underline', textUnderlineOffset: 2, transition: 'color 0.1s' }}
                          onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-2)')}
                          onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-3)')}
                        >
                          View
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
            Page <strong style={{ color: 'var(--text-2)', fontWeight: 600 }}>{page + 1}</strong> of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <PagBtn disabled={page === 0} onClick={() => onPage(0)}>«</PagBtn>
            <PagBtn disabled={page === 0} onClick={() => onPage(page - 1)}>‹</PagBtn>
            {(() => {
              const start = Math.max(0, Math.min(totalPages - 5, page - 2));
              return Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = start + i;
                return <PagBtn key={p} active={p === page} onClick={() => onPage(p)}>{p + 1}</PagBtn>;
              });
            })()}
            <PagBtn disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>›</PagBtn>
            <PagBtn disabled={page >= totalPages - 1} onClick={() => onPage(totalPages - 1)}>»</PagBtn>
          </div>
        </div>
      )}

      {/* Mass Download Action Bar */}
      {selectionSize > 0 && (
        <MassDownloadBar
          selectionSize={selectionSize}
          withUrls={withUrls}
          total={total}
          fetchingAll={fetchingAll}
          copied={copied}
          onSelectAll={selectAllMatching}
          onDownloadScript={handleDownloadScript}
          onCopyUrls={handleCopyUrls}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}

// ── Mass Download Bar ────────────────────────────────────────────────────────
type BarProps = {
  selectionSize: number;
  withUrls: number;
  total: number;
  fetchingAll: boolean;
  copied: boolean;
  onSelectAll: () => void;
  onDownloadScript: () => void;
  onCopyUrls: () => void;
  onClear: () => void;
};

function MassDownloadBar({
  selectionSize, withUrls, total, fetchingAll,
  copied, onSelectAll, onDownloadScript, onCopyUrls, onClear,
}: BarProps) {
  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--surface)',
      border: '1px solid var(--border-2)',
      borderRadius: 12,
      padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.15)',
      zIndex: 200,
      animation: 'slide-up 0.2s cubic-bezier(0.16,1,0.3,1)',
      whiteSpace: 'nowrap',
      maxWidth: 'calc(100vw - 48px)',
      flexWrap: 'wrap',
      justifyContent: 'center',
    }}>
      <style>{`@keyframes slide-up { from { opacity:0; transform:translateX(-50%) translateY(12px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>

      {/* Count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          background: 'var(--accent)', color: '#fff',
          borderRadius: 99, padding: '2px 9px',
          fontSize: 12, fontWeight: 700,
          minWidth: 26, textAlign: 'center',
        }}>
          {selectionSize}
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          ROM{selectionSize !== 1 ? 's' : ''} selected
          {withUrls < selectionSize && (
            <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>
              ({withUrls} with direct URL)
            </span>
          )}
        </span>
      </div>

      {/* Select all matching */}
      {selectionSize < total && (
        <button
          onClick={onSelectAll}
          disabled={fetchingAll}
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent)', fontSize: 12, fontWeight: 600,
            padding: '5px 12px', cursor: fetchingAll ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            opacity: fetchingAll ? 0.7 : 1,
          }}
        >
          {fetchingAll ? (
            <>
              <div style={{ width: 12, height: 12, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
              Loading…
            </>
          ) : (
            `Select all ${total.toLocaleString()} matching`
          )}
        </button>
      )}

      <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }}/>

      {/* Copy URLs */}
      <ActionBtn onClick={onCopyUrls} disabled={withUrls === 0}>
        {copied ? '✓ Copied!' : '⎘ Copy URLs'}
      </ActionBtn>

      {/* Download Script */}
      <ActionBtn onClick={onDownloadScript} disabled={withUrls === 0} primary>
        ↓ Download Script (.sh)
      </ActionBtn>

      {/* Clear */}
      <button
        onClick={onClear}
        style={{
          background: 'transparent', border: 'none',
          color: 'var(--text-3)', fontSize: 12,
          cursor: 'pointer', padding: '5px 4px',
          transition: 'color 0.1s',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)')}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)')}
      >
        ✕ Clear
      </button>
    </div>
  );
}

function ActionBtn({ children, onClick, disabled, primary }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: primary ? 'var(--accent)' : 'var(--surface-2)',
        color: primary ? '#fff' : disabled ? 'var(--text-3)' : 'var(--text)',
        border: `1px solid ${primary ? 'transparent' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '6px 14px', fontSize: 13, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.1s, opacity 0.1s',
      }}
    >
      {children}
    </button>
  );
}

// ── Pagination button ────────────────────────────────────────────────────────
function PagBtn({ children, onClick, disabled, active }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? 'var(--accent)' : 'var(--surface)',
        color: active ? '#fff' : disabled ? 'var(--text-3)' : 'var(--text-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '5px 10px', fontSize: 13,
        cursor: disabled ? 'default' : 'pointer',
        minWidth: 34, fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

// ── Checkbox ─────────────────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate, onChange, disabled }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        ref={el => { if (el) el.indeterminate = !!indeterminate; }}
        onChange={onChange}
        disabled={disabled}
        style={{ display: 'none' }}
      />
      <div style={{
        width: 16, height: 16,
        borderRadius: 4,
        border: `1.5px solid ${checked || indeterminate ? 'var(--accent)' : 'var(--border-2)'}`,
        background: checked || indeterminate ? 'var(--accent)' : 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.1s',
        flexShrink: 0,
      }}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M2 6l3 3 5-5"/>
          </svg>
        )}
        {!checked && indeterminate && (
          <svg width="8" height="2" viewBox="0 0 8 2" fill="#fff"><rect width="8" height="2" rx="1"/></svg>
        )}
      </div>
    </label>
  );
}
