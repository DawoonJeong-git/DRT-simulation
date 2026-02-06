// src/combined/CombinedView.jsx
import { useEffect, useRef, useState, useLayoutEffect, useMemo } from "react";
import MapView from "../maplibre/MapView";
import DeckGL from "@deck.gl/react";
import { WebMercatorViewport } from "@deck.gl/core";

import { getVehicleLayers } from "../deck/VehicleLayer";
import { useStationCoords } from "../deck/useStationCoords";
import { segmentsToRouteData } from "../deck/adapters/segmentsAdapter.js";

import StationInfoBox from "../ui/StationInfoBox";
import { VehicleInfoBox } from "../ui/VehicleInfoBox";
import PlaybackController from "../ui/PlaybackController";
import RecordingController from "../ui/RecordingController";
import AreaModeToggle from "../ui/AreaModeToggle";

function midnight(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// vehicleType -> areaMode 매핑 (차량 운행 필터용)
function vehicleTypeToAreaMode(vehicleType) {
  const vt = String(vehicleType ?? "").trim();
  if (vt === "carnivalWheel") return "accessible";
  if (vt === "IONIQ5" || vt === "carnivalReg") return "underserved";
  return "both";
}

// YYYYMMDDHHMM -> epoch ms
function ymdhmToMs(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.length !== 12) return null;

  const yyyy = s.slice(0, 4);
  const mm = s.slice(4, 6);
  const dd = s.slice(6, 8);
  const hh = s.slice(8, 10);
  const mi = s.slice(10, 12);

  const dt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00`);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeSegment(s) {
  const originMs = s.originMs ?? ymdhmToMs(s.originDepTime);
  const destMs = s.destMs ?? ymdhmToMs(s.destDepTime);
  return { ...s, originMs, destMs };
}

/** coordsMap: { [id]: [lon, lat] } */
function getBoundsFromCoordsMap(coordsMap) {
  const pts = Object.values(coordsMap || {}).filter(
    (v) => Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
  );
  if (pts.length === 0) return null;

  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;

  for (const [lon, lat] of pts) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function fitViewStateToBounds(bounds, { width, height, padding = 90 }) {
  const vp = new WebMercatorViewport({ width, height });
  const { longitude, latitude, zoom } = vp.fitBounds(bounds, { padding });
  return { longitude, latitude, zoom };
}

// ✅ deck.gl 레이어 id 중복 제거(같은 id가 여러개면 마지막 것만 남김)
function dedupeLayersById(layers) {
  const m = new Map();
  for (const layer of Array.isArray(layers) ? layers : []) {
    if (!layer || !layer.id) continue;
    if (m.has(layer.id)) m.delete(layer.id);
    m.set(layer.id, layer);
  }
  return Array.from(m.values());
}

function CombinedView() {
  const [viewState, setViewState] = useState(null);

  const [areaMode, setAreaMode] = useState("both");
  const [coverageVisible, setCoverageVisible] = useState(false);

  const [routeData, setRouteData] = useState([]);

  // areaMode(둘다/교통약자/소외)에 맞춰 차량 운행도 필터링
  const filteredRouteData = useMemo(() => {
    if (areaMode === "both") return routeData;
    return (routeData || []).filter(
      (r) => vehicleTypeToAreaMode(r?.vehicle_type ?? r?.vehicleType) === areaMode
    );
  }, [routeData, areaMode]);

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const [deckLayers, setDeckLayers] = useState([]);
  const deckLayersSafe = useMemo(() => dedupeLayersById(deckLayers), [deckLayers]);

  const [hideUI, setHideUI] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);

  const [baseDateMs, setBaseDateMs] = useState(() => midnight(Date.now()));
  const [isLive, setIsLive] = useState(true);

  const [liveStats, setLiveStats] = useState({ lastFetch: null, len: 0, updatedAtMs: null });
  const livePrevSigRef = useRef({ len: 0, updatedAtMs: null });

  const stationCoords = useStationCoords();
  const deckRef = useRef(null);

  useLayoutEffect(() => {
    window.setHoverInfo = setHoverInfo;
  }, []);

  useEffect(() => {
    if (isLive) {
      setBaseDateMs(midnight(Date.now()));
      setIsPlaying(false);
    }
  }, [isLive, setIsPlaying]);

  useEffect(() => {
    const s1 = window.__stationCoordsByServiceType?.[1] || {};
    const s2 = window.__stationCoordsByServiceType?.[2] || {};

    const target =
      areaMode === "accessible" ? s1 : areaMode === "underserved" ? s2 : { ...s1, ...s2 };

    const bounds = getBoundsFromCoordsMap(target);
    if (!bounds) return;

    const next = fitViewStateToBounds(bounds, {
      width: window.innerWidth,
      height: window.innerHeight,
      padding: 90,
    });

    setViewState((prev) => ({
      longitude: next.longitude,
      latitude: next.latitude,
      zoom: next.zoom,
      pitch: prev?.pitch ?? 0,
      bearing: prev?.bearing ?? 0,
    }));
  }, [stationCoords, areaMode]);

  const pad2 = (n) => String(n).padStart(2, "0");
  const toDateStr = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  useEffect(() => {
    let timer = null;
    let cancelled = false;

    const loadLive = async () => {
      try {
        const res = await fetch("/api/segments", { cache: "no-store" });
        if (!res.ok) return;

        const json = await res.json();
        const rawSegments = Array.isArray(json?.segments) ? json.segments : [];
        const segments = rawSegments.map(normalizeSegment);

        setLiveStats({
          lastFetch: Date.now(),
          len: segments.length,
          updatedAtMs: json?.updatedAtMs ?? null,
        });

        const prev = livePrevSigRef.current;
        if (segments.length !== prev.len || (json?.updatedAtMs ?? null) !== prev.updatedAtMs) {
          livePrevSigRef.current = { len: segments.length, updatedAtMs: json?.updatedAtMs ?? null };
        }

        const start = baseDateMs;
        const end = baseDateMs + 24 * 3600 * 1000;

        const filtered = segments.filter((s) => {
          const o = s.originMs;
          const d = s.destMs;
          if (o == null || d == null) return false;
          return o < end && d >= start;
        });

        const rdRaw = segmentsToRouteData(filtered, baseDateMs);
        const rd = (rdRaw || []).map((r) => ({
          ...r,
          vehicleType: r.vehicleType ?? r.vehicle_type,
        }));
        if (!cancelled) setRouteData(rd);
      } catch {
        // 조용히 무시
      }
    };

    const loadReplayOnce = async () => {
      try {
        const dateStr = toDateStr(baseDateMs);
        const res = await fetch(`/api/replay?date=${dateStr}`, { cache: "no-store" });
        if (!res.ok) return;

        const json = await res.json();
        const rawSegments = Array.isArray(json?.segments) ? json.segments : [];
        const segments = rawSegments.map(normalizeSegment);

        const start = baseDateMs;
        const end = baseDateMs + 24 * 3600 * 1000;

        const filtered = segments.filter((s) => {
          const o = s.originMs;
          const d = s.destMs;
          if (o == null || d == null) return false;
          return o < end && d >= start;
        });

        const rdRaw = segmentsToRouteData(filtered, baseDateMs);
        const rd = (rdRaw || []).map((r) => ({
          ...r,
          vehicleType: r.vehicleType ?? r.vehicle_type,
        }));
        if (!cancelled) setRouteData(rd);
      } catch {
        // 조용히 무시
      }
    };

    const start = async () => {
      if (isLive) {
        await loadLive();
        timer = setInterval(loadLive, 60_000);
      } else {
        // replay는 1회 로드(파일 생성/폴링 없음)
        await loadReplayOnce();
      }
    };

    start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [baseDateMs, isLive]);

  useEffect(() => {
    const updateLayers = async () => {
      const viewport = deckRef.current?.deck?.getViewports?.()[0];
      const layers = await getVehicleLayers(filteredRouteData, elapsedTime, stationCoords, viewport);
      setDeckLayers(layers);
    };

    if (filteredRouteData.length > 0 && stationCoords && Object.keys(stationCoords).length > 0) {
      updateLayers();
    } else {
      setDeckLayers([]);
    }
  }, [elapsedTime, filteredRouteData, stationCoords]);

  if (!viewState) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Loading map…
      </div>
    );
  }

  return (
    <div className={hideUI ? "hidden-ui" : ""} style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <div
        id="canvas-container"
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0 }}
      >
        <MapView
          viewState={viewState}
          setViewState={setViewState}
          areaMode={areaMode}
          coverageVisible={coverageVisible}
        />
        <DeckGL
          ref={deckRef}
          viewState={viewState}
          controller={{
            dragPan: true,
            scrollZoom: true,
            doubleClickZoom: true,
            touchZoom: true,
            touchRotate: true,
            keyboard: false,
          }}
          layers={deckLayersSafe}
          onViewStateChange={({ viewState: next }) => setViewState(() => next)}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0 }}
        />
      </div>

      {isLive && !hideUI && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 2000,
            background: "rgba(0,0,0,0.65)",
            color: "#fff",
            padding: "8px 10px",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.4,
            minWidth: 180,
          }}
        >
          <div style={{ fontWeight: 700 }}>LIVE</div>
          <div>fetch: {liveStats.lastFetch ? new Date(liveStats.lastFetch).toLocaleTimeString() : "-"}</div>
          <div>segments: {liveStats.len}</div>
          <div>updatedAt: {liveStats.updatedAtMs ? new Date(liveStats.updatedAtMs).toLocaleString() : "-"}</div>
        </div>
      )}

      <AreaModeToggle
        areaMode={areaMode}
        setAreaMode={setAreaMode}
        coverageVisible={coverageVisible}
        setCoverageVisible={setCoverageVisible}
        hideUI={hideUI}
      />

      {!hideUI && (
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 1000 }}>
          <PlaybackController
            elapsedTime={elapsedTime}
            setElapsedTime={setElapsedTime}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            speed={speed}
            setSpeed={setSpeed}
            baseDateMs={baseDateMs}
            setBaseDateMs={setBaseDateMs}
            isLive={isLive}
            setIsLive={setIsLive}
          />
        </div>
      )}

      {!hideUI && (
        <div style={{ position: "absolute", bottom: 20, right: 20, zIndex: 1000 }}>
          <RecordingController setHideUI={setHideUI} />
        </div>
      )}

      {hoverInfo?.type === "station" && (
        <StationInfoBox
          stationId={hoverInfo.stationId}
          position={{ x: hoverInfo.x, y: hoverInfo.y }}
          routeData={filteredRouteData}
          baseDateMs={baseDateMs}
          elapsedTime={elapsedTime}
        />
      )}

      {hoverInfo?.type === "vehicle" && (
        <VehicleInfoBox
          vehicleId={hoverInfo.vehicleId}
          vehicleType={hoverInfo.vehicleType}
          position={{ x: hoverInfo.x, y: hoverInfo.y }}
          passengerTotal={hoverInfo.passengerTotal}
          hasWheelchair={hoverInfo.hasWheelchair}
          passengerGeneral={hoverInfo.passengerGeneral}
          passengerWheel={hoverInfo.passengerWheel}
          nextStationId={hoverInfo.nextStationId}
          nextArrivalTime={hoverInfo.nextArrivalTime}
        />
      )}
    </div>
  );
}

export default CombinedView;
