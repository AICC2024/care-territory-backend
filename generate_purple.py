import geopandas as gpd
import json
from shapely.geometry import box, mapping
from shapely.ops import unary_union

# Load US county shapefile (must already be unzipped)
gdf = gpd.read_file("cb_2021_us_county_500k.shp")

# Filter to PA
pa = gdf[gdf["STATEFP"] == "42"]

# Isolate York County
york = pa[pa["NAME"] == "York"]

# Clip southern 2/3 of York
minx, miny, maxx, maxy = york.total_bounds
cut_y = miny + (maxy - miny) * (1/3)  # keep everything below top third
south_york_box = box(minx, miny, maxx, cut_y)
south_york = york.intersection(south_york_box)

# Merge and build GeoJSON
geom = unary_union(list(south_york.geometry))

geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(geom),
        "properties": {
            "team": "Purple",
            "color": "#6c3483"
        }
    }]
}

# Write output
with open("purple_territory.geojson", "w") as f:
    json.dump(geojson, f, indent=2)