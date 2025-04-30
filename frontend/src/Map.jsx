import { GoogleMap, LoadScript, Marker, InfoWindow } from "@react-google-maps/api";
import { useEffect, useState, useRef } from "react";
import axios from "axios";

const mapContainerStyle = {
  width: "100%",
  height: "500px",
};

const center = {
  lat: 36.1627, // Default: Nashville
  lng: -86.7816,
};

const clusterColors = {
  0: "red",
  1: "blue",
  2: "green",
  3: "purple",
  4: "orange",
  5: "teal"
};

function ClusterMap() {
  const [patients, setPatients] = useState([]);
  const [activeMarker, setActiveMarker] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    axios.get(`${baseUrl}/api/patients`)
      .then(res => setPatients(res.data))
      .catch(err => console.error("Failed to fetch patients:", err));
  }, []);

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <strong>Cluster Legend:</strong>
        <span style={{ marginLeft: "1rem", color: "red" }}>⬤ Cluster 0</span>
        <span style={{ marginLeft: "1rem", color: "blue" }}>⬤ Cluster 1</span>
        <span style={{ marginLeft: "1rem", color: "green" }}>⬤ Cluster 2</span>
        <span style={{ marginLeft: "1rem", color: "purple" }}>⬤ Cluster 3</span>
      </div>
      <button onClick={() => { mapRef.current?.setZoom(10); mapRef.current?.panTo(center); }} style={{ marginBottom: "1rem" }}>
        🔄 Reset View
      </button>
      <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={center}
          zoom={10}
          onLoad={(map) => (mapRef.current = map)}
        >
          {patients.map((p, index) => (
            <div key={index}>
              <Marker
                position={{ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) }}
                title={`${p.name} (${p.type_of_care})`}
                onClick={() => {
                  const clusterPatients = patients.filter(p2 => p2.cluster_id === p.cluster_id);
                  const bounds = new window.google.maps.LatLngBounds();
                  clusterPatients.forEach(p3 => {
                    bounds.extend({ lat: parseFloat(p3.latitude), lng: parseFloat(p3.longitude) });
                  });
                  mapRef.current.fitBounds(bounds);
                  setActiveMarker(p.patient_id);
                }}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: 6,
                  fillColor: clusterColors[p.cluster_id] || "gray",
                  fillOpacity: 1,
                  strokeWeight: 1,
                }}
              />
              {activeMarker === p.patient_id && (
                <InfoWindow
                  position={{ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) }}
                  onCloseClick={() => setActiveMarker(null)}
                >
                  <div>{p.name}</div>
                </InfoWindow>
              )}
            </div>
          ))}
        </GoogleMap>
      </LoadScript>
    </>
  );
}

export default ClusterMap;