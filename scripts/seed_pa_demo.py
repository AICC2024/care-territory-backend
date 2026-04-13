#!/usr/bin/env python3
import json
import os
from typing import Dict, List, Tuple

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "care_territory")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
ORS_API_KEY = os.environ.get("ORS_API_KEY", "")

OFFICES = [
    (1, "York County Office", "York, PA", 39.9626, -76.7277),
    (4, "Dauphin County Office", "Harrisburg, PA", 40.2732, -76.8867),
    (5, "Schuylkill County Office", "Pottsville, PA", 40.6856, -76.1955),
    (6, "Lancaster County Office", "Lancaster, PA", 40.0379, -76.3055),
]

STAFF = [
    (1, "Nurse York", "235 St. Charles Way, Suite 250, York, PA 17402", 10, 39.9305, -76.6911, "17402", 1, 2.0),
    (2, "Nurse Dauphin", "4075 Linglestown Road, Harrisburg, PA 17112", 10, 40.3342, -76.7944, "17112", 4, 2.0),
    (3, "Nurse Lancaster", "685 Good Drive, Lancaster, PA 17601", 10, 40.0628, -76.3499, "17601", 6, 2.0),
    (4, "Nurse Schuylkill", "302 N Centre St, Pottsville, PA 17901", 8, 40.6856, -76.1955, "17901", 5, 2.0),
]

PATIENTS = [
    (1, "Eleanor Price", "1500 Mt Rose Ave, York, PA 17403", "Hospice", "Active", 39.9502, -76.7098, 1, "17403", 1, 1),
    (2, "Caleb Turner", "320 Loucks Rd, York, PA 17404", "Home Health", "Active", 39.9793, -76.7600, 1, "17404", 1, 1),
    (3, "Maria Santos", "225 Pauline Dr, York, PA 17402", "Hospice", "Active", 39.9623, -76.6671, 1, "17402", 1, 1),
    (4, "Harold Kim", "5090 Jonestown Rd, Harrisburg, PA 17112", "Home Health", "Active", 40.3174, -76.7868, 2, "17112", 4, 2),
    (5, "Beatrice Allen", "2100 Linglestown Rd, Harrisburg, PA 17110", "Hospice", "Active", 40.3190, -76.8607, 2, "17110", 4, 2),
    (6, "Isaac Monroe", "303 N Progress Ave, Harrisburg, PA 17109", "Home Health", "Active", 40.2878, -76.8448, 2, "17109", 4, 2),
    (7, "Gloria Bennett", "800 New Holland Ave, Lancaster, PA 17602", "Hospice", "Active", 40.0513, -76.2866, 3, "17602", 6, 3),
    (8, "Noah Greene", "1300 Columbia Ave, Lancaster, PA 17603", "Home Health", "Active", 40.0370, -76.3374, 3, "17603", 6, 3),
    (9, "Patricia Lowe", "1650 Manheim Pike, Lancaster, PA 17601", "Hospice", "Active", 40.0661, -76.3197, 3, "17601", 6, 3),
    (10, "Samuel Ortiz", "500 Terry Rich Blvd, St Clair, PA 17970", "Home Health", "Active", 40.7209, -76.1924, 4, "17970", 5, 4),
    (11, "Janet Brooks", "1000 S Claude A Lord Blvd, Pottsville, PA 17901", "Hospice", "Active", 40.6674, -76.1866, 4, "17901", 5, 4),
    (12, "Rafael Diaz", "1 S Centre St, Pottsville, PA 17901", "Home Health", "Active", 40.6870, -76.1952, 4, "17901", 5, 4),
]


def connect():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


def ensure_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS staff (
            staff_id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            home_base_address TEXT,
            max_capacity INTEGER,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            zip_code TEXT,
            assigned_office_id INTEGER,
            avoid_home_zone BOOLEAN DEFAULT FALSE,
            avoid_home_radius_miles DOUBLE PRECISION DEFAULT 2.0,
            manual_override BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS patients (
            patient_id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT,
            type_of_care TEXT,
            status TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            cluster_id INTEGER,
            zip_code TEXT,
            assigned_staff TEXT,
            assigned_office_id INTEGER,
            assigned_staff_id INTEGER
        );

        CREATE TABLE IF NOT EXISTS offices (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            geojson_zone TEXT,
            geojson_zone_15 TEXT,
            geojson_zone_30 TEXT,
            geojson_zone_45 TEXT,
            geojson_zone_60 TEXT
        );
        """
    )


def seed_data(cur):
    cur.execute("DELETE FROM patients;")
    cur.execute("DELETE FROM staff;")

    for office in OFFICES:
        cur.execute(
            """
            INSERT INTO offices (id, name, address, latitude, longitude)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                address = EXCLUDED.address,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude
            """,
            office,
        )

    for row in STAFF:
        cur.execute(
            """
            INSERT INTO staff (
              staff_id, name, home_base_address, max_capacity, latitude, longitude, zip_code,
              assigned_office_id, avoid_home_radius_miles, avoid_home_zone, manual_override
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, FALSE)
            """,
            row,
        )

    for row in PATIENTS:
        patient_id, name, address, toc, status, lat, lng, cluster_id, zip_code, office_id, staff_id = row
        cur.execute(
            """
            INSERT INTO patients (
              patient_id, name, address, type_of_care, status, latitude, longitude,
              cluster_id, zip_code, assigned_staff, assigned_office_id, assigned_staff_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s)
            """,
            (patient_id, name, address, toc, status, lat, lng, cluster_id, zip_code, office_id, staff_id),
        )

    cur.execute(
        """
        UPDATE patients p
        SET assigned_staff = s.name
        FROM staff s
        WHERE p.assigned_staff_id = s.staff_id
        """
    )

    cur.execute("SELECT setval('staff_staff_id_seq', COALESCE((SELECT MAX(staff_id) FROM staff), 1));")
    cur.execute("SELECT setval('patients_patient_id_seq', COALESCE((SELECT MAX(patient_id) FROM patients), 1));")
    cur.execute("SELECT setval('offices_id_seq', COALESCE((SELECT MAX(id) FROM offices), 1));")


def fetch_ors_polygon(lat: float, lng: float, minutes: int) -> Dict:
    url = "https://api.openrouteservice.org/v2/isochrones/driving-car"
    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "locations": [[lng, lat]],
        "range": [minutes * 60],
        "range_type": "time",
        "attributes": ["area", "reachfactor", "total_pop"],
    }

    response = requests.post(url, headers=headers, json=payload, timeout=45)
    response.raise_for_status()
    data = response.json()
    if not data.get("features"):
        raise RuntimeError(f"ORS returned no features for {minutes} minutes")
    return data["features"][0]


def seed_zones(cur):
    if not ORS_API_KEY:
        print("⚠️ ORS_API_KEY missing, skipped drive-time polygon generation")
        return

    for office_id, office_name, _, lat, lng in OFFICES:
        print(f"🗺 Generating zones for {office_name} (office_id={office_id})")
        for minutes in (15, 30, 45, 60):
            try:
                feature = fetch_ors_polygon(lat, lng, minutes)
                geojson = json.dumps(feature)
                if minutes == 60:
                    cur.execute("UPDATE offices SET geojson_zone = %s, geojson_zone_60 = %s WHERE id = %s", (geojson, geojson, office_id))
                else:
                    cur.execute(f"UPDATE offices SET geojson_zone_{minutes} = %s WHERE id = %s", (geojson, office_id))
            except Exception as e:
                print(f"  ❌ {minutes} min failed: {e}")


def main():
    print(f"Using DB: {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}")
    conn = connect()
    try:
        conn.autocommit = False
        cur = conn.cursor()
        ensure_schema(cur)
        seed_data(cur)
        seed_zones(cur)
        conn.commit()
        cur.close()
        print("✅ PA demo import complete")
        print("   - Offices: 4")
        print("   - Staff: 4")
        print("   - Patients: 12")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
