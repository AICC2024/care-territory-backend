import geopandas as gpd
import json
from shapely.geometry import box, mapping
from shapely.ops import unary_union

# Load county shapefile (make sure .shp and related files are in place)
gdf = gpd.read_file("cb_2021_us_county_500k.shp")

# Focus on Pennsylvania counties
pa = gdf[gdf["STATEFP"] == "42"]

# Full counties
full_counties = pa[pa["NAME"].isin(["Perry", "Cumberland", "Franklin", "Adams"])]

# Clip western 1/3 of York and Dauphin
def clip_west(county, fraction=1/3):
    minx, miny, maxx, maxy = county.total_bounds
    clip = box(minx, miny, minx + (maxx - minx) * fraction, maxy)
    return county.intersection(clip)

york = pa[pa["NAME"] == "York"]
dauphin = pa[pa["NAME"] == "Dauphin"]

clipped_york = clip_west(york)
clipped_dauphin = clip_west(dauphin)

# Merge all geometries
geom = unary_union([
    *full_counties.geometry,
    *clipped_york.geometry,
    *clipped_dauphin.geometry
])

# Build GeoJSON
geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(geom),
        "properties": {
            "team": "Ladybug",
            "color": "#e75480"
        }
    }]
}

# Save
with open("ladybug_territory.geojson", "w") as f:
    json.dump(geojson, f, indent=2)