#!/bin/bash

# we don't want to lose the symlink here, so we only delete everything within the intermediate dir 
rm -r data/intermediate/*

# here we can remove all results and recreate since we only symlink the top level (output), 
# need the -rf because these directories contain subdirs
rm -rf output/figures
rm -rf output/tables
rm -rf output/scalars

# recreate what we lost
mkdir output/figures
mkdir output/tables
mkdir output/scalars
