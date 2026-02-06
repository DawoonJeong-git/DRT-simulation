import React, { useMemo } from "react";

// ---- utils ----
const to01 = (x) => (x === true || x === 1 || x === "1" ? 1 : 0);
const normStation = (x) => String(x ?? "").trim().replace(/^S/i, "").toUpperCase();

function msToHMS(msDiff) {
  if (typeof msDiff !== "number" || !isFinite(msDiff)) return "-";
  if (msDiff < 0) return "이미 지남";
  const sec = Math.round(msDiff / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function arrivalLabel(arrivalDiff) {
  if (typeof arrivalDiff !== "number" || !isFinite(arrivalDiff)) return "-";
  if (arrivalDiff <= 0) return "도착 완료";
  return msToHMS(arrivalDiff);
}

function departureLabel(depDiff) {
  if (typeof depDiff !== "number" || !isFinite(depDiff)) return "-";
  if (depDiff <= 0) return "출발 임박/진행";
  return msToHMS(depDiff);
}

// Build rows per vehicle for this station (phase-based, robust)
function buildFromRouteData(stationId, routeData, baseMs, elapsedSec) {
  const want = normStation(stationId);
  const now = baseMs + (elapsedSec || 0) * 1000;

  // tuning (운행 중 차량 필터만 유지)
  const START_BUFFER_MS = 2 * 60 * 1000;
  const END_BUFFER_MS = 10 * 60 * 1000;

  const bestByVehicle = new Map(); // vehicle_id -> row

  for (const v of routeData || []) {
    const evsRaw = Array.isArray(v?.eventsTimeline) ? v.eventsTimeline : [];
    if (evsRaw.length === 0) continue;

    const evs = evsRaw.slice().sort((a, b) => (a?.ms ?? 0) - (b?.ms ?? 0));

    // only currently operating
    const startMs = evs[0]?.ms;
    const endMs = evs[evs.length - 1]?.ms;
    if (typeof startMs !== "number" || typeof endMs !== "number") continue;

    if (now < startMs - START_BUFFER_MS) continue;
    if (now > endMs + END_BUFFER_MS) continue;

    // collect events at this station (NO lookback cut; rely on phase + time)
    const atStation = [];
    for (const e of evs) {
      if (normStation(e?.station) !== want) continue;
      const t = e?.ms;
      if (typeof t !== "number" || !isFinite(t)) continue;
      atStation.push(e);
    }
    if (atStation.length === 0) continue;

    atStation.sort((a, b) => a.ms - b.ms);

    // phase 기반 도착/출발
    const arrivals = atStation.filter((e) => e.phase === "arrive");
    const departs = atStation.filter((e) => e.phase === "depart");

    // 1) t0(도착): now 기준 최근 도착(<=now)이 있으면 그걸, 없으면 다음 도착(>now)
    let t0 = null;

    for (let i = arrivals.length - 1; i >= 0; i--) {
      if (arrivals[i].ms <= now) {
        t0 = arrivals[i].ms;
        break;
      }
    }
    if (t0 == null) {
      const nextArr = arrivals.find((e) => e.ms > now);
      if (!nextArr) continue; // 도착 이벤트 자체가 없으면 표시 불가
      t0 = nextArr.ms;
    }

    // 2) departureMs(출발): t0 이후 첫 depart (없으면 null = 아직 모름)
    let departureMs = null;
    for (const e of departs) {
      if (e.ms > t0) {
        departureMs = e.ms;
        break;
      }
    }

    // 3) counts: sum only within [t0, departureMs] if departureMs exists,
    // otherwise sum only at/after t0 (도착 이후 이벤트만)
    let pickup_total = 0,
      pickup_wheelchair = 0,
      dropoff_total = 0,
      dropoff_wheelchair = 0;

    for (const e of atStation) {
      if (e.ms < t0) continue;
      if (departureMs != null && e.ms > departureMs) break;

      pickup_total += Number(e?.pickup_total || 0);
      pickup_wheelchair += to01(e?.pickup_wheelchair);
      dropoff_total += Number(e?.dropoff_total || 0);
      dropoff_wheelchair += to01(e?.dropoff_wheelchair);
    }

    const row = {
      operation_id: v?.operation_id ?? v?.operationID,
      vehicle_id: v?.vehicle_id ?? v?.vehicleID,
      route_id: v?.route_id ?? v?.routeID ?? v?.routeId ?? v?.routeCode,
      vehicle_type: v?.vehicle_type ?? v?.vehicleType,

      arrivalMs: t0,
      departureMs,

      arrivalDiff: t0 - now,
      departureDiff: departureMs != null ? (departureMs - now) : null,

      pickup_total,
      pickup_wheelchair,
      dropoff_total,
      dropoff_wheelchair,
    };

    const prev = bestByVehicle.get(row.vehicle_id);
    if (!prev || row.arrivalDiff < prev.arrivalDiff) bestByVehicle.set(row.vehicle_id, row);
  }

  return Array.from(bestByVehicle.values()).sort((a, b) => a.arrivalDiff - b.arrivalDiff);
}

export default function StationInfoBox({
  stationId,
  position,
  routeData,
  baseDateMs,
  elapsedTime,
  vehicles, // legacy
}) {
  const rows = useMemo(() => {
    if (Array.isArray(vehicles) && vehicles.length > 0) {
      return vehicles.map((r) => ({
        operation_id: r.operation_id ?? r.operationID,
        vehicle_id: r.vehicle_id ?? r.vehicleID,
        route_id: r.route_id ?? r.routeID ?? r.routeId ?? r.routeCode,
        vehicle_type: r.vehicle_type ?? r.vehicleType,

        arrivalDiff: r._dist ?? null,
        departureDiff: r._dist ?? null,

        pickup_total: r.pickup_total || 0,
        pickup_wheelchair: to01(r.pickup_wheelchair),
        dropoff_total: r.dropoff_total || 0,
        dropoff_wheelchair: to01(r.dropoff_wheelchair),
      }));
    }
    if (routeData && typeof baseDateMs === "number" && typeof elapsedTime !== "undefined") {
      return buildFromRouteData(stationId, routeData, baseDateMs, elapsedTime);
    }
    return [];
  }, [vehicles, routeData, baseDateMs, elapsedTime, stationId]);

  const outerStyle = {
    position: "absolute",
    left: position?.x ?? 0,
    top: position?.y ?? 0,
    background: "white",
    border: "1px solid #ccc",
    padding: "8px",
    borderRadius: "6px",
    zIndex: 10,
    maxWidth: "340px",
    fontSize: "11px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
    pointerEvents: "none",
    transform: "translateY(-100%)",
  };

  if (!rows || rows.length === 0) {
    return (
      <div style={outerStyle}>
        <strong>Station ID :</strong> {String(stationId)}
        <hr />
        <div style={{ color: "#666" }}>현재 운행 중인 차량의 예정 정보가 없습니다.</div>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <strong>Station ID :</strong> {String(stationId)}
      <hr />

      <div style={{ lineHeight: 1.6 }}>
        {rows.map((r, idx) => {
          const pickWheel = r.pickup_wheelchair || 0;
          const pickGen = (r.pickup_total || 0) - pickWheel;
          const dropWheel = r.dropoff_wheelchair || 0;
          const dropGen = (r.dropoff_total || 0) - dropWheel;

          const showDeparture =
            r.arrivalDiff <= 0 && r.departureDiff != null && r.departureDiff > 0;

          return (
            <div
              key={`st-${stationId}-op-${r.operation_id}-v-${r.vehicle_id}-rt-${r.route_id}`}
            >
              {/* 🚘 차량 운행 정보 */}
              <div style={{ marginTop: 6 }}>
                <strong>차량 운행 정보</strong>
                <div>operationID : {r.operation_id ?? "-"}</div>
                <div>vehicleID : {r.vehicle_id ?? "-"}</div>
                <div>routeID : {r.route_id ?? "-"}</div>
                <div>vehicleType : {r.vehicle_type ?? "-"}</div>
              </div>

              {/* ⏱ 차량 출도착 정보 */}
              <div style={{ marginTop: 8 }}>
                <strong>차량 출도착 정보</strong>
                <div>
                  도착 예정 시간 : {r.arrivalDiff <= 0 ? "-" : arrivalLabel(r.arrivalDiff)}
                </div>
                <div>
                  출발 예정 시간 : {showDeparture ? departureLabel(r.departureDiff) : "-"}
                </div>
              </div>

              {/* 👥 승객 승하차 정보 */}
              <div style={{ marginTop: 8 }}>
                <strong>승객 승하차 정보</strong>
                <div>승차 예정 : 일반 {pickGen}명 / 휠체어 {pickWheel}명</div>
                <div>하차 예정 : 일반 {dropGen}명 / 휠체어 {dropWheel}명</div>
              </div>

              {idx < rows.length - 1 && <hr style={{ margin: "10px 0" }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
