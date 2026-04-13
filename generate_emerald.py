import geopandas as gpd
import json
from shapely.geometry import box, mapping
from shapely.ops import unary_union

# Load unzipped Census shapefile
gdf = gpd.read_file("cb_2021_us_county_500k.shp")
pa = gdf[gdf["STATEFP"] == "42"]

# Define Emerald bounding box from York through Chester near Maryland border
emerald_box = box(-77.2, 39.7, -75.8, 40.0)

# Intersect Emerald box with the combined shape of York, Lancaster, and Chester counties
merged_counties = pa[pa["NAME"].isin(["York", "Lancaster", "Chester"])]
intersected = merged_counties.intersection(emerald_box)

# Merge geometry
combined = unary_union(intersected.geometry)

# Build GeoJSON
geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(combined),
        "properties": {
            "team": "Emerald",
            "color": "#50c878"
        }
    }]
}

# Save
with open("emerald_territory.geojson", "w") as f:
    json.dump(geojson, f, indent=2)