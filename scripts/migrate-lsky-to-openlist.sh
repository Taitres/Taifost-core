#!/usr/bin/env bash

set -euo pipefail

: "${WEBDAV_USER:?Set WEBDAV_USER}"
: "${WEBDAV_PASSWORD:?Set WEBDAV_PASSWORD}"

SOURCE_NAMESPACE="${SOURCE_NAMESPACE:-uploads}"
SOURCE_ROOT="${SOURCE_ROOT:-/www/wwwroot/img.taitres.com/public/$SOURCE_NAMESPACE}"
WEBDAV_ROOT="${WEBDAV_ROOT:-https://pan.taitres.com/dav/img/$SOURCE_NAMESPACE}"
OPENLIST_ORIGIN="${OPENLIST_ORIGIN:-https://pan.taitres.com}"
OUTPUT_DIR="${OUTPUT_DIR:-./data-marlin/media-migration/$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ ! -d "$SOURCE_ROOT" ]]; then
  echo "Source directory does not exist: $SOURCE_ROOT" >&2
  exit 1
fi

for command in curl find jq sha256sum sort stat; do
  command -v "$command" >/dev/null ||
    {
      echo "Required command is missing: $command" >&2
      exit 1
    }
done

mkdir -p "$OUTPUT_DIR"
files_manifest="$OUTPUT_DIR/files.tsv"
url_map="$OUTPUT_DIR/url-map.tsv"
: >"$files_manifest"
: >"$url_map"

create_collection() {
  local url="$1"
  local status
  status="$(
    curl --silent --show-error \
      --user "$WEBDAV_USER:$WEBDAV_PASSWORD" \
      --request MKCOL \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$url/"
  )"
  case "$status" in
    201 | 405) ;;
    *)
      echo "MKCOL failed ($status): $url" >&2
      exit 1
      ;;
  esac
}

create_collection "$WEBDAV_ROOT"

while IFS= read -r directory; do
  [[ -z "$directory" ]] && continue
  create_collection "$WEBDAV_ROOT/$directory"
done < <(find -L "$SOURCE_ROOT" -mindepth 1 -type d -printf '%P\n' | sort)

uploaded=0
while IFS= read -r relative_path; do
  source_file="$SOURCE_ROOT/$relative_path"
  size="$(stat -c '%s' "$source_file")"
  digest="$(sha256sum "$source_file" | cut -d' ' -f1)"

  status="$(
    curl --silent --show-error --fail \
      --user "$WEBDAV_USER:$WEBDAV_PASSWORD" \
      --upload-file "$source_file" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$WEBDAV_ROOT/$relative_path"
  )"
  case "$status" in
    200 | 201 | 204) ;;
    *)
      echo "PUT failed ($status): $relative_path" >&2
      exit 1
      ;;
  esac

  openlist_path="/img/$SOURCE_NAMESPACE/$relative_path"
  metadata="$(
    jq -nc --arg path "$openlist_path" '{path: $path}' |
      curl --silent --show-error --fail \
        --header 'Content-Type: application/json' \
        --data-binary @- \
        "$OPENLIST_ORIGIN/api/fs/get"
  )"
  remote_size="$(jq -er '.data.size' <<<"$metadata")"
  sign="$(jq -er '.data.sign' <<<"$metadata")"
  if [[ "$remote_size" != "$size" ]]; then
    echo "Size mismatch for $relative_path: local=$size remote=$remote_size" >&2
    exit 1
  fi

  public_url="$OPENLIST_ORIGIN/p$openlist_path?sign=$sign"
  printf '%s\t%s\t%s\t%s\n' \
    "$relative_path" "$size" "$digest" "$public_url" >>"$files_manifest"
  printf 'http://img.taitres.com/%s/%s\t%s\n' \
    "$SOURCE_NAMESPACE" \
    "$relative_path" "$public_url" >>"$url_map"
  printf 'https://img.taitres.com/%s/%s\t%s\n' \
    "$SOURCE_NAMESPACE" \
    "$relative_path" "$public_url" >>"$url_map"

  uploaded=$((uploaded + 1))
  printf '[%d] %s\n' "$uploaded" "$relative_path"
done < <(find -L "$SOURCE_ROOT" -type f -printf '%P\n' | sort)

sha256sum "$files_manifest" "$url_map" >"$OUTPUT_DIR/SHA256SUMS"
echo "Uploaded and verified $uploaded files."
echo "Manifest: $files_manifest"
echo "URL map: $url_map"
