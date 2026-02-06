// src/ui/PlaybackController.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { controlBoxStyle, darkButtonStyle } from "./CommonStyles";

function PlaybackController({
  elapsedTime,
  setElapsedTime,
  isPlaying,
  setIsPlaying,
  speed,
  setSpeed,
  baseDateMs,
  setBaseDateMs,
  isLive,
  setIsLive,
}) {
  const SLIDER_MAX = 24 * 3600;
  const SLIDER_STEP = 60;

  const [hour, setHour] = useState("00");
  const [minute, setMinute] = useState("00");
  const [second, setSecond] = useState("00");

  const hourRef = useRef(null);
  const minuteRef = useRef(null);
  const secondRef = useRef(null);

  // 날짜 문자열(YYYY-MM-DD)
  const dateStr = useMemo(() => {
    const ms =
      typeof baseDateMs === "number"
        ? baseDateMs
        : (() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d.getTime();
          })();
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, [baseDateMs]);

  // 날짜 변경 = replay 모드 + baseDate 변경
  const onDateChange = (e) => {
    const v = e.target.value; // "YYYY-MM-DD"
    if (!v) return;

    setIsLive?.(false);

    const ms = new Date(`${v}T00:00:00`).getTime();
    setBaseDateMs?.(ms);

    setIsPlaying(false);
    setElapsedTime(0);
  };

  const handleReset = useCallback(() => {
    setElapsedTime(0);
    setIsPlaying(false);
    setSpeed(1);
  }, [setElapsedTime, setIsPlaying, setSpeed]);

  const handlePlayToggle = useCallback(() => {
    if (isLive) return;
    setIsPlaying((prev) => !prev);
  }, [isLive, setIsPlaying]);

  // ✅ 실시간 모드: requestAnimationFrame으로 부드럽게 elapsedTime 동기화
  useEffect(() => {
    if (!isLive) return;

    setIsPlaying(false);

    let rafId = null;
    const startPerf = performance.now();
    const startAbs = (() => {
      const now = new Date();
      return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    })();

    const tick = () => {
      const dt = (performance.now() - startPerf) / 1000;
      const rel = startAbs + dt;
      const clamped = Math.max(0, Math.min(SLIDER_MAX, rel));
      setElapsedTime(clamped);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => rafId && cancelAnimationFrame(rafId);
  }, [isLive, setElapsedTime, setIsPlaying]);

  // ▶/⏸ + 속도 반영(실시간 OFF 시에만 적용)
  useEffect(() => {
    if (isLive) return;
    let animationFrameId = null;
    let lastTime = performance.now();

    const animate = () => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      if (isPlaying) {
        setElapsedTime((prev) => Math.max(0, Math.min(SLIDER_MAX, prev + delta * speed)));
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, speed, isLive, setElapsedTime]);

  // ⏱ 표시(자정 + elapsedTime)
  useEffect(() => {
    const total = Math.floor(elapsedTime);
    setHour(String(Math.floor(total / 3600)).padStart(2, "0"));
    setMinute(String(Math.floor((total % 3600) / 60)).padStart(2, "0"));
    setSecond(String(Math.floor(total % 60)).padStart(2, "0"));
  }, [elapsedTime]);

  // 단축키(실시간 ON일 때는 비활성)
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase();
      const isTypingField = ["input", "textarea", "select"].includes(tag);
      const key = e.key.toLowerCase();

      if (key === " " && !isTypingField && !isLive) {
        e.preventDefault();
        handlePlayToggle();
      } else if (key === "r" && !isTypingField && !isLive) {
        e.preventDefault();
        handleReset();
      } else if (key === "arrowdown" && !isLive) {
        e.preventDefault();
        handleSpeedDecrease();
      } else if (key === "arrowup" && !isLive) {
        e.preventDefault();
        handleSpeedIncrease();
      } else if (key === "arrowleft" && !isLive) {
        e.preventDefault();
        setElapsedTime((prev) => Math.max(0, prev - SLIDER_STEP));
      } else if (key === "arrowright" && !isLive) {
        e.preventDefault();
        setElapsedTime((prev) => Math.min(SLIDER_MAX, prev + SLIDER_STEP));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLive, setElapsedTime, handlePlayToggle, handleReset]);

  const handleSliderChange = (e) => {
    setElapsedTime(parseFloat(e.target.value));
  };

  const handleTimeApply = () => {
    const totalSec = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
    const rel = totalSec;
    if (!isNaN(rel) && rel >= 0 && rel <= SLIDER_MAX) {
      setElapsedTime(rel);
      setIsPlaying(false);
    }
  };

  const handleKeyDown = (e, field) => {
    if (e.key === "Enter") {
      handleTimeApply();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (field === "hh") minuteRef.current?.focus();
      else if (field === "mm") secondRef.current?.focus();
      else if (field === "ss") hourRef.current?.focus();
    }
  };

  const handleSpeedChange = (e) => setSpeed(parseInt(e.target.value));
  const handleSpeedDecrease = () => setSpeed((s) => Math.max(1, s - 1));
  const handleSpeedIncrease = () => setSpeed((s) => Math.min(100, s + 1));

  const liveBtnStyle = {
    ...darkButtonStyle,
    background: isLive ? "#1e90ff" : darkButtonStyle.background || "#333",
    border: isLive ? "1px solid #5fb3ff" : darkButtonStyle.border || "none",
  };

  return (
    <div
      style={{
        ...controlBoxStyle,
        display: "flex",
        flexWrap: "nowrap",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "1em",
        whiteSpace: "nowrap",
      }}
    >
      {/* 실시간 토글 */}
      <div style={{ display: "flex", gap: "0.5em", flexShrink: 0 }}>
        <button
          style={liveBtnStyle}
          onClick={() => setIsLive?.((v) => !v)}
          title="오늘 현재 시각과 동기화(자정 기준 0~24h)"
        >
          {isLive ? "🟢 실시간" : "⚪ 실시간"}
        </button>
      </div>

      {/* 날짜 입력 */}
      <input
        type="date"
        value={dateStr}
        onChange={onDateChange}
        onFocus={() => {
          if (isLive) setIsLive?.(false);
        }}
        style={{
          background: "#222",
          color: "#fff",
          border: "1px solid #555",
          borderRadius: 6,
          padding: "4px 6px",
        }}
        title="재생 기준 날짜(자정~자정)"
      />

      {/* ▶/⏸ + 초기화 */}
      <div style={{ display: "flex", gap: "0.5em", flexShrink: 0 }}>
        <button
          style={{ ...darkButtonStyle, opacity: isLive ? 0.5 : 1, pointerEvents: isLive ? "none" : "auto" }}
          onClick={handlePlayToggle}
        >
          {isPlaying ? "⏸ 재생/정지" : "▶️ 재생/정지"}
        </button>
        <button
          style={{ ...darkButtonStyle, opacity: isLive ? 0.5 : 1, pointerEvents: isLive ? "none" : "auto" }}
          onClick={handleReset}
        >
          🔁 초기화
        </button>
      </div>

      {/* 슬라이더 + 시간 입력 */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.8em", flexShrink: 0 }}>
        <input
          type="range"
          min={0}
          max={SLIDER_MAX}
          step={SLIDER_STEP}
          value={elapsedTime}
          onChange={handleSliderChange}
          disabled={isLive}
          style={{ width: "250px", opacity: isLive ? 0.5 : 1 }}
        />
        <span style={{ whiteSpace: "nowrap" }}>
          <input
            ref={hourRef}
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "hh")}
            disabled={isLive}
            style={{ width: "2.8em", fontSize: "1em", textAlign: "center", fontFamily: "monospace", opacity: isLive ? 0.6 : 1 }}
          />
          :
          <input
            ref={minuteRef}
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "mm")}
            disabled={isLive}
            style={{ width: "2.8em", fontSize: "1em", textAlign: "center", fontFamily: "monospace", opacity: isLive ? 0.6 : 1 }}
          />
          :
          <input
            ref={secondRef}
            value={second}
            onChange={(e) => setSecond(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "ss")}
            disabled={isLive}
            style={{ width: "2.8em", fontSize: "1em", textAlign: "center", fontFamily: "monospace", opacity: isLive ? 0.6 : 1 }}
          />
        </span>
        <button
          style={{ ...darkButtonStyle, opacity: isLive ? 0.5 : 1, pointerEvents: isLive ? "none" : "auto" }}
          onClick={handleTimeApply}
        >
          적용
        </button>
      </div>

      {/* 속도 조절 */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5em", flexShrink: 0 }}>
        <span style={{ fontFamily: "monospace", fontWeight: "bold" }}>
          Speed: x&nbsp;
          <span style={{ display: "inline-block", fontFamily: "monospace", width: "50px", textAlign: "right" }}>
            {speed.toFixed(1)}
          </span>
        </span>

        <button
          style={{ ...darkButtonStyle, opacity: isLive ? 0.5 : 1, pointerEvents: isLive ? "none" : "auto" }}
          onClick={handleSpeedDecrease}
        >
          –
        </button>
        <input
          type="range"
          min="1"
          max="100"
          step="1"
          value={speed}
          onChange={handleSpeedChange}
          disabled={isLive}
          style={{ width: "100px", opacity: isLive ? 0.5 : 1 }}
        />
        <button
          style={{ ...darkButtonStyle, opacity: isLive ? 0.5 : 1, pointerEvents: isLive ? "none" : "auto" }}
          onClick={handleSpeedIncrease}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default PlaybackController;
