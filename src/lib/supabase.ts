import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

export type ConsoleWithStats = Console & {
  scraped_count: number;
};

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

export async function startScrapeJob(options?: { console?: string; consoles?: string[]; limit?: number }): Promise<void> {
  const { error } = await supabase.functions.invoke('scrape-roms', { body: options ?? {} });
  if (error) throw error;
}
