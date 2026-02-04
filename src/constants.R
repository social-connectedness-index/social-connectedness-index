data_dir <- "data"

output_dir <- file.path("output")
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

geoboundaries_gpkg_path = file.path(
  cleaned_shapefiles_dir,
  "geoBoundaries.gpkg"
)

geoboundaries_temp_shapes = file.path(
  cleaned_shapefiles_dir,
  "geoboundaries_temp"
)
geoboundaries_adm1_shapefile_path = file.path(
  geoboundaries_temp_shapes,
  "geoboundaries_adm1.shp"
)
geoboundaries_adm2_shapefile_path = file.path(
  geoboundaries_temp_shapes,
  "geoboundaries_adm2.shp"
)
geoboundaries_adm3_shapefile_path = file.path(
  geoboundaries_temp_shapes,
  "geoboundaries_adm3.shp"
)

sci_2021_dir = file.path(
  data_dir,
  "sci_2021"
)

country_sci_2021 = file.path(
  sci_2021_dir,
  "countries-countries-fb-social-connectedness-index-october-2021.tsv"
)

counties_sci_2021 = file.path(
  sci_2021_dir,
  "county_county.tsv"
)

sci_2026_dir = file.path(
  data_dir,
  "sci_2026"
)

country_sci_2026 = file.path(
  sci_2026_dir,
  "country.csv"
)

counties_sci_2026 = file.path(
  sci_2026_dir,
  "us_counties.csv"
)

scalar_output_fp = "output/scalars.txt"
internal_scalars_fp = file.path(data_dir, "internal_scalars.txt")
external_scalars_fp = file.path(data_dir, "external_scalars.txt")

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

countries_in_data = c(
  "AD",
  "AE",
  "AF",
  "AL",
  "AM",
  "AO",
  "AR",
  "AT",
  "AU",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BN",
  "BO",
  "BR",
  "BS",
  "BT",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CL",
  "CM",
  "CO",
  "CR",
  "CV",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FM",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GH",
  "GM",
  "GN",
  "GQ",
  "GR",
  "GT",
  "GW",
  "GY",
  "HK",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IN",
  "IQ",
  "IS",
  "IT",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KR",
  "KW",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MD",
  "ME",
  "MG",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MR",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NE",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PG",
  "PH",
  "PK",
  "PL",
  "PT",
  "PY",
  "QA",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SD",
  "SE",
  "SG",
  "SI",
  "SK",
  "SL",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SZ",
  "TD",
  "TG",
  "TH",
  "TJ",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TW",
  "TZ",
  "UA",
  "UG",
  "US",
  "UY",
  "UZ",
  "VC",
  "VE",
  "VN",
  "VU",
  "WS",
  "XK",
  "YE",
  "ZA",
  "ZM",
  "ZW"
)

south_america_iso2_codes = c(
  "AR", # ARG → Argentina
  "BO", # BOL → Bolivia
  "BR", # BRA → Brazil
  "CL", # CHL → Chile
  "CO", # COL → Colombia
  "EC", # ECU → Ecuador
  "GY", # GUY → Guyana
  "PY", # PRY → Paraguay
  "PE", # PER → Peru
  "SR", # SUR → Suriname
  "UY", # URY → Uruguay
  "VE", # VEN → Venezuela
  "FR", # FRA → France (French Guiana territory but ISO2 for France)
  "GF" # GUF → French Guiana (ISO2 code)
)

central_america_iso2_codes = c(
  "BZ", # BLZ → Belize
  "CR", # CRI → Costa Rica
  "GT", # GTM → Guatemala
  "HN", # HND → Honduras
  "MX", # MEX → Mexico
  "NI", # NIC → Nicaragua
  "PA", # PAN → Panama
  "SV" # SLV → El Salvador
)

north_america_iso2_codes = c(
  central_america_iso2_codes,
  "BS", # BHS → Bahamas
  "CA", # CAN → Canada
  "CU", # CUB → Cuba
  "DO", # DOM → Dominican Republic
  "HT", # HTI → Haiti
  "JM", # JAM → Jamaica
  "US" # USA → United States
)

africa_iso2_codes = c(
  "AO", # AGO → Angola
  "BJ", # BEN → Benin
  "BF", # BFA → Burkina Faso
  "BI", # BDI → Burundi
  "BW", # BWA → Botswana
  "CF", # CAF → Central African Republic
  "CM", # CMR → Cameroon
  "CV", # CPV → Cape Verde
  "TD", # TCD → Chad
  "KM", # COM → Comoros
  "CD", # COD → Dem. Rep. of the Congo
  "CG", # COG → Republic of the Congo
  "CI", # CIV → Ivory Coast
  "DJ", # DJI → Djibouti
  "DZ", # DZA → Algeria
  "EG", # EGY → Egypt
  "EH", # ESH → Western Sahara
  "ET", # ETH → Ethiopia
  "GQ", # GNQ → Equatorial Guinea
  "GW", # GNB → Guinea-Bissau
  "ER", # ERI → Eritrea
  "GA", # GAB → Gabon
  "GH", # GHA → Ghana
  "GN", # GIN → Guinea
  "GM", # GMB → Gambia
  "KE", # KEN → Kenya
  "LS", # LSO → Lesotho
  "LR", # LBR → Liberia
  "LY", # LBY → Libya
  "MA", # MAR → Morocco
  "MG", # MDG → Madagascar
  "MW", # MWI → Malawi
  "ML", # MLI → Mali
  "MR", # MRT → Mauritania
  "MZ", # MOZ → Mozambique
  "NA", # NAM → Namibia
  "NE", # NER → Niger
  "NG", # NGA → Nigeria
  "RW", # RWA → Rwanda
  "SN", # SEN → Senegal
  "SL", # SLE → Sierra Leone
  "SO", # SOM → Somalia
  "SD", # SDN → Sudan
  "SS", # SSD → South Sudan
  "ST", # STP → São Tomé and Príncipe
  "SZ", # SWZ → Eswatini (formerly Swaziland)
  "SC", # SYC → Seychelles
  "TG", # TGO → Togo
  "TN", # TUN → Tunisia
  "TZ", # TZA → Tanzania
  "UG", # UGA → Uganda
  "ZA", # ZAF → South Africa
  "ZM", # ZMB → Zambia
  "ZW" # ZWE → Zimbabwe
)

south_asia_iso2_codes = c(
  "BD", # BGD → Bangladesh
  "BT", # BTN → Bhutan
  "IN", # IND → India
  "NP", # NPL → Nepal
  "PK", # PAK → Pakistan
  "LK" # LKA → Sri Lanka
)


map_jobs_for_paper <- list(
  africa_gadm1 = list(
    sci_path = "data/sci_2026/gadm1.csv",
    friend_sf_path = gadm1_shapefile_path,
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf_path = gadm1_shapefile_path,
    highlight_region_key = "key",
    map_specs = list(
      cabo_delgado = list(
        user_region_id = "MOZ.1_1",
        friend_countries = africa_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 10, 15, 20, 30, 40, 50, 60, 75, 100, 115),
        xlim = c(-26, 58),
        ylim = c(-35, 35)
      ),
      antananarivo = list(
        user_region_id = "MDG.1_1",
        friend_countries = africa_iso2_codes,
        breaks = c(1:15),
        xlim = c(-26, 58),
        ylim = c(-35, 35)
      )
    )
  ),

  india_gadm2 = list(
    sci_path = "data/sci_2026/gadm2_shard_JO.csv",
    friend_sf_path = gadm2_shapefile_path,
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf_path = gadm2_shapefile_path,
    highlight_region_key = "key",
    map_specs = list(
      varanasi = list(
        user_region_id = "IND.34.75_1",
        friend_countries = south_asia_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75),
        xlim = c(60, 98),
        ylim = c(5, 37)
      ),
      belgaum = list(
        user_region_id = "IND.16.4_1",
        friend_countries = south_asia_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75),
        xlim = c(60, 98),
        ylim = c(5, 37)
      )
    )
  ),

  brazil_gadm2 = list(
    sci_path = "data/sci_2026/gadm2_shard_BR.csv",
    friend_sf_path = gadm2_shapefile_path,
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf_path = gadm2_shapefile_path,
    highlight_region_key = "key",
    map_specs = list(
      manaus = list(
        user_region_id = "BRA.4.38_2",
        friend_countries = south_america_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75),
        xlim = c(-33, -85),
        ylim = c(12, -55)
      )
    )
  ),

  chile_gadm2 = list(
    sci_path = "data/sci_2026/gadm2_shard_DO.csv",
    friend_sf_path = gadm2_shapefile_path,
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf_path = gadm2_shapefile_path,
    highlight_region_key = "key",
    map_specs = list(
      santiago = list(
        user_region_id = "CHL.14.5_1",
        friend_countries = south_america_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75),
        xlim = c(-33, -85),
        ylim = c(12, -55)
      )
    )
  )
)


test_map_jobs <- list(
  nuts1_to_country = list(
    sci_path = "data/sci_2026/nuts1_2024_to_country.csv",
    friend_sf_path = gadm0_shapefile_path,
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf_path = "data/cleaned_shapefiles/NUTS_RG_01M_2024_4326.gpkg",
    highlight_region_key = "NUTS_ID",
    map_specs = list(
      hamburg = list(
        user_region_id = "DE6",
        friend_countries = countries_in_data,
        breaks = NA,
        xlim = NA,
        ylim = NA
      )
    )
  ),

  us_county_to_country = list(
    sci_path = "data/sci_2026/us_counties_to_country.csv",
    friend_sf_path = gadm0_shapefile_path,
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf_path = "data/cleaned_shapefiles/united_states/united_states_counties.shp",
    highlight_region_key = "region_id",
    map_specs = list(
      san_bernardino = list(
        user_region_id = "06071",
        friend_countries = countries_in_data,
        breaks = NA,
        xlim = NA,
        ylim = NA
      )
    )
  ),

  us_county_to_us_county = list(
    sci_path = "data/sci_2026/us_counties.csv",
    friend_sf_path = "data/cleaned_shapefiles/united_states/united_states_counties.shp",
    friend_region_key = "region_id",
    friend_country_key = "region_id",
    highlight_sf_path = "data/cleaned_shapefiles/united_states/united_states_counties.shp",
    highlight_region_key = "region_id",
    map_specs = list(
      kings = list(
        user_region_id = "36047",
        friend_countries = c("US"),
        breaks = NA,
        xlim = c(-125, -66),
        ylim = c(25, 50)
      )
    )
  ),

  us_zcta_to_country = list(
    sci_path = "data/sci_2026/us_zcta_to_country.csv",
    friend_sf_path = gadm0_shapefile_path,
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf_path = "data/cleaned_shapefiles/united_states/united_states.shp",
    highlight_region_key = "region_id",
    map_specs = list(
      cambridge = list(
        user_region_id = "02138",
        friend_countries = countries_in_data,
        breaks = NA,
        xlim = NA,
        ylim = NA
      )
    )
  ),

  us_zcta_to_us_zcta = list(
    sci_path = "data/sci_2026/us_zcta_shard_8.csv",
    friend_sf_path = "data/cleaned_shapefiles/united_states/united_states.shp",
    friend_region_key = "region_id",
    friend_country_key = "region_id",
    highlight_sf_path = "data/cleaned_shapefiles/united_states/united_states.shp",
    highlight_region_key = "region_id",
    map_specs = list(
      tonopah = list(
        user_region_id = "89049",
        friend_countries = c("US"),
        breaks = NA,
        xlim = c(-125, -66),
        ylim = c(25, 50)
      )
    )
  ),

  country_country = list(
    sci_path = "data/sci_2026/country.csv",
    friend_sf_path = gadm0_shapefile_path,
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf_path = gadm0_shapefile_path,
    highlight_region_key = "sv_cntr",
    map_specs = list(
      sweden = list(
        user_region_id = "SE",
        friend_countries = countries_in_data,
        breaks = NA,
        xlim = NA,
        ylim = NA
      )
    )
  ),

  gadm1_country = list(
    sci_path = "data/sci_2026/gadm1_to_country.csv",
    friend_sf_path = gadm0_shapefile_path,
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf_path = gadm1_shapefile_path,
    highlight_region_key = "key",
    map_specs = list(
      india = list(
        user_region_id = "IND.12_1",
        friend_countries = countries_in_data,
        breaks = NA,
        xlim = NA,
        ylim = NA
      )
    )
  )
)
