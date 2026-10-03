import { useEffect, useState } from "react";

export function useMicrophoneMeter(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) { setLevel(0); return; }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) / data.length);
      setLevel(Math.min(1, rms * 8));
    }, 70);
    void context.resume();
    return () => { clearInterval(timer); source.disconnect(); void context.close(); };
  }, [stream]);
  return level;
}