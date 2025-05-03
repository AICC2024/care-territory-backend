import { useEffect, useState } from "react";
import axios from "axios";
import ClusterMap from "./Map";

function App() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);

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

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Patient List</h1>
      <ul>
        {Array.isArray(patients) && patients.map((p) => {
          const lat = parseFloat(p.latitude);
          const lng = parseFloat(p.longitude);
          const highlight = isNaN(lat) || isNaN(lng);

          return (
            <li
              key={p.patient_id}
              style={{
                color: highlight ? "orange" : "inherit",
                fontWeight: highlight ? "bold" : "normal"
              }}
            >
              {p.name} (Cluster {p.cluster_id}) – {p.address} ({p.type_of_care})
            </li>
          );
        })}
      </ul>
      <h2 style={{ marginTop: "2rem" }}>Staff List</h2>
      <ul>
        {staff.map((s) => (
          <li key={s.staff_id}>
            {s.name} – {s.home_base_address} (Capacity: {s.max_capacity})
          </li>
        ))}
      </ul>
      <h2 style={{ marginTop: "2rem" }}>Patient Map (Cluster View)</h2>
      <ClusterMap />
    </div>
  );
}

export default App;
