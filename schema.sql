-- Table: staff
CREATE TABLE staff (
    staff_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    home_base_address TEXT,
    max_capacity INTEGER,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    zip_code TEXT
);

-- Table: patients
CREATE TABLE patients (
    patient_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    type_of_care TEXT,
    status TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    cluster_id INTEGER,
    zip_code TEXT,
    assigned_staff TEXT
);