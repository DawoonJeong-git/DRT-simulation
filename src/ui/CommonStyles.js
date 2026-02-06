// src/ui/CommonStyles.js

export const controlBoxStyle = {
  backgroundColor: "rgba(30,30,30,0.85)",
  color: "white",
  padding: "6px 10px",
  borderRadius: "8px",
  border: "1px solid #444",
  boxShadow: "0 0 6px rgba(0,0,0,0.3)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontSize: "14px",
  overflow: "hidden",
};

export const darkButtonStyle = {
  backgroundColor: "#2a2a2a",
  color: "white",
  border: "1px solid #555",
  borderRadius: "6px",
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: "1em",
  textAlign: "center",
};

export const miniTextStyle = {
  fontSize: "0.85em",
  color: "#ccc",
};

export const fixedMonoTextStyle = {
  fontFamily: "monospace",
  width: "3.5em",
  display: "inline-block",
  fontSize: "1.2em",
  textAlign: "center",
};

export const fixedSpeedLabelStyle = {
  fontFamily: "monospace",
  fontSize: "0.9em",
  width: "100px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  textAlign: "left",
  overflow: "hidden",
  whiteSpace: "nowrap",
};

export const bottomPanelStyle = {
  position: "absolute",
  bottom: 20,
  left: 20,
  right: 20,
  display: "flex",
  flexDirection: "row",
  flexWrap: "nowrap", // ✅ 줄바꿈 방지
  alignItems: "center",
  justifyContent: "space-between", // 각 요소 사이 넓게 분배
  gap: "16px",
  padding: "12px 20px",
  backgroundColor: "rgba(30,30,30,0.85)",
  borderRadius: "12px",
  boxShadow: "0 0 8px rgba(0,0,0,0.4)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontSize: "14px",
  zIndex: 1000,
  overflowX: "auto", // ✅ 필요 시 좌우 스크롤 허용
  overflowY: "hidden",
  whiteSpace: "nowrap", // ✅ 요소 줄바꿈 방지
};
