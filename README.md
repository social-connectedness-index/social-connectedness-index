# The Social Connectedness Index

This repository provides a set of scripts to help make use of the **Social Connectedness Index (SCI)** data. The SCI data are publicly available at the [Humanitarian Data Exchange](https://data.humdata.org/dataset/social-connectedness-index). 

The repository also includes replication code for [Johnston, Kuchler, Kulkarni, and Stroebel (2026)](https://pages.stern.nyu.edu/~jstroebe/PDF/JKKS_SCI.pdf).

Replication code for other papers that use the SCI is available in separate repositories: Code for [Kuchler, Russell, and Stroebel (2022)](https://www.sciencedirect.com/science/article/pii/S0094119020300851) is available [here](https://github.com/social-connectedness-index/example-scripts), and code for [Bailey, Kuchler, Johnston, Russell, State, and Stroebel (2020)](https://link.springer.com/chapter/10.1007/978-3-030-60975-7_1) is available [here](https://github.com/social-connectedness-index/euro_sci). 

We also include **Relevant Literature.bib**, which contains references to papers that introduce and develop the Social Connectedness Index. 

---

This tool lets you create high‑quality maps of the **Social Connectedness Index (SCI)** with *very little code editing*. You do **not** need to understand spatial data or GIS concepts to use it successfully.

If you can:

* open an R project,
* run a script once, and
* edit a structured list,

then you can use this tool.

---

## Big Picture: How the Tool Works

Think of the workflow in **two clear phases**:

1. **One‑time setup** (run once)

   * Downloads, cleans, and standardizes shapefiles
   * Prepares everything behind the scenes

2. **Map selection** (repeat as needed)

   * You tell the tool *what maps you want*
   * The tool generates them automatically

You **never** need to touch the cleaning code again after the first run.

---

## Folder Structure (Mental Model)

You will mainly interact with **two files**:

| File                                 | What it does                         |
| ------------------------------------ | ------------------------------------ |
| `main.R`                             | Sets everything up and runs the maps |
| `src/map_structs.R`                  | Where you define what maps you want  |

Everything else is support machinery.

---

## Step 0: What You Need Installed

Before running anything, make sure you have:

* **R** 
* **RStudio** 

The tool uses these R packages:

* `sf`
* `tidyverse`
* `countrycode`
* `rmapshaper`
* `rgeoboundaries`
* `wbstats`

If R complains about a missing package, just run:

```r
install.packages("package_name")
```

---

## Step 1: One‑Time Setup

### What this step does

This step:

* cleans and standardizes them
* saves clean versions to disk

**You only need to do this once per machine.**

### What to do

1. Download the SCI data and the shapefiles that are applicable to your use case: GADM, NUTS, US counties, or US ZCTA. Download links to these shapefiles are at the end of this documentation. If you are using geoBoundaries, you need not download anything proactively. 

2. Open the **main script** (`main.R`):

```r
r_setup()
load_gadm_data(...)
load_geoboundaries_shapefiles(...)
clean_us_zcta_shapefile()
clean_us_county_shapefile()
walk(map_jobs, run_maps_from_job)
```

3. Select **everything** in the file
4. Click **Run** (or press `Cmd + Enter` / `Ctrl + Enter` repeatedly)

### What you should expect

* This can take several minutes
* You will see messages about shapefiles loading
* New folders will appear in your project directory

If this finishes without errors, you are set forever.

---

## Step 2: Understanding `map_structs.R`

This is the **only file most users ever touch**.

### What `map_structs.R` is

It is a **menu of maps**.

Each entry answers:

* *What kind of SCI data am I using?*
* *What geography am I mapping?*
* *Which region is the focus?*

You do **not** write functions. You only fill in values.

---

## The Structure of a Map Job

Every map job follows the same template:

```r
job_name = list(
  sci_path = "...",
  friend_sf = list(...),
  friend_region_key = "...",
  friend_country_key = "...",
  highlight_sf = list(...),
  highlight_region_key = "...",
  map_specs = list(...)
)
```

You can think of this as:

> **SCI data + shapes + rules + specific maps**

---

## Key Concepts

### SCI file (`sci_path`)

This is the CSV file containing SCI values.

Examples:

* `country.csv`
* `gadm1.csv`
* `us_counties.csv`

You do **not** edit these files.

---

### `friend_sf`

This tells the tool:

> "What shapes should be colored on the map?"

Examples:

* Countries (GADM0)
* States / provinces (GADM1)
* Counties
* ZIP codes

You almost always leave this alone.

---

### `highlight_sf`

This tells the tool:

> "What single region should be highlighted as the source?"

Example:

* Highlight **Stockholm** while coloring all of Sweden
* Highlight **San Bernardino County** while coloring countries

---

### Region keys

These tell the tool **how rows match shapes**.

You should **never invent these**.

Common ones:

* `sv_cntr` → country ISO‑2 codes
* `key` → GADM region IDs
* `shapeID` → geoBoundaries IDs
* `region_id` → US counties / ZCTAs

If you copy an existing job, these will already be correct.

---

## The Most Important Part: `map_specs`

This is where **you define actual maps**.

Each entry inside `map_specs` creates **one output map**.

Example:

```r
map_specs = list(
  stockholm = list(
    user_region_id = "70781695B5805413017960",
    friend_countries = c("SE"),
    breaks = NA,
    xlim = NA,
    ylim = NA
  )
)
```

---

## Editing `map_specs` (What You Change)

### `user_region_id`

This is the **region you are mapping from**.

Examples:

* Country: `"SE"`
* GADM region: `"IND.12_1"`
* County FIPS: `"06071"`
* ZIP code: `"02138"`

If this ID exists in the SCI data, it will work.

---

### `friend_countries`

This limits which countries appear on the map.

Examples:

* `countries_in_data` → everything
* `c("US")` → only the US
* `europe_iso2_codes` → Europe only

This is optional but helps keep maps readable.

---

### `breaks`

Controls the legend bins.

* `NA` → automatic
* `c(1, 2, 5, 10, 20, 50)` → manual

If unsure, use `NA`.

---

### `xlim` and `ylim`

These coordinates control the map zoom.

Examples:

* World map: `NA`
* Europe: `xlim = c(-10, 36)`, `ylim = c(36, 70)`

If unsure, use `NA`.

---

## Adding a New Map (Step‑by‑Step)

1. Open `map_structs.R`
2. Find a job similar to what you want
3. Copy one existing `map_specs` entry
4. Paste it below
5. Change:

   * the name (e.g. `berlin`, `mumbai`)
   * the `user_region_id`
6. Save the file

That’s it.

---

## Running the Maps

After editing `map_structs.R`:

1. Open the **main script**
2. Run:

```r
walk(map_jobs, run_maps_from_job)
```

The maps will be written to the output directory automatically.

---

# Data and Shapefiles

## The Social Connectedness Index

The Social Connectedness Index (SCI) measures the relative probability that two locations are socially connected, based on aggregated Facebook friendship links.

The SCI data are publicly available at the [Humanitarian Data Exchange](https://data.humdata.org/dataset/social-connectedness-index). 

Users of the SCI should cite the original SCI papers listed in `Relevant Literature.bib`.  

The SCI data should be downloaded and added to the `data/sci_2026` folder. 

## GADM Shapefile

**Link:**  
https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gpkg.zip

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

geoBoundaries shapefiles are downloaded, cleaned, and assembled using the script: ```src/clean_geoboundaries.R```. The cleaned outputs are stored in: ```data/cleaned_shapefiles/```.


## NUTS 2024 Shapefiles

**Link:**  
https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/territorial-units-statistics

**Settings:**
NUTS year: NUTS 2024
File Format: GeoPackage
Geometry Type: Polygons (RG)
Scale: 60M
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

# Contact

This repository is managed by [Theresa Kuchler](https://pages.stern.nyu.edu/~tkuchler/index.html), [Manas Kulkarni](mailto:manas.shantaram.kulkarni@gmail.com), and [Johannes Stroebel](https://pages.stern.nyu.edu/~jstroebe/).

