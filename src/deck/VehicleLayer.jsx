// src/deck/VehicleLayer.jsx — FIXED
import { PathLayer, IconLayer, ScatterplotLayer } from "@deck.gl/layers";

// ---------- helpers ----------
function isPt(p) {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}
function findBackwardValid(arr, i) {
  for (let k = Math.min(i, arr.length - 1); k >= 0; k--) if (isPt(arr[k])) return arr[k];
  return null;
}
/** 출발 전에는 미래 좌표를 끌어오지 않는 안전 보간 */
function interpolatePositionSafe(coords, time) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const idx = Math.floor(time);
  const frac = Math.min(1, Math.max(0, time - idx));

  // 끝 이후: 마지막 유효점만
  if (idx >= coords.length - 1) return findBackwardValid(coords, coords.length - 1);

  const cur = coords[idx], nxt = coords[idx + 1];
  const curOK = isPt(cur), nxtOK = isPt(nxt);

  if (!curOK && !nxtOK) return null;           // 출발 전

  const p1 = curOK ? cur : findBackwardValid(coords, idx);
  if (!p1) return null;                         // 과거에도 없음 → 표출 금지
  const p2 = nxtOK ? nxt : p1;                  // 미래로 당겨오지 않음

  const [x1, y1] = p1, [x2, y2] = p2;
  return [x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac];
}
function compactPath(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const p of arr) if (isPt(p)) out.push(p);
  return out;
}














// ---------- optional (garage marker) ----------
let cachedGarageId = null;
async function getGarageId() {
  if (cachedGarageId) return cachedGarageId;
  try {
    const res = await fetch("/garage.json");
    const json = await res.json();
    cachedGarageId = json.garageStationId;
  } catch (_) {
    cachedGarageId = null;
  }
  return cachedGarageId;
}

// ---------- main ----------
/**
 * routeData[i] 필수 필드:
 *  - coords: [ [lng,lat], ... ] (자정~자정 절대초 인덱스)
 *  - onboardTotal: number[] (초 단위 총 탑승자)
 *  - onboardWheel: number[] (초 단위 휠체어 0/1)
 *  - stops: [{station: "ID"}, ...]  (중간 정류장만)
 *  - vehicle_id, vehicle_type
 */
export async function getVehicleLayers(routeData, elapsedTime, stationCoords = {}, viewport) {
  const pathLayers = [];
  const overlayLayers = [];

  // 자정 기준 절대초(float)
  const t = Math.max(0, Number(elapsedTime) || 0);

  // --------- optional: garage icon ---------
  let garagePosition = null;
  const garageId = await getGarageId();
  if (garageId && stationCoords[garageId]) garagePosition = stationCoords[garageId];

  const vehicles = [];
  const stationIcons = [];
  const statusDots = [];

  for (const v of routeData || []) {
    const { coords, vehicle_id, vehicle_type, stops = [], onboardTotal, onboardWheel } = v || {};
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const rel = t;
    if (rel < 0 || rel >= coords.length) continue;

    const pos = interpolatePositionSafe(coords, rel);
    if (!pos) continue;

    // 경로: 현재 프레임 위치를 봉합하여 끊김 없이 보이게
    const pi = Math.floor(rel);
    const pastCoords = compactPath(coords.slice(0, pi + 1));
    const futureCoords = compactPath(coords.slice(pi));
    if (pastCoords.length === 0 || pastCoords.at(-1)[0] !== pos[0] || pastCoords.at(-1)[1] !== pos[1]) {
      pastCoords.push(pos);
    }
    if (futureCoords.length === 0 || futureCoords[0][0] !== pos[0] || futureCoords[0][1] !== pos[1]) {
      futureCoords.unshift(pos);
    }

    if (pastCoords.length >= 2) {
      pathLayers.push(
        new PathLayer({
          id: `path-past-${vehicle_id}`,
          data: [{ path: pastCoords }],
          getPath: (d) => d.path,
          getColor: [251, 201, 108],
          getWidth: 2,
          widthScale: 4,
          opacity: 1,
          pickable: false,
        })
      );
    }
    if (futureCoords.length >= 2) {
      pathLayers.push(
        new PathLayer({
          id: `path-future-${vehicle_id}`,
          data: [{ path: futureCoords }],
          getPath: (d) => d.path,
          getColor: [239, 122, 98],
          getWidth: 2,
          widthScale: 4,
          opacity: 1,
          pickable: false,
        })
      );
    }

    // ---- 승객 수(하차 즉시 반영) ----
    const maxIdx = (Array.isArray(onboardTotal) ? onboardTotal.length : 1) - 1;
    const idx    = Math.max(0, Math.min(Math.floor(rel), maxIdx)); // ← rel 사용
    const onTot  = Array.isArray(onboardTotal) ? Number(onboardTotal[idx] || 0) : 0;
    const onWhl  = Array.isArray(onboardWheel) ? Number(onboardWheel[idx] || 0) : 0;
    const passengerWheel   = Math.max(0, Math.min(1, onWhl));
    const passengerGeneral = Math.max(0, onTot - passengerWheel);

    // 차량 아이콘 데이터

    // ✅ 차량 아이콘 데이터 (프로젝트 규칙: car_{VehicleType}.png)
    const ALLOWED_VEHICLE_TYPES = new Set(["IONIQ5", "carnivalWheel", "carnivalReg"]);

    // 원본 값 보존(대소문자 포함). 파일명이 car_IONIQ5.png 처럼 대문자 포함이면 lowercasing 금지
    const vtRaw = vehicle_type ?? "";
    const vt = String(vtRaw).trim();

    // 허용 타입이면 그대로 사용, 아니면 기본값으로 fallback
    const vtSafe = ALLOWED_VEHICLE_TYPES.has(vt) ? vt : "IONIQ5";
    const iconName = `/car_${vtSafe}.png`;

    // (디버그용) 이상값만 찍기 — 안정화되면 지워도 됨
    if (!ALLOWED_VEHICLE_TYPES.has(vt)) {
      console.log("[VehicleType INVALID]", { vehicle_id, vehicle_type: vtRaw, trimmed: vt, fallback: vtSafe });
    }

    vehicles.push({
      vehicle_id,
      vehicle_type,
      position: pos,
      icon: iconName,
      passengerGeneral,
      passengerWheel,
      passengerCount: passengerGeneral + passengerWheel, // InfoBox 호환용
      startTime: "00:00:00",
    });

    // 상태 점(옵션)
    if (pos && viewport?.project && viewport?.unproject) {
      const now = performance.now();
      const blink = Math.floor((now / 500) % 2) === 0 ? 255 : 50;
      const sp = viewport.project(pos);
      const gp = viewport.unproject([sp[0] + 20, sp[1] - 25]);
      statusDots.push({ position: gp, color: [0, 100, 255, blink] });
    }




    // 정류장 아이콘(중간 정류장만) — ✅ 지나간 정류장 자동 제거(미래 이벤트가 있는 정류장만 남김)
    const nowMs = (typeof v.baseMs === "number" ? v.baseMs : 0) + Math.floor(rel) * 1000;
    const evs = Array.isArray(v.eventsTimeline) ? v.eventsTimeline : [];

    const normStation = (x) => String(x ?? "").trim().replace(/^S/i, "").toUpperCase();

    for (const s of stops || []) {
      const id = s?.station;
      if (!id) continue;

      const want = normStation(id);

      // ✅ 이 정류장에서 “미래 이벤트(>= nowMs)”가 남아있을 때만 아이콘 표시
      const hasFutureEvent = evs.some((ev) => {
        if (!ev) return false;
        if (normStation(ev.station) !== want) return false;
        return typeof ev.ms === "number" && ev.ms >= nowMs;
      });

      if (!hasFutureEvent) continue;

      const coord =
        stationCoords[id] ||
        stationCoords["S" + id] ||
        stationCoords[id?.toUpperCase?.()] ||
        stationCoords[("S" + id)?.toUpperCase?.()];

      if (coord) stationIcons.push({ stationId: id, position: coord, icon: "/station.png" });
    }
  }

  // ---- 차량 아이콘 layer (onHover에 실제 값만 전달) ----
  overlayLayers.push(
    new IconLayer({
      id: "vehicle-icons",
      data: vehicles,
      getIcon: (d) => ({ url: d.icon, width: 128, height: 128, anchorY: 128 }),
      getPosition: (d) => [...d.position, 5],
      getSize: 3,
      sizeScale: 10,
      pickable: true,
      onHover: ({ object, x, y }) => {
        if (object) {
          window.setHoverInfo?.({
            type: "vehicle",
            vehicleId: object.vehicle_id,
            vehicleType: object.vehicle_type,
            passengerTotal: object.passengerCount,
            hasWheelchair: (object.passengerWheel || 0) > 0,
            passengerGeneral: object.passengerGeneral,
            passengerWheel: object.passengerWheel,
            startTime: object.startTime,
            x,
            y,
          });
        } else {
          window.setHoverInfo?.(null);
        }
      },
      parameters: { depthTest: false },
    })
  );

  // ---- 정류장 아이콘 layer ----
  overlayLayers.push(
    new IconLayer({
      id: "station-icons",
      data: stationIcons,
      getIcon: (d) => ({ url: d.icon, width: 80, height: 80, anchorY: 80 }),
      getPosition: (d) => [...d.position, 1],
      getSize: 3,
      sizeScale: 8,
      pickable: true,
      onHover: ({ object, x, y }) => {
        if (object) {
          window.setHoverInfo?.({ type: "station", stationId: object.stationId, x, y });
        } else {
          window.setHoverInfo?.(null);
        }
      },
      parameters: { depthTest: false },
    })
  );

  // ---- 차고지 아이콘(있을 때만) ----
  const garageCoord = garagePosition;
  if (garageCoord && isPt(garageCoord)) {
    overlayLayers.push(
      new IconLayer({
        id: "garage-icon",
        data: [{ position: garageCoord, icon: "/garage.png" }],
        getIcon: (d) => ({ url: d.icon, width: 128, height: 128, anchorY: 128 }),
        getPosition: (d) => [...d.position, 5],
        getSize: 3,
        sizeScale: 10,
        pickable: true,
        parameters: { depthTest: false },
      })
    );
  }

  // ---- 상태 점 layer ----
  overlayLayers.push(
    new ScatterplotLayer({
      id: "status-dots",
      data: statusDots,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getRadius: 3,
      radiusMinPixels: 3,
      pickable: false,
      parameters: { depthTest: false },
    })
  );

  return [...pathLayers, ...overlayLayers];
}
