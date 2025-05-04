import { useEffect, useState } from "react";
import axios from "axios";
import ClusterMap from "./Map";

function App() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [openSections, setOpenSections] = useState({});
  const [allExpanded, setAllExpanded] = useState(false);

  useEffect(() => {
    axios.get(`${baseUrl}/api/patients`)
      .then(res => {
        console.log("Patients API response:", res.data);
        setPatients(res.data);
      })
      .catch(err => console.error("API fetch error:", err));

    axios.get(`${baseUrl}/api/staff`)
      .then(res => setStaff(res.data))
      .catch(err => console.error("Staff API fetch error:", err));
  }, []);

  const toggleSection = (name) => {
    setOpenSections(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const expandAll = () => {
    const expanded = {};
    staff.forEach(n => {
      expanded[n.name] = true;
    });
    setOpenSections(expanded);
  };

  const collapseAll = () => {
    setOpenSections({});
  };

  return (
    <div style={{ padding: "2rem" }}>
      <style>
        {`
          summary[open] span:first-child {
            transform: rotate(90deg);
          }
        `}
      </style>
      <h1>🧭 Territory Assignment Dashboard</h1>
      <h2 style={{ marginTop: "2rem" }}>
        Patient List (Grouped by Staff)
        <button onClick={() => {
          if (allExpanded) {
            collapseAll();
          } else {
            expandAll();
          }
          setAllExpanded(!allExpanded);
        }} style={{ marginLeft: "1rem" }}>
          {allExpanded ? "▶ Collapse All" : "▼ Expand All"}
        </button>
      </h2>
      {Array.isArray(patients) && staff.length > 0 && staff.map((nurse) => {
        const assignedPatients = patients.filter(p => p.assigned_staff === nurse.name);
        if (assignedPatients.length === 0) return null;

        return (
          <details
            key={nurse.name}
            open={!!openSections[nurse.name]}
          >
            <summary
              onClick={() => toggleSection(nurse.name)}
              style={{
                cursor: "pointer",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span>
                {openSections[nurse.name] ? "▼" : "▶"}
              </span>
              {nurse.name} ({assignedPatients.length} Patients)
            </summary>
            <ul
              style={{
                marginTop: "0.5rem",
                marginLeft: "1rem",
                maxHeight: "500px",
                overflow: "hidden",
                transition: "all 0.3s ease-in-out"
              }}
            >
              {assignedPatients.map(p => (
                <li key={p.patient_id}>
                  {p.name} – {p.address} ({p.type_of_care})
                </li>
              ))}
            </ul>
          </details>
        );
      })}
      <h2 style={{ marginTop: "2rem" }}>Patient Map (Zone View)</h2>
      <ClusterMap patients={patients} setPatients={setPatients} />
    </div>
  );
}

export default App;
