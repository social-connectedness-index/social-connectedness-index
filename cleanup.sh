#!/bin/bash

# Delete cleaned shapefiles and preprocessed .rds (forces re-cleaning on next run)
rm -rf data/cleaned_shapefiles/*

# Delete generated crosswalks and their .rds caches
rm -f data/zcta_cbsa_crosswalk.csv data/zcta_cbsa_crosswalk.rds
rm -f data/zcta_county_crosswalk.csv data/zcta_county_crosswalk.rds

# Delete preprocessed SCI .rds caches (keeps source CSVs)
rm -f data/sci_2026/*.rds

# Delete generated outputs
rm -rf output/maps/*
