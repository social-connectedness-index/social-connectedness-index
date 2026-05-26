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

sci_2021_dir <- file.path(data_dir, "sci_2021")

country_sci_2021 <- file.path(
  sci_2021_dir,
  "countries-countries-fb-social-connectedness-index-october-2021.tsv"
)

counties_sci_2021 <- file.path(
  sci_2021_dir,
  "county_county.tsv"
)

sci_2026_dir <- file.path(data_dir, "sci_2026")

country_sci_2026 <- file.path(
  sci_2026_dir,
  "country.csv"
)

counties_sci_2026 <- file.path(
  sci_2026_dir,
  "us_counties.csv"
)

scalar_output_fp <- file.path(output_dir, "scalars.txt")
internal_scalars_fp <- file.path(data_dir, "internal_scalars.txt")
external_scalars_fp <- file.path(data_dir, "external_scalars.txt")

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
