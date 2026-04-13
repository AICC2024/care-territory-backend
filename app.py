
from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import os
import psycopg2
from dotenv import load_dotenv
import requests
import json
from shapely.geometry import shape, Point
from geopy.distance import geodesic

load_dotenv()

app = Flask(__name__)
CORS(app)

# Route to update avoid-home-zone settings per staff member
@app.route("/api/staff/<int:staff_id>/avoid-home-zone", methods=["PATCH"])
def update_avoid_home_zone(staff_id):
    data = request.get_json() or {}

    has_zone_toggle = "avoid_home_zone" in data
    has_radius = "avoid_home_radius_miles" in data

    if not has_zone_toggle and not has_radius:
        return jsonify({"error": "Provide avoid_home_zone and/or avoid_home_radius_miles"}), 400

    updates = []
    values = []

    if has_zone_toggle:
        new_value = data.get("avoid_home_zone")
        if new_value not in [True, False]:
            return jsonify({"error": "Invalid value for avoid_home_zone"}), 400
        updates.append("avoid_home_zone = %s")
        values.append(new_value)

    if has_radius:
        try:
            radius = float(data.get("avoid_home_radius_miles"))
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid value for avoid_home_radius_miles"}), 400

        if radius < 0:
            return jsonify({"error": "avoid_home_radius_miles must be >= 0"}), 400

        updates.append("avoid_home_radius_miles = %s")
        values.append(radius)

    conn = get_connection()
    cur = conn.cursor()

    values.append(staff_id)
    cur.execute(f"UPDATE staff SET {', '.join(updates)} WHERE staff_id = %s", tuple(values))

    if cur.rowcount == 0:
        cur.close()
        conn.close()
        return jsonify({"error": "Staff not found"}), 404

    cur.execute(
        "SELECT avoid_home_zone, COALESCE(avoid_home_radius_miles, 2.0) FROM staff WHERE staff_id = %s",
        (staff_id,)
    )
    row = cur.fetchone()

    rebalanced_count = 0
    unresolved_violations = 0

    staff_by_id = {}
    counts = {}

    if row:
        cur.execute("""
            SELECT staff_id, name, latitude, longitude, assigned_office_id, max_capacity,
                   avoid_home_zone, COALESCE(avoid_home_radius_miles, 2.0), manual_override
            FROM staff
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND assigned_office_id IS NOT NULL
        """)
        staff_rows = cur.fetchall()

        for sid, sname, slat, slng, soffice, capacity, avoid, avoid_radius, override in staff_rows:
            normalized_capacity = int(capacity) if capacity is not None and int(capacity) > 0 else 999999
            staff_by_id[sid] = {
                "name": sname,
                "lat": slat,
                "lng": slng,
                "office_id": soffice,
                "capacity": normalized_capacity,
                "avoid_home_zone": bool(avoid),
                "avoid_home_radius_miles": float(avoid_radius),
                "manual_override": bool(override)
            }

        cur.execute("""
            SELECT assigned_staff_id, COUNT(*)
            FROM patients
            WHERE assigned_staff_id IS NOT NULL
            GROUP BY assigned_staff_id
        """)
        counts = {k: v for k, v in cur.fetchall()}
        for sid in staff_by_id:
            counts.setdefault(sid, 0)

    # If avoid-home-zone is enabled, immediately rebalance currently assigned patients
    # that now violate this nurse's home radius.
    if row and row[0]:
        cur.execute("""
            SELECT patient_id, name, latitude, longitude, assigned_office_id, assigned_staff_id
            FROM patients
            WHERE assigned_staff_id = %s
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND assigned_office_id IS NOT NULL
            ORDER BY patient_id ASC
        """, (staff_id,))
        assigned_patients = cur.fetchall()

        for patient_id, pname, plat, plng, poffice, current_sid in assigned_patients:
            current_staff = staff_by_id.get(current_sid)
            if not current_staff:
                continue

            current_dist = geodesic((plat, plng), (current_staff["lat"], current_staff["lng"])).miles
            if current_dist >= current_staff["avoid_home_radius_miles"]:
                continue

            same_office_candidates = []
            fallback_candidates = []

            for sid, candidate in staff_by_id.items():
                if sid == current_sid:
                    continue
                if candidate["manual_override"]:
                    continue
                if counts.get(sid, 0) >= candidate["capacity"]:
                    continue

                dist = geodesic((plat, plng), (candidate["lat"], candidate["lng"])).miles
                if candidate["avoid_home_zone"] and dist < candidate["avoid_home_radius_miles"]:
                    continue

                utilization_after = (counts.get(sid, 0) + 1) / max(candidate["capacity"], 1)
                score = dist + (utilization_after * 2.0)
                candidate_tuple = (score, dist, sid)

                if candidate["office_id"] == poffice:
                    same_office_candidates.append(candidate_tuple)
                else:
                    fallback_candidates.append(candidate_tuple)

            candidates = same_office_candidates if same_office_candidates else fallback_candidates
            if not candidates:
                unresolved_violations += 1
                continue

            candidates.sort(key=lambda x: (x[0], x[1], x[2]))
            best_sid = candidates[0][2]

            cur.execute(
                "UPDATE patients SET assigned_staff_id = %s, assigned_staff = %s WHERE patient_id = %s",
                (best_sid, staff_by_id[best_sid]["name"], patient_id)
            )
            counts[current_sid] = max(0, counts.get(current_sid, 0) - 1)
            counts[best_sid] = counts.get(best_sid, 0) + 1
            rebalanced_count += 1

    # If avoid-home-zone is disabled, rebalance patients back toward this nurse
    # (nearest-eligible pull-back, capacity-limited).
    elif row and not row[0] and staff_id in staff_by_id and not staff_by_id[staff_id]["manual_override"]:
        target_staff = staff_by_id[staff_id]

        cur.execute("""
            SELECT patient_id, name, latitude, longitude, assigned_office_id, assigned_staff_id
            FROM patients
            WHERE assigned_staff_id IS NOT NULL
              AND assigned_staff_id <> %s
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
            ORDER BY patient_id ASC
        """, (staff_id,))
        candidate_patients = cur.fetchall()

        pull_back_candidates = []
        for patient_id, pname, plat, plng, poffice, current_sid in candidate_patients:
            current_staff = staff_by_id.get(current_sid)
            if not current_staff:
                continue

            if counts.get(staff_id, 0) >= target_staff["capacity"]:
                break

            # Prefer same-office pull-back, but allow cross-office if none available.
            same_office_priority = 0 if target_staff["office_id"] == poffice else 1

            dist_to_target = geodesic((plat, plng), (target_staff["lat"], target_staff["lng"])).miles
            dist_to_current = geodesic((plat, plng), (current_staff["lat"], current_staff["lng"])).miles
            distance_gain = dist_to_current - dist_to_target

            if distance_gain <= 0:
                continue

            pull_back_candidates.append((same_office_priority, -distance_gain, dist_to_target, patient_id, current_sid))

        pull_back_candidates.sort(key=lambda x: (x[0], x[1], x[2], x[3]))

        for _, _, _, patient_id, current_sid in pull_back_candidates:
            if counts.get(staff_id, 0) >= target_staff["capacity"]:
                break

            cur.execute(
                "UPDATE patients SET assigned_staff_id = %s, assigned_staff = %s WHERE patient_id = %s",
                (staff_id, target_staff["name"], patient_id)
            )
            counts[current_sid] = max(0, counts.get(current_sid, 0) - 1)
            counts[staff_id] = counts.get(staff_id, 0) + 1
            rebalanced_count += 1

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({
        "status": "updated",
        "staff_id": staff_id,
        "avoid_home_zone": row[0] if row else None,
        "avoid_home_radius_miles": row[1] if row else None,
        "rebalanced_count": rebalanced_count,
        "unresolved_violations": unresolved_violations
    })

# --- Assign staff to patients route ---
@app.route("/api/assign-staff-to-patients", methods=["POST"])
def assign_staff_to_patients():
    payload = request.get_json(silent=True) or {}
    balance_weight = float(payload.get("balance_weight", 5.0))
    default_avoid_home_radius_miles = float(payload.get("avoid_home_radius_miles", 2.0))

    conn = get_connection()
    cur = conn.cursor()

    # Load unassigned patients (deterministic order)
    cur.execute("""
        SELECT patient_id, name, latitude, longitude, assigned_office_id
        FROM patients
        WHERE assigned_staff_id IS NULL
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND assigned_office_id IS NOT NULL
        ORDER BY patient_id ASC
    """)
    unassigned_patients = cur.fetchall()

    # Load all staff with assignment attributes
    cur.execute("""
        SELECT staff_id, name, latitude, longitude, assigned_office_id, max_capacity, avoid_home_zone, avoid_home_radius_miles, manual_override
        FROM staff
        WHERE latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND assigned_office_id IS NOT NULL
    """)
    staff_rows = cur.fetchall()

    # Count current panel sizes
    cur.execute("""
        SELECT assigned_staff_id, COUNT(*)
        FROM patients
        WHERE assigned_staff_id IS NOT NULL
        GROUP BY assigned_staff_id
    """)
    counts = {k: v for k, v in cur.fetchall()}

    # Read currently assigned patient locations for rebalancing
    cur.execute("""
        SELECT patient_id, name, latitude, longitude, assigned_office_id, assigned_staff_id
        FROM patients
        WHERE assigned_staff_id IS NOT NULL
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND assigned_office_id IS NOT NULL
    """)
    assigned_patient_rows = [list(row) for row in cur.fetchall()]

    staff_by_id = {}
    for sid, sname, slat, slng, soffice, capacity, avoid, avoid_radius, override in staff_rows:
        normalized_capacity = int(capacity) if capacity is not None and int(capacity) > 0 else 999999
        staff_by_id[sid] = {
            "name": sname,
            "lat": slat,
            "lng": slng,
            "office_id": soffice,
            "capacity": normalized_capacity,
            "avoid_home_zone": bool(avoid),
            "avoid_home_radius_miles": float(avoid_radius) if avoid_radius is not None else default_avoid_home_radius_miles,
            "manual_override": bool(override)
        }
        counts.setdefault(sid, 0)

    def projected_score_for_staff(patient_lat, patient_lng, sid):
        staff = staff_by_id[sid]
        dist = geodesic((patient_lat, patient_lng), (staff["lat"], staff["lng"])).miles
        utilization_after = (counts.get(sid, 0) + 1) / max(staff["capacity"], 1)
        score = dist + (utilization_after * balance_weight)
        return score, dist

    def eligible_staff_for_patient(patient_lat, patient_lng, patient_office_id):
        eligible = []
        for sid, staff in staff_by_id.items():
            if staff["manual_override"]:
                continue
            if staff["office_id"] != patient_office_id:
                continue
            if counts.get(sid, 0) >= staff["capacity"]:
                continue

            score, dist = projected_score_for_staff(patient_lat, patient_lng, sid)
            if staff["avoid_home_zone"] and dist < staff["avoid_home_radius_miles"]:
                continue

            # Deterministic ordering: score, distance, staff_id
            eligible.append((score, dist, sid))

        return sorted(eligible, key=lambda x: (x[0], x[1], x[2]))

    assigned = 0
    overflow = []

    # First pass: assign only to caregivers with available capacity
    for patient_id, pname, plat, plng, poffice in unassigned_patients:
        eligible = eligible_staff_for_patient(plat, plng, poffice)
        if not eligible:
            overflow.append((patient_id, pname, plat, plng, poffice))
            continue

        _, _, best_sid = eligible[0]
        best_sname = staff_by_id[best_sid]["name"]

        cur.execute("UPDATE patients SET assigned_staff_id = %s WHERE patient_id = %s", (best_sid, patient_id))
        counts[best_sid] = counts.get(best_sid, 0) + 1
        assigned += 1

        assigned_patient_rows.append([patient_id, pname, plat, plng, poffice, best_sid])
        print(f"✅ Assigned patient {pname} (ID: {patient_id}) to staff {best_sname} (ID: {best_sid})")

    # Rebalance pass: if any non-manual staff are overloaded, move patients to nearest available caregivers.
    rebalanced = 0
    while True:
        overloaded_staff = sorted([
            sid for sid, staff in staff_by_id.items()
            if not staff["manual_override"] and counts.get(sid, 0) > staff["capacity"]
        ])

        if not overloaded_staff:
            break

        move_candidates = []

        for from_sid in overloaded_staff:
            from_staff = staff_by_id[from_sid]
            from_office = from_staff["office_id"]

            for row in assigned_patient_rows:
                patient_id, pname, plat, plng, poffice, current_sid = row
                if current_sid != from_sid or poffice != from_office:
                    continue

                current_dist = geodesic((plat, plng), (from_staff["lat"], from_staff["lng"])).miles

                for to_sid, to_staff in staff_by_id.items():
                    if to_sid == from_sid:
                        continue
                    if to_staff["manual_override"]:
                        continue
                    if to_staff["office_id"] != poffice:
                        continue
                    if counts.get(to_sid, 0) >= to_staff["capacity"]:
                        continue

                    projected_score, target_dist = projected_score_for_staff(plat, plng, to_sid)
                    if to_staff["avoid_home_zone"] and target_dist < to_staff["avoid_home_radius_miles"]:
                        continue

                    distance_delta = target_dist - current_dist
                    # Deterministic move ranking
                    move_candidates.append((
                        distance_delta,
                        projected_score,
                        target_dist,
                        patient_id,
                        from_sid,
                        to_sid
                    ))

        if not move_candidates:
            break

        move_candidates.sort(key=lambda x: (x[0], x[1], x[2], x[3], x[5]))
        _, _, _, move_patient_id, from_sid, to_sid = move_candidates[0]

        cur.execute("UPDATE patients SET assigned_staff_id = %s WHERE patient_id = %s", (to_sid, move_patient_id))
        counts[from_sid] = max(0, counts.get(from_sid, 0) - 1)
        counts[to_sid] = counts.get(to_sid, 0) + 1
        rebalanced += 1

        for row in assigned_patient_rows:
            if row[0] == move_patient_id:
                row[5] = to_sid
                break

    # Retry overflow after rebalance in case capacity opened up.
    overflow_assigned = 0
    still_overflow = []

    for patient_id, pname, plat, plng, poffice in overflow:
        eligible = eligible_staff_for_patient(plat, plng, poffice)
        if not eligible:
            still_overflow.append((patient_id, pname, poffice))
            continue

        _, _, best_sid = eligible[0]
        cur.execute("UPDATE patients SET assigned_staff_id = %s WHERE patient_id = %s", (best_sid, patient_id))
        counts[best_sid] = counts.get(best_sid, 0) + 1
        overflow_assigned += 1

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({
        "status": "staff assigned",
        "assigned_count": assigned,
        "rebalanced_count": rebalanced,
        "overflow_assigned_count": overflow_assigned,
        "unassigned_overflow_count": len(still_overflow)
    })

@app.route("/api/assign-staff-to-offices", methods=["POST"])

def assign_staff_to_offices():
    conn = get_connection()
    cur = conn.cursor()

    # Load staff who are eligible
    cur.execute("""
        SELECT staff_id, latitude, longitude, manual_override
        FROM staff
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)
    staff_rows = cur.fetchall()

    # Load office zones
    cur.execute("SELECT id, latitude, longitude, geojson_zone FROM offices WHERE geojson_zone IS NOT NULL AND id NOT IN (3, 7)")
    offices = cur.fetchall()

    office_zones = []
    for oid, olat, olng, geojson_text in offices:
        try:
            geojson = json.loads(geojson_text)
            polygon = shape(geojson['geometry'])
            office_zones.append({
                "id": oid,
                "center_lat": olat,
                "center_lng": olng,
                "polygon": polygon
            })
        except:
            continue

    updated = 0
    for sid, slat, slng, manual_override in staff_rows:
        if manual_override:
            continue
        point = Point(slng, slat)
        matching = [o for o in office_zones if o["polygon"].contains(point)]

        if len(matching) == 1:
            office_id = matching[0]["id"]
        elif len(matching) > 1:
            distances = [(o["id"], geodesic((slat, slng), (o["center_lat"], o["center_lng"])).miles) for o in matching]
            office_id = min(distances, key=lambda x: x[1])[0]
        elif len(office_zones) > 0:
            distances = [(o["id"], geodesic((slat, slng), (o["center_lat"], o["center_lng"])).miles) for o in office_zones]
            office_id = min(distances, key=lambda x: x[1])[0]
        else:
            continue

        cur.execute("UPDATE staff SET assigned_office_id = %s WHERE staff_id = %s", (office_id, sid))
        updated += 1

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({"status": "staff assigned", "updated": updated})

# Assign patients to nearest office zone
@app.route("/api/assign-patients-to-offices", methods=["POST"])
def assign_patients_to_offices():
    conn = get_connection()
    cur = conn.cursor()

    # Load patients
    cur.execute("SELECT patient_id, latitude, longitude FROM patients WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
    patients = cur.fetchall()

    # Load office zones
    cur.execute("SELECT id, name, latitude, longitude, geojson_zone FROM offices WHERE geojson_zone IS NOT NULL AND id NOT IN (3, 7)")
    offices = cur.fetchall()

    # Parse office polygons
    office_zones = []
    for oid, name, lat, lng, geojson_text in offices:
        try:
            geojson = json.loads(geojson_text)
            polygon = shape(geojson['geometry'])
            office_zones.append({
                "id": oid,
                "name": name,
                "center_lat": lat,
                "center_lng": lng,
                "polygon": polygon
            })
        except Exception as e:
            print(f"⚠️ Failed to parse polygon for office {name}: {e}")

    # Assign patients
    assigned = 0
    for patient_id, plat, plng in patients:
        point = Point(plng, plat)

        matching_offices = [o for o in office_zones if o["polygon"].contains(point)]

        if len(matching_offices) == 1:
            assigned_office_id = matching_offices[0]["id"]
        elif len(matching_offices) > 1:
            distances = [(o["id"], geodesic((plat, plng), (o["center_lat"], o["center_lng"])).miles) for o in matching_offices]
            assigned_office_id = min(distances, key=lambda x: x[1])[0]
        else:
            distances = [(o["id"], geodesic((plat, plng), (o["center_lat"], o["center_lng"])).miles) for o in office_zones]
            assigned_office_id = min(distances, key=lambda x: x[1])[0]

        cur.execute("UPDATE patients SET assigned_office_id = %s WHERE patient_id = %s", (assigned_office_id, patient_id))
        assigned += 1

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({"status": "assigned", "count": assigned})

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
    cur.execute("SELECT patient_id, name, address, type_of_care, status, latitude, longitude, cluster_id, zip_code, assigned_staff, assigned_office_id, assigned_staff_id FROM patients")
    rows = cur.fetchall()
    colnames = [desc[0] for desc in cur.description]
    cur.close()
    conn.close()
    return jsonify([dict(zip(colnames, row)) for row in rows])

@app.route("/api/staff")
def get_staff():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT staff_id, name, home_base_address, max_capacity, latitude, longitude, zip_code, assigned_office_id, avoid_home_zone, avoid_home_radius_miles, manual_override FROM staff")
    rows = cur.fetchall()
    colnames = [desc[0] for desc in cur.description]
    cur.close()
    conn.close()
    return jsonify([dict(zip(colnames, row)) for row in rows])

# Assign nearest staff member to each patient cluster
from math import sqrt
# --- Backfill office zones for multiple time ranges ---
@app.route("/api/backfill-office-zones", methods=["POST"])
def backfill_office_zones():
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

    for office_id, lat, lng in offices:
        for minutes in [15, 30, 45, 60]:
            payload = {
                "locations": [[lng, lat]],
                "range": [minutes * 60],
                "range_type": "time",
                "attributes": ["area", "reachfactor", "total_pop"]
            }
            try:
                response = requests.post(url, headers=headers, json=payload)
                if response.status_code != 200:
                    print(f"❌ ORS {minutes}min failed for office {office_id}")
                    continue
                data = response.json()
                if "features" in data and data["features"]:
                    geojson = json.dumps(data["features"][0])
                    column = f"geojson_zone_{minutes}"
                    cur.execute(
                        f"UPDATE offices SET {column} = %s WHERE id = %s",
                        (geojson, office_id)
                    )
            except Exception as e:
                print(f"❌ Exception for office {office_id}, {minutes}min: {e}")

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({"status": "backfill complete"})
@app.route("/api/backfill-missing-office-zones", methods=["POST"])
def backfill_missing_office_zones():
    ors_api_key = os.environ.get("ORS_API_KEY")
    if not ors_api_key:
        return jsonify({"error": "Missing ORS_API_KEY in environment"}), 500

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, latitude, longitude, geojson_zone_15, geojson_zone_30, geojson_zone_45, geojson_zone_60
        FROM offices
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)
    offices = cur.fetchall()

    headers = {
        "Authorization": ors_api_key,
        "Content-Type": "application/json"
    }
    url = "https://api.openrouteservice.org/v2/isochrones/driving-car"

    failed = []

    for office_id, lat, lng, z15, z30, z45, z60 in offices:
        for minutes, existing in zip([15, 30, 45, 60], [z15, z30, z45, z60]):
            if existing is not None:
                continue
            payload = {
                "locations": [[lng, lat]],
                "range": [minutes * 60],
                "range_type": "time",
                "attributes": ["area", "reachfactor", "total_pop"]
            }
            try:
                response = requests.post(url, headers=headers, json=payload)
                if response.status_code != 200:
                    print(f"❌ ORS {minutes}min failed for office {office_id}")
                    failed.append((office_id, minutes))
                    continue
                data = response.json()
                if "features" in data and data["features"]:
                    geojson = json.dumps(data["features"][0])
                    column = f"geojson_zone_{minutes}"
                    cur.execute(
                        f"UPDATE offices SET {column} = %s WHERE id = %s",
                        (geojson, office_id)
                    )
            except Exception as e:
                print(f"❌ Exception for office {office_id}, {minutes}min: {e}")
                failed.append((office_id, minutes))

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({"status": "missing backfill complete", "failures": failed})

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

    # --- Assign office zone based on polygon containment or distance ---
    assigned_office_id = None
    if lat and lng:
        point = Point(lng, lat)
        cur.execute("SELECT id, latitude, longitude, geojson_zone FROM offices WHERE geojson_zone IS NOT NULL")
        offices = cur.fetchall()

        office_zones = []
        for oid, olat, olng, geojson_text in offices:
            try:
                geojson = json.loads(geojson_text)
                polygon = shape(geojson['geometry'])
                office_zones.append({
                    "id": oid,
                    "center_lat": olat,
                    "center_lng": olng,
                    "polygon": polygon
                })
            except:
                continue

        matching = [o for o in office_zones if o["polygon"].contains(point)]

        if len(matching) == 1:
            assigned_office_id = matching[0]["id"]
        elif len(matching) > 1:
            distances = [(o["id"], geodesic((lat, lng), (o["center_lat"], o["center_lng"])).miles) for o in matching]
            assigned_office_id = min(distances, key=lambda x: x[1])[0]
        elif len(office_zones) > 0:
            distances = [(o["id"], geodesic((lat, lng), (o["center_lat"], o["center_lng"])).miles) for o in office_zones]
            assigned_office_id = min(distances, key=lambda x: x[1])[0]

    cur.execute("""
        INSERT INTO patients (name, address, type_of_care, status, latitude, longitude, cluster_id, zip_code, assigned_staff, assigned_office_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (name, address, type_of_care, status, lat, lng, cluster_id, zip_code, assigned_staff, assigned_office_id))
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
    avoid_home_radius_miles = data.get("avoid_home_radius_miles", 2.0)

    if not lat or not lng:
        lat, lng = geocode_address(home_base_address)

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO staff (name, home_base_address, max_capacity, latitude, longitude, zip_code, avoid_home_radius_miles)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (name, home_base_address, max_capacity, lat, lng, zip_code, avoid_home_radius_miles))
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


# --- Route for office zones by time range ---
@app.route("/api/office-zones-by-range/<int:minutes>")
def get_office_zones_by_range(minutes):
    valid_ranges = [15, 30, 45, 60]
    if minutes not in valid_ranges:
        return jsonify({"error": "Invalid time range"}), 400

    if minutes == 60:
        column_expr = "COALESCE(geojson_zone_60, geojson_zone)"
    else:
        column_expr = f"COALESCE(geojson_zone_{minutes}, geojson_zone)"

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(f"""
        SELECT id, name, {column_expr} AS geojson_value
        FROM offices
        WHERE {column_expr} IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    zones = []
    for office_id, name, geojson_text in rows:
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