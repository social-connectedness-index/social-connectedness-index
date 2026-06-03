#!/usr/bin/env bash
# setup.sh — Installs all prerequisites, then downloads all data.
# Usage: ./setup.sh
# Supports macOS (via Homebrew) and Ubuntu/Debian (via apt).
# Safe to re-run — skips anything already installed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

section() { printf "\n${BLUE}=== %s ===${NC}\n" "$1"; }
ok()      { printf "  ${GREEN}Done:${NC} %s\n" "$1"; }
skip()    { printf "  ${YELLOW}Skip:${NC} %s (already installed)\n" "$1"; }
fail()    { printf "  ${RED}FAILED:${NC} %s\n" "$1"; }

OS="$(uname -s)"

# ─── Homebrew (macOS only) ───────────────────────────────────────────

install_homebrew() {
    if command -v brew &>/dev/null; then
        skip "Homebrew"
        return 0
    fi
    printf "  Installing Homebrew...\n"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -x /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew"
}

# ─── R ───────────────────────────────────────────────────────────────

install_r() {
    if command -v R &>/dev/null; then
        skip "R ($(R --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+\.\d+' || echo 'unknown version'))"
        return 0
    fi
    printf "  Installing R...\n"
    case "$OS" in
        Darwin)
            brew install --cask r
            ;;
        Linux)
            sudo apt-get update -qq
            sudo apt-get install -y -qq r-base r-base-dev \
                libcurl4-openssl-dev libssl-dev libxml2-dev \
                libfontconfig1-dev libharfbuzz-dev libfribidi-dev \
                libfreetype6-dev libpng-dev libtiff5-dev libjpeg-dev \
                libudunits2-dev libgdal-dev libgeos-dev libproj-dev \
                libavfilter-dev > /dev/null
            ;;
        *)
            fail "R — unsupported OS: $OS"
            return 1
            ;;
    esac
    ok "R"
}

# ─── Node.js ─────────────────────────────────────────────────────────

install_node() {
    if command -v node &>/dev/null; then
        skip "Node.js ($(node --version 2>/dev/null || echo 'unknown'))"
        return 0
    fi
    printf "  Installing Node.js...\n"
    case "$OS" in
        Darwin)
            brew install node
            ;;
        Linux)
            sudo apt-get update -qq
            sudo apt-get install -y -qq nodejs npm > /dev/null
            ;;
        *)
            fail "Node.js — unsupported OS: $OS"
            return 1
            ;;
    esac
    ok "Node.js"
}

# ─── mapshaper ───────────────────────────────────────────────────────

install_mapshaper() {
    if command -v mapshaper &>/dev/null; then
        skip "mapshaper"
        return 0
    fi
    printf "  Installing mapshaper...\n"
    npm install -g mapshaper
    ok "mapshaper"
}

# ─── RStudio ─────────────────────────────────────────────────────────

check_rstudio() {
    case "$OS" in
        Darwin)
            if [ -d "/Applications/RStudio.app" ]; then
                skip "RStudio"
                return 0
            fi
            ;;
        Linux)
            if command -v rstudio &>/dev/null; then
                skip "RStudio"
                return 0
            fi
            ;;
    esac
    printf "  ${YELLOW}Note:${NC} RStudio is not installed.\n"
    printf "         Download it from: https://posit.co/download/rstudio-desktop/\n"
}

# ─── Main ────────────────────────────────────────────────────────────

section "Installing prerequisites"

if [[ "$OS" == "Darwin" ]]; then
    install_homebrew
fi

install_r
install_node
install_mapshaper
check_rstudio

section "Downloading data"

bash "$SCRIPT_DIR/download_data.sh"

section "Setup complete"

printf "\nNext steps:\n"
if [[ "$OS" == "Darwin" && ! -d "/Applications/RStudio.app" ]] || \
   [[ "$OS" == "Linux" && ! $(command -v rstudio 2>/dev/null) ]]; then
    printf "  1. Install RStudio: https://posit.co/download/rstudio-desktop/\n"
    printf "  2. Open social-connectedness-index.Rproj in RStudio\n"
    printf "  3. Run shiny::runApp() for the interactive app, or\n"
    printf "     edit src/map_structs.R and run src/main.R for batch maps\n"
else
    printf "  1. Open social-connectedness-index.Rproj in RStudio\n"
    printf "  2. Run shiny::runApp() for the interactive app, or\n"
    printf "     edit src/map_structs.R and run src/main.R for batch maps\n"
fi
