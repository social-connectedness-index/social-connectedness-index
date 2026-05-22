#!/bin/bash

# Delete cleaned shapefiles (forces re-cleaning on next run)
rm -rf data/cleaned_shapefiles/*

# Delete generated outputs
rm -rf output/maps/*
rm -f output/scalars.txt
rm -f data/external_scalars.txt
