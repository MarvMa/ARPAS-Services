#!/bin/bash
set -euo pipefail

JSON_FILE="points_with_glb.json"
MODEL_DIR="./3d-models"

STORAGE_URL="http://localhost:80/api/storage/objects/upload"

if ! command -v jq &>/dev/null; then
  echo "❌ jq ist nicht installiert. Bitte installiere es (brew install jq)."
  exit 1
fi

COUNT=$(jq length "$JSON_FILE")

echo "▶Starte Upload von $COUNT Objekten zu $STORAGE_URL"

for i in $(seq 0 $((COUNT - 1))); do
  NAME=$(jq -r ".[$i].name" "$JSON_FILE")
  FILE=$(jq -r ".[$i].glb_file" "$JSON_FILE")
  LAT=$(jq -r ".[$i].latitude" "$JSON_FILE")
  LNG=$(jq -r ".[$i].longitude" "$JSON_FILE")
  ALT=$(jq -r ".[$i].altitude" "$JSON_FILE")

  FILE_PATH="$MODEL_DIR/$FILE"

  if [[ ! -f "$FILE_PATH" ]]; then
    echo "⚠️  Datei nicht gefunden: $FILE_PATH – überspringe $NAME"
    continue
  fi

  echo "⬆️  Lade hoch: $NAME ($FILE)"
  curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -X POST "$STORAGE_URL" \
    -F "file=@${FILE_PATH}" \
    -F "latitude=${LAT}" \
    -F "longitude=${LNG}" \
    -F "altitude=${ALT}"
done
