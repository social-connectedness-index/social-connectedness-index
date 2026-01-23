data_dir <- "data"

maps_dir <- file.path("output", "maps")

input_shapefiles_dir = file.path(data_dir, "input_shapefiles")
cleaned_shapefiles_dir <- file.path(data_dir, "cleaned_shapefiles")

gadm_gpkg_input = file.path(
  input_shapefiles_dir,
  "gadm_410-levels.zip"
)
gadm_shapefiles_output_dir = file.path(
  cleaned_shapefiles_dir,
  "gadm"
)
gadm0_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm0.shp")
gadm1_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm1.shp")
gadm2_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm2.shp")
gadm3_shapefile_path = file.path(gadm_shapefiles_output_dir, "gadm3.shp")

main_var_dict = c(
  "scaled_sci" = "Social Connectedness Index"
)

india_specs <- list(
  gurgaon = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.12.5_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  bangalore = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.16.3_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  varanasi = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.34.75_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  chennai = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.31.2_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  hyderabad = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.32.2_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  jhunjhunu = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.29.21_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  sonipat = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.12.20_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  aligarh = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.34.2_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  vellore = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.31.30_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  ),
  amritsar = list(
    shapefile_path = gadm2_shapefile_path,
    selected_user_region = "IND.28.1_1",
    selected_friend_countries = c("IN", "PK", "BD", "LK", "NP", "BT"),
    breaks = NA
  )
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
