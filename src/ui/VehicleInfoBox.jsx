import React from "react";

/**
 * VehicleInfoBox (FINAL)
 * - 출발시간: 표시 안 함
 * - 다음 도착 정류장: 표시 안 함
 * - 도착예정시간: 표시 안 함
 * - 승객수만 표시
 */
export function VehicleInfoBox({
  vehicleId,
  vehicleType,

  // 승객(신규)
  passengerTotal,
  hasWheelchair,

  // 승객(구형/하위호환)
  passengerGeneral,
  passengerWheel,

  position,
}) {
  // 1) 휠체어 탑승 수 (최대 1)
  const wheelFromNew =
    hasWheelchair === true || hasWheelchair === 1 || hasWheelchair === "1" ? 1 : 0;
  const wheel = typeof passengerWheel === "number" ? passengerWheel : wheelFromNew;

  // 2) 일반 승객 수
  const generalFromNew =
    typeof passengerTotal === "number"
      ? Math.max(0, passengerTotal - wheel)
      : undefined;

  const general =
    typeof passengerGeneral === "number"
      ? passengerGeneral
      : typeof generalFromNew === "number"
        ? generalFromNew
        : 0;

  // 3) 총 승객 수 (표시용)
  const total =
    typeof passengerTotal === "number"
      ? passengerTotal
      : typeof passengerGeneral === "number" || typeof passengerWheel === "number"
        ? (passengerGeneral || 0) + (passengerWheel || 0)
        : general + wheel;

  return (
    <div
      style={{
        position: "absolute",
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        background: "white",
        border: "1px solid #ccc",
        padding: "8px",
        borderRadius: "6px",
        zIndex: 10,
        maxWidth: "260px",
        fontSize: "11px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
        pointerEvents: "none",
        transform: "translateY(-100%)",
      }}
    >
      <strong>VehicleID:</strong> {vehicleId}
      <br />
      <strong>VehicleType:</strong> {vehicleType ?? "-"}
      <hr />

      {/* 승객 수 */}
      <div style={{ lineHeight: 1.5 }}>
        <div>
          <strong>탑승 승객 수:</strong> {total}
        </div>
        <div>일반: {general}</div>
        <div>휠체어: {wheel}</div>
      </div>
    </div>
  );
}
