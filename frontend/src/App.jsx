import { useEffect, useState } from "react";
import axios from "axios";
import OfficeMap from "./OfficeMap";

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
    <div style={{ width: "100vw", height: "100vh" }}>
      <OfficeMap patients={patients} staff={staff} />
    </div>
  );
}

export default App;
