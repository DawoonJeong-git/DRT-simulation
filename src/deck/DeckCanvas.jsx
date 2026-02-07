// src/deck/DeckCanvas.jsx
import { useEffect, useState, useMemo, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { getVehicleLayers } from "./VehicleLayer";
import { segmentsToRouteData } from "./adapters/segmentsAdapter";
import { useStationCoords } from "./useStationCoords";

function midnightMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function DeckCanvas() {
  const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  const baseDateMs = useMemo(() => midnightMs(Date.now()), []);
  const endDateMs = useMemo(() => baseDateMs + 24 * 3600 * 1000, [baseDateMs]);

  const [routeData, setRouteData] = useState([]);
  const stationCoords = useStationCoords();

  const [elapsedSec, setElapsedSec] = useState(() => {
    const now = Date.now();
    return Math.max(0, Math.min(86400, (now - baseDateMs) / 1000));
  });
  const rafRef = useRef(null);

  // LIVE segments polling (API-only)
  useEffect(() => {
    let id;
    const load = async () => {
      try {
        const res = await fetch(`${API}/api/segments`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const segments = Array.isArray(data?.segments) ? data.segments : [];

        const filtered = segments.filter((s) => s?.originMs >= baseDateMs && s?.originMs < endDateMs);
        const rd = segmentsToRouteData(filtered, baseDateMs);
        setRouteData(rd);
      } catch (e) {
        console.warn("api segments load failed:", e);
      }
    };
    load();
    id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [baseDateMs, endDateMs]);

  // 60fps progression
  useEffect(() => {
    let last = performance.now();
    const loop = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setElapsedSec((prev) => {
        const t = prev + dt;
        return t < 0 ? 0 : t > 86400 ? 86400 : t;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const viewState = { longitude: 127.265, latitude: 36.502, zoom: 15, pitch: 45, bearing: 0 };

  return (
    <DeckGL
      initialViewState={viewState}
      controller={true}
      layers={(viewport) => getVehicleLayers(routeData, elapsedSec, stationCoords, viewport)}
      style={{ width: "100vw", height: "100vh", position: "absolute", zIndex: 0 }}
    />
  );
}

export default DeckCanvas;
