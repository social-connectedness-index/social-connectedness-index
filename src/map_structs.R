map_jobs <- list(
  # country-country
  country_country = make_map_job(
    type = "country",
    sci_path = "data/sci_2026/country.csv",
    map_specs = list(
      sweden = list(
        user_region_id = "SE",
        friend_countries = countries_in_data,
        breaks = c(1, 2, 3, 4, 5, 7, 9, 10, 15, 20, 25, 30, 40, 50, 75),
        title = "Social Connectedness Index: Sweden"
      )
    )
  ),

  # GADM1-GADM1
  africa_gadm1 = make_map_job(
    type = "gadm1",
    sci_path = "data/sci_2026/gadm1.csv",
    map_specs = list(
      cabo_delgado = list(
        user_region_id = "MOZ.1_1",
        friend_countries = africa_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 10, 15, 20, 30, 40, 50, 60, 75, 100, 115),
        xlim = c(-26, 58),
        ylim = c(-35, 35),
        title = "Social Connectedness Index: Cabo Delgado, Mozambique"
      ),
      antananarivo = list(
        user_region_id = "MDG.1_1",
        friend_countries = africa_iso2_codes,
        breaks = c(1:15),
        xlim = c(-26, 58),
        ylim = c(-35, 35),
        title = "Social Connectedness Index: Antananarivo, Madagascar"
      )
    )
  ),

  # GADM2-GADM2
  india_gadm2 = make_map_job(
    type = "gadm2",
    sci_path = "data/sci_2026/gadm2_shard_JO.csv",
    map_specs = list(
      varanasi = list(
        user_region_id = "IND.34.75_1",
        friend_countries = south_asia_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75),
        xlim = c(60, 98),
        ylim = c(5, 37),
        title = "Social Connectedness Index: Varanasi, India"
      ),
      belgaum = list(
        user_region_id = "IND.16.4_1",
        friend_countries = south_asia_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75),
        xlim = c(60, 98),
        ylim = c(5, 37),
        title = "Social Connectedness Index: Belgaum, India"
      )
    )
  ),

  brazil_gadm2 = make_map_job(
    type = "gadm2",
    sci_path = "data/sci_2026/gadm2_shard_BR.csv",
    map_specs = list(
      manaus = list(
        user_region_id = "BRA.4.38_2",
        friend_countries = south_america_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75),
        xlim = c(-33, -85),
        ylim = c(12, -55),
        title = "Social Connectedness Index: Manaus, Brazil"
      )
    )
  ),

  chile_gadm2 = make_map_job(
    type = "gadm2",
    sci_path = "data/sci_2026/gadm2_shard_DO.csv",
    map_specs = list(
      santiago = list(
        user_region_id = "CHL.14.5_1",
        friend_countries = south_america_iso2_codes,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75),
        xlim = c(-33, -85),
        ylim = c(12, -55),
        title = "Social Connectedness Index: Santiago, Chile"
      )
    )
  ),

  # geoBoundaries ADM1-ADM1
  adm1_adm1 = make_map_job(
    type = "adm1",
    sci_path = "data/sci_2026/geoboundaries_adm1.csv",
    map_specs = list(
      massachusetts = list(
        user_region_id = "66186276B15934532614691",
        friend_countries = c("US"),
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20),
        xlim = c(-125, -66),
        ylim = c(25, 50),
        title = "Social Connectedness Index: Massachusetts, USA"
      )
    )
  ),

  # geoBoundaries ADM2-ADM2
  adm2_adm2 = make_map_job(
    type = "adm2",
    sci_path = "data/sci_2026/geoboundaries_adm2_shard_TG.csv",
    map_specs = list(
      stockholm = list(
        user_region_id = "70781695B5805413017960",
        friend_countries = c("SE"),
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
        title = "Social Connectedness Index: Stockholm, Sweden"
      )
    )
  ),

  # county-county
  us_county_to_us_county = make_map_job(
    type = "us_county",
    sci_path = "data/sci_2026/us_counties.csv",
    map_specs = list(
      kings = list(
        user_region_id = "36047",
        friend_countries = c("US"),
        xlim = c(-125, -66),
        ylim = c(25, 50),
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
        title = "Social Connectedness Index: Kings County, USA"
      )
    )
  ),

  # ZCTA-ZCTA
  us_zcta_to_us_zcta = make_map_job(
    type = "us_zcta",
    sci_path = "data/sci_2026/us_zcta_shard_8.csv",
    map_specs = list(
      tonopah = list(
        user_region_id = "89049",
        friend_countries = c("US"),
        xlim = c(-125, -66),
        ylim = c(25, 50),
        title = "Social Connectedness Index: Tonopah"
      )
    )
  ),

  # GADM1-country
  gadm1_country = make_map_job(
    type = "gadm1_country",
    sci_path = "data/sci_2026/gadm1_to_country.csv",
    map_specs = list(
      haryana = list(
        user_region_id = "IND.12_1",
        friend_countries = countries_in_data,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30),
        title = "Social Connectedness Index: Haryana, India"
      )
    )
  ),

  # geoBoundaries ADM1-country
  adm1_country = make_map_job(
    type = "adm1_country",
    sci_path = "data/sci_2026/geoboundaries_adm1_to_country.csv",
    map_specs = list(
      uttar_pradesh = list(
        user_region_id = "1811400B11231190780494",
        friend_countries = countries_in_data,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20),
        title = "Social Connectedness Index: Uttar Pradesh"
      )
    )
  ),

  # county-country
  us_county_to_country = make_map_job(
    type = "us_county_country",
    sci_path = "data/sci_2026/us_counties_to_country.csv",
    map_specs = list(
      san_bernardino = list(
        user_region_id = "06071",
        friend_countries = countries_in_data,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50),
        title = "Social Connectedness Index: San Bernardino"
      )
    )
  ),

  # ZCTA-country
  us_zcta_to_country = make_map_job(
    type = "us_zcta_country",
    sci_path = "data/sci_2026/us_zcta_to_country.csv",
    map_specs = list(
      cambridge = list(
        user_region_id = "02138",
        friend_countries = countries_in_data,
        breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50),
        title = "Social Connectedness Index: Cambridge"
      )
    )
  )
)
