data_dir <- "data"
input_dir <- file.path(data_dir, "input")
intermediate_dir <- file.path(data_dir, "intermediate")

figures_dir <- file.path("output", "figures")
maps_dir <- file.path(figures_dir, "maps")

input_shapefiles_dir = file.path(input_dir, "shapefiles")
intermediate_shapefiles_dir <- file.path(intermediate_dir, "shapefiles")

gadm_gpkg_input = file.path(
  input_shapefiles_dir,
  "gadm_410-levels.zip"
)
gadm_shapefiles_output_dir = file.path(
  intermediate_shapefiles_dir,
  "gadm"
)
gadm0_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm0.shp")
gadm1_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm1.shp")
gadm2_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm2.shp")
gadm3_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm3.shp")

geoboundaries_gpkg_input = file.path(
  intermediate_shapefiles_dir,
  "geoBoundaries.gpkg"
)

main_var_dict = c(
  "scaled_sci" = "Social Connectedness Index"
)

iso3_sovereign_iso3_xwalk = c(
  "AIA" = "GBR", # Anguilla
  "ASM" = "USA", # American Samoa
  "ABW" = "NLD", # Aruba
  "BMU" = "GBR", # Bermuda
  "BES" = "NLD", # Bonaire, Sint Eustatius and Saba
  "COK" = "NZL", # Cook Islands
  "CUW" = "NLD", # Curacao
  "CYM" = "GBR", # Cayman Islands
  "FLK" = "GBR", # Falkland Islands
  "FRO" = "DNK", # Faroe Islands
  "GUF" = "FRA", # French Guiana
  "GGY" = "GBR", # Guernsey
  "GIB" = "GBR", # Gibraltar
  "GRL" = "DNK", # Greenland
  "GLP" = "FRA", # Guadeloupe
  "GUM" = "USA", # Guam
  "HKG" = "CHN", # Hong Kong
  "IMN" = "GBR", # Isle of Man
  "JEY" = "GBR", # Jersey
  "MAC" = "CHN", # Macao
  "MAF" = "FRA", # Saint Martin
  "MHL" = "USA", # Marshall Islands
  "MNP" = "USA", # Northern Mariana Islands
  "MTQ" = "FRA", # Martinique
  "MSR" = "GBR", # Montserrat
  "MYT" = "FRA", # Mayotte
  "NCL" = "FRA", # New Caledonia
  "NFK" = "AUS", # Norfolk Island
  "NIU" = "NZL", # Niue
  "PYF" = "FRA", # French Polynesia
  "PRI" = "USA", # Puerto Rico
  "REU" = "FRA", # Reunion
  "SHN" = "GBR", # Saint Helena
  "SJM" = "NOR", # Svalbard and Jan Mayen
  "SXM" = "NLD", # Sint Maarten
  "TCA" = "GBR", # Turks and Caicos Islands
  "TKL" = "NZL", # Tokelau
  "VGB" = "GBR", # Virgin Islands, British
  "VIR" = "USA", # Virgin Islands, U.S.
  "WLF" = "FRA", # Wallis and Futuna
  "ZNC" = "CYP" # Northern Cyprus
)
