/**
 * server.js - Unified backend for Land & Ocean routing + ML predictions (Demo ocean routes)
 */

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import * as turf from "@turf/turf";

const app = express();
app.use(cors());
app.use(express.json());

// ML Service URL
const ML_URL = process.env.ML_URL || "http://localhost:8000/predict";

// Vehicle weight defaults (match your ML factors)
const VEHICLE_DEFAULTS = {
  car: 1200,
  van: 2500,
  bike: 200,
  ev: 1800,
  ship: 500000,
  cargo_ship: 500000,
  tanker: 700000,
  ferry: 100000,
};


import fs from "fs";

let shippingLanes = null;
try {
  const json = fs.readFileSync("./data/shipping_lanes.geojson", "utf8");
  shippingLanes = JSON.parse(json);
  console.log("Loaded shipping lanes:", shippingLanes.features.length, "features");
} catch (err) {
  console.error("Failed to load shipping lanes:", err.message);
}




// Routing engines per vehicle
const ROUTER_BASE = {
  car: "https://router.project-osrm.org/route/v1/driving/",
  van: "https://router.project-osrm.org/route/v1/driving/",
  bike: "https://router.project-osrm.org/route/v1/bike/",
  ev: "https://router.project-osrm.org/route/v1/driving/",
  ship: "marine", // ocean routes handled separately
};

// Helper: build OSRM coords string
function coordsToOsrm(a, b) {
  return `${a.lng},${a.lat};${b.lng},${b.lat}`;
}

// ---------- ML Call Helper ----------
async function callML(route, vehicle, weight_kg, routeType) {
  const distance_km = (route.distance || 0) / 1000.0;
  const avg_speed_kph = distance_km / ((route.duration || 1) / 3600 || 1);
  const turns = route.geometry?.coordinates?.length
    ? Math.max(1, Math.floor(route.geometry.coordinates.length / 10))
    : 0;
  const humps = turns > 0 ? Math.floor(turns / 4) : 0;

  const features = {
    distance_km,
    elevation_gain_m: 0,
    avg_speed_kph,
    turns,
    humps,
    weight_kg: weight_kg || VEHICLE_DEFAULTS[vehicle] || 1000,
    traffic_index: 1.0,
    route_type: routeType,
    vehicle,
  };

  const mlRes = await fetch(ML_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(features),
  });

  if (!mlRes.ok) {
    const txt = await mlRes.text();
    throw new Error("ML service error: " + txt);
  }
  return await mlRes.json();
}

// ---------- Land Route API ----------
app.post("/api/route", async (req, res) => {
  try {
    const { source, destination, vehicle = "car", weight_kg, optimizeFor = "co2" } = req.body;
    if (!source || !destination)
      return res.status(400).json({ error: "source and destination required" });

    // Ocean vessels → delegate to ocean route handler
    if (["ship", "cargo_ship", "tanker", "ferry"].includes(vehicle)) {
      const r = await fetch("http://localhost:4000/api/ocean-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, destination, vessel: vehicle }),
      });
      const j = await r.json();
      return res.json(j);
    }

    // Land routes → OSRM
    const baseUrl = ROUTER_BASE[vehicle] || ROUTER_BASE.car;
    const coords = coordsToOsrm(source, destination);
    const url = `${baseUrl}${coords}?alternatives=true&geometries=geojson&overview=full&annotations=distance,duration`;
    const r = await fetch(url);
    const j = await r.json();

    if (!j.routes || j.routes.length === 0)
      return res.status(500).json({ error: "No routes from OSRM" });

    const fastRoute = j.routes[0];
    let ecoRoute = j.routes[1];

    // fallback eco route if none
    if (!ecoRoute) {
      const midLat = (source.lat + destination.lat) / 2 + 0.01;
      const midLng = (source.lng + destination.lng) / 2;
      const coordsAlt = `${source.lng},${source.lat};${midLng},${midLat};${destination.lng},${destination.lat}`;
      const urlAlt = `${baseUrl}${coordsAlt}?geometries=geojson&overview=full`;
      const rAlt = await fetch(urlAlt);
      const jAlt = await rAlt.json();
      if (jAlt.routes && jAlt.routes[0]) ecoRoute = jAlt.routes[0];
    }
    const altRoute = ecoRoute || fastRoute;

    // ML predictions
    const [fastMl, altMl] = await Promise.all([
      callML(fastRoute, vehicle, weight_kg, "fast"),
      callML(altRoute, vehicle, weight_kg, "eco"),
    ]);

    // format output
    const formatResult = (route, mlRes) => {
      const base = {
        distance_km: +(route.distance / 1000).toFixed(2),
        duration_min: +(route.duration / 60).toFixed(1),
        co2_kg: +(mlRes.co2_kg).toFixed(2),
        geometry: route.geometry,
      };
      if (vehicle === "ev") {
        return { ...base, energy_kwh: +(mlRes.energy_kwh).toFixed(2) };
      } else {
        return { ...base, fuel_l: +(mlRes.fuel_l).toFixed(2) };
      }
    };

    const time_optimized = formatResult(fastRoute, fastMl);
    const eco_optimized = formatResult(altRoute, altMl);
    const preferred = optimizeFor === "time" ? time_optimized : eco_optimized;

    const co2SavedPercent = Math.max(
      0,
      ((time_optimized.co2_kg - eco_optimized.co2_kg) / (time_optimized.co2_kg || 1)) * 100
    );

    res.json({
      time_optimized,
      eco_optimized,
      preferred,
      co2SavedPercent: Math.round(co2SavedPercent),
      vehicle,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});// ---------- Ocean Route API (Demo Mode) ----------

// ---------- Ocean Route API (Demo using shipping lanes) ----------
app.post("/api/ocean-route", async (req, res) => {
  try {
    const { source, destination, vessel = "ship" } = req.body;
    if (!source || !destination) {
      return res.status(400).json({ error: "source and destination required" });
    }
    if (!shippingLanes) {
      return res.status(500).json({ error: "Shipping lanes not loaded" });
    }

    const srcPt = turf.point([source.lng, source.lat]);
    const dstPt = turf.point([destination.lng, destination.lat]);

    let nearestSrc = null, nearestDst = null;
    let minSrc = Infinity, minDst = Infinity;

    function checkNearest(line) {
      const snapSrc = turf.nearestPointOnLine(line, srcPt);
      const snapDst = turf.nearestPointOnLine(line, dstPt);

      if (snapSrc.properties.dist < minSrc) {
        minSrc = snapSrc.properties.dist;
        nearestSrc = snapSrc;
      }
      if (snapDst.properties.dist < minDst) {
        minDst = snapDst.properties.dist;
        nearestDst = snapDst;
      }
    }

    for (const feat of shippingLanes.features) {
      if (!feat.geometry) continue;
      if (feat.geometry.type === "LineString") {
        checkNearest(turf.lineString(feat.geometry.coordinates));
      } else if (feat.geometry.type === "MultiLineString") {
        for (const coords of feat.geometry.coordinates) {
          checkNearest(turf.lineString(coords));
        }
      }
    }

    if (!nearestSrc || !nearestDst) {
      return res.status(500).json({ error: "Failed to snap to shipping lanes" });
    }

    // Base route: straight line between snapped points
    const baseLine = turf.lineString([
      nearestSrc.geometry.coordinates,
      nearestDst.geometry.coordinates,
    ]);

    // Create eco & safe variants by shifting latitude
    function shiftLine(line, latShift) {
      return turf.lineString(
        line.geometry.coordinates.map(([lng, lat]) => [lng, lat + latShift])
      );
    }

    const ecoLine = shiftLine(baseLine, 0.5);   // slightly north
    const safeLine = shiftLine(baseLine, -0.5); // slightly south

    // Distance & duration
    function makeRoute(line, speedKph) {
      const distKm = turf.length(line, { units: "kilometers" });
      const durHr = distKm / speedKph;
      return {
        distance_km: +distKm.toFixed(1),
        duration_hr: +durHr.toFixed(1),
        geometry: line.geometry,
      };
    }

    const ecoRoute = makeRoute(ecoLine, 30);
    const safeRoute = makeRoute(safeLine, 25);

    // Call ML for emissions
    const [ecoMl, safeMl] = await Promise.all([
      callML(
        { distance: ecoRoute.distance_km * 1000, duration: ecoRoute.duration_hr * 3600, geometry: ecoRoute.geometry },
        vessel,
        VEHICLE_DEFAULTS[vessel],
        "eco"
      ),
      callML(
        { distance: safeRoute.distance_km * 1000, duration: safeRoute.duration_hr * 3600, geometry: safeRoute.geometry },
        vessel,
        VEHICLE_DEFAULTS[vessel],
        "safe"
      ),
    ]);

    ecoRoute.co2_kg = +(ecoMl.co2_kg).toFixed(1);
    safeRoute.co2_kg = +(safeMl.co2_kg).toFixed(1);

    res.json({
      vessel,
      eco_route: ecoRoute,
      safe_route: safeRoute,
    });
  } catch (err) {
    console.error("Ocean routing error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});
// ---------- Start Server ----------
const port = process.env.PORT || 4000;
app.listen(port, () => console.log("EcoRoute backend running on port", port));
