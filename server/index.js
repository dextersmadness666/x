import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Database ─────────────────────────────────────────────────────────────────

const DB_NAME = process.env.MYSQL_DATABASE || 'romspedia';
const DB_BASE = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
};

let pool;

async function initDb() {
  const conn = await mysql.createConnection(DB_BASE);
  await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  await conn.end();

  pool = mysql.createPool({ ...DB_BASE, database: DB_NAME, waitForConnections: true, connectionLimit: 10 });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS consoles (
      id       CHAR(36)     NOT NULL PRIMARY KEY,
      name     VARCHAR(255) NOT NULL,
      slug     VARCHAR(255) NOT NULL,
      image_url TEXT,
      rom_count INT DEFAULT 0,
      total_downloads INT DEFAULT 0,
      scraped_at DATETIME,
      created_at DATETIME DEFAULT NOW(),
      UNIQUE KEY uq_slug (slug)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS roms (
      id           CHAR(36)     NOT NULL PRIMARY KEY,
      console_id   CHAR(36),
      console_slug VARCHAR(255) NOT NULL,
      title        VARCHAR(500) NOT NULL,
      slug         VARCHAR(255) NOT NULL,
      image_url    TEXT,
      download_count INT DEFAULT 0,
      download_url TEXT,
      page_url     TEXT,
      scraped_at   DATETIME,
      created_at   DATETIME DEFAULT NOW(),
      UNIQUE KEY uq_rom (console_slug, slug)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id               CHAR(36)    NOT NULL PRIMARY KEY,
      status           VARCHAR(20) DEFAULT 'running',
      started_at       DATETIME    DEFAULT NOW(),
      completed_at     DATETIME,
      error_msg        TEXT,
      consoles_scraped INT         DEFAULT 0,
      roms_scraped     INT         DEFAULT 0,
      current_console  VARCHAR(255),
      pages_done       INT         DEFAULT 0,
      pages_total      INT         DEFAULT 0,
      urls_done        INT         DEFAULT 0,
      urls_total       INT         DEFAULT 0,
      created_at       DATETIME    DEFAULT NOW()
    )
  `);

  // Migrate: add queue support columns (idempotent)
  for (const sql of [
    'ALTER TABLE scrape_jobs ADD COLUMN target_label VARCHAR(255)',
    'ALTER TABLE scrape_jobs ADD COLUMN job_params TEXT',
  ]) {
    try { await pool.execute(sql); } catch { /* column already exists */ }
  }

  console.log(`Connected to MySQL: ${DB_BASE.host} → ${DB_NAME}`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/consoles', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.*,
             COALESCE(r.scraped_count, 0) AS scraped_count
      FROM consoles c
      LEFT JOIN (
        SELECT console_slug, COUNT(*) AS scraped_count
        FROM roms GROUP BY console_slug
      ) r ON r.console_slug = c.slug
      ORDER BY c.total_downloads DESC
    `);
    res.json(rows.map(r => ({
      ...r,
      rom_count:       Number(r.rom_count),
      total_downloads: Number(r.total_downloads),
      scraped_count:   Number(r.scraped_count),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/roms/total', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM roms');
    res.json({ total: Number(rows[0].total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/roms', async (req, res) => {
  try {
    const { console: consoleSlug, search, page = '0', pageSize = '50', all } = req.query;
    const offset = Number(page) * Number(pageSize);

    const params = [];
    let where = '1=1';
    if (consoleSlug) { where += ' AND console_slug = ?'; params.push(consoleSlug); }
    if (search)      { where += ' AND title LIKE ?';     params.push(`%${search}%`); }

    if (all) {
      const [rows] = await pool.execute(
        `SELECT id, title, download_url FROM roms WHERE ${where} ORDER BY download_count DESC`,
        params
      );
      return res.json({ data: rows });
    }

    const [rows]      = await pool.execute(
      `SELECT * FROM roms WHERE ${where} ORDER BY download_count DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM roms WHERE ${where}`,
      params
    );
    res.json({ data: rows, total: Number(countRows[0].total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/latest', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 1'
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape — create a job and immediately start scraping (legacy instant-start)
app.post('/api/scrape', async (req, res) => {
  try {
    const { console: consoleName, consoles, consolesOnly, limit } = req.body ?? {};

    const args = [];
    if (consolesOnly)     args.push('--consoles-only');
    if (consoleName)      args.push(`--console=${consoleName}`);
    if (consoles?.length) args.push(`--consoles=${consoles.join(',')}`);
    if (limit)            args.push(`--limit=${limit}`);

    spawn('node', ['scraper/index.js', ...args], {
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    }).unref();

    // Wait for scraper to write its job row
    await new Promise(r => setTimeout(r, 700));

    const [rows] = await pool.execute(
      'SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 1'
    );
    res.json(rows[0] ?? { status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs — list all jobs (queue page)
app.get('/api/jobs', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs — create a queued job (does not start it)
app.post('/api/jobs', async (req, res) => {
  try {
    const { label, params } = req.body ?? {};
    const id = randomUUID();
    const jobLabel  = label ?? 'Scrape job';
    const jobParams = JSON.stringify(params ?? {});
    await pool.query(
      "INSERT INTO scrape_jobs (id, status, target_label, job_params, created_at, started_at) VALUES (?, 'queued', ?, ?, NOW(), NULL)",
      [id, jobLabel, jobParams]
    );
    const [rows] = await pool.execute('SELECT * FROM scrape_jobs WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/start — start a queued job
app.post('/api/jobs/:id/start', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT status, job_params FROM scrape_jobs WHERE id = ?', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    if (rows[0].status !== 'queued') return res.status(400).json({ error: 'Job is not in queued state' });

    const params = JSON.parse(rows[0].job_params || '{}');
    const { console: consoleName, consoles, consolesOnly, limit } = params;

    const args = [];
    if (consolesOnly)     args.push('--consoles-only');
    if (consoleName)      args.push(`--console=${consoleName}`);
    if (consoles?.length) args.push(`--consoles=${consoles.join(',')}`);
    if (limit)            args.push(`--limit=${limit}`);

    await pool.execute(
      "UPDATE scrape_jobs SET status='running', started_at=NOW() WHERE id = ?", [req.params.id]
    );

    spawn('node', ['scraper/index.js', ...args], {
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    }).unref();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/cancel — cancel a running or queued job
app.post('/api/jobs/:id/cancel', async (req, res) => {
  try {
    await pool.execute(
      "UPDATE scrape_jobs SET status = 'cancelled' WHERE id = ? AND status IN ('running', 'queued')",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/jobs/:id — delete a job
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM scrape_jobs WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve built frontend in production
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

// ── Exports for Vite dev server integration ──────────────────────────────────

export { app, initDb };

// ── Start (only when run directly, not imported) ─────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const PORT = process.env.PORT || 3001;
  initDb()
    .then(() => app.listen(PORT, () => console.log(`API server → http://localhost:${PORT}`)))
    .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
}
