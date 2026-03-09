import { useRef, useState } from "react";
import { controlBoxStyle, darkButtonStyle } from "./CommonStyles";

function RecordingController({ setHideUI }) {
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const chunksRef = useRef([]);

  const canRecord =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator?.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function";

  const handleStartRecording = async () => {
    console.log("🟢 녹화 시작");

    // ✅ 지원 안 되는 환경이면 여기서 종료
    if (!canRecord) {
      console.warn("❌ getDisplayMedia 사용 불가(HTTPS/권한/브라우저 지원 확인 필요)");
      alert("화면 녹화는 HTTPS(또는 localhost)에서만 동작합니다.");
      return;
    }

    try {
      setHideUI(true);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });

      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `simulation_${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
        a.click();

        URL.revokeObjectURL(url);
        chunksRef.current = [];
        setHideUI(false);
      };

      // 사용자가 “공유 중지”를 누르면 자동 종료 처리
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        try { recorder.stop(); } catch {}
      });

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
        <button style={darkButtonStyle} onClick={handleStartRecording}>
          ⏺️ 화면 녹화 시작
        </button>
      ) : (
        <button style={darkButtonStyle} onClick={handleStopRecording}>
          ⏹️ 녹화 종료 및 저장
        </button>
      )}
    </div>
  );
}

export default RecordingController;
