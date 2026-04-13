import geopandas as gpd
import json
from shapely.geometry import box, mapping
from shapely.ops import unary_union

# Load the U.S. county shapefile (already unzipped)
gdf = gpd.read_file("cb_2021_us_county_500k.shp")

# Filter for Pennsylvania
pa = gdf[gdf["STATEFP"] == "42"]

# Load full counties
cumberland = pa[pa["NAME"] == "Cumberland"]
perry = pa[pa["NAME"] == "Perry"]

# Clip west half of Dauphin (everything west of -76.75)
dauphin = pa[pa["NAME"] == "Dauphin"]
minx, miny, maxx, maxy = dauphin.total_bounds
clip_box = box(minx, miny, -76.75, maxy)
dauphin_west = dauphin.intersection(clip_box)

# Combine all parts
geometry = unary_union(list(cumberland.geometry) + list(perry.geometry) + list(dauphin_west.geometry))

# Build GeoJSON
geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(geometry),
        "properties": {
            "team": "Dragonfly",
            "color": "#00b2a9"
        }
    }]
}

# Save to file
with open("dragonfly_territory.geojson", "w") as f:
    json.dump(geojson, f, indent=2)