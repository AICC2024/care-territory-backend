from flask import Flask, jsonify
from flask_cors import CORS
import pandas as pd
import os

app = Flask(__name__)
CORS(app)

@app.route("/api/patients")
def get_patients():
    df = pd.read_csv("data/patients.csv")
    columns = ["patient_id", "name", "address", "type_of_care", "status", "latitude", "longitude", "cluster_id"]
    df = df[[col for col in columns if col in df.columns]]
    return jsonify(df.to_dict(orient="records"))

@app.route("/api/staff")
def get_staff():
    df = pd.read_csv("data/staff.csv")
    return jsonify(df.to_dict(orient="records"))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port)