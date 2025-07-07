import geopandas as gpd
import json
from shapely.geometry import box, mapping
from shapely.ops import unary_union

# Load county shapefile (must be extracted locally)
gdf = gpd.read_file("cb_2021_us_county_500k.shp")

# Filter for Pennsylvania counties
pa = gdf[gdf["STATEFP"] == "42"]

# Target counties from the Blue map zone
target = pa[pa["NAME"].isin(["Lancaster", "Chester", "Berks"])]

# Define bounding box from visual inspection
# Covers: eastern Lancaster, eastern Chester, southern Berks
clip_box = box(-76.4, 39.9, -75.75, 40.4)

# Intersect and combine
clipped = target.intersection(clip_box)
geom = unary_union(clipped)

# Build GeoJSON
geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(geom),
        "properties": {
            "team": "Blue",
            "color": "#0077c2"
        }
    }]
}

# Save to file
with open("blue_territory.geojson", "w") as f:
    json.dump(geojson, f, indent=2)