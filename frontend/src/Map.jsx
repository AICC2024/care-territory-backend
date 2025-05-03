import React from "react";
import { GoogleMap, LoadScript, Marker, InfoWindow, Polygon } from "@react-google-maps/api";
import { useEffect, useState, useRef } from "react";
import { Delaunay } from "d3-delaunay";
import axios from "axios";
import * as turf from "@turf/turf";

const mapContainerStyle = {
  width: "100%",
  maxWidth: "1200px",
  margin: "0 auto",
  height: "calc(100vh - 120px)",
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

function convexHull(points) {
  points = points.sort((a, b) => a.lng - b.lng || a.lat - b.lat);

  const cross = (o, a, b) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function jitterPoint(point, amount = 0.00005) {
  const { latitude, longitude } = point;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    isNaN(latitude) ||
    isNaN(longitude)
  ) {
    console.warn("Invalid input to jitterPoint:", point);
  }
  return {
    lat: latitude + (Math.random() - 0.5) * amount,
    lng: longitude + (Math.random() - 0.5) * amount,
  };
}

function ClusterMap() {
  const [patients, setPatients] = useState([]);
  const [activeMarker, setActiveMarker] = useState(null);
  const mapRef = useRef(null);

  const [staff, setStaff] = useState([]);
  const [clusterCenters, setClusterCenters] = useState({});
  const [assignments, setAssignments] = useState({});
  const [staffZones, setStaffZones] = useState([]);

  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  // Patient load state for staff
  const [staffLoads, setStaffLoads] = useState({});
  // Track when map is ready
  const [mapReady, setMapReady] = useState(false);
  // Prevent premature patient pin rendering
  const [readyToRenderPatients, setReadyToRenderPatients] = useState(false);
  // Prevent repeated rebalancing
  const [hasBeenRebalanced, setHasBeenRebalanced] = useState(false);
  // Show rebalance prompt state
  const [showRebalancePrompt, setShowRebalancePrompt] = useState(false);
  // Determine readiness for rendering patients (prevents premature pin rendering)
  useEffect(() => {
    if (staff.length && patients.length && staffZones.length && mapReady) {
      setReadyToRenderPatients(true);
    }
  }, [staff, patients, staffZones, mapReady]);
  // Calculate patient loads and overcapacity for each staff
  useEffect(() => {
    if (!patients.length || !staff.length) return;

    const counts = {};
    patients.forEach(p => {
      if (!p.assigned_staff) return;
      counts[p.assigned_staff] = (counts[p.assigned_staff] || 0) + 1;
    });

    const loadSummary = {};
    staff.forEach(s => {
      const name = s.name;
      const max = parseInt(s.max_capacity) || 10;
      const current = counts[name] || 0;
      loadSummary[name] = {
        current,
        max,
        overCapacity: current > max
      };
    });

    console.log("📊 Staff Loads:", loadSummary);
    setStaffLoads(loadSummary);
  }, [patients, staff]);

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

  // Fetch assignments
  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    axios.get(`${baseUrl}/api/assignments`)
      .then(res => setAssignments(res.data))
      .catch(err => console.error("Failed to fetch assignments:", err));
  }, []);

  useEffect(() => {
    if (!mapRef.current || staff.length < 2) return;

    const features = staff
      .map(s => {
        const lat = parseFloat(s.latitude);
        const lng = parseFloat(s.longitude);
        if (isNaN(lat) || isNaN(lng)) return null;
        return turf.point([lng, lat], { id: s.name });
      })
      .filter(Boolean);

    console.log("Valid Turf staff features:", features);

    // Dynamically calculate bounding box from staff coordinates
    const lats = staff.map(s => parseFloat(s.latitude)).filter(lat => !isNaN(lat));
    const lngs = staff.map(s => parseFloat(s.longitude)).filter(lng => !isNaN(lng));

    const minLat = Math.min(...lats) - 0.5;
    const maxLat = Math.max(...lats) + 0.5;
    const minLng = Math.min(...lngs) - 0.5;
    const maxLng = Math.max(...lngs) + 0.5;

    const bbox = [minLng, minLat, maxLng, maxLat];

    const fc = turf.featureCollection(features);
    const polygons = turf.voronoi(fc, { bbox });

    console.log("Turf Voronoi polygons:", polygons);

    if (!polygons || !polygons.features) return;

    const zones = polygons.features.map((feature, index) => ({
      id: feature.properties.id || `zone-${index}`,
      path: feature.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }))
    }));

    console.log("Final staff zones for map:", zones);

    setStaffZones(zones);

    // Patient assignment has moved to a separate useEffect below
  }, [staff.length]);

  // Assign patients to staff zones after staffZones, staff, and patients are all ready
  useEffect(() => {
    if (!staffZones.length || !patients.length || !staff.length) return;

    // Only assign if patient.assigned_staff is missing or "Unassigned"
    const updated = patients.map(p => {
      if (p.assigned_staff && p.assigned_staff !== "Unassigned") return p;
      const pt = turf.point([parseFloat(p.longitude), parseFloat(p.latitude)]);
      // Ensure polygon is closed by repeating the first point at the end
      const zone = staffZones.find(z => {
        const polygon = turf.polygon([[...z.path.map(coord => [coord.lng, coord.lat]), [z.path[0].lng, z.path[0].lat]]]);
        return turf.booleanPointInPolygon(pt, polygon);
      });
      return {
        ...p,
        assigned_staff: zone?.id ?? "Unassigned"
      };
    });

    // Prevent infinite render loop: only update if any assignment actually changes
    const changed = updated.some((p, i) =>
      p.assigned_staff !== patients[i]?.assigned_staff
    );

    if (changed) {
      console.log("🔄 Assigned patients to staffZones:", updated);
      setPatients(updated);
    }
  }, [staffZones, staff, patients]);


  useEffect(() => {
    if (!mapRef.current || !staffZones.length || !mapReady) return;

    const bounds = new window.google.maps.LatLngBounds();

    staffZones.forEach(zone => {
      zone.path.forEach(coord => {
        bounds.extend(coord);
      });
    });

    mapRef.current.fitBounds(bounds);
  }, [staffZones, mapReady]);

  // --- Rebalance prompt trigger effect ---
  useEffect(() => {
    if (
      !staff.length ||
      !patients.length ||
      !staffZones.length ||
      !Object.keys(staffLoads).length ||
      hasBeenRebalanced
    ) return;

    const anyOver = Object.values(staffLoads).some(load => load.overCapacity);
    if (anyOver) {
      setShowRebalancePrompt(true);
    }
  }, [staffLoads, staff, patients, staffZones, hasBeenRebalanced]);

  // --- Handle Rebalancing Logic ---
  const handleRebalance = () => {
    if (
      !staff.length ||
      !patients.length ||
      !staffZones.length ||
      !Object.keys(staffLoads).length ||
      hasBeenRebalanced
    ) {
      setShowRebalancePrompt(false);
      return;
    }

    const loadByName = { ...staffLoads };
    const maxCapByName = Object.fromEntries(staff.map(s => [s.name, parseInt(s.max_capacity) || 10]));

    // Build staff location map
    const staffCoords = staff.reduce((acc, s) => {
      const lat = parseFloat(s.latitude);
      const lng = parseFloat(s.longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        acc[s.name] = [lat, lng];
      }
      return acc;
    }, {});

    // Make a shallow copy to mutate only those who get reassigned
    let reassignedPatients = [...patients];
    let changed = false;

    // For each staff, check if they are overloaded
    staff.forEach(s => {
      const staffName = s.name;
      if (!loadByName[staffName]) return;
      const isOverloaded = loadByName[staffName].overCapacity;
      if (!isOverloaded) return;

      const overflowCount = loadByName[staffName].current - maxCapByName[staffName];
      const staffLatLng = staffCoords[staffName];

      // Get all patients assigned to this staff, with their distance from staff
      const reassignmentCandidates = patients
        .filter(p2 => p2.assigned_staff === staffName)
        .map(p2 => ({
          ...p2,
          dist: Math.hypot(staffLatLng[0] - p2.latitude, staffLatLng[1] - p2.longitude)
        }))
        .sort((a, b) => b.dist - a.dist) // farthest first
        .slice(0, overflowCount); // only as many as overflow

      reassignmentCandidates.forEach(patient => {
        // Find nearest available staff (not self, not at capacity)
        let bestStaff = staffName;
        let minDist = Infinity;
        for (const [name, coords] of Object.entries(staffCoords)) {
          if (name === staffName) continue;
          const load = loadByName[name];
          const maxCap = maxCapByName[name];
          if (!load || load.current >= maxCap) continue;
          const dist = Math.hypot(coords[0] - patient.latitude, coords[1] - patient.longitude);
          if (dist < minDist) {
            bestStaff = name;
            minDist = dist;
          }
        }
        if (bestStaff !== staffName) {
          // Update only if changed
          const idx = reassignedPatients.findIndex(p => p.patient_id === patient.patient_id);
          if (idx !== -1 && reassignedPatients[idx].assigned_staff !== bestStaff) {
            console.log(`🔄 Reassigned ${patient.name} from ${staffName} ➝ ${bestStaff}`);
            reassignedPatients[idx] = { ...reassignedPatients[idx], assigned_staff: bestStaff };
            changed = true;
            // Also update loadByName for next iterations
            loadByName[staffName].current -= 1;
            loadByName[bestStaff].current += 1;
          }
        }
      });
    });

    if (changed) {
      setPatients(reassignedPatients);
      // Persist rebalanced assignments to backend
      const baseUrl = import.meta.env.VITE_API_BASE_URL;
      axios.post(`${baseUrl}/api/save-assignments`, reassignedPatients)
        .then(() => {
          console.log("✅ Rebalanced assignments saved to backend");
        })
        .catch(err => {
          console.error("❌ Failed to save rebalanced assignments:", err);
        });
      // Immediately update staffLoads to reflect new assignments
      setStaffLoads(prev => {
        const counts = {};
        reassignedPatients.forEach(p => {
          if (!p.assigned_staff) return;
          counts[p.assigned_staff] = (counts[p.assigned_staff] || 0) + 1;
        });

        const loadSummary = {};
        staff.forEach(s => {
          const name = s.name;
          const max = parseInt(s.max_capacity) || 10;
          const current = counts[name] || 0;
          loadSummary[name] = {
            current,
            max,
            overCapacity: current > max
          };
        });

        console.log("📊 Staff Loads (rebalance):", loadSummary);
        return loadSummary;
      });
      setHasBeenRebalanced(true);
    }
    setShowRebalancePrompt(false);
  };

  return (
    <>
      {showRebalancePrompt && (
        <div style={{ padding: "1rem", backgroundColor: "#fff3cd", border: "1px solid #ffeeba", borderRadius: "6px", marginBottom: "1rem" }}>
          <strong>⚠️ Rebalance Needed:</strong> One or more staff are over capacity. Rebalance patients now?
          <div style={{ marginTop: "0.5rem" }}>
            <button onClick={handleRebalance} style={{ marginRight: "10px" }}>Yes, Rebalance</button>
            <button onClick={() => setShowRebalancePrompt(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ marginBottom: "1rem" }}>
        <strong>Staff Legend:</strong>
        {staff.map((s, index) => (
          <span
            key={s.name}
            style={{
              marginLeft: "1rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              lineHeight: "1.4"
            }}
          >
            <span
              style={{
                color: staffLoads[s.name]?.overCapacity ? "red" : "green",
                fontWeight: "bold"
              }}
            >
              {staffLoads[s.name]?.overCapacity ? "⚠️" : "✔️"}
            </span>
            <span style={{ color: clusterColors[index] || "gray", fontWeight: "bold" }}>
              {s.name}
            </span>
            <span style={{ fontWeight: "normal" }}>
              ({staffLoads[s.name]?.current || 0}/{staffLoads[s.name]?.max || 0})
            </span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: "bold",
                padding: "2px 4px",
                borderRadius: "4px",
                backgroundColor: staffLoads[s.name]?.overCapacity ? "#fdd" : "#dfd",
                color: staffLoads[s.name]?.overCapacity ? "darkred" : "green"
              }}
            >
              {staffLoads[s.name]?.overCapacity ? "Over" : "OK"}
            </span>
          </span>
        ))}
      </div>
      <div
        style={{
          display: "inline-block",
          padding: "10px 20px",
          border: "1px solid #ccc",
          borderRadius: "6px",
          backgroundColor: "#f9f9f9",
          marginBottom: "1rem",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)"
        }}
      >
        <div style={{ marginBottom: "8px", fontWeight: "bold", fontSize: "14px" }}>
          🛠 Map Layer Controls
        </div>
        <div style={{ display: "flex", gap: "30px", alignItems: "center" }}>
          <label
            htmlFor="toggle-boundaries"
            style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: "bold" }}
          >
            Show Boundaries
            <div style={{ position: "relative", width: "40px", height: "20px" }}>
              <input
                id="toggle-boundaries"
                name="toggle-boundaries"
                type="checkbox"
                checked={showBoundaries}
                onChange={() => setShowBoundaries(!showBoundaries)}
                style={{
                  opacity: 0,
                  width: "40px",
                  height: "20px",
                  margin: 0,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  zIndex: 2,
                  cursor: "pointer"
                }}
              />
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "20px",
                  backgroundColor: showBoundaries ? "#4caf50" : "#ccc",
                  transition: "background-color 0.2s"
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  left: showBoundaries ? "22px" : "2px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  backgroundColor: "#fff",
                  transition: "left 0.2s"
                }}
              />
            </div>
          </label>

          <label
            htmlFor="toggle-labels"
            style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: "bold" }}
          >
            Show Labels
            <div style={{ position: "relative", width: "40px", height: "20px" }}>
              <input
                id="toggle-labels"
                name="toggle-labels"
                type="checkbox"
                checked={showLabels}
                onChange={() => setShowLabels(!showLabels)}
                style={{
                  opacity: 0,
                  width: "40px",
                  height: "20px",
                  margin: 0,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  zIndex: 2,
                  cursor: "pointer"
                }}
              />
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "20px",
                  backgroundColor: showLabels ? "#4caf50" : "#ccc",
                  transition: "background-color 0.2s"
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  left: showLabels ? "22px" : "2px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  backgroundColor: "#fff",
                  transition: "left 0.2s"
                }}
              />
            </div>
          </label>
          <button
            onClick={() => {
              if (!mapRef.current || !staffZones.length) return;
              const bounds = new window.google.maps.LatLngBounds();
              staffZones.forEach(zone => {
                zone.path.forEach(coord => bounds.extend(coord));
              });
              mapRef.current.fitBounds(bounds);
            }}
            style={{
              padding: "6px 10px",
              border: "1px solid #ccc",
              borderRadius: "4px",
              backgroundColor: "#f1f1f1",
              color: "#333",
              fontSize: "13px",
              cursor: "pointer",
              height: "32px"
            }}
          >
            🔄 Reset View
          </button>
        </div>
      </div>
      <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={center}
          zoom={10}
          onLoad={(map) => {
            mapRef.current = map;
            setMapReady(true);
          }}
        >
          {/* --- Voronoi territory polygons for staff --- */}
          {mapReady && staffZones.length > 0 && staffZones.map((zone, index) => (
            <React.Fragment key={zone.id || `zone-${index}`}>
              {showBoundaries && (
                <Polygon
                  paths={zone.path}
                  options={{
                    fillColor: clusterColors[index] || "gray",
                    fillOpacity: 0.1,
                    strokeColor: "black",
                    strokeOpacity: 0.3,
                    strokeWeight: 1
                  }}
                />
              )}
              {showLabels && (
                <InfoWindow
                  position={{
                    lat: zone.path.reduce((sum, c) => sum + c.lat, 0) / zone.path.length,
                    lng: zone.path.reduce((sum, c) => sum + c.lng, 0) / zone.path.length
                  }}
                  options={{ disableAutoPan: true }}
                >
                  <div style={{
                    fontWeight: "bold",
                    color: clusterColors[index] || "gray",
                    fontSize: "10px",
                    backgroundColor: "rgba(255, 255, 255, 0.5)",
                    padding: "1px 4px",
                    borderRadius: "2px",
                    border: "1px solid #ccc",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.2)"
                  }}>
                    <div>{zone.id}</div>
                    <div>Capacity: {staffLoads[zone.id]?.current || 0}/{staffLoads[zone.id]?.max || 0}</div>
                    <div>Status: {staffLoads[zone.id]?.overCapacity ? "Overloaded" : "OK"}</div>
                  </div>
                </InfoWindow>
              )}
            </React.Fragment>
          ))}
          {readyToRenderPatients && patients.map((p, index) => {
            const lat = parseFloat(p.latitude);
            const lng = parseFloat(p.longitude);
            if (isNaN(lat) || isNaN(lng)) return null;
            // Case-insensitive staff assignment lookup, and ensure staff is loaded
            let staffIndex = -1;
            if (staff.length) {
              staffIndex = staff.findIndex(
                s =>
                  s.name?.toLowerCase() === p.assigned_staff?.toLowerCase()
              );
              if (staffIndex === -1) {
                console.warn("⚠️ No matching staff for patient", p.name, "Assigned to:", p.assigned_staff);
              }
            }
            const pinColor = clusterColors[staffIndex] || "gray";
            return (
              <div key={index}>
                <Marker
                  position={{ lat, lng }}
                  title={`${p.name} (${p.type_of_care}) — Assigned to ${p.assigned_staff || "Unassigned"}`}
                  onClick={() => {
                    const clusterPatients = patients.filter(
                      p2 => p2.assigned_staff?.toLowerCase() === p.assigned_staff?.toLowerCase()
                    );
                    const bounds = new window.google.maps.LatLngBounds();
                    clusterPatients.forEach(p3 => {
                      bounds.extend({ lat: parseFloat(p3.latitude), lng: parseFloat(p3.longitude) });
                    });
                    mapRef.current.fitBounds(bounds);
                    window.google.maps.event.addListenerOnce(mapRef.current, 'idle', () => {
                      const zoom = mapRef.current.getZoom();
                      if (zoom > 19) {
                        mapRef.current.setZoom(19);
                      }
                    });
                    setActiveMarker(p.patient_id);
                  }}
                  icon={{
                    url: `http://maps.google.com/mapfiles/ms/icons/${pinColor}-dot.png`
                  }}
                />
                {activeMarker === p.patient_id && (
                  <InfoWindow
                    position={{ lat, lng }}
                    onCloseClick={() => setActiveMarker(null)}
                    options={{ disableAutoPan: true }}
                  >
                    <div>
                      <strong>{p.name}</strong><br />
                      Type: {p.type_of_care}<br />
                      Assigned to: <em>{p.assigned_staff || "Unassigned"}</em>
                    </div>
                  </InfoWindow>
                )}
              </div>
            );
          })}
          {staff.map((s, index) => {
            const lat = parseFloat(s.latitude);
            const lng = parseFloat(s.longitude);
            if (isNaN(lat) || isNaN(lng)) return null;

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
                    const clusterPatients = patients.filter(p => p.assigned_staff === s.name);
                    const coordsUsed = [];

                    clusterPatients.forEach(p => {
                      const lat2 = parseFloat(p.latitude);
                      const lng2 = parseFloat(p.longitude);
                      if (!isNaN(lat2) && !isNaN(lng2)) {
                        coordsUsed.push([lat2, lng2]);
                      }
                    });

                    if (!isNaN(lat) && !isNaN(lng)) {
                      coordsUsed.push([lat, lng]);
                    }

                    console.log(`Zooming to ${s.name} with manual bounds from coords:`, coordsUsed);

                    const avgLat = coordsUsed.reduce((sum, c) => sum + c[0], 0) / coordsUsed.length;
                    const avgLng = coordsUsed.reduce((sum, c) => sum + c[1], 0) / coordsUsed.length;

                    mapRef.current.panTo({ lat: avgLat, lng: avgLng });
                    mapRef.current.setZoom(19);

                    setActiveMarker(`staff-${s.staff_id}`);
                  }}
                />
                {activeMarker === `staff-${s.staff_id}` && (
                  <InfoWindow
                    position={{ lat, lng }}
                    onCloseClick={() => setActiveMarker(null)}
                  >
                    <div>
                      <strong>{s.name}</strong><br />
                      Capacity: {staffLoads[s.name]?.current || 0} / {staffLoads[s.name]?.max || 0}<br />
                      Status: {staffLoads[s.name]?.overCapacity ? "Overloaded" : "OK"}
                    </div>
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