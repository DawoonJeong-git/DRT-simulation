// /SRC/deck/adapters/segmentsAdapter.js
import { cumulativeDistances, interpolateAlong } from "../utils/interp.js";

// 정류장 ID 정규화: 대문자 + 선행 'S' 제거
function normStopId(x) {
  if (x == null) return null;
  return String(x).trim().replace(/^S/i, "").toUpperCase();
}
function to01(x) {
  return (x === 1 || x === true || x === "1") ? 1 : 0;
}

const FIVE_MIN = 5 * 60 * 1000; // 5분(ms)

function pickRouteIdFromTrip(trip, operation_id) {
  // trip 내 모든 segment에서 route 후보를 긁어오고,
  // operation_id와 동일한 값(오염값)은 버린다.
  for (const seg of (trip || [])) {
    const c =
      seg?.routeID ??
      seg?.routeId ??
      seg?.route_id ??
      seg?.routeCode ??
      seg?.route ??
      null;

    if (c == null) continue;
    if (operation_id != null && String(c) === String(operation_id)) continue; // ✅ 오염 제거
    return c; // 첫 정상 후보
  }
  return null;
}


export function segmentsToRouteData(segments, baseMs, windowMs = 24 * 3600 * 1000) {
  const startMs = baseMs;
  const endMs   = baseMs + windowMs;
  const SEC     = 1000;
  const totalSec = Math.round(windowMs / SEC);

  // (1) 차량/운행 키로 그룹

  const byRunKey = new Map();
  for (const s of (Array.isArray(segments) ? segments : [])) {
    const oid = s?.operationID;
    const vid = s?.vehicleID;

    // vehicleID와 operationID 둘 다 없으면 차량 구분 불가 → 제외
    if (!oid || !vid) continue;
    if (s.originMs == null || s.destMs == null) continue;
    if (!Array.isArray(s.polyline) || s.polyline.length < 2) continue;

    // ✅ 반드시 operationID + vehicleID 조합
    const key = `${oid}|||${vid}`;

    if (!byRunKey.has(key)) byRunKey.set(key, []);
    byRunKey.get(key).push(s);
  }

  const vehiclesOut = [];

  for (const [, segs0] of byRunKey) {
    // (2) 창과 겹치는 세그먼트만, 운행 순으로 정렬
    const segs = segs0
      .filter(s => s.originMs <= endMs && s.destMs >= startMs)
      .sort((a, b) => {
        const ra = Number.isFinite(a.routeInfo) ? a.routeInfo : 0;
        const rb = Number.isFinite(b.routeInfo) ? b.routeInfo : 0;
        if (ra !== rb) return ra - rb;
        if (a.originMs !== b.originMs) return (a.originMs || 0) - (b.originMs || 0);
        return (a.destMs || 0) - (b.destMs || 0);
      });

    if (segs.length === 0) continue;

    // (3) trip 분할
    const trips = [];
    let cur = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1];
      const next = segs[i];
      const contiguous =
        (next.routeInfo === (prev.routeInfo + 1)) &&
        (prev.destStationID === next.originStationID) &&
        ((next.originMs - prev.destMs) <= FIVE_MIN);
      if (contiguous) cur.push(next);
      else { trips.push(cur); cur = [next]; }
    }
    trips.push(cur);

    // (4) 각 trip을 절대초 타임라인에 매핑
    for (const trip of trips) {
      const coords  = new Array(totalSec + 1).fill(null);
      const covered = new Array(totalSec + 1).fill(false);

      for (let i = 0; i < trip.length; i++) {
        const seg = trip[i];
        const poly = seg.polyline;
        const cum  = cumulativeDistances(poly);
        const tot  = cum[cum.length - 1] || 1;

        // 경계 엄격화: 시작=출발 ‘이후’ 첫 초, 끝=도착 ‘이전’ 마지막 초
        const segS = seg.originMs;
        const segE = Math.min(seg.destMs, endMs);
        if (segE <= startMs || segE <= segS) continue;

        const i0 = Math.ceil((segS - startMs) / SEC);
        const i1 = Math.floor((segE - startMs) / SEC);
        if (i1 < i0) continue;

        for (let t = i0; t <= i1; t++) covered[t] = true;

        for (let t = i0; t <= i1; t++) {
          if (coords[t] != null) continue;
          const ms = startMs + t * SEC;
          const p  = Math.min(1, Math.max(0, (ms - seg.originMs) / Math.max(1, seg.destMs - seg.originMs)));
          const pt = interpolateAlong(poly, cum, tot * p);
          if (pt) coords[t] = pt;
        }

        // 연속(같은 정류장) + ≤5분이면 대기 좌표 유지
        const next = trip[i + 1];
        if (next &&
            (next.routeInfo === seg.routeInfo + 1) &&
            (seg.destStationID === next.originStationID)) {
          const gapMs = next.originMs - seg.destMs;
          if (gapMs > 0 && gapMs <= FIVE_MIN) {
            const endIdx  = Math.floor((Math.min(seg.destMs, endMs) - startMs) / SEC);
            const nextIdx = Math.ceil((Math.max(next.originMs, startMs) - startMs) / SEC);
            const endPt   = interpolateAlong(poly, cum, tot * 1.0);
            for (let t = endIdx + 1; t < nextIdx; t++) {
              covered[t] = true;
              if (coords[t] == null && endPt) coords[t] = endPt;
            }
          }
        }
      }

      // 세그먼트 ‘내부/대기’만 ffill — 운행 밖은 null 유지
      let last = null;
      for (let i = 0; i < coords.length; i++) {
        if (!covered[i]) { last = null; continue; }
        if (coords[i] == null && last) coords[i] = last;
        else if (coords[i] != null) last = coords[i];
      }

      // stops: 중간 정류장(첫 origin / 마지막 dest 제외)
      const firstOrigin = normStopId(trip[0]?.originStationID);
      const lastDest    = normStopId(trip[trip.length - 1]?.destStationID);
      const stationSet = new Set();
      for (const seg of trip) {
        const o = normStopId(seg.originStationID);
        const d = normStopId(seg.destStationID);
        if (o && o !== firstOrigin) stationSet.add(o);
        if (d && d !== lastDest)    stationSet.add(d);
      }
      const stops = Array.from(stationSet).map(id => ({ station: id }));

      // 이벤트 타임라인(절대 ms) 생성
      // seg.events는 스키마 A( pickup_total / dropoff_total ) 또는
      // 스키마 B( origin.board / dest.alight )가 올 수 있음
      const eventsTimeline = [];
      for (const seg of trip) {
        const oId = normStopId(seg.originStationID);
        const dId = normStopId(seg.destStationID);

        const e = seg.events || {};
        const o = e.origin || {};
        const d = e.dest   || {};

        let p_up   = Number(o.pickup_total ?? 0);
        let w_up   = to01(o.pickup_wheelchair ?? 0);
        let p_down = Number(d.dropoff_total ?? 0);
        let w_down = to01(d.dropoff_wheelchair ?? 0);

        const hasSchemaB = (o.board !== undefined) || (d.alight !== undefined) || (o.alight !== undefined) || (d.board !== undefined);
        if (hasSchemaB) {
          p_up   = Number(o.board?.passenger  ?? 0);
          w_up   = to01(o.board?.wheelchair   ?? 0);
          p_down = Number(d.alight?.passenger ?? 0);
          w_down = to01(d.alight?.wheelchair  ?? 0);
        }

        eventsTimeline.push({
          ms: seg.originMs,
          station: oId,
          phase: "depart",   
          pickup_total: p_up,
          pickup_wheelchair: w_up,
          dropoff_total: 0,
          dropoff_wheelchair: 0
        });
        eventsTimeline.push({
          ms: seg.destMs,
          station: dId,
          phase: "arrive",   
          pickup_total: 0,
          pickup_wheelchair: 0,
          dropoff_total: p_down,
          dropoff_wheelchair: w_down
        });
      }
      eventsTimeline.sort((a,b)=>a.ms-b.ms);

      // 온보드 배열(초 단위) 생성: 하차 즉시 감소, covered 밖은 0
      const onboardTotal = new Array(totalSec + 1).fill(0);
      const onboardWheel = new Array(totalSec + 1).fill(0);

      const deltas = {}; // { idx: { tot: +/-, whl: +/0/- } }
      for (const ev of eventsTimeline) {
        const idx = Math.floor((ev.ms - startMs) / SEC);  // ★ floor: 즉시 반영
        if (idx < 0 || idx > totalSec) continue;
        const whlDelta = to01(ev.pickup_wheelchair) - to01(ev.dropoff_wheelchair);
        const totDelta = (ev.pickup_total || 0)      - (ev.dropoff_total || 0);
        if (!deltas[idx]) deltas[idx] = { tot: 0, whl: 0 };
        deltas[idx].tot += totDelta;
        deltas[idx].whl += whlDelta;
      }

      // covered(운행/대기) 구간에서만 유효
      let curTot = 0, curWhl = 0;
      for (let i = 0; i <= totalSec; i++) {
        if (deltas[i]) {
          curTot += deltas[i].tot;
          curWhl  = Math.max(0, Math.min(1, curWhl + deltas[i].whl)); // 휠 0/1 clamp
          curTot  = Math.max(0, curTot);
        }
        onboardTotal[i] = covered[i] ? curTot : 0;
        onboardWheel[i] = covered[i] ? curWhl : 0;
      }

      // 출력
      const firstSeg = trip[0];

      // ✅ grouping key는 내부에서만 사용 (필요하면 runKey로 보관)
      const runKey = `${firstSeg.operationID}|||${firstSeg.vehicleID}`;


      const operation_id = firstSeg.operationID ?? null;
      const vehicle_id   = firstSeg.vehicleID ?? null;

      // route 후보 키를 넓게 (데이터마다 이름이 다를 수 있음)
      const routeCandidate =
        firstSeg.routeID ??
        firstSeg.routeId ??
        firstSeg.route_id ??
        firstSeg.routeCode ??
        firstSeg.route ??
        null;

      // ✅ route가 operation과 같으면(현재 네 증상), route는 없다고 보고 null 처리
      const route_id = pickRouteIdFromTrip(trip, operation_id);

      const vehicle_type = firstSeg.vehicleType || "car";

      vehiclesOut.push({
        // (선택) runKey가 필요하면 남겨두기
        runKey,

        operation_id,
        vehicle_id,
        route_id,
        vehicle_type,

        start_time: "00:00:00",
        baseMs: startMs,
        coords,
        stops,
        eventsTimeline,
        onboardTotal,
        onboardWheel,
      });

    }
  }

  return vehiclesOut;
}
