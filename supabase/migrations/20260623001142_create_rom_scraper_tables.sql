
CREATE TABLE consoles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  image_url text,
  rom_count integer DEFAULT 0,
  total_downloads bigint DEFAULT 0,
  scraped_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE roms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  console_id uuid REFERENCES consoles(id) ON DELETE CASCADE,
  console_slug text NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  image_url text,
  download_count integer DEFAULT 0,
  download_url text,
  page_url text,
  scraped_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(console_slug, slug)
);

CREATE TABLE scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error_msg text,
  consoles_scraped integer DEFAULT 0,
  roms_scraped integer DEFAULT 0,
  current_console text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_roms_console_id ON roms(console_id);
CREATE INDEX idx_roms_console_slug ON roms(console_slug);
CREATE INDEX idx_roms_title ON roms USING gin(to_tsvector('english', title));

ALTER TABLE consoles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roms ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_consoles" ON consoles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_consoles" ON consoles FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_consoles" ON consoles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_consoles" ON consoles FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "select_roms" ON roms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_roms" ON roms FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_roms" ON roms FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_roms" ON roms FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "select_scrape_jobs" ON scrape_jobs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_scrape_jobs" ON scrape_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_scrape_jobs" ON scrape_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_scrape_jobs" ON scrape_jobs FOR DELETE TO anon, authenticated USING (true);
