import { useEffect, useState } from "react";
import axios from "axios";

function App() {
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);

  useEffect(() => {
    axios.get("http://localhost:5050/api/patients")
      .then(res => setPatients(res.data))
      .catch(err => console.error("API fetch error:", err));

    axios.get("http://localhost:5050/api/staff")
      .then(res => setStaff(res.data))
      .catch(err => console.error("Staff API fetch error:", err));
  }, []);

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Patient List</h1>
      <ul>
        {patients.map((p) => (
          <li key={p.patient_id}>
            {p.name} – {p.address} ({p.type_of_care})
          </li>
        ))}
      </ul>
      <h2 style={{ marginTop: "2rem" }}>Staff List</h2>
      <ul>
        {staff.map((s) => (
          <li key={s.staff_id}>
            {s.name} – {s.home_base_address} (Capacity: {s.max_capacity})
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
