import React, { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// fix default icon paths for leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (!positions || positions.length === 0) return;
    const all = positions.flat();
    if (all.length > 0) {
      map.fitBounds(all, { padding: [40, 40] });
    }
  }, [positions, map]);
  return null;
}

// 🔧 FIX: Support LineString + MultiLineString safely
function geoToLatLngs(geometry) {
  if (!geometry || !geometry.coordinates) return [];

  if (geometry.type === "LineString") {
    return geometry.coordinates
      .filter((pt) => Array.isArray(pt) && pt.length >= 2)
      .map((pt) => [pt[1], pt[0]]);
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates
      .flat()
      .filter((pt) => Array.isArray(pt) && pt.length >= 2)
      .map((pt) => [pt[1], pt[0]]);
  }

  return [];
}

export default function App() {
  const [from, setFrom] = useState("Los Angeles, USA");
  const [to, setTo] = useState("Tokyo, Japan");
  const [vehicle, setVehicle] = useState("car");
  const [mode, setMode] = useState("land"); // "land" or "ocean"
  const [analysis, setAnalysis] = useState(null);
  const [srcDstCoords, setSrcDstCoords] = useState(null);

  async function geocode(q) {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&q=" +
        encodeURIComponent(q)
    );
    const j = await res.json();
    if (!j || j.length === 0) throw new Error("Geocode failed for " + q);
    return {
      lat: parseFloat(j[0].lat),
      lng: parseFloat(j[0].lon),
      name: j[0].display_name,
    };
  }

  async function compute() {
    try {
      setAnalysis(null);
      const s = await geocode(from);
      const d = await geocode(to);
      setSrcDstCoords({ source: s, destination: d });

      if (mode === "land") {
        const body = {
          source: s,
          destination: d,
          vehicle,
          weight_kg: 1000,
          optimizeFor: "co2",
        };
        const r = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setAnalysis({ ...j, source: s, destination: d, type: "land" });
      } else {
        const body = { source: s, destination: d, vessel: "cargo_ship" };
        const r = await fetch("/api/ocean-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setAnalysis({ ...j, source: s, destination: d, type: "ocean" });
      }
    } catch (e) {
      alert(e.message);
      console.error(e);
    }
  }

  return (
    <div className="app">
      {/* Side panel */}
      <div className="panel">
        <h2>EcoRoute</h2>

        <label>Source</label>
        <input value={from} onChange={(e) => setFrom(e.target.value)} />

        <label>Destination</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} />

        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="land">Land</option>
          <option value="ocean">Ocean</option>
        </select>

        {mode === "land" && (
          <>
            <label>Vehicle</label>
            <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
              <option value="car">Car</option>
              <option value="van">Van</option>
              <option value="bike">Bike</option>
              <option value="ev">EV</option>
            </select>
          </>
        )}

        <button onClick={compute}>Calculate routes</button>

        {/* Results */}
        {analysis && mode === "land" && (
          <div className="results">
            <div className="cards">
              <div className="card">
                <h3>Fast Route</h3>
                <p>
                  {analysis.time_optimized?.distance_km} km •{" "}
                  {analysis.time_optimized?.duration_min} min
                </p>
                <p>
                  {analysis.time_optimized?.fuel_l} L •{" "}
                  {analysis.time_optimized?.co2_kg} kg CO₂
                </p>
              </div>
              <div className="card">
                <h3>Eco Route</h3>
                <p>
                  {analysis.eco_optimized?.distance_km} km •{" "}
                  {analysis.eco_optimized?.duration_min} min
                </p>
                <p>
                  {analysis.eco_optimized?.fuel_l} L •{" "}
                  {analysis.eco_optimized?.co2_kg} kg CO₂
                </p>
              </div>
            </div>
            <div className="highlight">
              <h4>CO₂ Saved</h4>
              <span className="percent">{analysis.co2SavedPercent}%</span>
            </div>
            <div className="chart">
              <h4>Route Comparison</h4>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={[
                    {
                      name: "Distance (km)",
                      Fast: analysis.time_optimized?.distance_km,
                      Eco: analysis.eco_optimized?.distance_km,
                    },
                    {
                      name: "Duration (min)",
                      Fast: analysis.time_optimized?.duration_min,
                      Eco: analysis.eco_optimized?.duration_min,
                    },
                    {
                      name: "Fuel (L)",
                      Fast: analysis.time_optimized?.fuel_l,
                      Eco: analysis.eco_optimized?.fuel_l,
                    },
                    {
                      name: "CO₂ (kg)",
                      Fast: analysis.time_optimized?.co2_kg,
                      Eco: analysis.eco_optimized?.co2_kg,
                    },
                  ]}
                >
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Fast" fill="#4A90E2" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Eco" fill="#27AE60" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {analysis && mode === "ocean" && analysis.eco_route && analysis.safe_route && (
          <div className="results">
            <div className="cards">
              <div className="card">
                <h3>Eco Ocean Route</h3>
                <p>
                  {analysis.eco_route?.distance_km} km •{" "}
                  {analysis.eco_route?.duration_hr} hr
                </p>
                <p>{analysis.eco_route?.co2_kg} kg CO₂</p>
              </div>
              <div className="card">
                <h3>Safe Ocean Route</h3>
                <p>
                  {analysis.safe_route?.distance_km} km •{" "}
                  {analysis.safe_route?.duration_hr} hr
                </p>
                <p>{analysis.safe_route?.co2_kg} kg CO₂</p>
              </div>
            </div>
            <div className="chart">
              <h4>Ocean Route Comparison</h4>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={[
                    {
                      name: "Distance (km)",
                      Eco: analysis.eco_route?.distance_km,
                      Safe: analysis.safe_route?.distance_km,
                    },
                    {
                      name: "Duration (hr)",
                      Eco: analysis.eco_route?.duration_hr,
                      Safe: analysis.safe_route?.duration_hr,
                    },
                    {
                      name: "CO₂ (kg)",
                      Eco: analysis.eco_route?.co2_kg,
                      Safe: analysis.safe_route?.co2_kg,
                    },
                  ]}
                >
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Eco" fill="#27AE60" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Safe" fill="#F39C12" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="map">
        <MapContainer
          id="map"
          center={[20, 0]}
          zoom={3}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap contributors"
          />
          {srcDstCoords && (
            <>
              <Marker
                position={[srcDstCoords.source.lat, srcDstCoords.source.lng]}
              />
              <Marker
                position={[
                  srcDstCoords.destination.lat,
                  srcDstCoords.destination.lng,
                ]}
              />
            </>
          )}
          {analysis && mode === "land" && (
            <>
              {analysis.time_optimized?.geometry && (
                <Polyline
                  positions={geoToLatLngs(analysis.time_optimized.geometry)}
                  color="blue"
                  weight={5}
                />
              )}
              {analysis.eco_optimized?.geometry && (
                <Polyline
                  positions={geoToLatLngs(analysis.eco_optimized.geometry)}
                  color="green"
                  weight={5}
                />
              )}
              <FitBounds
                positions={[
                  geoToLatLngs(analysis.time_optimized?.geometry),
                  geoToLatLngs(analysis.eco_optimized?.geometry),
                ]}
              />
            </>
          )}
          {analysis && mode === "ocean" && analysis.eco_route?.geometry && analysis.safe_route?.geometry && (
            <>
              <Polyline
                positions={geoToLatLngs(analysis.eco_route.geometry)}
                color="green"
                weight={5}
              />
              <Polyline
                positions={geoToLatLngs(analysis.safe_route.geometry)}
                color="orange"
                weight={5}
              />
              <FitBounds
                positions={[
                  geoToLatLngs(analysis.eco_route.geometry),
                  geoToLatLngs(analysis.safe_route.geometry),
                ]}
              />
            </>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
