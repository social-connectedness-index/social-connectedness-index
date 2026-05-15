map_specs <- list(
  sweden_country = list(
    type = "country",
    user_region_id = "SE",
    sci_path = "data/sci_2026/country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 9, 15, 20, 30, 40, 50, 75),
    title = "Social Connectedness Index: Sweden"
  ),

  cabo_delgado_gadm1 = list(
    type = "gadm1",
    user_region_id = "MOZ.1_1",
    sci_path = "data/sci_2026/gadm1.csv",
    friend_countries = africa_iso2_codes,
    breaks = c(1, 3, 5, 10, 20, 40, 50, 75, 100, 115),
    xlim = c(-26, 58),
    ylim = c(-35, 35),
    title = "Social Connectedness Index: Cabo Delgado, Mozambique"
  ),

  antananarivo_gadm1 = list(
    type = "gadm1",
    user_region_id = "MDG.1_1",
    sci_path = "data/sci_2026/gadm1.csv",
    friend_countries = africa_iso2_codes,
    breaks = c(1, 3, 4, 6, 7, 9, 10, 12, 13, 15),
    xlim = c(-26, 58),
    ylim = c(-35, 35),
    title = "Social Connectedness Index: Antananarivo, Madagascar"
  ),

  varanasi_gadm2 = list(
    type = "gadm2",
    user_region_id = "IND.34.75_1",
    sci_path = "data/sci_2026/gadm2_shard_JO.csv",
    friend_countries = south_asia_iso2_codes,
    breaks = c(1, 3, 5, 15, 25, 35, 40, 50, 60, 75),
    xlim = c(60, 98),
    ylim = c(5, 37),
    title = "Social Connectedness Index: Varanasi, India"
  ),

  belgaum_gadm2 = list(
    type = "gadm2",
    user_region_id = "IND.16.4_1",
    sci_path = "data/sci_2026/gadm2_shard_JO.csv",
    friend_countries = south_asia_iso2_codes,
    breaks = c(1, 3, 5, 15, 25, 35, 40, 50, 60, 75),
    xlim = c(60, 98),
    ylim = c(5, 37),
    title = "Social Connectedness Index: Belgaum, India"
  ),

  manaus_gadm2 = list(
    type = "gadm2",
    user_region_id = "BRA.4.38_2",
    sci_path = "data/sci_2026/gadm2_shard_BR.csv",
    friend_countries = south_america_iso2_codes,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    xlim = c(-33, -85),
    ylim = c(12, -55),
    title = "Social Connectedness Index: Manaus, Brazil"
  ),

  santiago_gadm2 = list(
    type = "gadm2",
    user_region_id = "CHL.14.5_1",
    sci_path = "data/sci_2026/gadm2_shard_DO.csv",
    friend_countries = south_america_iso2_codes,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    xlim = c(-33, -85),
    ylim = c(12, -55),
    title = "Social Connectedness Index: Santiago, Chile"
  ),

  massachusetts_adm1 = list(
    type = "adm1",
    user_region_id = "66186276B15934532614691",
    sci_path = "data/sci_2026/geoboundaries_adm1.csv",
    friend_countries = c("US"),
    breaks = c(1, 3, 5, 7, 9, 12, 14, 16, 18, 20),
    xlim = c(-125, -66),
    ylim = c(25, 50),
    title = "Social Connectedness Index: Massachusetts, USA"
  ),

  stockholm_adm2 = list(
    type = "adm2",
    user_region_id = "70781695B5805413017960",
    sci_path = "data/sci_2026/geoboundaries_adm2_shard_TG.csv",
    friend_countries = c("SE"),
    breaks = c(1, 3, 4, 6, 7, 9, 10, 12, 13, 15),
    title = "Social Connectedness Index: Stockholm, Sweden"
  ),

  kings_us_county = list(
    type = "us_county",
    user_region_id = "36047",
    sci_path = "data/sci_2026/us_counties.csv",
    friend_countries = c("US"),
    xlim = c(-125, -66),
    ylim = c(25, 50),
    breaks = c(1, 3, 4, 6, 7, 9, 10, 12, 13, 15),
    title = "Social Connectedness Index: Kings County, USA"
  ),

  tonopah_us_zcta = list(
    type = "us_zcta",
    user_region_id = "89049",
    sci_path = "data/sci_2026/us_zcta_shard_8.csv",
    friend_countries = c("US"),
    xlim = c(-125, -66),
    ylim = c(25, 50),
    breaks = c(1, 3, 4, 6, 7, 9, 10, 12, 13, 15),
    title = "Social Connectedness Index: Tonopah"
  ),

  haryana_gadm1_country = list(
    type = "gadm1_country",
    user_region_id = "IND.12_1",
    sci_path = "data/sci_2026/gadm1_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 7, 10, 12, 15, 20, 25, 30),
    title = "Social Connectedness Index: Haryana, India"
  ),

  uttar_pradesh_adm1_country = list(
    type = "adm1_country",
    user_region_id = "1811400B11231190780494",
    sci_path = "data/sci_2026/geoboundaries_adm1_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 7, 9, 12, 14, 16, 18, 20),
    title = "Social Connectedness Index: Uttar Pradesh"
  ),

  san_bernardino_us_county_country = list(
    type = "us_county_country",
    user_region_id = "06071",
    sci_path = "data/sci_2026/us_counties_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 40, 50),
    title = "Social Connectedness Index: San Bernardino"
  ),

  cambridge_us_zcta_country = list(
    type = "us_zcta_country",
    user_region_id = "02138",
    sci_path = "data/sci_2026/us_zcta_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 40, 50),
    title = "Social Connectedness Index: Cambridge"
  ),

  ile_de_france_nuts1 = list(
    type = "nuts1",
    user_region_id = "FR1",
    sci_path = "data/sci_2026/nuts1_2024.csv",
    friend_countries = nuts_cntr_codes,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    xlim = c(-25, 45),
    ylim = c(34, 72),
    title = "Social Connectedness Index: Ile-de-France, France (NUTS1)"
  ),

  oberbayern_nuts2 = list(
    type = "nuts2",
    user_region_id = "DE21",
    sci_path = "data/sci_2026/nuts2_2024.csv",
    friend_countries = nuts_cntr_codes,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    xlim = c(-25, 45),
    ylim = c(34, 72),
    title = "Social Connectedness Index: Oberbayern, Germany (NUTS2)"
  ),

  berlin_nuts3 = list(
    type = "nuts3",
    user_region_id = "DE300",
    sci_path = "data/sci_2026/nuts3_2024.csv",
    friend_countries = nuts_cntr_codes,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    xlim = c(-25, 45),
    ylim = c(34, 72),
    title = "Social Connectedness Index: Berlin, Germany (NUTS3)"
  ),

  ile_de_france_nuts1_country = list(
    type = "nuts1_country",
    user_region_id = "FR1",
    sci_path = "data/sci_2026/nuts1_2024_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    title = "Social Connectedness Index: Ile-de-France, France (NUTS1 to Country)"
  ),

  oberbayern_nuts2_country = list(
    type = "nuts2_country",
    user_region_id = "DE21",
    sci_path = "data/sci_2026/nuts2_2024_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    title = "Social Connectedness Index: Oberbayern, Germany (NUTS2 to Country)"
  ),

  berlin_nuts3_country = list(
    type = "nuts3_country",
    user_region_id = "DE300",
    sci_path = "data/sci_2026/nuts3_2024_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 3, 5, 7, 10, 15, 20, 30, 50, 75),
    title = "Social Connectedness Index: Berlin, Germany (NUTS3 to Country)"
  )
)
