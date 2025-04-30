# Care Territory App

This is a monorepo for the Care Territory Optimization project, supporting both **home health** and **hospice** services. It includes:

- A **Flask backend** for serving patient and staff data from CSV files
- A **React (Vite) frontend** for displaying and interacting with that data

---

## 📁 Project Structure

```
care-territory-backend/
├── backend/       ← Flask API with patient & staff routes
│   └── data/      ← CSV files for patients and staff
├── frontend/      ← Vite + React app
```

---

## 🚀 Getting Started

### 🖥 Backend (Flask)

1. Navigate to the backend folder:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

By default, Flask runs at:  
**http://localhost:5050**

---

### 💻 Frontend (Vite + React)

1. Navigate to the frontend:
```bash
cd frontend
npm install
npm run dev
```

Frontend runs at:  
**http://localhost:5173**

---

## 🗂 Example CSV Files

- `backend/data/patients.csv`
- `backend/data/staff.csv`

Each file should contain relevant fields like:
- Patients: `patient_id`, `name`, `address`, `type_of_care`, `status`
- Staff: `staff_id`, `name`, `home_base_address`, `max_capacity`

---

## 🛠 TODO

- [ ] Add clustering logic for territory definition
- [ ] Visualize locations and clusters on a map
- [ ] Deploy to Render.com
- [ ] Add reporting and filters