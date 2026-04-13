import React from "react";
import stethoscopeIcon from "./assets/stethoscope-icon.png";
import personIcon from "./assets/person.png";
import yorkIcon from "./assets/york_staff.png";
import dauphinIcon from "./assets/dauphin_staff.png";
import schuylkillIcon from "./assets/schuylkill_staff.png";
import lancasterIcon from "./assets/lancaster_staff.png";
import serviceAreaGeojson from "./assets/hospice_service_area.js";
import teamTerritories from "./assets/team_territories.js";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { GoogleMap, LoadScript, Marker, InfoWindow, Polygon, OverlayView } from "@react-google-maps/api";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { getApiBaseUrl } from "./apiBase";
import chickadeeTerritory from "./assets/chickadee_territory.js";
import dragonflyTerritory from "./assets/dragonfly_territory.js";
import ladybugTerritory from "./assets/ladybug_territory.js";
import orangeTerritory from "./assets/orange_territory.js";
import purpleTerritory from "./assets/purple_territory.js";
import emeraldTerritory from "./assets/emerald_territory.js";
import blueTerritory from "./assets/blue_territory.js";

const mapContainerStyle = {
  width: "100%",
  height: "100vh",
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
  // Only keep officeZones, mapRef, mapReady, showOfficeZones, map legend drag state
  const mapRef = useRef(null);
  const [officeZones, setOfficeZones] = useState([]);
  const [showOfficeZones, setShowOfficeZones] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showServiceArea, setShowServiceArea] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  const [showTeamLabels, setShowTeamLabels] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [visibleZones, setVisibleZones] = useState({});
  const [mapCenter, setMapCenter] = useState({ lat: 39.95, lng: -76.73 });
  const [driveTime, setDriveTime] = useState("60");
  const [loadingZones, setLoadingZones] = useState(false);
  // --- Patients and Staff state ---
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [showPatients, setShowPatients] = useState(true);
  const [showStaff, setShowStaff] = useState(true);
  // --- Legend Drag State ---
  const [legendPosition, setLegendPosition] = useState({ x: 325, y: 20 });
  // --- Sidebar Collapse State ---
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("legendPosition");
    if (saved) {
      setLegendPosition(JSON.parse(saved));
    }
  }, []);
  const legendRef = useRef(null);

  // Drag handlers for legend
  const handleLegendMouseDown = (e) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const { x, y } = legendPosition;
    const handleMouseMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setLegendPosition({ x: x + dx, y: y + dy });
      localStorage.setItem("legendPosition", JSON.stringify({ x: x + dx, y: y + dy }));
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // --- Sidebar Drag State ---
  const [sidebarPosition, setSidebarPosition] = useState({ x: window.innerWidth - 320, y: 100 });
  useEffect(() => {
    const saved = localStorage.getItem("sidebarPosition");
    if (saved) {
      setSidebarPosition(JSON.parse(saved));
    }
  }, []);
  const sidebarRef = useRef(null);
  const handleSidebarMouseDown = (e) => {
    // Only drag if mouse is on header area (top 30px or so)
    // Optionally, you can check event target here if you want finer control
    const startX = e.clientX;
    const startY = e.clientY;
    const { x, y } = sidebarPosition;
    const handleMouseMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newPos = { x: x + dx, y: y + dy };
      setSidebarPosition(newPos);
      localStorage.setItem("sidebarPosition", JSON.stringify(newPos));
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Fetch office drive-time zones by driveTime (always use /office-zones-by-range/${driveTime}, no special logic for 60)
  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    setLoadingZones(true);
    axios.get(`${baseUrl}/api/office-zones-by-range/${driveTime}`)
      .then(res => {        const uniqueZones = res.data.filter(
          (zone, index, self) =>
            index === self.findIndex(z => z.name === zone.name)
        );
        setOfficeZones(uniqueZones);
        const visibility = {};
        uniqueZones.forEach(z => visibility[z.id] = true);
        setVisibleZones(visibility);
      })
      .catch(err => console.error("Failed to fetch office zones:", err))
      .finally(() => setLoadingZones(false));
  }, [driveTime]);

  // --- Fetch patients and staff data ---
  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    axios.get(`${baseUrl}/api/patients`).then(res => setPatients(res.data));
    axios.get(`${baseUrl}/api/staff`).then(res => setStaff(res.data));
  }, []);

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
  }, [showServiceArea, showOfficeZones, driveTime, mapReady, officeZones]);

  const renderToggleRow = ({ id, label, checked, onChange }) => (
    <label
      key={id}
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "8px 10px",
        borderRadius: "10px",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        backgroundColor: "rgba(255, 255, 255, 0.75)",
        cursor: "pointer"
      }}
    >
      <span style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>{label}</span>
      <div style={{ position: "relative", width: "48px", height: "28px", flexShrink: 0 }}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          style={{
            opacity: 0,
            width: "48px",
            height: "28px",
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
            borderRadius: "999px",
            backgroundColor: checked ? "#22c55e" : "#cbd5e1",
            boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.10)",
            transition: "all 0.2s ease"
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "3px",
            left: checked ? "23px" : "3px",
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            backgroundColor: "#fff",
            boxShadow: "0 2px 6px rgba(15, 23, 42, 0.22)",
            transition: "all 0.2s ease"
          }}
        />
      </div>
    </label>
  );

  return (
    <>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .label-background {
          background-color: rgba(255, 255, 255, 0.85);
          padding: 1px 4px;
          border-radius: 3px;
          text-shadow: 0 0 2px #fff;
        }
      `}</style>
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
        top: "18px",
        left: "18px",
        zIndex: 10,
        backgroundColor: "rgba(255, 255, 255, 0.9)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        padding: "14px",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        borderRadius: "14px",
        boxShadow: "0 14px 30px rgba(15, 23, 42, 0.18)",
        width: "320px"
      }}>
      {/* Floating Office Legend */}
      {/* Floating Office Legend, now draggable */}
      <div
        ref={legendRef}
        onMouseDown={handleLegendMouseDown}
        style={{
          position: "absolute",
          top: `${legendPosition.y}px`,
          left: `${legendPosition.x}px`,
          backgroundColor: "rgba(15, 23, 42, 0.9)",
          color: "#f8fafc",
          padding: "10px 12px",
          border: "1px solid rgba(148, 163, 184, 0.45)",
          borderRadius: "10px",
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.32)",
          fontSize: "13px",
          zIndex: 10,
          cursor: "move"
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "6px" }}>🗺 Office Legend</div>
        <div><span style={{ color: "#e91e63" }}>●</span> Dauphin County</div>
        <div><span style={{ color: "#3f51b5" }}>●</span> York County</div>
        <div><span style={{ color: "#009688" }}>●</span> Lancaster County</div>
        <div><span style={{ color: "#ff9800" }}>●</span> Schuylkill County</div>
      </div>
        {/* Map Layer Controls */}
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ marginBottom: "8px", fontWeight: "bold", fontSize: "14px" }}>
            🛠 Map Layer Controls
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
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
              },
              {
                id: "toggle-patients",
                checked: showPatients,
                onChange: () => setShowPatients(!showPatients),
                label: "Show Patients"
              },
              {
                id: "toggle-staff",
                checked: showStaff,
                onChange: () => setShowStaff(!showStaff),
                label: "Show Staff"
              }
            ].map(renderToggleRow)}
          </div>
        </div>
      </div>
      <div style={{
        position: "absolute",
        top: "390px",
        left: "18px",
        zIndex: 10,
        backgroundColor: "rgba(255, 255, 255, 0.9)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        padding: "12px",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        borderRadius: "14px",
        boxShadow: "0 14px 30px rgba(15, 23, 42, 0.18)",
        maxHeight: "58vh",
        overflowY: "auto"
      }}>
        <div style={{ fontWeight: "bold", marginBottom: "8px" }}>📍 Offices</div>
        {officeZones
          .filter(zone => ![3, 7].includes(zone.id))
          .map((zone) => (
          <div key={zone.id} style={{ marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor={`toggle-office-${zone.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flex: 1,
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                backgroundColor: "rgba(255, 255, 255, 0.75)",
                cursor: "pointer"
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>{zone.name}</span>
              <div style={{ position: "relative", width: "48px", height: "28px", flexShrink: 0 }}>
                <input
                  id={`toggle-office-${zone.id}`}
                  type="checkbox"
                  checked={visibleZones[zone.id]}
                  onChange={() => setVisibleZones(prev => ({ ...prev, [zone.id]: !prev[zone.id] }))}
                  style={{
                    opacity: 0,
                    width: "48px",
                    height: "28px",
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
                    borderRadius: "999px",
                    backgroundColor: visibleZones[zone.id] ? "#22c55e" : "#cbd5e1",
                    boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.10)",
                    transition: "all 0.2s ease"
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "3px",
                    left: visibleZones[zone.id] ? "23px" : "3px",
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    backgroundColor: "#fff",
                    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.22)",
                    transition: "all 0.2s ease"
                  }}
                />
              </div>
            </label>
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
                padding: "8px 10px",
                fontSize: "11px",
                fontWeight: 700,
                borderRadius: "10px",
                backgroundColor: "#0f172a",
                color: "#f8fafc",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                cursor: "pointer",
                boxShadow: "0 4px 10px rgba(15, 23, 42, 0.22)"
              }}
            >
              Focus
            </button>
          </div>
        ))}
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>🕒 Drive Time Radius</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
            {["15", "30", "45", "60"].map(min => {
              const active = driveTime === min;
              return (
                <button
                  key={min}
                  onClick={() => setDriveTime(min)}
                  style={{
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontWeight: 700,
                    borderRadius: "10px",
                    backgroundColor: active ? "#22c55e" : "rgba(255, 255, 255, 0.92)",
                    color: active ? "#ffffff" : "#0f172a",
                    border: active ? "1px solid #16a34a" : "1px solid rgba(148, 163, 184, 0.45)",
                    boxShadow: active
                      ? "0 6px 14px rgba(34, 197, 94, 0.28)"
                      : "0 4px 10px rgba(15, 23, 42, 0.08)",
                    cursor: "pointer"
                  }}
                >
                  {min} min
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>🧑‍🤝‍🧑 Team Visibility</div>
          {renderToggleRow({
            id: "toggle-show-teams",
            label: "Show Team Territories",
            checked: showTeams,
            onChange: () => {
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
            }
          })}
          <div style={{ marginTop: "6px" }}>
            {renderToggleRow({
              id: "toggle-show-team-labels",
              label: "Show Team Labels",
              checked: showTeamLabels,
              onChange: () => setShowTeamLabels(!showTeamLabels)
            })}
          </div>
          <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {[
              { id: "team-chickadee", label: "Chickadee" },
              { id: "team-dragonfly", label: "Dragonfly" },
              { id: "team-ladybug", label: "Ladybug" },
              { id: "team-orange", label: "Orange" },
              { id: "team-purple", label: "Purple" },
              { id: "team-emerald", label: "Emerald" },
              { id: "team-blue", label: "Blue" }
            ].map(({ id, label }) =>
              renderToggleRow({
                id: `toggle-${id}`,
                label,
                checked: visibleZones[id] ?? true,
                onChange: () => setVisibleZones(prev => ({ ...prev, [id]: !prev[id] }))
              })
            )}
          </div>
        </div>
      </div>
      {/* Staff Assignment Sidebar (Draggable, Collapsible) */}
      <div
        ref={sidebarRef}
        onMouseDown={handleSidebarMouseDown}
        style={{
          position: "absolute",
          left: `${sidebarPosition.x}px`,
          top: `${sidebarPosition.y}px`,
          width: "340px",
          maxHeight: "85vh",
          overflowY: "auto",
          backgroundColor: "rgba(255, 255, 255, 0.94)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          padding: "14px",
          border: "1px solid rgba(148, 163, 184, 0.35)",
          borderRadius: "14px",
          boxShadow: "0 14px 30px rgba(15, 23, 42, 0.2)",
          zIndex: 20,
          cursor: "move",
          paddingBottom: "24px"
        }}
      >
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            fontSize: "16px",
            fontWeight: "bold",
            backgroundColor: "#0f172a",
            color: "#f8fafc",
            border: "1px solid rgba(148, 163, 184, 0.4)",
            borderRadius: "8px",
            padding: "2px 8px",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(15,23,42,0.25)"
          }}
          title={sidebarCollapsed ? "Expand" : "Collapse"}
        >
          {sidebarCollapsed ? "▸" : "▾"}
        </button>
        <div style={{ fontWeight: "bold", marginBottom: "8px", fontSize: "16px" }}>
          🧑‍⚕️ Staff Assignments
        </div>
        <div style={{
          overflowY: "auto",
          maxHeight: sidebarCollapsed ? "0px" : "400px",
          transition: "max-height 0.3s ease-in-out",
          overflow: sidebarCollapsed ? "hidden" : "auto",
          paddingRight: "4px"
        }}>
          {staff.map(s => {
            const assignedPatients = patients.filter(p => p.assigned_staff_id === s.staff_id);
            return (
              <div key={s.staff_id} style={{ marginBottom: "12px" }}>
                <div style={{ fontWeight: "bold" }}>{s.name}</div>
                <label style={{ fontSize: "13px", color: "#333", display: "block" }}>
                  <input
                    type="checkbox"
                    checked={!!s.avoid_home_zone}
                    onChange={async (e) => {
                      const baseUrl = getApiBaseUrl();
                      const newValue = e.target.checked;
                      try {
                        await axios.patch(`${baseUrl}/api/staff/${s.staff_id}/avoid-home-zone`, {
                          avoid_home_zone: newValue
                        });

                        const [staffRes, patientsRes] = await Promise.all([
                          axios.get(`${baseUrl}/api/staff`),
                          axios.get(`${baseUrl}/api/patients`)
                        ]);
                        setStaff(staffRes.data);
                        setPatients(patientsRes.data);
                      } catch (err) {
                        toast.error("Failed to update avoid home zone");
                      }
                    }}
                    style={{ marginRight: "6px" }}
                  />
                  Avoid Home Zone
                </label>
                <div style={{ marginTop: "4px", fontSize: "12px", color: "#333", display: "flex", alignItems: "center", gap: "6px" }}>
                  Radius (mi)
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={s.avoid_home_radius_miles ?? 2}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setStaff(prev =>
                        prev.map(st =>
                          st.staff_id === s.staff_id
                            ? { ...st, avoid_home_radius_miles: raw === "" ? "" : Number(raw) }
                            : st
                        )
                      );
                    }}
                    onBlur={async (e) => {
                      const baseUrl = getApiBaseUrl();
                      const parsed = Number(e.target.value);
                      const safeRadius = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;

                      setStaff(prev =>
                        prev.map(st =>
                          st.staff_id === s.staff_id
                            ? { ...st, avoid_home_radius_miles: safeRadius }
                            : st
                        )
                      );

                      try {
                        await axios.patch(`${baseUrl}/api/staff/${s.staff_id}/avoid-home-zone`, {
                          avoid_home_radius_miles: safeRadius
                        });

                        const [staffRes, patientsRes] = await Promise.all([
                          axios.get(`${baseUrl}/api/staff`),
                          axios.get(`${baseUrl}/api/patients`)
                        ]);
                        setStaff(staffRes.data);
                        setPatients(patientsRes.data);
                      } catch (err) {
                        toast.error("Failed to update avoid-home radius");
                      }
                    }}
                    style={{ width: "64px", padding: "2px 6px", fontSize: "12px" }}
                  />
                </div>
                <div style={{ fontSize: "13px", color: "#666", marginTop: "4px" }}>
                  {assignedPatients.length} patient{assignedPatients.length !== 1 ? "s" : ""}
                </div>
                <ul style={{ marginTop: "4px", paddingLeft: "16px", fontSize: "13px" }}>
                  {assignedPatients.map(p => (
                    <li key={p.patient_id}>{p.name}</li>
                  ))}
                </ul>
              </div>
            );
          })}
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
          {officeZones
            .filter(zone => ![3, 7].includes(zone.id))
            .map((zone, index) => {
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
                      fillOpacity: 0.15,
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
                      padding: "6px 10px",
                      whiteSpace: "nowrap",
                      backgroundColor: "rgba(255, 255, 255, 0.96)",
                      borderRadius: "8px",
                      border: "1px solid rgba(17, 24, 39, 0.35)",
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "#111827",
                      textShadow: "none",
                      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
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
        {/* --- Patients Markers --- */}
        {/*
          Office color mapping for patient pins:
            1: "#e91e63" // Dauphin
            2: "#3f51b5" // York
            3: "#4caf50" // Lancaster
            4: "#ff9800" // Schuylkill
            6: "#009688" // Teal for Office 6
        */}
        {(() => {
          const officeColors = {
            1: "#3f51b5", // York County
            4: "#e91e63", // Dauphin County
            5: "#ff9800", // Schuylkill County
            6: "#009688"  // Lancaster County
          };
          const officeTitles = {
            1: "York County",
            4: "Dauphin County",
            5: "Schuylkill County",
            6: "Lancaster County"
          };
          // Add mapping from staff_id to staff name
          const staffById = {};
          staff.forEach(s => {
            staffById[s.staff_id] = s.name;
          });
          return (
            showPatients &&
            patients.map(p => {              console.log("Rendering patient:", p.name, "assigned to office", p.assigned_office_id);
              const assignedNurse = staffById[p.assigned_staff_id] || "Unassigned";
              return (
                <Marker
                  key={`patient-${p.patient_id}`}
                  position={{ lat: p.latitude, lng: p.longitude }}
                  icon={{
                    path: window.google && window.google.maps ? window.google.maps.SymbolPath.CIRCLE : 0,
                    scale: 7,
                    fillColor: officeColors[parseInt(p.assigned_office_id)] || "#6b7280",
                    fillOpacity: 0.8,
                    strokeColor: "#fff",
                    strokeWeight: 2
                  }}
                  title={`Patient Name: ${p.name}\nService Type: ${p.type_of_care}\nAssigned Office: ${officeTitles[parseInt(p.assigned_office_id)] || "Unassigned"}\nAssigned Nurse: ${assignedNurse}`}
                />
              );
            })
          );
        })()}

        {/* --- Staff Markers --- */}
        {(() => {
          // Compute patients per staff_id (names)
          const patientsByStaffId = {};
          patients.forEach(p => {
            if (p.assigned_staff_id && p.name) {
              const sid = parseInt(p.assigned_staff_id);
              if (!patientsByStaffId[sid]) patientsByStaffId[sid] = [];
              patientsByStaffId[sid].push(p.name);
            }
          });
          const officeColors = {
            1: "#3f51b5", // York County
            4: "#e91e63", // Dauphin County
            5: "#ff9800", // Schuylkill County
            6: "#009688"  // Lancaster County
          };
          const officeTitles = {
            1: "York County",
            4: "Dauphin County",
            5: "Schuylkill County",
            6: "Lancaster County"
          };
          const staffIconsByOffice = {
            1: yorkIcon,
            4: dauphinIcon,
            5: schuylkillIcon,
            6: lancasterIcon
          };
          return (
            showStaff && staff.map(s => {
              const officeIdNum = parseInt(s.assigned_office_id);
              const assignedOffice = officeTitles[officeIdNum] || "Unassigned";
              const patientList = patientsByStaffId[s.staff_id] || [];
              return (
                <Marker
                  key={`staff-${s.staff_id}`}
                  position={{ lat: s.latitude, lng: s.longitude }}
                  icon={{
                    url: staffIconsByOffice[officeIdNum] || personIcon,
                    scaledSize: new window.google.maps.Size(30, 30),
                    anchor: new window.google.maps.Point(15, 15)
                  }}
                  title={`Staff: ${s.name}\nAssigned Office: ${assignedOffice}\nAssigned Patients (${patientList.length}):\n${patientList.join(", ")}`}
                />
              );
            })
          );
        })()}
        </GoogleMap>
      </LoadScript>
    </>
  );
}

export default OfficeMap;