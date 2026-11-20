/**
 * ブラウザ標準の Web Audio API で呼び出し時の簡易通知音を鳴らします。
 * 外部音声ファイル不要で動作します。
 */
export function playCallChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime

    const notes = [880, 1174.66] // A5 -> D6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + idx * 0.16)
      gain.gain.setValueAtTime(0.001, now + idx * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.16 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + idx * 0.16)
      osc.stop(now + idx * 0.16 + 0.36)
    })
  } catch {
    // ユーザー操作前の自動再生制限などで鳴らせない場合は無視
  }
}
