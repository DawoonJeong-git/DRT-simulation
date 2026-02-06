// src/deck/StationLayer.jsx (교체)
import { IconLayer } from "@deck.gl/layers";

export function StationLayer({ stationCoords, routeData, elapsedTime, setHoverInfo, setSelectedInfo }) {
  const visibleStationIds = new Set();

  const sec = Math.max(0, Math.floor(elapsedTime || 0));
  for (const vehicle of routeData) {
    const coords = vehicle?.coords || [];
    // 🔴 핵심: 그 시각의 좌표가 실제로 존재할 때만 정류장을 노출
    if (!Array.isArray(coords) || !coords[sec] || coords[sec].length !== 2) continue;

    for (const stop of vehicle.stops || []) {
      if (stop?.station) visibleStationIds.add(stop.station);
    }
  }

  const data = [...visibleStationIds]
    .filter(id => Array.isArray(stationCoords[id]))
    .map(id => ({ stationId: id, coordinates: stationCoords[id] }));

  return new IconLayer({
    id: "station-icons",
    data,
    pickable: true,
    getPosition: d => d.coordinates,
    getIcon: () => ({ url: "/station.png", width: 128, height: 128, anchorY: 128 }),
    sizeScale: 1,
    getSize: 30,
    onHover: ({ object, x, y }) => {
      setHoverInfo?.(object ? { type: "station", stationId: object.stationId, x, y } : null);
    },
    onClick: ({ object, x, y }) => {
      if (object) setSelectedInfo?.({ type: "station", stationId: object.stationId, x, y });
    },
  });
}
