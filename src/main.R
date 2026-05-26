source("src/setup.R")
source("src/map_structs.R")

output_master_scalars_file()

output_format <- "png" # "png" for images, "mp4" for videos

for (spec_name in names(map_specs)) {
  message("Processing: ", spec_name)
  spec <- map_specs[[spec_name]]
  spec$output_path <- file.path(maps_dir, paste0(spec_name, ".", output_format))
  if ("region_a_id" %in% names(spec)) {
    do.call(make_comparison_map, spec)
  } else {
    do.call(make_map, spec)
  }
}
