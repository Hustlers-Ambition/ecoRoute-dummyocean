# EcoRoute — OSRM + AI version (Map + Graphs)

This package runs locally (no Docker) and shows two real routes from OSRM:
- Blue = time-optimized (OSRM fastest)
- Green = eco-optimized (OSRM alternative evaluated by ML model)

## Requirements
- Node.js 18+ and npm
- Python 3.9+ and pip

## Steps (run in separate terminals)

1) ML service
```bash
cd ml_service
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1 (PowerShell) or activate.bat (cmd)
pip install -r requirements.txt
python train_model.py
uvicorn app:app --reload --port 8000
```

2) Backend
```bash
cd backend
npm install
node server.js
# backend listens on http://localhost:4000
```

3) Frontend
```bash
cd frontend
npm install
npm run dev
# open http://localhost:5173
```

## Notes
- The backend calls the public OSRM demo server (router.project-osrm.org). For production, self-host OSRM or use a paid routing provider.
- The ML model is trained on synthetic data (train_model.py). Replace with real telemetry for better accuracy.
- OpenStreetMap Nominatim geocoding is used in the frontend for address -> lat/lon. Respect rate limits.
"# ecoRoute-dummyocean" 
"# ecoRoute-dummyocean" 
