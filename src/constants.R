data_dir <- "data"
output_dir <- "output"
maps_dir <- file.path(output_dir, "maps")

input_shapefiles_dir <- file.path(data_dir, "input_shapefiles")
cleaned_shapefiles_dir <- file.path(data_dir, "cleaned_shapefiles")

gadm_gpkg_input <- file.path(
  input_shapefiles_dir,
  "gadm_410-levels.zip"
)

gadm_shapefiles_output_dir <- file.path(
  cleaned_shapefiles_dir,
  "gadm"
)

gadm0_shapefile_path <- file.path(gadm_shapefiles_output_dir, "gadm0.gpkg")
gadm1_shapefile_path <- file.path(gadm_shapefiles_output_dir, "gadm1.gpkg")
gadm2_shapefile_path <- file.path(gadm_shapefiles_output_dir, "gadm2.gpkg")
gadm3_shapefile_path <- file.path(gadm_shapefiles_output_dir, "gadm3.gpkg")
# "GADM best": one combined layer that picks the most appropriate admin level
# per country (built by create_gadm_best_shapefile in clean_gadm_shapefiles.R).
gadm_best_shapefile_path <- file.path(gadm_shapefiles_output_dir, "gadm_best.gpkg")

# --- GADM "best" granularity config -----------------------------------------
# For each country we pick a single GADM admin level to represent it in the
# combined "gadm_best" layer: most countries default to GADM2, but some are too
# coarse at GADM2 (pinned to GADM0/1) and some warrant finer detail (GADM3).
gadm_best_granularities <- list(
  gadm0 = c("AD", "AG", "BS", "DM", "FM", "KI", "KN", "LC", "MC", "MV", "SB",
            "SC", "TO", "VC", "VU", "WS"),
  gadm1 = c("AE", "AF", "AM", "AO", "BB", "BG", "BH", "BI", "BN", "BT", "BY",
            "BZ", "CD", "CF", "CG", "CH", "CV", "CY", "DJ", "DZ", "EE", "EG",
            "ER", "GA", "GD", "GH", "GM", "GQ", "GT", "GW", "GY", "HN", "HR",
            "IL", "IS", "JM", "JP", "KE", "KM", "KW", "KZ", "LR", "LS", "LY",
            "MD", "ME", "MK", "ML", "MN", "MR", "MT", "MU", "MW", "MZ", "NA",
            "NE", "NG", "NL", "NZ", "PA", "PG", "QA", "RO", "RU", "RW", "SG",
            "SI", "SL", "SO", "SR", "SS", "SV", "SZ", "TD", "TG", "TJ", "TL",
            "TN", "TT", "TZ", "UG", "UZ", "YE", "ZM", "ZW"),
  gadm3 = c("BA", "CL", "ES", "FR", "GB", "GR", "IN", "NP", "PK", "ZA")
)
# gadm2 = the default level for every other country. Built from the full ISO2
# code list (countrycode's codelist) + Kosovo (no ISO2), minus the levels above.
all_iso2_codes <- c(
  countrycode::codelist$iso2c[!is.na(countrycode::codelist$iso2c)],
  "XK" # Kosovo
)
gadm_best_granularities$gadm2 <- setdiff(
  all_iso2_codes,
  c(gadm_best_granularities$gadm0,
    gadm_best_granularities$gadm1,
    gadm_best_granularities$gadm3)
)
# Overseas territories pinned to a fixed GADM level by GID3 prefix (ISO3),
# overriding their sovereign's chosen granularity.
gadm1_territories_prefixes <- c(
  "AIA", "BMU", "CYM", "GGY", "GUM", "IMN", "JEY", "MHL", "MNP", "MSR", "MYT",
  "PRI", "PYF", "SJM", "SPM", "TCA", "VGB", "GRL"
)
gadm2_territories_prefixes <- c(
  "BLM", "GLP", "GUF", "MTQ", "NCL", "REU", "SHN", "WLF"
)

geoboundaries_gpkg_path <- file.path(
  cleaned_shapefiles_dir,
  "geoBoundaries.gpkg"
)

us_cleaned_shapefiles_dir <- file.path(
  cleaned_shapefiles_dir,
  "united_states"
)

us_county_shapefile_path <- file.path(
  us_cleaned_shapefiles_dir,
  "united_states_counties.gpkg"
)

us_zcta_shapefile_path <- file.path(
  us_cleaned_shapefiles_dir,
  "united_states.gpkg"
)

us_cbsa_shapefile_path <- file.path(
  us_cleaned_shapefiles_dir,
  "united_states_cbsa.gpkg"
)

zcta_cbsa_crosswalk_path <- file.path(
  data_dir,
  "zcta_cbsa_crosswalk.csv"
)

zcta_county_crosswalk_path <- file.path(
  data_dir,
  "zcta_county_crosswalk.csv"
)

nuts_gpkg_input <- file.path(
  input_shapefiles_dir,
  "NUTS_RG_01M_2024_4326.gpkg"
)

nuts_shapefiles_output_dir <- file.path(
  cleaned_shapefiles_dir,
  "nuts"
)

nuts1_shapefile_path <- file.path(nuts_shapefiles_output_dir, "nuts1.gpkg")
nuts2_shapefile_path <- file.path(nuts_shapefiles_output_dir, "nuts2.gpkg")
nuts3_shapefile_path <- file.path(nuts_shapefiles_output_dir, "nuts3.gpkg")

sci_2026_dir <- file.path(data_dir, "sci_2026")

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

europe_iso2_codes = c(
  "AL", # ALB → Albania
  "AD", # AND → Andorra
  "AT", # AUT → Austria
  "BE", # BEL → Belgium
  "BG", # BGR → Bulgaria
  "BA", # BIH → Bosnia and Herzegovina
  "BY", # BLR → Belarus
  "CH", # CHE → Switzerland
  "CY", # CYP → Cyprus
  "CZ", # CZE → Czech Republic
  "DE", # DEU → Germany
  "DK", # DNK → Denmark
  "ES", # ESP → Spain
  "EE", # EST → Estonia
  "FI", # FIN → Finland
  "FR", # FRA → France
  "GB", # GBR → United Kingdom
  "GR", # GRC → Greece
  "HR", # HRV → Croatia
  "HU", # HUN → Hungary
  "IE", # IRL → Ireland
  "IT", # ITA → Italy
  "LI", # LIE → Liechtenstein
  "LT", # LTU → Lithuania
  "LV", # LVA → Latvia
  "LU", # LUX → Luxembourg
  "MD", # MDA → Moldova
  "MT", # MLT → Malta
  "MK", # MKD → North Macedonia
  "ME", # MNE → Montenegro
  "NL", # NLD → Netherlands
  "NO", # NOR → Norway
  "PL", # POL → Poland
  "PT", # PRT → Portugal
  "RO", # ROU → Romania
  "RS", # SRB → Serbia
  "SK", # SVK → Slovakia
  "SI", # SVN → Slovenia
  "SE", # SWE → Sweden
  "XK", # XKO → Kosovo (user-assigned ISO-2)
  "NC" # ZNC → Northern Cyprus (non-ISO)
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

# Country groups exported to the web app. Southeast Asia is split into mainland
# and maritime presets for the UI; the Philippines belongs to the maritime group.
southeast_asia_iso2_codes = c(
  "MM", # MMR → Myanmar
  "TH", # THA → Thailand
  "KH", # KHM → Cambodia
  "LA", # LAO → Laos
  "VN" # VNM → Vietnam
)

maritime_southeast_asia_iso2_codes = c(
  "ID", # IDN → Indonesia
  "MY", # MYS → Malaysia
  "PH", # PHL → Philippines
  "SG", # SGP → Singapore
  "BN", # BRN → Brunei
  "TL", # TLS → Timor-Leste
  "PG" # PNG → Papua New Guinea
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

west_asia_iso2_codes = c(
  "AM", # ARM → Armenia
  "AZ", # AZE → Azerbaijan
  "BH", # BHR → Bahrain
  "GE", # GEO → Georgia
  "IQ", # IRQ → Iraq
  "IL", # ISR → Israel
  "JO", # JOR → Jordan
  "KW", # KWT → Kuwait
  "LB", # LBN → Lebanon
  "OM", # OMN → Oman
  "QA", # QAT → Qatar
  "SA", # SAU → Saudi Arabia
  "TR", # TUR → Turkey
  "AE", # ARE → United Arab Emirates
  "SY", # SYR → Syria
  "YE" # YEM → Yemen
)

east_asia_iso2_codes = c(
  "JP", # JPN → Japan
  "KR", # KOR → South Korea
  "TW" # TWN → Taiwan
)

central_asia_iso2_codes = c(
  "KZ", # KAZ → Kazakhstan
  "KG", # KGZ → Kyrgyzstan
  "TJ", # TJK → Tajikistan
  "UZ" # UZB → Uzbekistan
)

nyc_county_fips <- c("36005", "36047", "36061", "36081", "36085")
nyc_cbsa_code <- "NYC"

# 2-digit state FIPS (county GEOID prefix) -> 2-letter postal abbreviation.
# Used to build human county labels like "Kings County, NY". Includes DC and the
# territories present in the Census TIGER county file.
state_fips_to_abbr <- c(
  "01" = "AL", "02" = "AK", "04" = "AZ", "05" = "AR", "06" = "CA",
  "08" = "CO", "09" = "CT", "10" = "DE", "11" = "DC", "12" = "FL",
  "13" = "GA", "15" = "HI", "16" = "ID", "17" = "IL", "18" = "IN",
  "19" = "IA", "20" = "KS", "21" = "KY", "22" = "LA", "23" = "ME",
  "24" = "MD", "25" = "MA", "26" = "MI", "27" = "MN", "28" = "MS",
  "29" = "MO", "30" = "MT", "31" = "NE", "32" = "NV", "33" = "NH",
  "34" = "NJ", "35" = "NM", "36" = "NY", "37" = "NC", "38" = "ND",
  "39" = "OH", "40" = "OK", "41" = "OR", "42" = "PA", "44" = "RI",
  "45" = "SC", "46" = "SD", "47" = "TN", "48" = "TX", "49" = "UT",
  "50" = "VT", "51" = "VA", "53" = "WA", "54" = "WV", "55" = "WI",
  "56" = "WY", "60" = "AS", "66" = "GU", "69" = "MP", "72" = "PR",
  "74" = "UM", "78" = "VI"
)

nuts_cntr_codes = c(
  "AL", # Albania
  "AT", # Austria
  "BA", # Bosnia and Herzegovina
  "BE", # Belgium
  "BG", # Bulgaria
  "CH", # Switzerland
  "CY", # Cyprus
  "CZ", # Czech Republic
  "DE", # Germany
  "DK", # Denmark
  "EE", # Estonia
  "EL", # Greece (Eurostat code, not ISO2 "GR")
  "ES", # Spain
  "FI", # Finland
  "FR", # France
  "HR", # Croatia
  "HU", # Hungary
  "IE", # Ireland
  "IS", # Iceland
  "IT", # Italy
  "LI", # Liechtenstein
  "LT", # Lithuania
  "LU", # Luxembourg
  "LV", # Latvia
  "ME", # Montenegro
  "MK", # North Macedonia
  "MT", # Malta
  "NL", # Netherlands
  "NO", # Norway
  "PL", # Poland
  "PT", # Portugal
  "RO", # Romania
  "RS", # Serbia
  "SE", # Sweden
  "SI", # Slovenia
  "SK", # Slovakia
  "TR", # Turkey
  "XK" # Kosovo
)
