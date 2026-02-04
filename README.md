# The Social Connectedness Index

This repository provides a set of scripts to help make use of the **Social Connectedness Index (SCI)** data. The SCI data are publicly available at the [Humanitarian Data Exchange](https://data.humdata.org/dataset/social-connectedness-index). 

The repository also includes replication code for [Johnston, Kuchler, Kulkarni, and Stroebel (2026)](https://pages.stern.nyu.edu/~jstroebe/PDF/JKKS_SCI.pdf).

Replication code for other papers that use the SCI is available in separate repositories: Code for [Kuchler, Russell, and Stroebel (2021)](https://www.sciencedirect.com/science/article/pii/S0094119020300851) is available [here](https://github.com/social-connectedness-index/example-scripts), and code for [Bailey, Kuchler, Johnston, Russell, State, and Stroebel (2020)](https://link.springer.com/chapter/10.1007/978-3-030-60975-7_1) is available [here](https://github.com/social-connectedness-index/euro_sci). 

We also include **Relevant Literature.bib**, which contains references to papers that introduce and develop the Social Connectedness Index. 

---

## Directory Structure 

```
data
  data/cleaned_shapefiles 
  data/input_shapefiles
  data/sci_2021
  data/sci_2026
output
  output/maps
src
```

---

# Data and Shapefiles

## The Social Connectedness Index

The Social Connectedness Index (SCI) measures the relative probability that two locations are socially connected, based on aggregated Facebook friendship links.

Users of the SCI should cite the original SCI papers listed in `Relevant Literature + Bibtex.bib`.  

## GADM Shapefiles

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

## geoBoundaries Shapefiles

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

This repository is managed by [Theresa Kuchler](https://pages.stern.nyu.edu/~tkuchler/index.html) and [Johannes Stroebel](https://pages.stern.nyu.edu/~jstroebe/).