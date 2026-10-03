export function VoiceWave({ level = 0, active = true }: { level?: number; active?: boolean }) {
  return <span className="voice-wave" aria-label={active ? "Microphone activity" : "Microphone paused"}>
    {[0.35, 0.65, 1, 0.8, 0.5, 0.9, 0.4].map((weight, i) => <span key={i} style={{ height: active ? 3 + level * weight * 17 : 3, animationDelay: `${i * 100}ms` }} />)}
  </span>;
}
