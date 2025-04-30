from flask import Flask, jsonify
from flask_cors import CORS
import pandas as pd

app = Flask(__name__)
CORS(app)

@app.route("/api/patients")
def get_patients():
    df = pd.read_csv("data/patients.csv")
    return jsonify(df.to_dict(orient="records"))

@app.route("/api/staff")
def get_staff():
    df = pd.read_csv("data/staff.csv")
    return jsonify(df.to_dict(orient="records"))

if __name__ == "__main__":
    app.run(debug=True)