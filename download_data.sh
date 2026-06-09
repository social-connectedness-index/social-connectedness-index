#!/usr/bin/env bash
# download_data.sh — Downloads all external data for the SCI mapping tool.
# Usage: ./download_data.sh
# Safe to re-run (skips files that already exist).
# Total download size: ~5 GB+ (GADM shapefile alone is ~2.5 GB).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SCI_2026_DIR="data/sci_2026"
INPUT_SHAPEFILES_DIR="data/input_shapefiles"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

section()  { printf "\n${BLUE}=== %s ===${NC}\n" "$1"; }
skip()     { printf "  ${YELLOW}Skip:${NC} %s (already exists)\n" "$1"; }
ok()       { printf "  ${GREEN}Done:${NC} %s\n" "$1"; }
fail()     { printf "  ${RED}FAILED:${NC} %s\n" "$1"; }

mkdir -p "$SCI_2026_DIR" "$INPUT_SHAPEFILES_DIR"

download() {
    local url="$1" dest="$2"
    [ -f "$dest" ] && { skip "$(basename "$dest")"; return 0; }
    printf "  Downloading %s...\n" "$(basename "$dest")"
    if curl -fSL --progress-bar -o "$dest" "$url"; then
        ok "$(basename "$dest")"
    else
        rm -f "$dest"
        fail "$(basename "$dest")"
        return 1
    fi
}

gdrive_download() {
    local file_id="$1" dest="$2"
    [ -f "$dest" ] && { skip "$(basename "$dest")"; return 0; }
    printf "  Downloading %s (Google Drive)...\n" "$(basename "$dest")"
    if curl -fSL --progress-bar -o "$dest" \
        "https://drive.usercontent.google.com/download?id=${file_id}&export=download&confirm=t"; then
        ok "$(basename "$dest")"
    else
        rm -f "$dest"
        fail "$(basename "$dest")"
        return 1
    fi
}

download_and_extract() {
    local url="$1" zip_name="$2" extract_dir="$3"
    local zip_path="$TEMP_DIR/$zip_name"
    printf "  Downloading %s...\n" "$zip_name"
    curl -fSL --progress-bar -o "$zip_path" "$url"
    printf "  Extracting %s...\n" "$zip_name"
    unzip -o -j "$zip_path" -d "$extract_dir" > /dev/null
    rm -f "$zip_path"
    ok "$zip_name"
}

gdrive_download_and_extract() {
    local file_id="$1" zip_name="$2" extract_dir="$3"
    local zip_path="$TEMP_DIR/$zip_name"
    printf "  Downloading %s (Google Drive)...\n" "$zip_name"
    curl -fSL --progress-bar -o "$zip_path" \
        "https://drive.usercontent.google.com/download?id=${file_id}&export=download&confirm=t"
    printf "  Extracting %s...\n" "$zip_name"
    unzip -o -j "$zip_path" -d "$extract_dir" > /dev/null
    rm -f "$zip_path"
    ok "$zip_name"
}

# ─── SCI 2026 Data ───────────────────────────────────────────────────

section "SCI 2026 Data (Humanitarian Data Exchange)"

download \
    "https://data.humdata.org/dataset/e9988552-74e4-4ff4-943f-c782ac8bca87/resource/652cf9c9-541f-47de-8d53-ff818062bd0c/download/country.csv" \
    "$SCI_2026_DIR/country.csv"

download \
    "https://data.humdata.org/dataset/e9988552-74e4-4ff4-943f-c782ac8bca87/resource/8e1b8b59-c12e-48ea-9af3-41dde75916d5/download/gadm1.csv" \
    "$SCI_2026_DIR/gadm1.csv"

download \
    "https://data.humdata.org/dataset/e9988552-74e4-4ff4-943f-c782ac8bca87/resource/6419cafc-5edb-4355-9577-b086ecc8d21d/download/geoboundaries_adm1.csv" \
    "$SCI_2026_DIR/geoboundaries_adm1.csv"

download \
    "https://data.humdata.org/dataset/e9988552-74e4-4ff4-943f-c782ac8bca87/resource/97dc352f-c9c5-47d6-a6ef-88709e14006c/download/us_counties.csv" \
    "$SCI_2026_DIR/us_counties.csv"

# Zip archives from HDX
if [ ! -f "$SCI_2026_DIR/nuts1_2024.csv" ] || \
   [ ! -f "$SCI_2026_DIR/nuts2_2024.csv" ] || \
   [ ! -f "$SCI_2026_DIR/nuts3_2024.csv" ]; then
    download_and_extract \
        "https://data.humdata.org/dataset/e9988552-74e4-4ff4-943f-c782ac8bca87/resource/b691d1d1-b286-456d-9a23-16e2f2d463cc/download/nuts_2024.zip" \
        "nuts_2024.zip" "$SCI_2026_DIR"
else
    skip "NUTS 2024 CSVs"
fi

if [ ! -f "$SCI_2026_DIR/gadm1_to_country.csv" ] || \
   [ ! -f "$SCI_2026_DIR/us_counties_to_country.csv" ]; then
    download_and_extract \
        "https://data.humdata.org/dataset/e9988552-74e4-4ff4-943f-c782ac8bca87/resource/953e8683-bcf7-49f9-908f-1e14209e98d3/download/all_region_to_country.zip" \
        "all_region_to_country.zip" "$SCI_2026_DIR"
else
    skip "region-to-country CSVs"
fi

# Large sharded files from Google Drive
# NOTE: these gadm2_shard_*.csv power the STANDALONE batch tool (src/main.R) only.
# The WEB apps now use "GADM best" (gadm_best_shard_*.csv + gadm_best_to_country.csv),
# which are NOT auto-downloaded here — they are supplied separately (no public URL
# yet). gadm_best.gpkg geometry IS reproducible (built by create_gadm_best_shapefile
# in setup.R). Without the gadm_best SCI CSVs, `export_all.R sci:gadm2` skips the
# web gadm2 data. See gadm-best-replaces-gadm2 in the project notes.
if ! ls "$SCI_2026_DIR"/gadm2_shard_*.csv &>/dev/null; then
    gdrive_download_and_extract \
        "1M3XTjZG_bgzGkEZ1tJgZ6qLcuPJU5Ck4" "gadm2.zip" "$SCI_2026_DIR"
else
    skip "GADM2 shards"
fi

if ! ls "$SCI_2026_DIR"/geoboundaries_adm2_shard_*.csv &>/dev/null; then
    gdrive_download_and_extract \
        "1y6DHFyFpmadbDKYQ0a4UaI7EK-FuJgK8" "geoboundaries_adm2.zip" "$SCI_2026_DIR"
else
    skip "geoBoundaries ADM2 shards"
fi

if ! ls "$SCI_2026_DIR"/us_zcta_shard_*.csv &>/dev/null; then
    gdrive_download_and_extract \
        "13gbCdgHD-xfkogDoSzcAGKhNLHMPy8tR" "us_zcta.zip" "$SCI_2026_DIR"
else
    skip "US ZCTA shards"
fi

# ─── Shapefiles ──────────────────────────────────────────────────────

section "Shapefiles"

printf "  ${YELLOW}Note:${NC} GADM shapefile is ~2.5 GB — this may take a while.\n"

download \
    "https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-levels.zip" \
    "$INPUT_SHAPEFILES_DIR/gadm_410-levels.zip"

download \
    "https://gisco-services.ec.europa.eu/distribution/v2/nuts/gpkg/NUTS_RG_01M_2024_4326.gpkg" \
    "$INPUT_SHAPEFILES_DIR/NUTS_RG_01M_2024_4326.gpkg"

download \
    "https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/tl_2025_us_zcta520.zip" \
    "$INPUT_SHAPEFILES_DIR/tl_2025_us_zcta520.zip"

download \
    "https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip" \
    "$INPUT_SHAPEFILES_DIR/tl_2025_us_county.zip"

download \
    "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_cbsa_500k.zip" \
    "$INPUT_SHAPEFILES_DIR/cb_2025_us_cbsa_500k.zip"

download \
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt" \
    "$INPUT_SHAPEFILES_DIR/tab20_zcta520_county20_natl.txt"

download \
    "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx" \
    "$INPUT_SHAPEFILES_DIR/list1_2023.xlsx"

# ─── Summary ─────────────────────────────────────────────────────────

section "Download complete"

sci_2026_count=$(find "$SCI_2026_DIR" -name "*.csv" | wc -l | tr -d ' ')
shp_count=$(ls "$INPUT_SHAPEFILES_DIR" | wc -l | tr -d ' ')

printf "  SCI 2026 files:  %s CSVs\n" "$sci_2026_count"
printf "  Shapefiles:      %s files\n" "$shp_count"
printf "\nNext steps:\n"
printf "  1. Install R (https://cran.r-project.org/) and RStudio (https://posit.co/download/rstudio-desktop/)\n"
printf "  2. Install Node.js (https://nodejs.org) and mapshaper: npm install -g mapshaper\n"
printf "  3. Open social-connectedness-index.Rproj in RStudio\n"
printf "  4. Edit src/map_structs.R and run src/main.R to generate maps\n"
printf "     (or make maps interactively at https://social-connectedness.org/)\n"
