# train_model.py
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
import joblib, os

# ----------------------------
# Vehicle / Vessel assumptions
# ----------------------------
VEHICLE_FACTORS = {
    "car":   {"weight": 1200, "co2_factor": 1.0,  "energy_mode": "fuel"},
    "van":   {"weight": 2500, "co2_factor": 1.4,  "energy_mode": "fuel"},
    "bike":  {"weight": 200,  "co2_factor": 0.2,  "energy_mode": "fuel"},
    "ev":    {"weight": 1800, "co2_factor": 0.0,  "energy_mode": "electric"},
    "cargo_ship": {"weight": 500000, "co2_factor": 8.0, "energy_mode": "fuel"},
    "tanker":     {"weight": 700000, "co2_factor": 10.0,"energy_mode": "fuel"},
    "ferry":      {"weight": 100000, "co2_factor": 5.0, "energy_mode": "fuel"},
}

ROUTE_TYPES = {"fast": 0, "eco": 1, "safe": 2}


# ----------------------------
# Synthetic Data Generator
# ----------------------------
def generate_data(n=5000):
    np.random.seed(42)
    rows = []
    vehicles = list(VEHICLE_FACTORS.keys())
    route_types = list(ROUTE_TYPES.keys())

    for _ in range(n):
        distance_km = np.random.uniform(5, 2000)
        elevation_gain_m = np.random.uniform(0, 1000)
        avg_speed_kph = np.random.uniform(10, 120)
        turns = np.random.randint(0, 200)
        humps = np.random.randint(0, 50)
        traffic_index = np.random.uniform(0.5, 2.0)

        vehicle = np.random.choice(vehicles)
        route_type = np.random.choice(route_types)
        v = VEHICLE_FACTORS[vehicle]

        # baseline weight
        weight_kg = v["weight"]
        co2_factor = v["co2_factor"]

        # --- baseline fuel consumption ---
        base_fuel = (distance_km / 12.0) + (weight_kg / 1000) * 0.5
        base_co2 = base_fuel * 2.31

        # --- route adjustments ---
        if route_type == "eco":
            base_fuel *= 0.9 + np.random.uniform(-0.05, 0.05)
            base_co2 *= 0.9 + np.random.uniform(-0.05, 0.05)
        elif route_type == "safe":
            base_fuel *= 1.2 + np.random.uniform(-0.1, 0.1)
            base_co2 *= 1.2 + np.random.uniform(-0.1, 0.1)
        else:  # fast
            base_fuel *= 1.05 + np.random.uniform(-0.05, 0.05)
            base_co2 *= 1.05 + np.random.uniform(-0.05, 0.05)

        # --- vehicle adjustments ---
        fuel = base_fuel * (1.0 if v["energy_mode"] == "fuel" else 0.5)
        co2 = base_co2 * co2_factor

        rows.append([
            distance_km, elevation_gain_m, avg_speed_kph, turns, humps,
            weight_kg, traffic_index, ROUTE_TYPES[route_type], fuel, co2
        ])

    return pd.DataFrame(rows, columns=[
        "distance_km","elevation_gain_m","avg_speed_kph","turns","humps",
        "weight_kg","traffic_index","route_type","fuel_l","co2_kg"
    ])


# ----------------------------
# Train + Save Model
# ----------------------------
def train_model():
    print("🔄 Generating synthetic dataset...")
    df = generate_data(10000)

    X = df.drop(["fuel_l","co2_kg"], axis=1)
    y = df[["fuel_l","co2_kg"]]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print("🔄 Training RandomForestRegressor...")
    model = RandomForestRegressor(n_estimators=200, random_state=42)
    model.fit(X_train, y_train)

    print("✅ Model R^2 score:", model.score(X_test, y_test))

    os.makedirs("models", exist_ok=True)
    joblib.dump(model, "models/eco_model.pkl")
    print("✅ Model saved to models/eco_model.pkl")


if __name__ == "__main__":
    train_model()
