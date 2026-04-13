import geopandas as gpd
import json
from shapely.geometry import box, mapping
from shapely.ops import unary_union

# Load shapefile
gdf = gpd.read_file("cb_2021_us_county_500k.shp")
pa = gdf[gdf["STATEFP"] == "42"]

# Target counties
target = pa[pa["NAME"].isin(["Lancaster", "York", "Chester"])]

# Define precise bounding box (PDF visual)
# Covers: Lancaster center/southeast, York east edge, Chester west edge
clip_box = box(-76.6, 39.8, -75.9, 40.25)

# Intersect and merge geometry
clipped = target.intersection(clip_box)
merged = unary_union(clipped)

# Create GeoJSON structure
geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(merged),
        "properties": {
            "team": "Orange",
            "color": "#f7941d"
        }
    }]
}

# Save
with open("orange_territory.geojson", "w") as f:
    json.dump(geojson, f, indent=2)