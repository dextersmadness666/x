const API_BASE = '/api';

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
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  target_label: string | null;
  started_at: string | null;
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

export type ScrapeParams = {
  console?: string;
  consoles?: string[];
  consolesOnly?: boolean;
  limit?: number;
};

export async function getJobs(): Promise<ScrapeJob[]> {
  return apiFetch('/jobs');
}

export async function createQueuedJob(opts: { label: string; params: ScrapeParams }): Promise<ScrapeJob> {
  return apiFetch('/jobs', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function startJob(jobId: string): Promise<void> {
  await apiFetch(`/jobs/${jobId}/start`, { method: 'POST', body: '{}' });
}

export async function cancelJob(jobId: string): Promise<void> {
  await apiFetch(`/jobs/${jobId}/cancel`, { method: 'POST', body: '{}' });
}

export async function deleteJob(jobId: string): Promise<void> {
  await apiFetch(`/jobs/${jobId}`, { method: 'DELETE' });
}
