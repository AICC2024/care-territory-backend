import pandas as pd
import requests
import os
from dotenv import load_dotenv

# Load API key from .env file
load_dotenv()
API_KEY = os.getenv("GOOGLE_API_KEY")

def geocode_address(address):
    url = f"https://maps.googleapis.com/maps/api/geocode/json?address={requests.utils.quote(address)}&key={API_KEY}"
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        if data["status"] == "OK":
            location = data["results"][0]["geometry"]["location"]
            return location["lat"], location["lng"]
    return None, None

def add_coordinates(filename):
    df = pd.read_csv(filename)
    if "latitude" not in df.columns or "longitude" not in df.columns:
        df["latitude"] = None
        df["longitude"] = None

    for i, row in df.iterrows():
        address = row.get("address") or row.get("home_base_address")
        if pd.isna(row["latitude"]) or pd.isna(row["longitude"]):
            lat, lng = geocode_address(address)
            if lat and lng:
                print(f"✅ {address} → ({lat}, {lng})")
                df.at[i, "latitude"] = lat
                df.at[i, "longitude"] = lng
            else:
                print(f"❌ Failed to geocode: {address}")
    
    df.to_csv(filename, index=False)
    print(f"📝 Updated: {filename}")

# Run geocoding on both CSVs
add_coordinates("data/patients.csv")
add_coordinates("data/staff.csv")