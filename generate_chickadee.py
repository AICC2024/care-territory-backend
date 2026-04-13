import geopandas as gpd
import json
from shapely.geometry import box, mapping
from shapely.ops import unary_union

gdf = gpd.read_file("cb_2021_us_county_500k.shp")
pa = gdf[gdf["STATEFP"] == "42"]

# Full coverage
full = pa[pa["NAME"].isin(["Schuylkill", "Berks"])]

# Northern Lebanon (clip)
lebanon = pa[pa["NAME"] == "Lebanon"]
minx, miny, maxx, maxy = lebanon.total_bounds
mid_y = (miny + maxy) / 2
clip_box = box(minx, mid_y, maxx, maxy)
north_lebanon = lebanon.intersection(clip_box)

# Combine
combined = unary_union(list(full.geometry) + list(north_lebanon.geometry))

geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(combined),
        "properties": {
            "team": "Chickadee",
            "color": "#fcd116"
        }
    }]
}

with open("chickadee_territory.geojson", "w") as f:
    json.dump(geojson, f, indent=2)