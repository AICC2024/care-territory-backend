from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import os
import psycopg2
from dotenv import load_dotenv

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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port)