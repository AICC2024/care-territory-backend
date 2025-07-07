from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import os
import psycopg2
from dotenv import load_dotenv
import requests
import json

load_dotenv()

app = Flask(__name__)
CORS(app)

def get_connection():
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=os.environ.get("DB_PORT", 5432),
        dbname=os.environ.get("DB_NAME", "care_territory"),
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ.get("DB_PASSWORD", "yourpassword")
    )

@app.route("/api/patients")
def get_patients():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT patient_id, name, address, type_of_care, status, latitude, longitude, cluster_id, zip_code, assigned_staff FROM patients")
    rows = cur.fetchall()
    colnames = [desc[0] for desc in cur.description]
    cur.close()
    conn.close()
    return jsonify([dict(zip(colnames, row)) for row in rows])

@app.route("/api/staff")
def get_staff():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT staff_id, name, home_base_address, max_capacity, latitude, longitude, zip_code FROM staff")
    rows = cur.fetchall()
    colnames = [desc[0] for desc in cur.description]
    cur.close()
    conn.close()
    return jsonify([dict(zip(colnames, row)) for row in rows])

# Assign nearest staff member to each patient cluster
from math import sqrt

@app.route("/api/assignments")
def assign_staff_to_clusters():
    conn = get_connection()
    patients_df = pd.read_sql("SELECT * FROM patients", conn)
    staff_df = pd.read_sql("SELECT * FROM staff", conn)
    # Keep conn open until after SQL read
    conn.close()

    # Compute cluster centers
    cluster_centers = {}
    grouped = patients_df.groupby("cluster_id")
    for cluster_id, group in grouped:
        lat = group["latitude"].mean()
        lng = group["longitude"].mean()
        cluster_centers[int(cluster_id)] = (lat, lng)

    # Find nearest staff for each cluster
    assignments = {}
    for cluster_id, (clat, clng) in cluster_centers.items():
        min_dist = float("inf")
        nearest_staff = None
        for _, row in staff_df.iterrows():
            if pd.notna(row["latitude"]) and pd.notna(row["longitude"]):
                slat, slng = row["latitude"], row["longitude"]
                dist = sqrt((clat - slat)**2 + (clng - slng)**2)
                if dist < min_dist:
                    min_dist = dist
                    nearest_staff = row["name"]
        if nearest_staff:
            assignments[str(cluster_id)] = nearest_staff

    return jsonify(assignments)

@app.route("/api/save-assignments", methods=["POST"])
def save_assignments():
    data = request.json
    conn = get_connection()
    cur = conn.cursor()
    for p in data:
        cur.execute(
            "UPDATE patients SET assigned_staff = %s WHERE patient_id = %s",
            (p.get("assigned_staff"), p.get("patient_id"))
        )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "success"})

def geocode_address(address):
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not api_key:
        print("❌ Missing GOOGLE_MAPS_API_KEY in environment")
        return None, None
    url = f"https://maps.googleapis.com/maps/api/geocode/json?address={address}&key={api_key}"
    print(f"🌐 Geocoding request to: {url}")
    try:
        response = requests.get(url)
        data = response.json()
        print("📦 Geocode API response:", data)
        if data['status'] == 'OK':
            loc = data['results'][0]['geometry']['location']
            return loc['lat'], loc['lng']
        else:
            print(f"❌ Geocoding failed: {data['status']}")
    except Exception as e:
        print(f"❌ Geocoding error: {e}")
    return None, None

@app.route("/api/add-patient", methods=["POST"])
def add_patient():
    data = request.json
    name = data.get("name")
    address = data.get("address")
    type_of_care = data.get("type_of_care")
    status = data.get("status", "Active")
    zip_code = data.get("zip_code")
    lat = data.get("latitude")
    lng = data.get("longitude")
    cluster_id = data.get("cluster_id")

    if not lat or not lng:
        lat, lng = geocode_address(address)

    conn = get_connection()
    cur = conn.cursor()

    assigned_staff = None
    if lat and lng:
        cur.execute("SELECT name, latitude, longitude FROM staff WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
        staff_rows = cur.fetchall()
        min_dist = float("inf")
        for sname, slat, slng in staff_rows:
            dist = (lat - slat) ** 2 + (lng - slng) ** 2
            if dist < min_dist:
                min_dist = dist
                assigned_staff = sname

    cur.execute("""
        INSERT INTO patients (name, address, type_of_care, status, latitude, longitude, cluster_id, zip_code, assigned_staff)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (name, address, type_of_care, status, lat, lng, cluster_id, zip_code, assigned_staff))
    conn.commit()
    cur.close()
    conn.close()

    return jsonify({"status": "inserted", "name": name})

@app.route("/api/add-staff", methods=["POST"])
def add_staff():
    data = request.json
    name = data.get("name")
    home_base_address = data.get("home_base_address")
    max_capacity = data.get("max_capacity")
    zip_code = data.get("zip_code")
    lat = data.get("latitude")
    lng = data.get("longitude")

    if not lat or not lng:
        lat, lng = geocode_address(home_base_address)

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO staff (name, home_base_address, max_capacity, latitude, longitude, zip_code)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (name, home_base_address, max_capacity, lat, lng, zip_code))
    conn.commit()
    cur.close()
    conn.close()

    return jsonify({"status": "inserted", "name": name})

@app.route("/api/add-office", methods=["POST"])
def add_office():
    data = request.json
    name = data.get("name")
    address = data.get("address")

    lat, lng = geocode_address(address)

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO offices (name, address, latitude, longitude)
        VALUES (%s, %s, %s, %s)
        RETURNING id
    """, (name, address, lat, lng))
    office_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()

    # Trigger ORS zone generation
    try:
        ors_api_key = os.environ.get("ORS_API_KEY")
        if ors_api_key:
            url = "https://api.openrouteservice.org/v2/isochrones/driving-car"
            headers = {
                "Authorization": ors_api_key,
                "Content-Type": "application/json"
            }
            payload = {
                "locations": [[lng, lat]],
                "range": [3600],
                "range_type": "time",
                "attributes": ["area", "reachfactor", "total_pop"]
            }
            response = requests.post(url, headers=headers, json=payload)
            data = response.json()
            if "features" in data and len(data["features"]) > 0:
                geojson = json.dumps(data["features"][0])
                conn = get_connection()
                cur = conn.cursor()
                cur.execute("UPDATE offices SET geojson_zone = %s WHERE id = %s", (geojson, office_id))
                conn.commit()
                cur.close()
                conn.close()
    except Exception as e:
        print(f"❌ Failed to auto-generate ORS zone: {e}")

    return jsonify({"status": "inserted", "name": name, "id": office_id})


@app.route("/api/offices")
def get_offices():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name, address, latitude, longitude, geojson_zone FROM offices")
    rows = cur.fetchall()
    colnames = [desc[0] for desc in cur.description]
    cur.close()
    conn.close()
    return jsonify([dict(zip(colnames, row)) for row in rows])

# Route to delete an office by ID
@app.route("/api/delete-office/<int:office_id>", methods=["DELETE"])
def delete_office(office_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM offices WHERE id = %s", (office_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "deleted", "id": office_id})

@app.route("/api/office-zones")
def get_office_zones():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, name, geojson_zone
        FROM offices
        WHERE geojson_zone IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    zones = []
    for row in rows:
        office_id, name, geojson_text = row
        try:
            geojson = json.loads(geojson_text)
            zones.append({
                "id": office_id,
                "name": name,
                "geojson": geojson
            })
        except Exception:
            continue

    return jsonify(zones)

@app.route("/api/generate-office-zone/<int:office_id>", methods=["POST"])
def generate_office_zone(office_id):
    minutes = int(request.args.get("minutes", "60"))
    ors_api_key = os.environ.get("ORS_API_KEY")
    if not ors_api_key:
        return jsonify({"error": "Missing ORS_API_KEY in environment"}), 500

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT latitude, longitude FROM offices WHERE id = %s", (office_id,))
    result = cur.fetchone()

    if not result:
        cur.close()
        conn.close()
        return jsonify({"error": "Office not found"}), 404

    lat, lng = result
    url = "https://api.openrouteservice.org/v2/isochrones/driving-car"
    headers = {
        "Authorization": ors_api_key,
        "Content-Type": "application/json"
    }
    payload = {
        "locations": [[lng, lat]],
        "range": [minutes * 60],
        "range_type": "time",
        "attributes": ["area", "reachfactor", "total_pop"]
    }

    try:
        response = requests.post(url, headers=headers, json=payload)
        data = response.json()
        if "features" in data and len(data["features"]) > 0:
            geojson = json.dumps(data["features"][0])
            cur.execute("UPDATE offices SET geojson_zone = %s WHERE id = %s", (geojson, office_id))
            conn.commit()
        else:
            return jsonify({"error": "ORS returned no features"}), 502
    except Exception as e:
        return jsonify({"error": f"ORS request failed: {e}"}), 500
    finally:
        cur.close()
        conn.close()

    return jsonify({
        "status": "zone_saved",
        "office_id": office_id,
        "geojson": json.loads(geojson)
    })


# --- Process unassigned patients route ---
@app.route("/api/process-unassigned-patients", methods=["POST"])
def process_unassigned_patients():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT patient_id, address, latitude, longitude
        FROM patients
        WHERE latitude IS NULL OR longitude IS NULL OR assigned_staff IS NULL
    """)
    rows = cur.fetchall()

    updated = 0
    for pid, address, lat, lng in rows:
        if lat is None or lng is None:
            lat, lng = geocode_address(address)
        assigned_staff = None
        if lat and lng:
            cur.execute("SELECT name, latitude, longitude FROM staff WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
            staff_rows = cur.fetchall()
            min_dist = float("inf")
            for sname, slat, slng in staff_rows:
                dist = (lat - slat) ** 2 + (lng - slng) ** 2
                if dist < min_dist:
                    min_dist = dist
                    assigned_staff = sname
        cur.execute("""
            UPDATE patients
            SET latitude = %s, longitude = %s, assigned_staff = %s
            WHERE patient_id = %s
        """, (lat, lng, assigned_staff, pid))
        updated += 1

    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "processed", "count": updated})



# --- Process unassigned staff route ---
@app.route("/api/process-unassigned-staff", methods=["POST"])
def process_unassigned_staff():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT staff_id, home_base_address
        FROM staff
        WHERE latitude IS NULL OR longitude IS NULL
    """)
    rows = cur.fetchall()

    updated = 0
    for sid, address in rows:
        lat, lng = geocode_address(address)
        if lat and lng:
            cur.execute("""
                UPDATE staff
                SET latitude = %s, longitude = %s
                WHERE staff_id = %s
            """, (lat, lng, sid))
            updated += 1

    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "processed", "count": updated})


# --- Regenerate all office zones route ---
@app.route("/api/regenerate-all-office-zones", methods=["POST"])
def regenerate_all_office_zones():
    ors_api_key = os.environ.get("ORS_API_KEY")
    if not ors_api_key:
        return jsonify({"error": "Missing ORS_API_KEY in environment"}), 500

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, latitude, longitude FROM offices WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
    offices = cur.fetchall()

    headers = {
        "Authorization": ors_api_key,
        "Content-Type": "application/json"
    }
    url = "https://api.openrouteservice.org/v2/isochrones/driving-car"
    updated = 0

    for office_id, lat, lng in offices:
        payload = {
            "locations": [[lng, lat]],
            "range": [3600],
            "range_type": "time",
            "attributes": ["area", "reachfactor", "total_pop"]
        }
        try:
            response = requests.post(url, headers=headers, json=payload)
            print(f"🌍 ORS response for office {office_id}:", response.status_code, response.text)
            if response.status_code != 200:
                print(f"❌ Skipping office {office_id}: HTTP {response.status_code}")
                continue
            data = response.json()
            if "features" in data and len(data["features"]) > 0:
                geojson = json.dumps(data["features"][0])
                cur.execute("UPDATE offices SET geojson_zone = %s WHERE id = %s", (geojson, office_id))
                updated += 1
            else:
                print(f"❌ ORS returned no features for office {office_id}")
        except Exception as e:
            print(f"❌ Failed to generate zone for office {office_id}: {e}")

    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "regenerated", "updated": updated})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port)