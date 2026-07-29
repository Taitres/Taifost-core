\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE media_url_map (
  old_url text PRIMARY KEY,
  new_url text NOT NULL
) ON COMMIT DROP;

COPY media_url_map (old_url, new_url)
FROM '/tmp/marlin-media-url-map.tsv'
WITH (FORMAT text, DELIMITER E'\t');

DO $migration$
DECLARE
  mapping record;
BEGIN
  FOR mapping IN SELECT old_url, new_url FROM media_url_map LOOP
    UPDATE posts
    SET
      text = replace(text, mapping.old_url, mapping.new_url),
      content = replace(content, mapping.old_url, mapping.new_url),
      images = replace(images::text, mapping.old_url, mapping.new_url)::jsonb,
      summary = replace(summary, mapping.old_url, mapping.new_url),
      meta = replace(meta::text, mapping.old_url, mapping.new_url)::jsonb
    WHERE concat_ws(
      ' ',
      text,
      content,
      images::text,
      summary,
      meta::text
    ) LIKE '%' || mapping.old_url || '%';

    UPDATE notes
    SET
      text = replace(text, mapping.old_url, mapping.new_url),
      content = replace(content, mapping.old_url, mapping.new_url),
      images = replace(images::text, mapping.old_url, mapping.new_url)::jsonb,
      meta = replace(meta::text, mapping.old_url, mapping.new_url)::jsonb
    WHERE concat_ws(' ', text, content, images::text, meta::text)
      LIKE '%' || mapping.old_url || '%';

    UPDATE pages
    SET
      text = replace(text, mapping.old_url, mapping.new_url),
      content = replace(content, mapping.old_url, mapping.new_url),
      images = replace(images::text, mapping.old_url, mapping.new_url)::jsonb,
      meta = replace(meta::text, mapping.old_url, mapping.new_url)::jsonb
    WHERE concat_ws(' ', text, content, images::text, meta::text)
      LIKE '%' || mapping.old_url || '%';

    UPDATE projects
    SET
      text = replace(text, mapping.old_url, mapping.new_url),
      description = replace(description, mapping.old_url, mapping.new_url),
      avatar = replace(avatar, mapping.old_url, mapping.new_url),
      preview_url = replace(preview_url, mapping.old_url, mapping.new_url),
      project_url = replace(project_url, mapping.old_url, mapping.new_url),
      doc_url = replace(doc_url, mapping.old_url, mapping.new_url)
    WHERE concat_ws(
      ' ',
      text,
      description,
      avatar,
      preview_url,
      project_url,
      doc_url
    ) LIKE '%' || mapping.old_url || '%';
  END LOOP;
END
$migration$;

COMMIT;
