# The Social Connectedness Index

This repository provides a set of scripts to help make use of the **Social Connectedness Index (SCI)** data. The SCI data are publicly available at the [Humanitarian Data Exchange](https://data.humdata.org/dataset/social-connectedness-index). 

The repository also includes replication code for [Johnston, Kuchler, Kulkarni, and Stroebel (2026)](https://pages.stern.nyu.edu/~jstroebe/PDF/JKKS_SCI.pdf).

Replication code for other papers that use the SCI is available in separate repositories: Code for [Kuchler, Russell, and Stroebel (2022)](https://www.sciencedirect.com/science/article/pii/S0094119020300851) is available [here](https://github.com/social-connectedness-index/example-scripts), and code for [Bailey, Kuchler, Johnston, Russell, State, and Stroebel (2020)](https://link.springer.com/chapter/10.1007/978-3-030-60975-7_1) is available [here](https://github.com/social-connectedness-index/euro_sci). 

We also include **Relevant Literature.bib**, which contains references to papers that introduce and develop the Social Connectedness Index. 

---

This tool lets you create high-quality maps of the **Social Connectedness Index (SCI)** with *very little code editing*. You do **not** need to understand spatial data or GIS concepts to use it successfully.

There are **four ways** to use this tool, from easiest to most flexible:

0. **Web app (no install)** — Make maps right in your browser at
   **[social-connectedness.org](https://social-connectedness.org/)** — no R, no
   server, nothing to download. It produces the same static maps as the tool below
   and currently supports country, state/province (GADM1), NUTS1, and US county
   levels (more granularities coming). Source and deploy instructions are in
   [`web/README.md`](web/README.md).
1. **Interactive app** — Launch a point-and-click Shiny app: `shiny::runApp()` (see [Interactive App](#interactive-app))
2. **Batch mode** — Edit `src/map_structs.R` and run `src/main.R` to generate multiple maps at once (see [Quick Start](#quick-start))
3. **Scripting** — Call `make_map()` directly in R for full control (see [Using make_map() Directly](#using-make_map-directly))

---

## Quick Start

If you just want to get maps as fast as possible:

1. Clone this repository and run the setup script:
   ```bash
   git clone https://github.com/social-connectedness-index/social-connectedness-index.git
   cd social-connectedness-index
   ./setup.sh
   ```
   This installs R, Node.js, and mapshaper (via Homebrew on Mac or apt on Linux), then downloads all SCI data and shapefiles (~5 GB). It is safe to re-run — it skips anything already installed or downloaded. See [Setup](#setup) for details.
2. Install [RStudio](https://posit.co/download/rstudio-desktop/) (if not already installed)
3. Open `social-connectedness-index.Rproj` in RStudio
4. Open `src/map_structs.R`, edit the map definitions to specify the maps you want (see [Editing map_structs.R](#step-2-editing-map_structsr))
5. Open `src/main.R` and run the entire script (`Cmd+A` then `Cmd+Enter` on Mac, or `Ctrl+A` then `Ctrl+Enter` on Windows)
6. Your maps will appear in `output/maps/`

On the first run, the script will automatically install any missing R packages and clean the shapefiles. On subsequent runs, the cleaning step is skipped automatically, so re-runs are fast.

---

## Interactive App

After completing the one-time setup (steps 1–3 of the Quick Start above), you can launch an interactive Shiny app to create maps without editing any code:

```r
install.packages("shiny")  # only needed once
shiny::runApp()
```

The app lets you:

* **Load presets** — start from a working example and modify it
* **Select map type** — dropdown with all available map types
* **Pick SCI data** — auto-filtered to match the selected type
* **Choose countries** — preset groups (Europe, Africa, etc.) or all
* **Set custom breaks, colors, zoom** — via an expandable "Advanced options" panel
* **Preview** the map in your browser
* **Download** as PNG or PDF

---

## Big Picture: How the Tool Works

Think of the workflow in **two clear phases**:

1. **One-time setup** (runs automatically on first use)

   * Installs any missing R packages
   * Loads, cleans, and standardizes shapefiles
   * Preprocesses shapefiles and SCI data into R's native `.rds` format for faster loading
   * Saves cleaned and preprocessed versions to disk

2. **Map creation** (repeat as needed)

   * You edit `src/map_structs.R` to define what maps you want
   * Run `src/main.R` to generate them
   * The tool automatically skips the cleaning step if it has already been done

You **never** need to touch the cleaning code. After the first run, re-runs go straight to map generation.

---

## Folder Structure

You will mainly interact with **two files**:

| File                | What it does                         |
| ------------------- | ------------------------------------ |
| `src/main.R`        | Sets everything up and runs the maps |
| `src/map_structs.R` | Where you define what maps you want  |

Other key files:

| File / Folder                   | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `setup.sh`                      | Installs prerequisites and downloads data (`./setup.sh`) |
| `download_data.sh`              | Downloads SCI data and shapefiles only (`./download_data.sh`) |
| `app.R`                         | Interactive Shiny app (run with `shiny::runApp()`) |
| `src/setup.R`                   | Shared setup: packages, sources, shapefile cleaning|
| `src/make_map.R`                | The `make_map()` function (public API)             |
| `src/constants.R`               | File paths and country code lists                  |
| `src/mapping_tools.R`           | Internal map rendering helpers and config          |
| `src/preprocess.R`              | Converts shapefiles and CSVs to `.rds` for faster loading (runs once) |
| `src/clean_gadm_shapefiles.R`   | Cleans GADM shapefiles (runs once automatically)   |
| `src/clean_geoboundaries.R`     | Downloads and cleans geoBoundaries (runs once)     |
| `src/clean_us_shapefiles.R`     | Cleans US Census shapefiles (runs once)            |
| `src/clean_cbsa.R`              | Cleans CBSA shapefiles and builds ZCTA-CBSA crosswalk (runs once) |
| `src/clean_nuts_shapefiles.R`   | Cleans NUTS shapefiles (runs once)                 |
| `data/sci_2026/`                | SCI data files (downloaded by `download_data.sh`)  |
| `data/input_shapefiles/`        | Raw shapefiles (downloaded by `download_data.sh`)  |
| `data/cleaned_shapefiles/`      | Cleaned shapefiles (generated automatically)       |
| `output/maps/`                  | Generated map images (PNG)                         |

---

## Setup

The `setup.sh` script installs all prerequisites and downloads all data in one step:

```bash
./setup.sh
```

This will:

1. **Install R** — via Homebrew (macOS) or apt (Ubuntu/Debian)
2. **Install Node.js** — via Homebrew (macOS) or apt (Ubuntu/Debian)
3. **Install mapshaper** — via npm (used for shapefile simplification)
4. **Download all data** — SCI CSV files from the [Humanitarian Data Exchange](https://data.humdata.org/dataset/social-connectedness-index) and shapefiles from GADM, Eurostat, and the US Census Bureau

The script is safe to re-run — it skips anything already installed or downloaded. The data download is approximately **5 GB** (the GADM shapefile alone is ~2.5 GB). geoBoundaries shapefiles are not included in the download; they are fetched automatically via API when you first run the R scripts.

**RStudio** must be installed manually: [https://posit.co/download/rstudio-desktop/](https://posit.co/download/rstudio-desktop/)

The tool uses these R packages: `av`, `countrycode`, `RColorBrewer`, `readxl`, `rmapshaper`, `rgeoboundaries`, `rnaturalearth`, `rnaturalearthdata`, `sf`, and `tidyverse`. **You do not need to install these packages manually.** The R scripts will detect and install any missing packages automatically on the first run.

### Manual installation

If you prefer to install prerequisites yourself, or are on Windows:

* [**R**](https://cran.r-project.org/) (version 4.0 or later recommended)
* [**RStudio**](https://posit.co/download/rstudio-desktop/)
* [**Node.js**](https://nodejs.org) (v18 or later recommended)
* **mapshaper**: `npm install -g mapshaper`

Then run `./download_data.sh` to download the SCI data and shapefiles, or download them individually from the links in [Data and Shapefiles](#data-and-shapefiles).

The R pipeline automatically detects Node.js installations from NVM (`~/.nvm`), Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`), or standard system paths. If you use a different Node.js version manager (e.g., `fnm`, `volta`), ensure that `node` is on your shell's `PATH` before launching R, or add the appropriate directory to your `~/.Renviron`:

```
PATH=${PATH}:/path/to/your/node/bin
```

---

## Step 1: One-Time Setup

### What this step does

The first time you run `src/main.R`, it will:

* install any missing R packages
* load and clean your shapefiles
* preprocess shapefiles and SCI data into `.rds` format (R's fast binary format) for quicker loading on future runs
* save cleaned and preprocessed versions to `data/cleaned_shapefiles/`

**You only need to do this once per machine.** On subsequent runs, the script detects that the cleaned and preprocessed files already exist and skips this step.

### What to do

1. Run `./setup.sh` to install prerequisites and download all data (see [Setup](#setup)). If you've already done this, skip to step 2.

2. Open the R project file (`social-connectedness-index.Rproj`) in RStudio

3. Open `src/main.R`

4. Select everything and run it (`Cmd+A` then `Cmd+Enter` on Mac, or `Ctrl+A` then `Ctrl+Enter` on Windows)

### What you should expect

* This can take several minutes on the first run
* You will see messages about shapefiles loading, cleaning, and preprocessing
* New folders and files will appear in `data/cleaned_shapefiles/` (`.gpkg` and `.rds` files)

If this finishes without errors, you are set.

---

## Step 2: Editing `map_structs.R`

This is the **only file most users ever need to edit**.

### What `map_structs.R` is

It is a **menu of maps**. Each entry in `map_specs` is a named list that defines a single map:

* What **type** of map you are making (which determines the shapefiles and how regions are matched)
* Which **SCI data file** to use
* The **region** you are mapping from
* Which **countries** to show
* Optional zoom, legend breaks, and title

You do **not** write functions. You only fill in values.

---

## Map Types

The `type` field tells the tool what kind of map you are creating. Each type determines which shapefiles are used and how regions are matched. You do not need to specify shapefile paths or key columns yourself.

### Region-to-region types

These types color **sub-national regions** based on SCI to a selected region at the same level:

| Type         | Friends colored as          | Source highlighted as       | Example use case                                     |
| ------------ | --------------------------- | --------------------------- | ---------------------------------------------------- |
| `country`    | Countries (GADM level 0)    | Country                     | SCI from Sweden to all countries                     |
| `gadm1`      | GADM level 1 (states)       | GADM level 1                | SCI from a state to other states                     |
| `gadm2`      | GADM level 2 (districts)    | GADM level 2                | SCI from a district to other districts               |
| `adm1`       | geoBoundaries ADM1          | geoBoundaries ADM1          | SCI from Massachusetts to other US states            |
| `adm2`       | geoBoundaries ADM2          | geoBoundaries ADM2          | SCI from Stockholm municipality to Swedish regions   |
| `nuts1`      | NUTS level 1 regions        | NUTS level 1 region         | SCI from Ile-de-France to European NUTS1 regions     |
| `nuts2`      | NUTS level 2 regions        | NUTS level 2 region         | SCI from Oberbayern to European NUTS2 regions        |
| `nuts3`      | NUTS level 3 regions        | NUTS level 3 region         | SCI from Berlin to European NUTS3 regions            |
| `us_county`  | US counties                 | US county                   | SCI from Kings County to other US counties           |
| `us_zcta`    | US ZIP Code areas           | US ZIP Code area            | SCI from a ZIP code to other ZIP codes               |
| `us_cbsa`    | US metro areas (CBSAs)      | US metro area (CBSA)        | SCI from New York metro to other metros              |

### Cross-level US types

These types map between different US geographic levels by aggregating ZCTA-level SCI data via a crosswalk:

| Type             | Friends colored as     | Source highlighted as  | Example use case                                          |
| ---------------- | ---------------------- | ---------------------- | --------------------------------------------------------- |
| `us_zcta_cbsa`   | US metro areas (CBSAs) | US ZIP Code area       | SCI from a ZIP code, aggregated to metro areas            |
| `us_cbsa_zcta`   | US ZIP Code areas      | US metro area (CBSA)   | SCI from a metro area, shown at ZIP code level            |
| `us_zcta_county` | US counties            | US ZIP Code area       | SCI from a ZIP code, aggregated to counties               |

### Region-to-country types

These types color **countries** based on SCI from a sub-national region:

| Type                | Friends colored as | Source highlighted as  | Example use case                                   |
| ------------------- | ------------------ | ---------------------- | -------------------------------------------------- |
| `gadm1_country`     | Countries          | GADM level 1           | SCI from a GADM1 region to all countries           |
| `gadm2_country`     | Countries          | GADM level 2           | SCI from a GADM2 district to all countries         |
| `adm1_country`      | Countries          | geoBoundaries ADM1     | SCI from Uttar Pradesh to all countries            |
| `adm2_country`      | Countries          | geoBoundaries ADM2     | SCI from a geoBoundaries district to all countries |
| `nuts1_country`     | Countries          | NUTS level 1           | SCI from Ile-de-France to all countries            |
| `nuts2_country`     | Countries          | NUTS level 2           | SCI from Oberbayern to all countries               |
| `nuts3_country`     | Countries          | NUTS level 3           | SCI from Berlin to all countries                   |
| `us_county_country` | Countries          | US county              | SCI from San Bernardino County to all countries    |
| `us_zcta_country`   | Countries          | US ZIP Code area       | SCI from Cambridge (02138) to all countries        |

### Country-to-region types

These types color **sub-national regions** based on SCI from a country (the reverse direction of region-to-country):

| Type                | Friends colored as     | Source highlighted as | Example use case                                       |
| ------------------- | ---------------------- | --------------------- | ------------------------------------------------------ |
| `country_gadm1`     | GADM level 1 (states)  | Country               | Where does Japan have the most friends? (GADM1)        |
| `country_gadm2`     | GADM level 2 (districts)| Country              | Where does Japan have the most friends? (GADM2)        |
| `country_adm1`      | geoBoundaries ADM1     | Country               | Where does Japan have the most friends? (ADM1)         |
| `country_adm2`      | geoBoundaries ADM2     | Country               | Where does Japan have the most friends? (ADM2)         |
| `country_nuts1`     | NUTS level 1           | Country               | Where does Japan have the most friends in Europe? (NUTS1)|
| `country_nuts2`     | NUTS level 2           | Country               | Where does Japan have the most friends in Europe? (NUTS2)|
| `country_nuts3`     | NUTS level 3           | Country               | Where does Japan have the most friends in Europe? (NUTS3)|
| `country_us_cbsa`   | US metro areas (CBSAs) | Country               | Where does the Netherlands have the most friends? (CBSAs)|
| `country_us_county` | US counties            | Country               | Where does the Netherlands have the most friends? (counties)|
| `country_us_zcta`   | US ZIP Code areas      | Country               | Where does the Netherlands have the most friends? (ZCTAs)|

---

## The Structure of a Map Spec

Each entry in `map_specs` follows the same template:

```r
map_name = list(
  type = "...",
  sci_path = "data/sci_2026/...",
  user_region_id = "...",
  friend_countries = c("..."),
  breaks = ...,    # optional, defaults to automatic
  xlim = ...,      # optional, defaults to full extent
  ylim = ...,      # optional, defaults to full extent
  title = "..."    # optional
)
```

---

## What Each Field Means

### `type`

Determines which shapefiles are used and how regions are matched. See the [Map Types](#map-types) tables above for valid values.

### `sci_path`

The path to the SCI data file. These are CSV files in `data/sci_2026/`.

The file you use depends on the map type:

| Type                         | Example SCI file                                  |
| ---------------------------- | ------------------------------------------------- |
| `country`                    | `data/sci_2026/country.csv`                       |
| `gadm1`                      | `data/sci_2026/gadm1.csv`                         |
| `gadm2`                      | `data/sci_2026/gadm2_shard_XX.csv` (see below)    |
| `adm1`                       | `data/sci_2026/geoboundaries_adm1.csv`            |
| `adm2`                       | `data/sci_2026/geoboundaries_adm2_shard_XX.csv`   |
| `nuts1`                      | `data/sci_2026/nuts1_2024.csv`                    |
| `nuts2`                      | `data/sci_2026/nuts2_2024.csv`                    |
| `nuts3`                      | `data/sci_2026/nuts3_2024.csv`                    |
| `us_county`                  | `data/sci_2026/us_counties.csv`                   |
| `us_zcta`                    | `data/sci_2026/us_zcta_shard_X.csv`               |
| `us_cbsa`                    | `data/sci_2026/us_zcta_shard_X.csv` (all shards)  |
| `us_zcta_cbsa`               | `data/sci_2026/us_zcta_shard_X.csv`               |
| `us_cbsa_zcta`               | `data/sci_2026/us_zcta_shard_X.csv` (all shards)  |
| `us_zcta_county`             | `data/sci_2026/us_zcta_shard_X.csv`               |
| `gadm1_country`              | `data/sci_2026/gadm1_to_country.csv`              |
| `gadm2_country`              | `data/sci_2026/gadm2_to_country.csv`              |
| `adm1_country`               | `data/sci_2026/geoboundaries_adm1_to_country.csv` |
| `adm2_country`               | `data/sci_2026/geoboundaries_adm2_to_country.csv` |
| `nuts1_country`              | `data/sci_2026/nuts1_2024_to_country.csv`         |
| `nuts2_country`              | `data/sci_2026/nuts2_2024_to_country.csv`         |
| `nuts3_country`              | `data/sci_2026/nuts3_2024_to_country.csv`         |
| `us_county_country`          | `data/sci_2026/us_counties_to_country.csv`        |
| `us_zcta_country`            | `data/sci_2026/us_zcta_to_country.csv`            |
| `country_gadm1`              | `data/sci_2026/gadm1_to_country.csv`              |
| `country_gadm2`              | `data/sci_2026/gadm2_to_country.csv`              |
| `country_adm1`               | `data/sci_2026/geoboundaries_adm1_to_country.csv` |
| `country_adm2`               | `data/sci_2026/geoboundaries_adm2_to_country.csv` |
| `country_nuts1`              | `data/sci_2026/nuts1_2024_to_country.csv`         |
| `country_nuts2`              | `data/sci_2026/nuts2_2024_to_country.csv`         |
| `country_nuts3`              | `data/sci_2026/nuts3_2024_to_country.csv`         |
| `country_us_cbsa`            | `data/sci_2026/us_zcta_to_country.csv`            |
| `country_us_county`          | `data/sci_2026/us_counties_to_country.csv`        |
| `country_us_zcta`            | `data/sci_2026/us_zcta_to_country.csv`            |

**Sharded files**: Some SCI files are split into shards by country or region (e.g., `gadm2_shard_BR.csv`). Use the shard that contains the region you want to map from. The shard suffix typically corresponds to the ISO-2 country code of the source region.

### `user_region_id`

The **region you are mapping from** (the source). This must match an ID in the SCI data file.

Examples:

* Country: `"SE"` (ISO-2 code)
* GADM level 1: `"IND.12_1"` (GADM GID)
* GADM level 2: `"IND.34.75_1"` (GADM GID)
* geoBoundaries: `"70781695B5805413017960"` (shapeID from geoBoundaries)
* NUTS: `"DE6"` (NUTS code)
* US county: `"06071"` (FIPS code)
* US ZCTA: `"02138"` (ZIP code)
* US CBSA: `"35620"` (CBSA code, e.g., New York-Newark-Jersey City)

### `friend_countries`

Which countries to show on the map. This limits the regions that are colored.

Examples:

* `countries_in_data` — all countries in the dataset
* `c("US")` — only the United States
* `europe_iso2_codes` — all European countries
* `africa_iso2_codes` — all African countries
* `south_asia_iso2_codes` — South Asian countries

Pre-defined country lists are available in `src/constants.R`.

### `breaks` (optional)

Controls the legend bins (how SCI values are grouped into colors).

* Omit — automatic bins based on the data distribution
* `c(1, 2, 5, 10, 20, 50)` — manually specified bin boundaries

If unsure, omit this field and the tool will choose bins automatically.

### `xlim` and `ylim` (optional)

Control the map zoom by setting longitude and latitude bounds.

* Omit — show the full extent
* `xlim = c(-10, 36), ylim = c(36, 70)` — zoom to Europe

If unsure, omit these fields.

---

## Adding a New Map (Step-by-Step)

1. Open `src/map_structs.R`
2. Find an existing entry with a similar `type` to what you want
3. Copy it
4. Change:
   * the entry name (e.g., `berlin = list(...)`)
   * the `type` if needed
   * the `sci_path` if using different SCI data
   * the `user_region_id` to your region of interest
   * the `friend_countries` if you want to limit the map extent
5. Save the file
6. Run `src/main.R`

### Example: Adding a map of SCI from Berlin

```r
# Add this inside the map_specs list in map_structs.R
berlin = list(
  type = "gadm2",
  sci_path = "data/sci_2026/gadm2_shard_DE.csv",
  user_region_id = "DEU.4_1",
  friend_countries = europe_iso2_codes,
  xlim = c(-10, 36),
  ylim = c(36, 70)
)
```

### Example: Adding a country-level world map from Japan

```r
japan = list(
  type = "country",
  sci_path = "data/sci_2026/country.csv",
  user_region_id = "JP",
  friend_countries = countries_in_data
)
```

---

## Using `make_map()` Directly

For interactive use or scripting beyond `map_structs.R`, you can call `make_map()` directly in the R console after running the setup portion of `src/main.R`. This gives you access to additional customization options.

### Minimal call

```r
make_map("country", "SE", "data/sci_2026/country.csv")
```

### Full example

```r
make_map(
  type = "gadm2",
  user_region_id = "BRA.4.38_2",
  sci_path = "data/sci_2026/gadm2_shard_BR.csv",
  friend_countries = south_america_iso2_codes,
  xlim = c(-85, -33),
  ylim = c(-55, 12),
  breaks = c(1, 2, 3, 5, 10, 20, 50, 75),
  title = "Social Connectedness: Manaus, Brazil",
  output_path = "output/maps/manaus.png"
)
```

### Additional parameters

Beyond the fields available in `map_structs.R`, `make_map()` accepts:

| Parameter              | Default                         | Description                                  |
| ---------------------- | ------------------------------- | -------------------------------------------- |
| `filter_dest_cbsa`     | `NULL`                          | CBSA code to filter destinations; auto-zooms to the metro area |
| `reference_quantile`   | `0.25`                          | Percentile used to normalize SCI values      |
| `legend_name`          | `"Likelihood of Friendship"`    | Legend title text                             |
| `color_palette`        | default blue ramp               | Vector of hex colors for the color scale     |
| `highlight_color`      | `"#FF0000"`                     | Fill color for the source region             |
| `border_color`         | `"black"`                       | Country border color                         |
| `na_color`             | `"#BFBFBF"`                     | Fill for regions with no data                |
| `background_color`     | `"white"`                       | Plot background color                        |
| `subtitle`             | `NULL`                          | Subtitle text                                |
| `caption`              | default citation                | Caption text; `FALSE` to suppress            |
| `font_family`          | `"Helvetica"`                   | Font family                                  |
| `base_font_size`       | `24`                            | Base font size (all text scales from this)   |
| `output_path`          | `NULL`                          | File path to save; `NULL` returns the plot   |
| `width`                | `30`                            | Output width in inches                       |
| `height`               | `25`                            | Output height in inches                      |
| `dpi`                  | `300`                           | Output resolution                            |
| `return_data`          | `FALSE`                         | If `TRUE`, returns a list with plot and data |

---

## Using `make_comparison_map()` Directly

`make_comparison_map()` produces a diverging-color map comparing the social connections of two regions. Regions more connected to Region A are colored in one direction, and regions more connected to Region B in the other.

### Example

```r
make_comparison_map(
  type = "country",
  region_a_id = "DE",
  region_b_id = "BR",
  sci_path = "data/sci_2026/country.csv",
  label_a = "Germany",
  label_b = "Brazil",
  color_a = "#FFCC00",
  color_b = "#009739",
  title = "Germany vs Brazil",
  subtitle = "Friendship Links to Germany vs Brazil",
  output_path = "output/maps/de_vs_br.png"
)
```

### Parameters

| Parameter              | Default                         | Description                                          |
| ---------------------- | ------------------------------- | ---------------------------------------------------- |
| `type`                 | (required)                      | Map type (same types as `make_map()`)                |
| `region_a_id`          | (required)                      | Region ID for the first region                       |
| `region_b_id`          | (required)                      | Region ID for the second region                      |
| `sci_path`             | (required)                      | Path to SCI data for Region A                        |
| `sci_path_b`           | `NULL`                          | Path to SCI data for Region B (defaults to `sci_path`)|
| `label_a`              | `NULL`                          | Legend label for Region A                            |
| `label_b`              | `NULL`                          | Legend label for Region B                            |
| `color_a`              | (required)                      | Color for regions more connected to A                |
| `color_b`              | (required)                      | Color for regions more connected to B                |
| `color_mid`            | `"white"`                       | Color for equally connected regions                  |
| `friend_countries`     | `NULL`                          | Countries to include (same as `make_map()`)          |
| `breaks`               | auto-computed                   | Custom break points (in log2 ratio space)            |

All other display parameters (`xlim`, `ylim`, `border_color`, `output_path`, etc.) work the same as in `make_map()`.

Comparison specs can also be defined in `map_structs.R` — use `region_a_id` and `region_b_id` instead of `user_region_id`, and the batch runner will automatically dispatch to `make_comparison_map()`.

---

## Running the Maps

After editing `src/map_structs.R`:

1. Open `src/main.R`
2. Run the entire script

The maps will be saved as PNG files in `output/maps/`. Each map is named after its entry in `map_specs` (e.g., the `sweden` entry produces `output/maps/sweden.png`).

---

## Troubleshooting

**"Package X is not available"**: Make sure you have a working internet connection. The script installs packages from CRAN automatically.

**Shapefile cleaning takes a long time**: This is normal on the first run (especially geoBoundaries, which downloads data for every country via API). Subsequent runs skip this step entirely.

**"Cannot open file" errors**: Make sure you have placed the required shapefiles and SCI data files in the correct folders (`data/input_shapefiles/` and `data/sci_2026/`).

**Map shows no colored regions**: Check that your `user_region_id` exists in the SCI data file and that `friend_countries` includes the countries you expect to see.

**Want to re-run the cleaning step**: Run `./cleanup.sh` to delete all cleaned shapefiles, preprocessed `.rds` files, and generated outputs, then run `src/main.R` again. Alternatively, delete specific files in `data/cleaned_shapefiles/` — the cleaning and preprocessing will re-run for any missing output files.

---

# Data and Shapefiles

## The Social Connectedness Index

The Social Connectedness Index (SCI) measures the relative probability that two locations are socially connected, based on aggregated Facebook friendship links.

The SCI data are publicly available at the [Humanitarian Data Exchange](https://data.humdata.org/dataset/social-connectedness-index). 

Users of the SCI should cite the original SCI papers listed in `Relevant Literature.bib`.  

The SCI data should be downloaded and added to the `data/sci_2026` folder. 

## GADM Shapefile

**Link:**  
https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-levels.zip

**Citation:**
```bibtex
@dataset{gadm_4.1,
  title       = {{GADM} – Global Administrative Areas (version 4.1)},
  year        = {2022},
  version     = {4.1},
  publisher   = {GADM},
  url         = {https://gadm.org}
}
```

The GADM GeoPackage should be placed in: ```data/input_shapefiles/```. 

## geoBoundaries Shapefile API

**Link:**  
https://www.geoboundaries.org/api.html

**Citation:**
```bibtex
@article{runfola2020geoboundaries,
  title        = {geoBoundaries: A global database of political administrative boundaries},
  author       = {Runfola, Daniel and Community Contributors and Rogers, Lindsey and Habib, Joshua and Horn, Sidonie and Murphy, Sean and Miller, Dorian and Day, Hadley and Troup, Lydia and Fornatora, Dominic and Spage, Natalie and Pupkiewicz, Kristina and Roth, Michael and Rivera, Carolina and Altman, Charlie and Schruer, Isabel and McLaughlin, Tara and Biddle, Russ and Ritchey, Renee and Topness, Emily and Turner, James and Updike, Sam and Buckman, Helena and Simpson, Neel and Lin, Jason and Anderson, Austin and Baier, Heather and Crittenden, Matt and Dowker, Elizabeth and Fuhrig, Sydney and Goodman, Seth and Grimsley, Grace and Layko, Rachel and Melville, Graham and Mulder, Maddy and Oberman, Rachel and Panganiban, Joshua and Peck, Andrew and Seitz, Leigh and Shea, Sylvia and Slevin, Hannah and Yougerman, Rebecca and Hobbs, Lauren},
  journal      = {PLOS ONE},
  volume       = {15},
  number       = {4},
  pages        = {e0231866},
  year         = {2020},
  publisher    = {Public Library of Science}
}
```

geoBoundaries shapefiles are downloaded automatically via API when you first run the script. No manual download is needed. The cleaned outputs are stored in: ```data/cleaned_shapefiles/```.


## NUTS 2024 Shapefiles

**Link:**  
https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/territorial-units-statistics

**Settings:**
NUTS year: NUTS 2024
File Format: GeoPackage
Geometry Type: Polygons (RG)
Scale: 01M
CRS: ESPG: 4326

**Citation:**
```bibtex
@misc{eurostat_nuts2024,
  title        = {NUTS – Nomenclature of Territorial Units for Statistics, 2024},
  author       = {{Eurostat}},
  year         = {2024},
  publisher    = {European Commission},
  url          = {https://ec.europa.eu/eurostat}
}
```

This file should be placed in ```data/input_shapefiles/```. 


## US Counties and ZCTA Shapefiles

**Link:**  
https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html

These shapefiles are sourced from the U.S. Census Bureau TIGER/Line products and are used for county-level and ZIP Code Tabulation Area (ZCTA) analyses.

**Citation:**
```bibtex
@misc{us_census_tiger,
  title        = {TIGER/Line Shapefiles},
  author       = {{U.S. Census Bureau}},
  year         = {2024},
  publisher    = {U.S. Department of Commerce},
  url          = {https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html}
}
```

This file should be placed in ```data/input_shapefiles/```. 


## US Metro Areas (CBSA)

To use the CBSA (Core-Based Statistical Area / metro area) map types (`us_cbsa`, `us_zcta_cbsa`, `us_cbsa_zcta`), you need three additional files placed in `data/input_shapefiles/`:

1. **CBSA Shapefile** (`cb_2025_us_cbsa_500k.zip`): Cartographic boundary file for CBSAs from the U.S. Census Bureau.
   * Download from: https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html (select "Core Based Statistical Area")

2. **ZCTA-County Relationship File** (`tab20_zcta520_county20_natl.txt`): Maps ZCTAs to their primary county.
   * Download from: https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.html (select "2020 ZCTA to County")

3. **OMB Delineation File** (`list1_2023.xlsx`): Maps counties to CBSA codes.
   * Download from: https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html

On the first run, the script builds a ZCTA-CBSA crosswalk from files (2) and (3) and saves it to `data/zcta_cbsa_crosswalk.csv`. This crosswalk is used to aggregate ZCTA-level SCI data to the metro area level. The crosswalk and cleaned CBSA shapefile are cached and only rebuilt if their output files are deleted.

# Contact

This repository is managed by [Theresa Kuchler](https://pages.stern.nyu.edu/~tkuchler/index.html), [Manas Kulkarni](mailto:manas.shantaram.kulkarni@gmail.com), and [Johannes Stroebel](https://pages.stern.nyu.edu/~jstroebe/).
