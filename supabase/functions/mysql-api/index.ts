import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { DOMParser } from "npm:linkedom@0.18.9";
import mysql from "npm:mysql2/promise";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MYSQL_HOST     = Deno.env.get("MYSQL_HOST")     ?? "itzone.ddns.net";
const MYSQL_PORT     = parseInt(Deno.env.get("MYSQL_PORT") ?? "3306");
const MYSQL_USER     = Deno.env.get("MYSQL_USER")     ?? "root";
const MYSQL_PASSWORD = Deno.env.get("MYSQL_PASSWORD") ?? "Regrexboi19@";
const MYSQL_DATABASE = Deno.env.get("MYSQL_DATABASE") ?? "romspedia";

// Module-level pool, created lazily after DB init
let pool: ReturnType<typeof mysql.createPool> | null = null;
let dbReady = false;

async function ensureDb() {
  if (dbReady) return;

  // Bootstrap: create database + tables
  const boot = await mysql.createConnection({
    host: MYSQL_HOST, port: MYSQL_PORT,
    user: MYSQL_USER, password: MYSQL_PASSWORD,
  });
  await boot.execute(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\``);
  await boot.execute(`USE \`${MYSQL_DATABASE}\``);
  await boot.execute(`
    CREATE TABLE IF NOT EXISTS consoles (
      id CHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL, image_url TEXT,
      rom_count INT DEFAULT 0, total_downloads INT DEFAULT 0,
      scraped_at DATETIME, created_at DATETIME DEFAULT NOW(),
      UNIQUE KEY uq_slug (slug)
    )
  `);
  await boot.execute(`
    CREATE TABLE IF NOT EXISTS roms (
      id CHAR(36) NOT NULL PRIMARY KEY, console_id CHAR(36),
      console_slug VARCHAR(255) NOT NULL, title VARCHAR(500) NOT NULL,
      slug VARCHAR(255) NOT NULL, image_url TEXT,
      download_count INT DEFAULT 0, download_url TEXT,
      page_url TEXT, scraped_at DATETIME, created_at DATETIME DEFAULT NOW(),
      UNIQUE KEY uq_rom (console_slug, slug)
    )
  `);
  await boot.execute(`
    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id CHAR(36) NOT NULL PRIMARY KEY, status VARCHAR(20) DEFAULT 'running',
      started_at DATETIME DEFAULT NOW(), completed_at DATETIME,
      error_msg TEXT, consoles_scraped INT DEFAULT 0, roms_scraped INT DEFAULT 0,
      current_console VARCHAR(255), pages_done INT DEFAULT 0, pages_total INT DEFAULT 0,
      urls_done INT DEFAULT 0, urls_total INT DEFAULT 0,
      created_at DATETIME DEFAULT NOW()
    )
  `);
  await boot.end();

  pool = mysql.createPool({
    host: MYSQL_HOST, port: MYSQL_PORT,
    user: MYSQL_USER, password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true, connectionLimit: 5,
  });
  dbReady = true;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleConsoles() {
  const [rows] = await pool!.execute(`
    SELECT c.*, COALESCE(r.cnt, 0) AS scraped_count
    FROM consoles c
    LEFT JOIN (SELECT console_slug, COUNT(*) AS cnt FROM roms GROUP BY console_slug) r
      ON r.console_slug = c.slug
    ORDER BY c.total_downloads DESC
  `);
  return json((rows as Record<string, unknown>[]).map(r => ({
    ...r,
    rom_count:       Number(r.rom_count),
    total_downloads: Number(r.total_downloads),
    scraped_count:   Number(r.scraped_count),
  })));
}

async function handleRomsTotal() {
  const [rows] = await pool!.execute("SELECT COUNT(*) AS total FROM roms") as [Record<string,unknown>[], unknown];
  return json({ total: Number(rows[0].total) });
}

async function handleRoms(search: URLSearchParams) {
  const consoleSlug = search.get("console");
  const q          = search.get("search");
  const page       = parseInt(search.get("page") ?? "0");
  const pageSize   = parseInt(search.get("pageSize") ?? "50");
  const all        = search.get("all");

  const params: unknown[] = [];
  let where = "1=1";
  if (consoleSlug) { where += " AND console_slug = ?"; params.push(consoleSlug); }
  if (q)           { where += " AND title LIKE ?";     params.push(`%${q}%`); }

  if (all) {
    const [rows] = await pool!.execute(
      `SELECT id, title, download_url FROM roms WHERE ${where} ORDER BY download_count DESC`,
      params
    );
    return json({ data: rows });
  }

  const offset = page * pageSize;
  const [rows]      = await pool!.execute(
    `SELECT * FROM roms WHERE ${where} ORDER BY download_count DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [cnt]       = await pool!.execute(
    `SELECT COUNT(*) AS total FROM roms WHERE ${where}`, params
  ) as [Record<string,unknown>[], unknown];
  return json({ data: rows, total: Number(cnt[0].total) });
}

async function handleLatestJob() {
  const [rows] = await pool!.execute(
    "SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 1"
  ) as [Record<string,unknown>[], unknown];
  return json(rows[0] ?? null);
}

// ── Scraping helpers ──────────────────────────────────────────────────────────

const BASE_URL = "https://www.romspedia.com";
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHTML(url: string) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

type ConsoleRow = { name: string; slug: string; image_url: string | null; rom_count: number; total_downloads: number };
type RomRow    = { console_slug: string; title: string; slug: string; image_url: string | null; download_count: number; page_url: string; download_url: string | null; console_id?: string };

function parseConsoles(html: string): ConsoleRow[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: ConsoleRow[] = [];
  for (const a of doc.querySelectorAll('a[href^="roms/"]')) {
    const href = (a as Element).getAttribute("href") || "";
    const slug = href.replace(/^roms\//, "").replace(/\/$/, "");
    if (!slug || slug.includes("/") || slug.includes("page")) continue;
    const name = (a as Element).querySelector("h2.emulator-title")?.textContent?.trim();
    if (!name) continue;
    let img = (a as Element).querySelector("img")?.getAttribute("src") ?? null;
    if (img && !img.startsWith("http")) img = img.startsWith("/") ? BASE_URL + img : null;
    const dls = (a as Element).querySelectorAll("p.emulator-download");
    out.push({
      name, slug, image_url: img,
      rom_count:       parseInt(((dls[0] as Element)?.textContent || "0").replace(/\D/g, "")) || 0,
      total_downloads: parseInt(((dls[1] as Element)?.textContent || "0").replace(/\D/g, "")) || 0,
    });
  }
  return out;
}

function parseRomPage(html: string, consoleSlug: string): RomRow[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: RomRow[] = [];
  for (const card of doc.querySelectorAll("div.single-rom")) {
    const dlCount = parseInt(((card.querySelector("span.down-number") as Element)?.textContent || "0").replace(/\D/g, "")) || 0;
    const href = (card.querySelector('a[href^="/roms/"]') as Element)?.getAttribute("href") || "";
    if (!href) continue;
    const parts = href.replace("/roms/", "").split("/");
    if (parts.length < 2 || !parts[1]) continue;
    const title = (card.querySelector("h2.roms-title") as Element)?.textContent?.trim();
    if (!title) continue;
    const imgEl = card.querySelector("img.img-fluid") as Element | null;
    let img = imgEl?.getAttribute("src") || "";
    if (!img || img.startsWith("data:") || img.includes("spinner")) img = imgEl?.getAttribute("data-src") || "";
    out.push({
      console_slug: consoleSlug, title, slug: parts[1],
      image_url: (img && !img.startsWith("data:")) ? img : null,
      download_count: dlCount, page_url: BASE_URL + href, download_url: null,
    });
  }
  return out;
}

function getMaxPage(html: string): number {
  const navIdx = html.indexOf('class="pagination"');
  const ulEnd  = navIdx >= 0 ? html.indexOf("</ul>", navIdx) : -1;
  const scope  = ulEnd >= 0 ? html.slice(navIdx, ulEnd) : html;
  const matches = scope.match(/\/page\/(\d+)/g) || [];
  return matches.reduce((max, m) => Math.max(max, parseInt(m.slice(6))), 1);
}

async function fetchDirectUrl(pageUrl: string): Promise<string | null> {
  try {
    const html = await fetchHTML(pageUrl + "/download?speed=fast");
    const m = html.match(/href="(https:\/\/downloads\.romspedia\.com\/roms\/[^"]+)"/);
    return m?.[1] ?? null;
  } catch { return null; }
}

async function resolveUrls(roms: RomRow[], onProgress?: (d: number, t: number) => Promise<void>) {
  const queue = [...roms]; let done = 0; const total = roms.length;
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const rom = queue.shift(); if (!rom) break;
      const url = await fetchDirectUrl(rom.page_url);
      if (url) rom.download_url = url;
      done++;
      if (onProgress && (done % 10 === 0 || done === total)) await onProgress(done, total);
      await sleep(80);
    }
  });
  await Promise.all(workers);
}

async function loadExistingUrls(consoleSlug: string): Promise<Map<string, string>> {
  const [rows] = await pool!.execute(
    "SELECT slug, download_url FROM roms WHERE console_slug = ? AND download_url IS NOT NULL",
    [consoleSlug]
  ) as [Record<string,string>[], unknown];
  return new Map(rows.map(r => [r.slug, r.download_url]));
}

async function upsertConsole(c: ConsoleRow): Promise<string> {
  const id = crypto.randomUUID();
  await pool!.query(
    `INSERT INTO consoles (id,name,slug,image_url,rom_count,total_downloads,scraped_at,created_at)
     VALUES (?,?,?,?,?,?,NOW(),NOW())
     ON DUPLICATE KEY UPDATE
       name=VALUES(name),image_url=VALUES(image_url),
       rom_count=VALUES(rom_count),total_downloads=VALUES(total_downloads),scraped_at=NOW()`,
    [id, c.name, c.slug, c.image_url, c.rom_count, c.total_downloads]
  );
  const [rows] = await pool!.execute("SELECT id FROM consoles WHERE slug=?", [c.slug]) as [Record<string,string>[], unknown];
  return rows[0].id;
}

async function upsertRoms(roms: RomRow[]) {
  if (!roms.length) return;
  const BATCH = 100;
  for (let i = 0; i < roms.length; i += BATCH) {
    const vals = roms.slice(i, i + BATCH).map(r => [
      crypto.randomUUID(), r.console_id ?? null, r.console_slug, r.title, r.slug,
      r.image_url ?? null, r.download_count, r.download_url ?? null, r.page_url,
      new Date(), new Date(),
    ]);
    await pool!.query(
      `INSERT INTO roms (id,console_id,console_slug,title,slug,image_url,download_count,download_url,page_url,scraped_at,created_at)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         title=VALUES(title),image_url=VALUES(image_url),download_count=VALUES(download_count),
         download_url=VALUES(download_url),page_url=VALUES(page_url),scraped_at=VALUES(scraped_at)`,
      [vals]
    );
  }
}

async function updateJob(jobId: string, fields: Record<string, unknown>) {
  const sets = Object.keys(fields).map(k => `\`${k}\`=?`).join(",");
  await pool!.query(`UPDATE scrape_jobs SET ${sets} WHERE id=?`, [...Object.values(fields), jobId]);
}

async function scrapeConsole(
  c: ConsoleRow, limit: number, jobId: string,
) {
  const firstUrl  = `${BASE_URL}/roms/${c.slug}`;
  let firstHtml: string;
  try { firstHtml = await fetchHTML(firstUrl); } catch (e) { console.warn(`Skip ${c.slug}:`, e); return; }

  const maxPage = getMaxPage(firstHtml);
  const all     = parseRomPage(firstHtml, c.slug);
  await updateJob(jobId, { pages_done: 1, pages_total: maxPage });

  for (let p = 2; p <= maxPage; p++) {
    if (limit && all.length >= limit) break;
    await sleep(500);
    try {
      all.push(...parseRomPage(await fetchHTML(`${firstUrl}/page/${p}`), c.slug));
      await updateJob(jobId, { pages_done: p, pages_total: maxPage });
    } catch { break; }
  }

  const seen = new Set<string>();
  const deduped = all.filter(r => { if (seen.has(r.slug)) return false; seen.add(r.slug); return true; });
  const final   = limit ? deduped.slice(0, limit) : deduped;

  const existing = await loadExistingUrls(c.slug);
  const newRoms  = final.filter(r => {
    const u = existing.get(r.slug);
    if (u) { r.download_url = u; return false; }
    return true;
  });

  if (newRoms.length) {
    await resolveUrls(newRoms, async (done, total) => {
      await updateJob(jobId, { urls_done: done, urls_total: total });
    });
  }

  const consoleId = await upsertConsole(c);
  await upsertRoms(final.map(r => ({ ...r, console_id: consoleId })));
  return final.length;
}

async function handleScrapeStart(body: { console?: string; consoles?: string[]; consolesOnly?: boolean; limit?: number }) {
  const jobId = crypto.randomUUID();
  await pool!.query(
    "INSERT INTO scrape_jobs (id,status,created_at,started_at) VALUES (?,?,NOW(),NOW())",
    [jobId, "running"]
  );

  EdgeRuntime.waitUntil((async () => {
    try {
      const html        = await fetchHTML(`${BASE_URL}/roms`);
      const allConsoles = parseConsoles(html);

      let targets = allConsoles;
      if (body.consoles?.length) {
        targets = allConsoles.filter(c => (body.consoles as string[]).includes(c.slug));
      } else if (body.console) {
        targets = allConsoles.filter(c =>
          c.slug === body.console ||
          c.name.toLowerCase().includes(body.console!.toLowerCase())
        );
      }

      await updateJob(jobId, { consoles_scraped: targets.length });

      if (body.consolesOnly) {
        for (const c of targets) await upsertConsole(c);
        await updateJob(jobId, { status: "completed", completed_at: new Date() });
        return;
      }

      let totalRoms = 0;
      for (const c of targets) {
        await updateJob(jobId, { current_console: c.name, pages_done: 0, pages_total: 0, urls_done: 0, urls_total: 0 });
        const count = await scrapeConsole(c, body.limit ?? 0, jobId);
        totalRoms += count ?? 0;
        await updateJob(jobId, { roms_scraped: totalRoms });
        await sleep(700);
      }

      await updateJob(jobId, { status: "completed", completed_at: new Date(), roms_scraped: totalRoms, current_console: null });
    } catch (err) {
      await updateJob(jobId, { status: "failed", completed_at: new Date(), error_msg: String(err) });
    }
  })());

  return json({ ok: true, jobId }, 202);
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    await ensureDb();
  } catch (err) {
    return json({ error: `DB init failed: ${String(err)}` }, 503);
  }

  const url  = new URL(req.url);
  const path = url.pathname.replace(/^.*\/mysql-api/, "") || "/";

  try {
    if (req.method === "GET") {
      if (path === "/consoles")    return handleConsoles();
      if (path === "/roms/total")  return handleRomsTotal();
      if (path.startsWith("/roms")) return handleRoms(url.searchParams);
      if (path === "/jobs/latest") return handleLatestJob();
    }
    if (req.method === "POST" && path === "/scrape") {
      const body = await req.json().catch(() => ({}));
      return handleScrapeStart(body);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
