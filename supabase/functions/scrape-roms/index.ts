import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser } from "npm:linkedom@0.18.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BASE_URL = "https://www.romspedia.com";
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchHTML(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

type ConsoleRow = {
  name: string;
  slug: string;
  image_url: string | null;
  rom_count: number;
  total_downloads: number;
};

type RomRow = {
  console_slug: string;
  title: string;
  slug: string;
  image_url: string | null;
  download_count: number;
  page_url: string;
  download_url: string | null;
  console_id?: string;
};

type SupabaseClient = ReturnType<typeof createClient>;

// ── Fetch direct .zip/.7z URL from the ROM's download page ──────────────────
// The page contains: href="https://downloads.romspedia.com/roms/<filename>"
async function fetchDirectDownloadUrl(pageUrl: string): Promise<string | null> {
  try {
    const html = await fetchHTML(pageUrl + "/download?speed=fast");
    const match = html.match(/href="(https:\/\/downloads\.romspedia\.com\/roms\/[^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Enrich ROMs with direct download URLs (bounded concurrency) ──────────────
async function resolveDirectUrls(
  roms: RomRow[],
  concurrency = 6,
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<void> {
  const queue = roms.slice();
  const total = roms.length;
  let done = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const rom = queue.shift();
      if (!rom) break;
      const url = await fetchDirectDownloadUrl(rom.page_url);
      if (url) rom.download_url = url;
      done++;
      if (onProgress && (done % 10 === 0 || done === total)) {
        await onProgress(done, total);
      }
      await sleep(80);
    }
  });
  await Promise.all(workers);
}

// ── Parse console cards from /roms ──────────────────────────────────────────
// Each card: <a href="roms/<slug>"> > .pop-slide > h2.emulator-title + p.emulator-download (x2) + img
function parseConsoles(html: string): ConsoleRow[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const consoles: ConsoleRow[] = [];

  const anchors = doc.querySelectorAll('a[href^="roms/"]');
  for (const a of anchors) {
    const href = (a as Element).getAttribute("href") || "";
    const slug = href.replace(/^roms\//, "").replace(/\/$/, "");
    if (!slug || slug.includes("/") || slug.includes("page")) continue;

    const titleEl = (a as Element).querySelector("h2.emulator-title");
    if (!titleEl) continue;
    const name = titleEl.textContent?.trim() || "";
    if (!name) continue;

    const imgEl = (a as Element).querySelector("img");
    let imageUrl = imgEl?.getAttribute("src") || null;
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = imageUrl.startsWith("/") ? BASE_URL + imageUrl : null;
    }

    const dlEls = (a as Element).querySelectorAll("p.emulator-download");
    const romCount = parseInt((dlEls[0]?.textContent || "0").replace(/\D/g, ""), 10) || 0;
    const totalDownloads = parseInt((dlEls[1]?.textContent || "0").replace(/\D/g, ""), 10) || 0;

    consoles.push({ name, slug, image_url: imageUrl, rom_count: romCount, total_downloads: totalDownloads });
  }

  return consoles;
}

// ── Parse ROM cards from a listing page ─────────────────────────────────────
// Each card: div.single-rom > .single-rom-header (span.down-number) + a[href] + img + h2.roms-title
function parseRomPage(html: string, consoleSlug: string): RomRow[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const roms: RomRow[] = [];

  const cards = doc.querySelectorAll("div.single-rom");
  for (const card of cards) {
    const downloadCount =
      parseInt((card.querySelector("span.down-number")?.textContent || "0").replace(/\D/g, ""), 10) || 0;

    const linkEl = card.querySelector('a[href^="/roms/"]') as Element | null;
    const href = linkEl?.getAttribute("href") || "";
    if (!href) continue;

    const parts = href.replace("/roms/", "").split("/");
    if (parts.length < 2) continue;
    const romSlug = parts[1];
    if (!romSlug) continue;

    const titleEl = card.querySelector("h2.roms-title");
    const title = titleEl?.textContent?.trim() || "";
    if (!title) continue;

    // Image: real src first, then data-src (lazy loaded)
    const imgEl = card.querySelector("img.img-fluid") as Element | null;
    let imageUrl = imgEl?.getAttribute("src") || "";
    if (!imageUrl || imageUrl.startsWith("data:") || imageUrl.includes("spinner")) {
      imageUrl = imgEl?.getAttribute("data-src") || "";
    }
    const finalImage = imageUrl && !imageUrl.startsWith("data:") ? imageUrl : null;

    const pageUrl = BASE_URL + href;

    roms.push({
      console_slug: consoleSlug,
      title,
      slug: romSlug,
      image_url: finalImage,
      download_count: downloadCount,
      page_url: pageUrl,
      download_url: null as string | null,
    });
  }

  return roms;
}

// ── Load existing download URLs from DB to skip re-fetching on resume ─────────
async function loadExistingDownloadUrls(
  supabase: SupabaseClient,
  consoleSlug: string
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("roms")
    .select("slug, download_url")
    .eq("console_slug", consoleSlug)
    .not("download_url", "is", null);
  return new Map((data ?? []).map((r: { slug: string; download_url: string }) => [r.slug, r.download_url]));
}

// ── Find max pagination page ─────────────────────────────────────────────────
function getMaxPage(html: string): number {
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

// ── Scrape all pages for one console ────────────────────────────────────────
async function scrapeConsoleRoms(
  supabase: SupabaseClient,
  slug: string,
  limitPerConsole = 0,
  onPageProgress?: (done: number, total: number) => Promise<void>,
  onUrlProgress?: (done: number, total: number) => Promise<void>,
): Promise<RomRow[]> {
  const firstUrl = `${BASE_URL}/roms/${slug}`;
  const firstHtml = await fetchHTML(firstUrl);
  const maxPage = getMaxPage(firstHtml);
  const all = parseRomPage(firstHtml, slug);
  if (onPageProgress) await onPageProgress(1, maxPage);

  for (let p = 2; p <= maxPage; p++) {
    if (limitPerConsole && all.length >= limitPerConsole) break;
    await sleep(500);
    try {
      const html = await fetchHTML(`${firstUrl}/page/${p}`);
      all.push(...parseRomPage(html, slug));
      if (onPageProgress) await onPageProgress(p, maxPage);
    } catch { break; }
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = all.filter(r => {
    if (seen.has(r.slug)) return false;
    seen.add(r.slug);
    return true;
  });

  const final = limitPerConsole ? deduped.slice(0, limitPerConsole) : deduped;

  // Reuse existing download URLs from DB; only fetch for new/missing ROMs
  const existingUrls = await loadExistingDownloadUrls(supabase, slug);
  const newRoms = final.filter(r => {
    const url = existingUrls.get(r.slug);
    if (url) { r.download_url = url; return false; }
    return true;
  });

  if (newRoms.length) await resolveDirectUrls(newRoms, 6, onUrlProgress);

  return final;
}

// ── Edge Function handler ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: { console?: string; consoles?: string[]; consolesOnly?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const perConsoleLimit = body.limit ?? 0;

  const { data: job } = await supabase
    .from("scrape_jobs")
    .insert({ status: "running" })
    .select()
    .single();
  const jobId = job?.id as string;

  EdgeRuntime.waitUntil((async () => {
    try {
      // Fast path: only import console metadata, skip ROM scraping
      if (body.consolesOnly) {
        const indexHtml = await fetchHTML(`${BASE_URL}/roms`);
        const allConsoles = parseConsoles(indexHtml);

        const BATCH = 20;
        for (let i = 0; i < allConsoles.length; i += BATCH) {
          await supabase.from("consoles").upsert(
            allConsoles.slice(i, i + BATCH),
            { onConflict: "slug" }
          );
        }

        await supabase.from("scrape_jobs").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          consoles_scraped: allConsoles.length,
        }).eq("id", jobId);
        return;
      }

      // 1. Parse console list
      const indexHtml = await fetchHTML(`${BASE_URL}/roms`);
      const allConsoles = parseConsoles(indexHtml);

      // Resolve target list: array of slugs > single slug/name > all
      let targets = allConsoles;
      if (body.consoles?.length) {
        targets = allConsoles.filter(c => (body.consoles as string[]).includes(c.slug));
      } else if (body.console) {
        targets = allConsoles.filter(c =>
          c.slug === body.console ||
          c.name.toLowerCase().includes((body.console as string).toLowerCase())
        );
      }

      await supabase.from("scrape_jobs").update({ consoles_scraped: targets.length }).eq("id", jobId);

      let totalRoms = 0;

      for (const console_ of targets) {
        await supabase.from("scrape_jobs").update({
          current_console: console_.name,
          pages_done: 0, pages_total: 0,
          urls_done: 0, urls_total: 0,
        }).eq("id", jobId);

        // Upsert console
        const { data: consoleRow } = await supabase
          .from("consoles")
          .upsert({ ...console_, scraped_at: new Date().toISOString() }, { onConflict: "slug" })
          .select("id")
          .single();

        // Scrape ROM listing pages + resolve download URLs
        let roms: RomRow[] = [];
        try {
          roms = await scrapeConsoleRoms(
            supabase,
            console_.slug,
            perConsoleLimit,
            async (done, total) => {
              await supabase.from("scrape_jobs")
                .update({ pages_done: done, pages_total: total })
                .eq("id", jobId);
            },
            async (done, total) => {
              await supabase.from("scrape_jobs")
                .update({ urls_done: done, urls_total: total })
                .eq("id", jobId);
            },
          );
        } catch (e) {
          console.warn(`Failed scraping ${console_.slug}:`, e);
          continue;
        }

        const romsToSave = roms.map(r => ({
          ...r,
          console_id: consoleRow?.id,
          scraped_at: new Date().toISOString(),
        }));

        if (romsToSave.length) {
          const BATCH = 100;
          for (let i = 0; i < romsToSave.length; i += BATCH) {
            await supabase.from("roms").upsert(romsToSave.slice(i, i + BATCH), {
              onConflict: "console_slug,slug",
            });
          }
        }

        totalRoms += romsToSave.length;
        await supabase.from("scrape_jobs").update({ roms_scraped: totalRoms }).eq("id", jobId);
        await sleep(700);
      }

      await supabase.from("scrape_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        roms_scraped: totalRoms,
        current_console: null,
      }).eq("id", jobId);

    } catch (err) {
      await supabase.from("scrape_jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_msg: String(err),
      }).eq("id", jobId);
    }
  })());

  return new Response(JSON.stringify({ ok: true, jobId }), {
    status: 202,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
