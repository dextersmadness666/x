CREATE OR REPLACE FUNCTION public.get_console_rom_counts()
RETURNS TABLE(slug text, scraped_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT console_slug, COUNT(*)::bigint
  FROM roms
  GROUP BY console_slug;
$$;

GRANT EXECUTE ON FUNCTION public.get_console_rom_counts() TO anon, authenticated;
