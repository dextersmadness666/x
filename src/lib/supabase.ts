const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const API_BASE     = `${SUPABASE_URL}/functions/v1/mysql-api`;

export type Console = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  rom_count: number;
  total_downloads: number;
  scraped_at: string | null;
  created_at: string;
};

export type ConsoleWithStats = Console & { scraped_count: number };

export type Rom = {
  id: string;
  console_id: string;
  console_slug: string;
  title: string;
  slug: string;
  image_url: string | null;
  download_count: number;
  download_url: string | null;
  page_url: string | null;
  scraped_at: string | null;
  created_at: string;
};

export type ScrapeJob = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  error_msg: string | null;
  consoles_scraped: number;
  roms_scraped: number;
  current_console: string | null;
  pages_done: number;
  pages_total: number;
  urls_done: number;
  urls_total: number;
  created_at: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json() as Promise<T>;
}

export async function getConsoles(): Promise<ConsoleWithStats[]> {
  return apiFetch('/consoles');
}

export async function getRoms(params: {
  console?: string | null;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: Rom[]; total: number }> {
  const q = new URLSearchParams();
  if (params.console)               q.set('console',  params.console);
  if (params.search?.trim())        q.set('search',   params.search.trim());
  if (params.page  !== undefined)   q.set('page',     String(params.page));
  if (params.pageSize !== undefined) q.set('pageSize', String(params.pageSize));
  return apiFetch(`/roms?${q}`);
}

export async function getTotalRoms(): Promise<number> {
  const { total } = await apiFetch<{ total: number }>('/roms/total');
  return total;
}

export async function getLatestJob(): Promise<ScrapeJob | null> {
  return apiFetch('/jobs/latest');
}

export async function startScrapeJob(options?: {
  console?: string;
  consoles?: string[];
  consolesOnly?: boolean;
  limit?: number;
}): Promise<void> {
  await apiFetch('/scrape', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

export async function getAllMatchingRoms(params: {
  console?: string | null;
  search?: string;
}): Promise<Array<{ id: string; title: string; download_url: string | null }>> {
  const q = new URLSearchParams({ all: '1' });
  if (params.console)        q.set('console', params.console);
  if (params.search?.trim()) q.set('search',  params.search.trim());
  const { data } = await apiFetch<{ data: Array<{ id: string; title: string; download_url: string | null }> }>(`/roms?${q}`);
  return data;
}
