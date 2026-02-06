export function getUpcomingVehiclesByStation(routeData, elapsedTime, stationCoords) {
  const stationMap = {};
  const simStartSec = 8 * 3600; // 시뮬 시작 기준

  for (const vehicle of routeData) {
    const [hh, mm, ss] = vehicle.start_time.split(":").map(Number);
    const startSec = hh * 3600 + mm * 60 + (ss || 0);
    const delay = startSec - simStartSec;
    const relativeTime = elapsedTime - delay;

    if (relativeTime < 0) continue; // 아직 출발 안 함

    const stops = vehicle.stops || [];
    const totalCoords = vehicle.coords?.length || 0;
    if (totalCoords === 0 || stops.length === 0) continue;

    // ⚠️ 정류장 수 + 구간 수 기준으로 전체 시간을 나누어 정류장 시간 추정
    const totalStopCount = stops.length;
    const stopArrivalSeconds = []; // 각 stop별 도착 예상 시간

    const secondsPerStop = totalCoords / (totalStopCount + 1); // 중간지점 기준 추정
    for (let i = 0; i < totalStopCount; i++) {
      stopArrivalSeconds.push((i + 1) * secondsPerStop); // 점점 뒤로 도착
    }

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const station = stop.station;
      const coord = stationCoords[station];
      if (!coord) continue;

      const stopTime = stopArrivalSeconds[i];

      // ⛔ 이미 지난 정류장 제외
      if (relativeTime > stopTime + 60) continue;

      // ✅ 아직 도착 전이면 포함
      if (relativeTime <= stopTime) {
        const entry = {
          vehicle_id: vehicle.vehicle_id,
          vehicle_type: vehicle.vehicle_type,
          pickup_general: stop.pickup_general || 0,
          pickup_wheelchair: stop.pickup_wheelchair || 0,
          dropoff_general: stop.dropoff_general || 0,
          dropoff_wheelchair: stop.dropoff_wheelchair || 0,
          etd: simStartSec + delay + stopTime,
        };

        if (!stationMap[station]) stationMap[station] = [];
        stationMap[station].push(entry);
      }
    }
  }

  return stationMap;
}
