require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cheerio = require('cheerio');
const mysql = require('mysql2/promise');
const pLimit = require('p-limit');
const { randomUUID } = require('crypto');

const BASE_URL = 'https://www.romspedia.com';
const DB_NAME  = process.env.MYSQL_DATABASE || 'romspedia';
const DB_BASE  = {
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT) || 3306,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
};

if (!DB_BASE.host || !DB_BASE.user) {
  console.error('Missing MYSQL_HOST or MYSQL_USER in .env');
  process.exit(1);
}

let pool;

async function initDb() {
  const conn = await mysql.createConnection(DB_BASE);
  await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  await conn.end();

  pool = mysql.createPool({ ...DB_BASE, database: DB_NAME, waitForConnections: true, connectionLimit: 5 });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS consoles (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      image_url TEXT, rom_count INT DEFAULT 0, total_downloads INT DEFAULT 0,
      scraped_at DATETIME, created_at DATETIME DEFAULT NOW(),
      UNIQUE KEY uq_slug (slug)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS roms (
      id CHAR(36) NOT NULL PRIMARY KEY,
      console_id CHAR(36), console_slug VARCHAR(255) NOT NULL,
      title VARCHAR(500) NOT NULL, slug VARCHAR(255) NOT NULL,
      image_url TEXT, download_count INT DEFAULT 0,
      download_url TEXT, page_url TEXT,
      scraped_at DATETIME, created_at DATETIME DEFAULT NOW(),
      UNIQUE KEY uq_rom (console_slug, slug)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id CHAR(36) NOT NULL PRIMARY KEY, status VARCHAR(20) DEFAULT 'running',
      started_at DATETIME DEFAULT NOW(), completed_at DATETIME,
      error_msg TEXT, consoles_scraped INT DEFAULT 0, roms_scraped INT DEFAULT 0,
      current_console VARCHAR(255), pages_done INT DEFAULT 0, pages_total INT DEFAULT 0,
      urls_done INT DEFAULT 0, urls_total INT DEFAULT 0, created_at DATETIME DEFAULT NOW()
    )
  `);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHTML(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseConsoles(html) {
  const $ = cheerio.load(html);
  const consoles = [];
  $('a[href^="roms/"]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    const slug = href.replace(/^roms\//, '').replace(/\/$/, '');
    if (!slug || slug.includes('/') || slug.includes('page')) return;
    const title = a.find('h2.emulator-title').text().trim();
    if (!title) return;
    const imgEl = a.find('img').first();
    const imageUrl = imgEl.attr('src') || null;
    const downloads = a.find('p.emulator-download');
    const romCount = parseInt((downloads.eq(0).text().replace(/\D/g, '') || '0'), 10);
    const totalDownloads = parseInt((downloads.eq(1).text().replace(/\D/g, '') || '0'), 10);
    consoles.push({
      name: title, slug,
      image_url: imageUrl && imageUrl.startsWith('http') ? imageUrl : (imageUrl ? BASE_URL + imageUrl : null),
      rom_count: romCount, total_downloads: totalDownloads,
    });
  });
  return consoles;
}

function parseRomPage(html, consoleSlug) {
  const $ = cheerio.load(html);
  const roms = [];
  $('div.single-rom').each((_, el) => {
    const card = $(el);
    const downloadCount = parseInt(card.find('span.down-number').text().replace(/\D/g, '') || '0', 10);
    const linkEl = card.find('a[href^="/roms/"]').first();
    const href = linkEl.attr('href') || '';
    if (!href) return;
    const parts = href.replace('/roms/', '').split('/');
    if (parts.length < 2) return;
    const romSlug = parts[1];
    if (!romSlug) return;
    const title = card.find('h2.roms-title').text().trim();
    if (!title) return;
    const imgEl = card.find('img.img-fluid').first();
    let imageUrl = imgEl.attr('src') || '';
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.includes('spinner')) {
      imageUrl = imgEl.attr('data-src') || '';
    }
    if (!imageUrl || imageUrl.startsWith('data:')) imageUrl = null;
    roms.push({
      console_slug: consoleSlug, title, slug: romSlug,
      image_url: imageUrl || null, download_count: downloadCount,
      page_url: BASE_URL + href, download_url: null,
    });
  });
  return roms;
}

async function fetchDirectDownloadUrl(pageUrl) {
  try {
    const html = await fetchHTML(pageUrl + '/download?speed=fast');
    const match = html.match(/href="(https:\/\/downloads\.romspedia\.com\/roms\/[^"]+)"/);
    return match ? match[1] : null;
  } catch { return null; }
}

async function resolveDirectUrls(roms, concurrencyLimit = 6) {
  const limit = pLimit(concurrencyLimit);
  let done = 0;
  const total = roms.length;
  process.stdout.write(`    Resolving direct URLs: 0/${total}`);
  await Promise.all(roms.map(rom => limit(async () => {
    const directUrl = await fetchDirectDownloadUrl(rom.page_url);
    if (directUrl) rom.download_url = directUrl;
    done++;
    process.stdout.write(`\r    Resolving direct URLs: ${done}/${total}`);
  })));
  process.stdout.write('\n');
}

async function loadExistingDownloadUrls(consoleSlug) {
  const [rows] = await pool.execute(
    'SELECT slug, download_url FROM roms WHERE console_slug = ? AND download_url IS NOT NULL',
    [consoleSlug]
  );
  return new Map(rows.map(r => [r.slug, r.download_url]));
}

function getMaxPage(html) {
  const navIdx = html.indexOf('class="pagination"');
  const ulEnd = navIdx >= 0 ? html.indexOf('</ul>', navIdx) : -1;
  const scope = ulEnd >= 0 ? html.slice(navIdx, ulEnd) : html;
  const matches = scope.match(/\/page\/(\d+)/g) || [];
  let max = 1;
  for (const m of matches) { const n = parseInt(m.slice(6), 10); if (n > max) max = n; }
  return max;
}

async function scrapeConsoleRoms(consoleSlug, limitPerConsole = 0) {
  const firstUrl = `${BASE_URL}/roms/${consoleSlug}`;
  console.log(`  Scraping ${firstUrl} ...`);
  let firstHtml;
  try { firstHtml = await fetchHTML(firstUrl); }
  catch (err) { console.warn(`  Failed: ${err.message}`); return []; }

  const maxPage = getMaxPage(firstHtml);
  const allRoms = parseRomPage(firstHtml, consoleSlug);
  console.log(`    Page 1/${maxPage}: ${allRoms.length} ROMs`);

  if (!limitPerConsole || allRoms.length < limitPerConsole) {
    for (let p = 2; p <= maxPage; p++) {
      if (limitPerConsole && allRoms.length >= limitPerConsole) break;
      await sleep(600);
      try {
        const html = await fetchHTML(`${firstUrl}/page/${p}`);
        const pageRoms = parseRomPage(html, consoleSlug);
        allRoms.push(...pageRoms);
        console.log(`    Page ${p}/${maxPage}: ${pageRoms.length} ROMs (total: ${allRoms.length})`);
      } catch (err) { console.warn(`    Page ${p} failed: ${err.message}`); break; }
    }
  }

  const seen = new Set();
  const deduped = allRoms.filter(r => { if (seen.has(r.slug)) return false; seen.add(r.slug); return true; });
  const final = limitPerConsole ? deduped.slice(0, limitPerConsole) : deduped;

  const existingUrls = await loadExistingDownloadUrls(consoleSlug);
  const newRoms = final.filter(r => {
    const url = existingUrls.get(r.slug);
    if (url) { r.download_url = url; return false; }
    return true;
  });

  if (newRoms.length === 0) {
    console.log(`    All ${final.length} URLs already in DB`);
  } else {
    if (newRoms.length < final.length) console.log(`    ${final.length - newRoms.length} URLs reused, resolving ${newRoms.length} new`);
    await resolveDirectUrls(newRoms);
  }
  return final;
}

// ── MySQL helpers ─────────────────────────────────────────────────────────────

async function upsertConsole(console_) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO consoles (id, name, slug, image_url, rom_count, total_downloads, scraped_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), image_url = VALUES(image_url),
       rom_count = VALUES(rom_count), total_downloads = VALUES(total_downloads),
       scraped_at = NOW()`,
    [id, console_.name, console_.slug, console_.image_url ?? null, console_.rom_count, console_.total_downloads]
  );
  const [rows] = await pool.execute('SELECT id FROM consoles WHERE slug = ?', [console_.slug]);
  return rows[0].id;
}

async function upsertRoms(roms) {
  if (!roms.length) return;
  const BATCH = 100;
  for (let i = 0; i < roms.length; i += BATCH) {
    const batch = roms.slice(i, i + BATCH);
    const values = batch.map(r => [
      randomUUID(), r.console_id || null, r.console_slug, r.title, r.slug,
      r.image_url || null, r.download_count, r.download_url || null, r.page_url || null,
      new Date(), new Date(),
    ]);
    await pool.query(
      `INSERT INTO roms (id, console_id, console_slug, title, slug, image_url, download_count, download_url, page_url, scraped_at, created_at)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), image_url = VALUES(image_url),
         download_count = VALUES(download_count), download_url = VALUES(download_url),
         page_url = VALUES(page_url), scraped_at = VALUES(scraped_at)`,
      [values]
    );
  }
}

async function createJob() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO scrape_jobs (id, status, created_at, started_at) VALUES (?, ?, NOW(), NOW())',
    [id, 'running']
  );
  return id;
}

async function updateJob(jobId, updates) {
  const sets = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
  const vals = Object.values(updates);
  await pool.query(`UPDATE scrape_jobs SET ${sets} WHERE id = ?`, [...vals, jobId]);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  await initDb();

  const args = process.argv.slice(2);
  const consolesOnly  = args.includes('--consoles-only');
  const targetConsole = args.find(a => a.startsWith('--console='))?.split('=')[1];
  const targetSlugs   = args.find(a => a.startsWith('--consoles='))?.split('=')[1]?.split(',').filter(Boolean);
  const limit         = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

  const jobId = await createJob();
  console.log(`Job started: ${jobId}`);

  try {
    console.log('\nFetching console list...');
    const html = await fetchHTML(`${BASE_URL}/roms`);
    const allConsoles = parseConsoles(html);
    console.log(`Found ${allConsoles.length} consoles`);

    let targets = allConsoles;
    if (targetSlugs?.length) {
      targets = allConsoles.filter(c => targetSlugs.includes(c.slug));
    } else if (targetConsole) {
      targets = allConsoles.filter(c =>
        c.slug === targetConsole || c.name.toLowerCase().includes(targetConsole.toLowerCase())
      );
    }

    if (targets.length === 0) {
      console.error(`No console matched. Available slugs:`);
      allConsoles.forEach(c => console.log(`  ${c.slug} - ${c.name}`));
      await updateJob(jobId, { status: 'failed', error_msg: `No console matched: ${targetConsole || targetSlugs}` });
      return;
    }

    await updateJob(jobId, { consoles_scraped: targets.length });

    if (consolesOnly) {
      for (const c of targets) await upsertConsole(c);
      await updateJob(jobId, { status: 'completed', completed_at: new Date() });
      console.log('\nDone (consoles only).');
      process.exit(0);
    }

    let totalRoms = 0;
    const concurrency = pLimit(2);

    await Promise.all(targets.map(console_ => concurrency(async () => {
      await updateJob(jobId, { current_console: console_.name });
      const consoleId = await upsertConsole(console_);
      const roms = await scrapeConsoleRoms(console_.slug, limit);
      const romsWithId = roms.map(r => ({ ...r, console_id: consoleId }));
      await upsertRoms(romsWithId);
      totalRoms += romsWithId.length;
      await updateJob(jobId, { roms_scraped: totalRoms });
      console.log(`  Saved ${romsWithId.length} ROMs for ${console_.name}`);
      await sleep(800);
    })));

    await updateJob(jobId, {
      status: 'completed', completed_at: new Date(),
      roms_scraped: totalRoms, current_console: null,
    });
    console.log(`\nDone! ${targets.length} consoles, ${totalRoms} ROMs saved.`);
  } catch (err) {
    console.error('\nScraping failed:', err.message);
    await updateJob(jobId, { status: 'failed', completed_at: new Date(), error_msg: err.message });
  } finally {
    await pool.end();
  }
}

run();
