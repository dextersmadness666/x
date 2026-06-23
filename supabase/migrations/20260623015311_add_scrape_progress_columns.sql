ALTER TABLE scrape_jobs
  ADD COLUMN IF NOT EXISTS pages_done integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pages_total integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urls_done integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urls_total integer DEFAULT 0;
