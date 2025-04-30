import pandas as pd
from sklearn.cluster import KMeans

# Load patient data with coordinates
df = pd.read_csv("data/patients.csv")

# Drop rows without coordinates
df = df.dropna(subset=["latitude", "longitude"])

# Prepare the coordinate array for clustering
coordinates = df[["latitude", "longitude"]].values

# Define number of clusters (adjust as needed)
k = 4
kmeans = KMeans(n_clusters=k, random_state=42)
df["cluster_id"] = kmeans.fit_predict(coordinates)

# Save updated CSV
df.to_csv("data/patients.csv", index=False)

# Print results
print(df[["name", "address", "latitude", "longitude", "cluster_id"]])
print(f"\n🧠 Assigned {k} clusters and saved to patients.csv.")