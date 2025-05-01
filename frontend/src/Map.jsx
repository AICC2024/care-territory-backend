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

  const [staff, setStaff] = useState([]);
  const [clusterCenters, setClusterCenters] = useState({});

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    axios.get(`${baseUrl}/api/patients`)
      .then(res => setPatients(res.data))
      .catch(err => console.error("Failed to fetch patients:", err));
  }, []);

  // Fetch staff
  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    axios.get(`${baseUrl}/api/staff`)
      .then(res => setStaff(res.data))
      .catch(err => console.error("Failed to fetch staff:", err));
  }, []);

  // Compute cluster centers
  useEffect(() => {
    const centers = {};
    const grouped = patients.reduce((acc, p) => {
      const id = p.cluster_id;
      if (!acc[id]) acc[id] = [];
      acc[id].push([parseFloat(p.latitude), parseFloat(p.longitude)]);
      return acc;
    }, {});

    for (const id in grouped) {
      const points = grouped[id];
      const avgLat = points.reduce((sum, pt) => sum + pt[0], 0) / points.length;
      const avgLng = points.reduce((sum, pt) => sum + pt[1], 0) / points.length;
      centers[id] = { lat: avgLat, lng: avgLng };
    }
    setClusterCenters(centers);
  }, [patients]);

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
          {staff.map((s, index) => {
            const lat = parseFloat(s.latitude);
            const lng = parseFloat(s.longitude);
            let nearestCluster = 0;
            let minDistance = Infinity;

            for (const id in clusterCenters) {
              const center = clusterCenters[id];
              const d = Math.sqrt(
                Math.pow(center.lat - lat, 2) + Math.pow(center.lng - lng, 2)
              );
              if (d < minDistance) {
                minDistance = d;
                nearestCluster = parseInt(id);
              }
            }

            return (
              <div key={`staff-${index}`}>
                <Marker
                  position={{ lat, lng }}
                  title={`${s.name} (Capacity: ${s.max_capacity})`}
                  icon={{
                    url: "/icons/nurse.png",
                    scaledSize: new window.google.maps.Size(32, 32)
                  }}
                  onClick={() => {
                    const clusterPatients = patients.filter(p2 => {
                      const lat2 = parseFloat(p2.latitude);
                      const lng2 = parseFloat(p2.longitude);
                      return !isNaN(lat2) && !isNaN(lng2) && p2.cluster_id === nearestCluster;
                    });

                    const bounds = new window.google.maps.LatLngBounds();
                    clusterPatients.forEach(p => {
                      bounds.extend({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) });
                    });
                    bounds.extend({ lat, lng }); // Include staff location

                    const ne = bounds.getNorthEast();
                    const sw = bounds.getSouthWest();
                    const latDiff = Math.abs(ne.lat() - sw.lat());
                    const lngDiff = Math.abs(ne.lng() - sw.lng());

                    const isTinyCluster = latDiff < 0.001 && lngDiff < 0.001;

                    if (isTinyCluster) {
                      const avgLat = clusterPatients.reduce((sum, p) => sum + parseFloat(p.latitude), 0) / clusterPatients.length;
                      const avgLng = clusterPatients.reduce((sum, p) => sum + parseFloat(p.longitude), 0) / clusterPatients.length;
                      mapRef.current.panTo({ lat: avgLat, lng: avgLng });
                      mapRef.current.setZoom(17);
                    } else {
                      const padding = 100;
                      mapRef.current.fitBounds(bounds, padding);
                      // Smoother zoom for tight clusters: cap zoom to 17 if necessary
                      window.google.maps.event.addListenerOnce(mapRef.current, 'idle', () => {
                        const currentZoom = mapRef.current.getZoom();
                        if (currentZoom > 17) {
                          mapRef.current.setZoom(17);
                        }
                      });
                    }
                    setActiveMarker(`staff-${s.staff_id}`);
                  }}
                />
                {activeMarker === `staff-${s.staff_id}` && (
                  <InfoWindow
                    position={{ lat, lng }}
                    onCloseClick={() => setActiveMarker(null)}
                  >
                    <div>{s.name}</div>
                  </InfoWindow>
                )}
              </div>
            );
          })}
        </GoogleMap>
      </LoadScript>
    </>
  );
}

export default ClusterMap;