# app.py - FastAPI ML inference service
from fastapi import FastAPI
from pydantic import BaseModel
import joblib, os, numpy as np

MODEL_PATH = os.environ.get("MODEL_PATH", "models/eco_model.pkl")
app = FastAPI(title="EcoRoute ML Service")

# Vehicle/vessel assumptions (synthetic factors — can be replaced with real data)
VEHICLE_FACTORS = {
    # Land
    "car":   {"weight": 1200, "co2_factor": 1.0,  "energy_mode": "fuel"},
    "van":   {"weight": 2500, "co2_factor": 1.4,  "energy_mode": "fuel"},
    "bike":  {"weight": 200,  "co2_factor": 0.2,  "energy_mode": "fuel"},
    "ev":    {"weight": 1800, "co2_factor": 0.0,  "energy_mode": "electric"},
    # Ocean
    "cargo_ship": {"weight": 500000, "co2_factor": 8.0, "energy_mode": "fuel"},
    "tanker":     {"weight": 700000, "co2_factor": 10.0,"energy_mode": "fuel"},
    "ferry":      {"weight": 100000, "co2_factor": 5.0, "energy_mode": "fuel"},
}

class Features(BaseModel):
    distance_km: float
    elevation_gain_m: float = 0.0
    avg_speed_kph: float = 50.0
    turns: int = 0
    humps: int = 0
    weight_kg: float = 1000.0
    traffic_index: float = 1.0
    route_type: str = "fast"
    vehicle: str = "car"   # NEW: include both land & sea

@app.on_event("startup")
def load_model():
    global model
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(f"Model missing at {MODEL_PATH}. Run train_model.py to create it.")
    model = joblib.load(MODEL_PATH)

@app.post("/predict")
def predict(feat: Features):
    # Encode route type: fast=0, eco=1, safe=2
    route_map = {"fast": 0, "eco": 1, "safe": 2}
    route_type_val = route_map.get(feat.route_type, 0)

    # Vehicle adjustments
    v = VEHICLE_FACTORS.get(feat.vehicle, VEHICLE_FACTORS["car"])
    base_weight = v["weight"]
    co2_factor = v["co2_factor"]
    energy_mode = v["energy_mode"]

    X = np.array([[ 
        feat.distance_km,
        feat.elevation_gain_m,
        feat.avg_speed_kph,
        feat.turns,
        feat.humps,
        base_weight,               # vehicle/vessel weight
        feat.traffic_index,
        route_type_val
    ]])

    # Base ML model prediction [fuel_l, co2_kg]
    pred = model.predict(X)[0]
    fuel, co2 = float(pred[0]), float(pred[1])

    # Adjust emissions scaling by vehicle/vessel type
    co2 *= co2_factor
    fuel *= max(1.0, co2_factor / 2.0)  # heavier ships burn more fuel

    # --- Energy Mode Handling ---
    if energy_mode == "electric":
        # EV: Convert distance → kWh (assume ~0.2 kWh/km)
        energy_kwh = feat.distance_km * 0.2
        return {
            "fuel_l": 0.0,
            "energy_kwh": energy_kwh,
            "co2_kg": co2
        }

    # Ships (extra safety vs eco adjustments)
    if feat.vehicle in ["cargo_ship", "tanker", "ferry"]:
        if feat.route_type == "eco":
            # Slightly longer but more efficient (slow steaming, optimized currents)
            fuel *= 0.85
            co2 *= 0.85
        elif feat.route_type == "safe":
            # Safe route (storm-avoidance) → longer, more fuel
            fuel *= 1.2
            co2 *= 1.2

    return {
        "fuel_l": fuel,
        "co2_kg": co2
    }
