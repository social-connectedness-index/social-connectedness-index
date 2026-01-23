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


india_specs <- list(
  varanasi = list(
    selected_user_region = "IND.34.75_1",
    selected_friend_countries = south_asia_iso2_codes,
    breaks = NA
  ),
  amritsar = list(
    selected_user_region = "IND.28.1_1",
    selected_friend_countries = south_asia_iso2_codes,
    breaks = NA
  )
)

africa_specs <- list(
  cairo = list(
    selected_user_region = "EGY.11_1",
    selected_friend_countries = africa_iso2_codes,
    breaks = NA
  )
)
