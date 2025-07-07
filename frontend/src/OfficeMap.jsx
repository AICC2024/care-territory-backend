import React from "react";
import stethoscopeIcon from "./assets/stethoscope-icon.png";
import serviceAreaGeojson from "./assets/hospice_service_area.js";
import teamTerritories from "./assets/team_territories.js";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { GoogleMap, LoadScript, Marker, InfoWindow, Polygon, OverlayView } from "@react-google-maps/api";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import chickadeeTerritory from "./assets/chickadee_territory.js";
import dragonflyTerritory from "./assets/dragonfly_territory.js";
import ladybugTerritory from "./assets/ladybug_territory.js";
import orangeTerritory from "./assets/orange_territory.js";
import purpleTerritory from "./assets/purple_territory.js";
import emeraldTerritory from "./assets/emerald_territory.js";
import blueTerritory from "./assets/blue_territory.js";

const mapContainerStyle = {
  width: "calc(100% - 100px)",
  marginLeft: "350px",
  height: "calc(100vh - 120px)",
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


function OfficeMap() {
  // Only keep officeZones, mapRef, mapReady, showOfficeZones, showLabels
  const mapRef = useRef(null);
  const [officeZones, setOfficeZones] = useState([]);
  const [showOfficeZones, setShowOfficeZones] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showServiceArea, setShowServiceArea] = useState(true);
  const [showTeams, setShowTeams] = useState(false);
  const [showTeamLabels, setShowTeamLabels] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [visibleZones, setVisibleZones] = useState({});
  const [mapCenter, setMapCenter] = useState({ lat: 39.95, lng: -76.73 });
  const [driveTime, setDriveTime] = useState("60");
  const [loadingZones, setLoadingZones] = useState(false);

  // Fetch office drive-time zones
  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    axios.get(`${baseUrl}/api/office-zones`)
      .then(res => {
        const uniqueZones = res.data.filter(
          (zone, index, self) =>
            index === self.findIndex(z => z.name === zone.name)
        );
        setOfficeZones(uniqueZones);
        const visibility = {};
        uniqueZones.forEach(z => visibility[z.id] = true);
        setVisibleZones(visibility);
      })
      .catch(err => console.error("Failed to fetch office zones:", err));
  }, []);

  // Re-generate drive time zones when driveTime changes
  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    const generateAndReload = async () => {
      setLoadingZones(true);
      try {
        const updatedZones = await Promise.all(
          officeZones.map(async zone => {
            const { data } = await axios.post(`${baseUrl}/api/generate-office-zone/${zone.id}?minutes=${driveTime}`);
            return {
              id: zone.id,
              name: zone.name,
              geojson: data.geojson
            };
          })
        );
        const uniqueZones = updatedZones.filter(
          (zone, index, self) =>
            index === self.findIndex(z => z.name === zone.name)
        );
        setOfficeZones(uniqueZones);
        const visibility = {};
        uniqueZones.forEach(z => visibility[z.id] = true);
        setVisibleZones(visibility);
      } catch (err) {
        console.error("Error updating office zones:", err);
      }
      setLoadingZones(false);
    };

    if (officeZones.length) {
      generateAndReload();
    }
  }, [driveTime]);

  // Unified effect: recenter map on service area or office zones as needed
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const bounds = new window.google.maps.LatLngBounds();

    if (showServiceArea) {
      serviceAreaGeojson.features.forEach(feature => {
        feature.geometry.coordinates.forEach(poly => {
          poly[0].forEach(([lng, lat]) => bounds.extend({ lat, lng }));
        });
      });
      mapRef.current.fitBounds(bounds);
      return;
    }

    if (showOfficeZones && officeZones.length) {
      officeZones.forEach(zone => {
        if (zone.geojson?.geometry?.coordinates?.[0]) {
          zone.geojson.geometry.coordinates[0].forEach(([lng, lat]) => bounds.extend({ lat, lng }));
        }
      });
      mapRef.current.fitBounds(bounds);
      window.google.maps.event.addListenerOnce(mapRef.current, "idle", () => {
        mapRef.current.setZoom(10);
      });
    }
  }, [showServiceArea, showOfficeZones, driveTime, mapReady]);

  return (
    <>
      <style>
      {`@keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }`}
      </style>
      {loadingZones && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(255, 255, 255, 0.6)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 999
        }}>
          <div style={{
            border: "4px solid #f3f3f3",
            borderTop: "4px solid #4caf50",
            borderRadius: "50%",
            width: "40px",
            height: "40px",
            animation: "spin 1s linear infinite"
          }} />
        </div>
      )}
      <div style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        zIndex: 10,
        backgroundColor: "#fff",
        padding: "16px",
        border: "1px solid #ccc",
        borderRadius: "8px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
        width: "285px"
      }}>
        {/* Map Layer Controls */}
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ marginBottom: "8px", fontWeight: "bold", fontSize: "14px" }}>
            🛠 Map Layer Controls
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {[
              {
                id: "toggle-office-zones",
                checked: showOfficeZones,
                onChange: () => setShowOfficeZones(!showOfficeZones),
                label: "Show Office Zones"
              },
              {
                id: "toggle-labels",
                checked: showLabels,
                onChange: () => setShowLabels(!showLabels),
                label: "Show Labels"
              },
              {
                id: "toggle-service-area",
                checked: showServiceArea,
                onChange: () => setShowServiceArea(!showServiceArea),
                label: "Show Service Boundary"
              }
            ].map(({ id, checked, onChange, label }) => (
              <div key={id} style={{ marginBottom: "2px", display: "flex", alignItems: "center", gap: "40px" }}>
                <div style={{ position: "relative", width: "60px", height: "20px" }}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={onChange}
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
                      backgroundColor: checked ? "#4caf50" : "#ccc",
                      transition: "background-color 0.2s"
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "2px",
                      left: checked ? "24px" : "2px",
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: "#fff",
                      transition: "left 0.2s"
                    }}
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    onChange();
                  }}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    borderRadius: "4px",
                    backgroundColor: "#eee",
                    border: "1px solid #aaa",
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "left"
                  }}
                >
                  {label}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{
        position: "absolute",
        top: "240px",
        left: "20px",
        zIndex: 10,
        backgroundColor: "#fff",
        padding: "10px",
        border: "1px solid #ccc",
        borderRadius: "8px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
        maxHeight: "60vh",
        overflowY: "auto"
      }}>
        <div style={{ fontWeight: "bold", marginBottom: "8px" }}>📍 Offices</div>
        {officeZones.map((zone) => (
          <div key={zone.id} style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "40px" }}>
            <div style={{ position: "relative", width: "60px", height: "20px" }}>
              <input
                type="checkbox"
                checked={visibleZones[zone.id]}
                onChange={() => setVisibleZones(prev => ({ ...prev, [zone.id]: !prev[zone.id] }))}
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
                  backgroundColor: visibleZones[zone.id] ? "#4caf50" : "#ccc",
                  transition: "background-color 0.2s"
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  left: visibleZones[zone.id] ? "24px" : "2px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  backgroundColor: "#fff",
                  transition: "left 0.2s"
                }}
              />
            </div>
            <button
              onClick={() => {
                if (zone.geojson?.geometry?.coordinates?.[0]) {
                  const coords = zone.geojson.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
                  const centerLat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
                  const centerLng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
                  mapRef.current?.panTo({ lat: centerLat, lng: centerLng });
                  mapRef.current?.setZoom(11);
                }
              }}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                borderRadius: "4px",
                backgroundColor: "#eee",
                border: "1px solid #aaa",
                cursor: "pointer",
                width: "100%",
                textAlign: "left"
              }}
            >
              {zone.name}
            </button>
          </div>
        ))}
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "6px" }}>🕒 Drive Time Radius</div>
          <div>
            {["15", "30", "45", "60"].map(min => (
              <div key={min} style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "40px" }}>
                <div style={{ position: "relative", width: "60px", height: "20px" }}>
                  <input
                    type="checkbox"
                    checked={driveTime === min}
                    onChange={() => setDriveTime(min)}
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
                  <div style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "20px",
                    backgroundColor: driveTime === min ? "#4caf50" : "#ccc",
                    transition: "background-color 0.2s"
                  }} />
                  <div style={{
                    position: "absolute",
                    top: "2px",
                    left: driveTime === min ? "24px" : "2px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    backgroundColor: "#fff",
                    transition: "left 0.2s"
                  }} />
                </div>
                <button
                  onClick={() => setDriveTime(min)}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    borderRadius: "4px",
                    backgroundColor: "#eee",
                    border: "1px solid #aaa",
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "left"
                  }}
                >
                  {min} Minutes
                </button>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "6px" }}>🧑‍🤝‍🧑 Team Visibility</div>
          <div style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "40px" }}>
            <div style={{ position: "relative", width: "60px", height: "20px" }}>
              <input
                type="checkbox"
                checked={showTeams}
                onChange={() => {
                  const newState = !showTeams;
                  setShowTeams(newState);
                  setShowTeamLabels(newState);
                  const updated = {
                    "team-chickadee": newState,
                    "team-dragonfly": newState,
                    "team-ladybug": newState,
                    "team-orange": newState,
                    "team-purple": newState,
                    "team-emerald": newState,
                    "team-blue": newState
                  };
                  setVisibleZones(prevZones => ({ ...prevZones, ...updated }));
                }}
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
              <div style={{
                width: "100%",
                height: "100%",
                borderRadius: "20px",
                backgroundColor: showTeams ? "#4caf50" : "#ccc",
                transition: "background-color 0.2s"
              }} />
              <div style={{
                position: "absolute",
                top: "2px",
                left: showTeams ? "24px" : "2px",
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                backgroundColor: "#fff",
                transition: "left 0.2s"
              }} />
            </div>
            <button
              onClick={() => {
                const newState = !showTeams;
                setShowTeams(newState);
                setShowTeamLabels(newState);
                const updated = {
                  "team-chickadee": newState,
                  "team-dragonfly": newState,
                  "team-ladybug": newState,
                  "team-orange": newState,
                  "team-purple": newState,
                  "team-emerald": newState,
                  "team-blue": newState
                };
                setVisibleZones(prevZones => ({ ...prevZones, ...updated }));
              }}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                borderRadius: "4px",
                backgroundColor: "#eee",
                border: "1px solid #aaa",
                cursor: "pointer",
                width: "100%",
                textAlign: "left"
              }}
            >
              Show Team Territories
            </button>
          </div>
          <div style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "40px" }}>
            <div style={{ position: "relative", width: "60px", height: "20px" }}>
              <input
                type="checkbox"
                checked={showTeamLabels}
                onChange={() => setShowTeamLabels(!showTeamLabels)}
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
              <div style={{
                width: "100%",
                height: "100%",
                borderRadius: "20px",
                backgroundColor: showTeamLabels ? "#4caf50" : "#ccc",
                transition: "background-color 0.2s"
              }} />
              <div style={{
                position: "absolute",
                top: "2px",
                left: showTeamLabels ? "24px" : "2px",
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                backgroundColor: "#fff",
                transition: "left 0.2s"
              }} />
            </div>
            <button
              onClick={() => setShowTeamLabels(!showTeamLabels)}
              style={{
                padding: "6px 10px",
                fontSize: "12px",
                borderRadius: "4px",
                backgroundColor: "#eee",
                border: "1px solid #aaa",
                cursor: "pointer",
                width: "100%",
                textAlign: "left"
              }}
            >
              Show Team Labels
            </button>
          </div>
          {[
            { id: "team-chickadee", label: "Chickadee" },
            { id: "team-dragonfly", label: "Dragonfly" },
            { id: "team-ladybug", label: "Ladybug" },
            { id: "team-orange", label: "Orange" },
            { id: "team-purple", label: "Purple" },
            { id: "team-emerald", label: "Emerald" },
            { id: "team-blue", label: "Blue" }
          ].map(({ id, label }) => (
            <div key={id} style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "40px" }}>
              <div style={{ position: "relative", width: "60px", height: "20px" }}>
                <input
                  type="checkbox"
                  checked={visibleZones[id] ?? true}
                  onChange={() => setVisibleZones(prev => ({ ...prev, [id]: !prev[id] }))}
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
                <div style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "20px",
                  backgroundColor: visibleZones[id] ? "#4caf50" : "#ccc",
                  transition: "background-color 0.2s"
                }} />
                <div style={{
                  position: "absolute",
                  top: "2px",
                  left: visibleZones[id] ? "24px" : "2px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  backgroundColor: "#fff",
                  transition: "left 0.2s"
                }} />
              </div>
              <button
                onClick={() => setVisibleZones(prev => ({ ...prev, [id]: !prev[id] }))}
                style={{
                  padding: "6px 10px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  backgroundColor: "#eee",
                  border: "1px solid #aaa",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left"
                }}
              >
                {label}
              </button>
            </div>
          ))}
        </div>
      </div>
      <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={mapCenter}
          onLoad={(map) => {
            mapRef.current = map;
            setMapReady(true);
          }}
        >
          {/* --- Office drive-time polygons --- */}
          {officeZones.map((zone, index) => {
            const coords = zone.geojson.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
            let centerLat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
            let centerLng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;

            // Offset to avoid overlap for Carolyn's House and Dauphin County Office
            if (zone.name === "Carolyn's House") {
              centerLat += 0.03;
            } else if (zone.name === "Dauphin County Office") {
              centerLat -= 0.03;
            }

            return (
              <React.Fragment key={`office-zone-${zone.id}`}>
                {visibleZones[zone.id] && showOfficeZones && (
                  <Polygon
                    paths={coords}
                    options={{
                      fillColor: clusterColors[index % Object.keys(clusterColors).length] || "gray",
                      fillOpacity: 0.25,
                      strokeColor: "#444",
                      strokeOpacity: 0.7,
                      strokeWeight: 2
                    }}
                  />
                )}
                {visibleZones[zone.id] && showLabels && (
                  <OverlayView
                    position={{ lat: centerLat, lng: centerLng }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "4px 8px",
                      whiteSpace: "nowrap",
                      backgroundColor: "black",
                      borderRadius: "6px",
                      fontSize: "13px",
                      fontWeight: "bold",
                      color: "#fff",
                      textShadow: "1px 1px 2px rgba(0,0,0,0.6)",
                      fontFamily: "'Segoe UI', Arial, sans-serif",
                      zIndex: 9999
                    }}>
                      <img src={stethoscopeIcon} style={{ width: 24, height: 24, marginRight: 6 }} />
                      {zone.name}
                    </div>
                  </OverlayView>
                )}
              </React.Fragment>
            );
          })}
          {/* --- Hospice Service Area Boundary --- */}
          {showServiceArea &&
            serviceAreaGeojson.features.map((feature, idx) =>
              feature.geometry.coordinates.map((poly, pIdx) => {
                const coords = poly[0].map(([lng, lat]) => ({ lat, lng }));
                return (
                  <Polygon
                    key={`service-boundary-${idx}-${pIdx}`}
                    paths={coords}
                    options={{
                      strokeColor: "#000",
                      strokeOpacity: 0.9,
                      strokeWeight: 3,
                      fillOpacity: 0
                    }}
                  />
                );
              })
            )}
          {/* --- Team Territories Polygons --- */}
          {/* --- Chickadee Territory Polygon --- */}
          {visibleZones["team-chickadee"] && chickadeeTerritory?.features?.length > 0 && (
            <>
              <Polygon
                paths={chickadeeTerritory.features[0].geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{
                  strokeColor: "#000",
                  strokeOpacity: 1,
                  strokeWeight: 2,
                  fillColor: chickadeeTerritory.features[0].properties.color,
                  fillOpacity: 0.35
                }}
              />
              {showTeamLabels && (
                <OverlayView
                  position={{
                    lat: chickadeeTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[1], 0) / chickadeeTerritory.features[0].geometry.coordinates[0].length,
                    lng: chickadeeTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[0], 0) / chickadeeTerritory.features[0].geometry.coordinates[0].length
                  }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <div style={{
                    padding: "4px 8px",
                    backgroundColor: "#000",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "13px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap"
                  }}>
                    Chickadee
                  </div>
                </OverlayView>
              )}
            </>
          )}
          {/* --- Dragonfly Territory Polygon --- */}
          {visibleZones["team-dragonfly"] && dragonflyTerritory?.features?.length > 0 && (
            <>
              <Polygon
                paths={dragonflyTerritory.features[0].geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{
                  strokeColor: "#000",
                  strokeOpacity: 1,
                  strokeWeight: 2,
                  fillColor: dragonflyTerritory.features[0].properties.color,
                  fillOpacity: 0.35
                }}
              />
              {showTeamLabels && (
                <OverlayView
                  position={{
                    lat: dragonflyTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[1], 0) / dragonflyTerritory.features[0].geometry.coordinates[0].length,
                    lng: dragonflyTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[0], 0) / dragonflyTerritory.features[0].geometry.coordinates[0].length
                  }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <div style={{
                    padding: "4px 8px",
                    backgroundColor: "#000",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "13px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap"
                  }}>
                    Dragonfly
                  </div>
                </OverlayView>
              )}
            </>
          )}
          {/* --- Ladybug Territory Polygon --- */}
          {visibleZones["team-ladybug"] && ladybugTerritory?.features?.length > 0 && (
            <>
              <Polygon
                paths={ladybugTerritory.features[0].geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{
                  strokeColor: "#000",
                  strokeOpacity: 1,
                  strokeWeight: 2,
                  fillColor: ladybugTerritory.features[0].properties.color,
                  fillOpacity: 0.35
                }}
              />
              {showTeamLabels && (
                <OverlayView
                  position={{
                    lat: ladybugTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[1], 0) / ladybugTerritory.features[0].geometry.coordinates[0].length,
                    lng: ladybugTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[0], 0) / ladybugTerritory.features[0].geometry.coordinates[0].length
                  }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <div style={{
                    padding: "4px 8px",
                    backgroundColor: "#000",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "13px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap"
                  }}>
                    Ladybug
                  </div>
                </OverlayView>
              )}
            </>
          )}
          {/* --- Orange Territory Polygon --- */}
          {visibleZones["team-orange"] && orangeTerritory?.features?.length > 0 && (
            <>
              <Polygon
                paths={orangeTerritory.features[0].geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{
                  strokeColor: "#000",
                  strokeOpacity: 1,
                  strokeWeight: 2,
                  fillColor: orangeTerritory.features[0].properties.color,
                  fillOpacity: 0.35
                }}
              />
              {showTeamLabels && (
                <OverlayView
                  position={{
                    lat: orangeTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[1], 0) / orangeTerritory.features[0].geometry.coordinates[0].length,
                    lng: orangeTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[0], 0) / orangeTerritory.features[0].geometry.coordinates[0].length
                  }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <div style={{
                    padding: "4px 8px",
                    backgroundColor: "#000",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "13px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap"
                  }}>
                    Orange
                  </div>
                </OverlayView>
              )}
            </>
          )}
          {/* --- Purple Territory Polygon --- */}
          {visibleZones["team-purple"] && purpleTerritory?.features?.length > 0 && (
            <>
              <Polygon
                paths={purpleTerritory.features[0].geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{
                  strokeColor: "#000",
                  strokeOpacity: 1,
                  strokeWeight: 2,
                  fillColor: purpleTerritory.features[0].properties.color,
                  fillOpacity: 0.35
                }}
              />
              {showTeamLabels && (
                <OverlayView
                  position={{
                    lat: purpleTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[1], 0) / purpleTerritory.features[0].geometry.coordinates[0].length,
                    lng: purpleTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[0], 0) / purpleTerritory.features[0].geometry.coordinates[0].length
                  }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <div style={{
                    padding: "4px 8px",
                    backgroundColor: "#000",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "13px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap"
                  }}>
                    Purple
                  </div>
                </OverlayView>
              )}
            </>
          )}
          {/* --- Emerald Territory Polygon --- */}
          {visibleZones["team-emerald"] && emeraldTerritory?.features?.length > 0 && (
            <>
              {emeraldTerritory.features[0].geometry.type === "MultiPolygon" &&
                emeraldTerritory.features[0].geometry.coordinates.map((poly, i) => (
                  <Polygon
                    key={`emerald-multi-${i}`}
                    paths={poly[0]
                      .filter(([lng, lat]) => typeof lng === "number" && typeof lat === "number")
                      .map(([lng, lat]) => ({ lat, lng }))}
                    options={{
                      strokeColor: "#000",
                      strokeOpacity: 1,
                      strokeWeight: 2,
                      fillColor: emeraldTerritory.features[0].properties.color,
                      fillOpacity: 0.35
                    }}
                  />
                ))}
              {emeraldTerritory.features[0].geometry.type === "Polygon" && (
                <Polygon
                  paths={emeraldTerritory.features[0].geometry.coordinates[0]
                    .filter(([lng, lat]) => typeof lng === "number" && typeof lat === "number")
                    .map(([lng, lat]) => ({ lat, lng }))}
                  options={{
                    strokeColor: "#000",
                    strokeOpacity: 1,
                    strokeWeight: 2,
                    fillColor: emeraldTerritory.features[0].properties.color,
                    fillOpacity: 0.35
                  }}
                />
              )}
              {/* Emerald territory label */}
              {showTeamLabels && (
                <OverlayView
                  position={() => {
                    // If MultiPolygon, use first polygon for label center
                    let coords;
                    if (emeraldTerritory.features[0].geometry.type === "MultiPolygon") {
                      coords = emeraldTerritory.features[0].geometry.coordinates[0][0];
                    } else {
                      coords = emeraldTerritory.features[0].geometry.coordinates[0];
                    }
                    return {
                      lat: coords.reduce((sum, pt) => sum + pt[1], 0) / coords.length,
                      lng: coords.reduce((sum, pt) => sum + pt[0], 0) / coords.length
                    };
                  }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <div style={{
                    padding: "4px 8px",
                    backgroundColor: "#000",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "13px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap"
                  }}>
                    Emerald
                  </div>
                </OverlayView>
              )}
            </>
          )}
          {/* --- Blue Territory Polygon --- */}
          {visibleZones["team-blue"] && blueTerritory?.features?.length > 0 && (
            <>
              <Polygon
                paths={blueTerritory.features[0].geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }))}
                options={{
                  strokeColor: "#000",
                  strokeOpacity: 1,
                  strokeWeight: 2,
                  fillColor: blueTerritory.features[0].properties.color,
                  fillOpacity: 0.35
                }}
              />
              {showTeamLabels && (
                <OverlayView
                  position={{
                    lat: blueTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[1], 0) / blueTerritory.features[0].geometry.coordinates[0].length,
                    lng: blueTerritory.features[0].geometry.coordinates[0].reduce((sum, pt) => sum + pt[0], 0) / blueTerritory.features[0].geometry.coordinates[0].length
                  }}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                >
                  <div style={{
                    padding: "4px 8px",
                    backgroundColor: "#000",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "13px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap"
                  }}>
                    Blue
                  </div>
                </OverlayView>
              )}
            </>
          )}
        </GoogleMap>
      </LoadScript>
    </>
  );
}


export default OfficeMap;