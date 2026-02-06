import { useState } from "react";
import { controlBoxStyle, darkButtonStyle } from "./CommonStyles";

function RecordingController({ setHideUI }) {
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const chunks = [];

  const handleStartRecording = async () => {
    console.log("🟢 녹화 시작");

    try {
      setHideUI(true); // ✅ UI 숨기기

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 }
      });

      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `simulation_${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
        a.click();
        chunks.length = 0;
        setHideUI(false); // ✅ UI 다시 보이기
      };

      recorder.start();
      console.log("🎥 녹화 중...");
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      console.error("❌ 녹화 실패", err);
      setHideUI(false);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  return (
    <div style={controlBoxStyle}>
      {!isRecording ? (
        <button style={darkButtonStyle} onClick={handleStartRecording}>⏺️ 화면 녹화 시작</button>
      ) : (
        <button style={darkButtonStyle} onClick={handleStopRecording}>⏹️ 녹화 종료 및 저장</button>
      )}
    </div>
  );
}

export default RecordingController;
