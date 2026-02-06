// src/ui/AreaModeToggle.jsx
import React from "react";

const BTN_BASE = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.25)",
  color: "white",
  cursor: "pointer",
  fontSize: 13,
  background: "rgba(0,0,0,0.35)",
};


function AreaModeToggle({ areaMode, setAreaMode, coverageVisible, setCoverageVisible, hideUI }) {
  if (hideUI) return null;

  const btnStyle = (active) => ({
    ...BTN_BASE,
    background: active ? "rgba(255,255,255,0.18)" : BTN_BASE.background,
  });

  return (
    <div style={{ position: "absolute", top: 16, left: 16, zIndex: 1200, display: "flex", gap: 8 }}>
      <button style={btnStyle(areaMode === "both")} onClick={() => setAreaMode("both")}>
        전체
      </button>
      <button style={btnStyle(areaMode === "accessible")} onClick={() => setAreaMode("accessible")}>
        교통약자
      </button>
      <button style={btnStyle(areaMode === "underserved")} onClick={() => setAreaMode("underserved")}>
        소외
      </button>
      <button style={btnStyle(coverageVisible)} onClick={() => setCoverageVisible((v) => !v)}>
        서비스 범위 표출
      </button>

    </div>
  );
}

export default AreaModeToggle;
