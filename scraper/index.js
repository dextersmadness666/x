require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const pLimit = require('p-limit');

const BASE_URL = 'https://www.romspedia.com';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

// ── Parse console cards from /roms ──────────────────────────────────────────
// Structure: <a href="roms/<slug>"> > .pop-slide > h2.emulator-title + p.emulator-download (x2)
function parseConsoles(html) {
  const $ = cheerio.load(html);
  const consoles = [];

  $('a[href^="roms/"]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    // Only top-level console slugs (no sub-paths)
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
      name: title,
      slug,
      image_url: imageUrl && imageUrl.startsWith('http') ? imageUrl : (imageUrl ? BASE_URL + imageUrl : null),
      rom_count: romCount,
      total_downloads: totalDownloads,
    });
  });

  return consoles;
}

// ── Parse a single page of ROMs from /roms/<slug>[/page/N] ──────────────────
// Structure: div.single-rom > .single-rom-header (span.down-number) + .roms-img (a+img) + .roms-info (a > h2.roms-title)
function parseRomPage(html, consoleSlug) {
  const $ = cheerio.load(html);
  const roms = [];

  $('div.single-rom').each((_, el) => {
    const card = $(el);

    const downloadCount = parseInt(card.find('span.down-number').text().replace(/\D/g, '') || '0', 10);

    // First <a> in .roms-img has the href; second <a> in .roms-info has the title
    const linkEl = card.find('a[href^="/roms/"]').first();
    const href = linkEl.attr('href') || '';
    if (!href) return;

    const parts = href.replace('/roms/', '').split('/');
    if (parts.length < 2) return;
    const romSlug = parts[1];
    if (!romSlug) return;

    const titleEl = card.find('h2.roms-title');
    const title = titleEl.text().trim();
    if (!title) return;

    // Image: prefer real src, fall back to data-src (lazy loaded)
    const imgEl = card.find('img.img-fluid').first();
    let imageUrl = imgEl.attr('src') || '';
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.includes('spinner')) {
      imageUrl = imgEl.attr('data-src') || '';
    }
    if (!imageUrl || imageUrl.startsWith('data:')) imageUrl = null;

    const pageUrl = BASE_URL + href;

    roms.push({
      console_slug: consoleSlug,
      title,
      slug: romSlug,
      image_url: imageUrl || null,
      download_count: downloadCount,
      page_url: pageUrl,
      download_url: null,
    });
  });

  return roms;
}

// ── Fetch the direct .zip/.7z download URL from the ROM's download page ────
// The page contains: href="https://downloads.romspedia.com/roms/<filename>"
async function fetchDirectDownloadUrl(pageUrl) {
  try {
    const html = await fetchHTML(pageUrl + '/download?speed=fast');
    const match = html.match(/href="(https:\/\/downloads\.romspedia\.com\/roms\/[^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Enrich an array of ROMs with direct download URLs (bounded concurrency) ──
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

// ── Load existing download URLs from DB to avoid re-fetching on resume ────────
async function loadExistingDownloadUrls(consoleSlug) {
  const { data } = await supabase
    .from('roms')
    .select('slug, download_url')
    .eq('console_slug', consoleSlug)
    .not('download_url', 'is', null);
  return new Map((data ?? []).map(r => [r.slug, r.download_url]));
}

// ── Find max page number from pagination links ───────────────────────────────
function getMaxPage(html) {
  // Scope to the <ul class="pagination"> block; the ">>" last-page button
  // within it always has href="/roms/<slug>/page/N" where N is the true last page.
  const navIdx = html.indexOf('class="pagination"');
  const ulEnd = navIdx >= 0 ? html.indexOf('</ul>', navIdx) : -1;
  const scope = ulEnd >= 0 ? html.slice(navIdx, ulEnd) : html;

  const matches = scope.match(/\/page\/(\d+)/g) || [];
  let max = 1;
  for (const m of matches) {
    const n = parseInt(m.slice(6), 10); // '/page/'.length === 6
    if (n > max) max = n;
  }
  return max;
}

// ── Scrape all pages of a console ────────────────────────────────────────────
async function scrapeConsoleRoms(consoleSlug, limitPerConsole = 0) {
  const firstUrl = `${BASE_URL}/roms/${consoleSlug}`;
  console.log(`  Scraping ${firstUrl} ...`);

  let firstHtml;
  try {
    firstHtml = await fetchHTML(firstUrl);
  } catch (err) {
    console.warn(`  Failed: ${err.message}`);
    return [];
  }

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
      } catch (err) {
        console.warn(`    Page ${p} failed: ${err.message}`);
        break;
      }
    }
  }

  // Deduplicate by slug
  const seen = new Set();
  const deduped = allRoms.filter(r => {
    if (seen.has(r.slug)) return false;
    seen.add(r.slug);
    return true;
  });

  const final = limitPerConsole ? deduped.slice(0, limitPerConsole) : deduped;

  // Reuse existing download URLs from DB; only fetch for new/missing ROMs
  const existingUrls = await loadExistingDownloadUrls(consoleSlug);
  const newRoms = final.filter(r => {
    const url = existingUrls.get(r.slug);
    if (url) { r.download_url = url; return false; }
    return true;
  });

  if (newRoms.length === 0) {
    console.log(`    All ${final.length} URLs already in DB`);
  } else {
    if (newRoms.length < final.length) {
      console.log(`    ${final.length - newRoms.length} URLs reused from DB, resolving ${newRoms.length} new`);
    }
    await resolveDirectUrls(newRoms);
  }

  return final;
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
async function upsertConsole(console_) {
  const { data, error } = await supabase
    .from('consoles')
    .upsert({ ...console_, scraped_at: new Date().toISOString() }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function upsertRoms(roms) {
  if (!roms.length) return;
  const { error } = await supabase
    .from('roms')
    .upsert(roms.map(r => ({ ...r, scraped_at: new Date().toISOString() })), {
      onConflict: 'console_slug,slug',
    });
  if (error) throw error;
}

async function updateJob(jobId, updates) {
  await supabase.from('scrape_jobs').update(updates).eq('id', jobId);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const args = process.argv.slice(2);
  const consolesOnly = args.includes('--consoles-only');
  const targetConsole = args.find(a => a.startsWith('--console='))?.split('=')[1];
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

  const { data: job, error: jobErr } = await supabase
    .from('scrape_jobs')
    .insert({ status: 'running' })
    .select()
    .single();
  if (jobErr) { console.error('Failed to create job:', jobErr.message); process.exit(1); }
  const jobId = job.id;
  console.log(`Job started: ${jobId}`);

  try {
    // 1. Parse all consoles
    console.log('\nFetching console list...');
    const html = await fetchHTML(`${BASE_URL}/roms`);
    const allConsoles = parseConsoles(html);
    console.log(`Found ${allConsoles.length} consoles`);

    const targets = targetConsole
      ? allConsoles.filter(c =>
          c.slug === targetConsole ||
          c.name.toLowerCase().includes(targetConsole.toLowerCase())
        )
      : allConsoles;

    if (targets.length === 0) {
      console.error(`No console matched "${targetConsole}". Available slugs:`);
      allConsoles.forEach(c => console.log(`  ${c.slug} - ${c.name}`));
      await updateJob(jobId, { status: 'failed', error_msg: `No console matched: ${targetConsole}` });
      return;
    }

    await updateJob(jobId, { consoles_scraped: targets.length });

    if (consolesOnly) {
      for (const c of targets) await upsertConsole(c);
      await updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() });
      console.log('\nDone (consoles only).');
      return;
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
      status: 'completed',
      completed_at: new Date().toISOString(),
      roms_scraped: totalRoms,
      current_console: null,
    });

    console.log(`\nDone! ${targets.length} consoles, ${totalRoms} ROMs saved.`);
  } catch (err) {
    console.error('\nScraping failed:', err.message);
    await updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_msg: err.message,
    });
  }
}

run();
