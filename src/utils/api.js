// src/utils/api.js

export function getAPIBase() {
  const isLocalhost = window.location.hostname === "localhost";
  return isLocalhost
    ? "http://localhost:5000"
    : "https://flask-drt-backend.onrender.com";  // ← 실제 Render 주소로 교체
}
