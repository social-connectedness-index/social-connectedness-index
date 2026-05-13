map_specs <- list(
  sweden = list(
    type = "country",
    user_region_id = "SE",
    sci_path = "data/sci_2026/country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 2, 3, 4, 5, 7, 9, 10, 15, 20, 25, 30, 40, 50, 75),
    title = "Social Connectedness Index: Sweden"
  ),

  cabo_delgado = list(
    type = "gadm1",
    user_region_id = "MOZ.1_1",
    sci_path = "data/sci_2026/gadm1.csv",
    friend_countries = africa_iso2_codes,
    breaks = c(1, 2, 3, 4, 5, 10, 15, 20, 30, 40, 50, 60, 75, 100, 115),
    xlim = c(-26, 58),
    ylim = c(-35, 35),
    title = "Social Connectedness Index: Cabo Delgado, Mozambique"
  ),

  antananarivo = list(
    type = "gadm1",
    user_region_id = "MDG.1_1",
    sci_path = "data/sci_2026/gadm1.csv",
    friend_countries = africa_iso2_codes,
    breaks = c(1:15),
    xlim = c(-26, 58),
    ylim = c(-35, 35),
    title = "Social Connectedness Index: Antananarivo, Madagascar"
  ),

  varanasi = list(
    type = "gadm2",
    user_region_id = "IND.34.75_1",
    sci_path = "data/sci_2026/gadm2_shard_JO.csv",
    friend_countries = south_asia_iso2_codes,
    breaks = c(1, 2, 3, 4, 5, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75),
    xlim = c(60, 98),
    ylim = c(5, 37),
    title = "Social Connectedness Index: Varanasi, India"
  ),

  belgaum = list(
    type = "gadm2",
    user_region_id = "IND.16.4_1",
    sci_path = "data/sci_2026/gadm2_shard_JO.csv",
    friend_countries = south_asia_iso2_codes,
    breaks = c(1, 2, 3, 4, 5, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75),
    xlim = c(60, 98),
    ylim = c(5, 37),
    title = "Social Connectedness Index: Belgaum, India"
  ),

  manaus = list(
    type = "gadm2",
    user_region_id = "BRA.4.38_2",
    sci_path = "data/sci_2026/gadm2_shard_BR.csv",
    friend_countries = south_america_iso2_codes,
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75),
    xlim = c(-33, -85),
    ylim = c(12, -55),
    title = "Social Connectedness Index: Manaus, Brazil"
  ),

  santiago = list(
    type = "gadm2",
    user_region_id = "CHL.14.5_1",
    sci_path = "data/sci_2026/gadm2_shard_DO.csv",
    friend_countries = south_america_iso2_codes,
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75),
    xlim = c(-33, -85),
    ylim = c(12, -55),
    title = "Social Connectedness Index: Santiago, Chile"
  ),

  massachusetts = list(
    type = "adm1",
    user_region_id = "66186276B15934532614691",
    sci_path = "data/sci_2026/geoboundaries_adm1.csv",
    friend_countries = c("US"),
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20),
    xlim = c(-125, -66),
    ylim = c(25, 50),
    title = "Social Connectedness Index: Massachusetts, USA"
  ),

  stockholm = list(
    type = "adm2",
    user_region_id = "70781695B5805413017960",
    sci_path = "data/sci_2026/geoboundaries_adm2_shard_TG.csv",
    friend_countries = c("SE"),
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
    title = "Social Connectedness Index: Stockholm, Sweden"
  ),

  kings = list(
    type = "us_county",
    user_region_id = "36047",
    sci_path = "data/sci_2026/us_counties.csv",
    friend_countries = c("US"),
    xlim = c(-125, -66),
    ylim = c(25, 50),
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
    title = "Social Connectedness Index: Kings County, USA"
  ),

  tonopah = list(
    type = "us_zcta",
    user_region_id = "89049",
    sci_path = "data/sci_2026/us_zcta_shard_8.csv",
    friend_countries = c("US"),
    xlim = c(-125, -66),
    ylim = c(25, 50),
    title = "Social Connectedness Index: Tonopah"
  ),

  haryana = list(
    type = "gadm1_country",
    user_region_id = "IND.12_1",
    sci_path = "data/sci_2026/gadm1_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30),
    title = "Social Connectedness Index: Haryana, India"
  ),

  uttar_pradesh = list(
    type = "adm1_country",
    user_region_id = "1811400B11231190780494",
    sci_path = "data/sci_2026/geoboundaries_adm1_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20),
    title = "Social Connectedness Index: Uttar Pradesh"
  ),

  san_bernardino = list(
    type = "us_county_country",
    user_region_id = "06071",
    sci_path = "data/sci_2026/us_counties_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50),
    title = "Social Connectedness Index: San Bernardino"
  ),

  cambridge = list(
    type = "us_zcta_country",
    user_region_id = "02138",
    sci_path = "data/sci_2026/us_zcta_to_country.csv",
    friend_countries = countries_in_data,
    breaks = c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50),
    title = "Social Connectedness Index: Cambridge"
  )
)
