import geopandas as gpd
import json
from shapely.geometry import mapping

gdf = gpd.read_file("cb_2021_us_county_500k.shp")

counties = ["Perry", "Cumberland", "Franklin", "Adams", "York", "Dauphin",
            "Lebanon", "Lancaster", "Schuylkill", "Berks", "Chester"]
pa = gdf[gdf["STATEFP"] == "42"]
target = pa[pa["NAME"].isin(counties)]

merged = target.unary_union
geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": mapping(merged),
        "properties": {"name": "Hospice Service Territory"}
    }]
}

with open("hospice_service_area.geojson", "w") as f:
    json.dump(geojson, f, indent=2)