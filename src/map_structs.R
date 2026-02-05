map_jobs <- list(
  # country-country
  country_country = list(
    sci_path = "data/sci_2026/country.csv",
    friend_sf = list(
      path = gadm0_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = gadm0_shapefile_path,
      layer = NULL
    ),
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

  # GADM1-GADM1
  africa_gadm1 = list(
    sci_path = "data/sci_2026/gadm1.csv",
    friend_sf = list(
      path = gadm1_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = gadm1_shapefile_path,
      layer = NULL
    ),
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

  # GADM2-GADM2
  india_gadm2 = list(
    sci_path = "data/sci_2026/gadm2_shard_JO.csv",
    friend_sf = list(
      path = gadm2_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = gadm2_shapefile_path,
      layer = NULL
    ),
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
    friend_sf = list(
      path = gadm2_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = gadm2_shapefile_path,
      layer = NULL
    ),
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
    friend_sf = list(
      path = gadm2_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = gadm2_shapefile_path,
      layer = NULL
    ),
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
  ),

  # geoBoundaries_ADM1-geoBoundaries_ADM1
  adm1_adm1 = list(
    sci_path = "data/sci_2026/geoboundaries_adm1.csv",
    friend_sf = list(
      path = geoboundaries_gpkg_path,
      layer = "adm1"
    ),
    friend_region_key = "shapeID",
    friend_country_key = "shapeGroup",
    highlight_sf = list(
      path = geoboundaries_gpkg_path,
      layer = "adm1"
    ),
    highlight_region_key = "shapeID",
    map_specs = list(
      massachusetts = list(
        user_region_id = "66186276B15934532614691",
        friend_countries = c("US"),
        breaks = NA,
        xlim = c(-125, -66),
        ylim = c(25, 50)
      )
    )
  ),

  # geoBoundaries_ADM2-geoBoundaries_ADM2
  adm2_adm2 = list(
    sci_path = "data/sci_2026/geoboundaries_adm2_shard_TG.csv",
    friend_sf = list(
      path = geoboundaries_gpkg_path,
      layer = "adm2"
    ),
    friend_region_key = "shapeID",
    friend_country_key = "shapeGroup",
    highlight_sf = list(
      path = geoboundaries_gpkg_path,
      layer = "adm2"
    ),
    highlight_region_key = "shapeID",
    map_specs = list(
      stockholm = list(
        user_region_id = "70781695B5805413017960",
        friend_countries = c("SE"),
        breaks = NA,
        xlim = NA,
        ylim = NA
      )
    )
  ),

  # NUTS1-NUTS1, NUTS2-NUTS2, NUTS3-NUTS3
  nuts_nuts = list(
    sci_path = "data/sci_2026/nuts1_2024.csv",
    friend_sf = list(
      path = nuts_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "NUTS_ID",
    friend_country_key = "CNTR_CODE",
    highlight_sf = list(
      path = nuts_shapefile_path,
      layer = NULL
    ),
    highlight_region_key = "NUTS_ID",
    map_specs = list(
      germany = list(
        user_region_id = "DE6",
        friend_countries = europe_iso2_codes,
        breaks = NA,
        xlim = c(-10, 36),
        ylim = c(36, 70)
      )
    )
  ),

  # county-county
  us_county_to_us_county = list(
    sci_path = "data/sci_2026/us_counties.csv",
    friend_sf = list(
      path = us_county_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "region_id",
    friend_country_key = "region_id",
    highlight_sf = list(
      path = us_county_shapefile_path,
      layer = NULL
    ),
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

  # ZCTA-ZCTA
  us_zcta_to_us_zcta = list(
    sci_path = "data/sci_2026/us_zcta_shard_8.csv",
    friend_sf = list(
      path = us_zcta_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "region_id",
    friend_country_key = "region_id",
    highlight_sf = list(
      path = us_zcta_shapefile_path,
      layer = NULL
    ),
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

  # GADM1-country, GADM2-country,
  gadm1_country = list(
    sci_path = "data/sci_2026/gadm1_to_country.csv",
    friend_sf = list(
      path = gadm0_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = gadm1_shapefile_path,
      layer = NULL
    ),
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
  ),

  # geoBoundaries_ADM1-country, geoBoundaries_ADM2-country
  adm1_country = list(
    sci_path = "data/sci_2026/geoboundaries_adm1_to_country.csv",
    friend_sf = list(
      path = gadm0_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = geoboundaries_gpkg_path,
      layer = "adm1"
    ),
    highlight_region_key = "shapeID",
    map_specs = list(
      uttar_pradesh = list(
        user_region_id = "1811400B11231190780494",
        friend_countries = countries_in_data,
        breaks = NA,
        xlim = NA,
        ylim = NA
      )
    )
  ),

  # NUTS1-country, NUTS2-country, NUTS3-country
  nuts1_to_country = list(
    sci_path = "data/sci_2026/nuts1_2024_to_country.csv",
    friend_sf = list(
      path = gadm0_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = nuts_shapefile_path,
      layer = NULL
    ),
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

  # county-country
  us_county_to_country = list(
    sci_path = "data/sci_2026/us_counties_to_country.csv",
    friend_sf = list(
      path = gadm0_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = us_county_shapefile_path,
      layer = NULL
    ),
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

  # ZCTA-country
  us_zcta_to_country = list(
    sci_path = "data/sci_2026/us_zcta_to_country.csv",
    friend_sf = list(
      path = gadm0_shapefile_path,
      layer = NULL
    ),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(
      path = us_zcta_shapefile_path,
      layer = NULL
    ),
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
  )
)
