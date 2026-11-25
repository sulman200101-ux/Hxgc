export type OperationSound = 'duplicate' | 'issued' | 'uncertain';
export const SOUND_PATTERNS: Record<OperationSound, readonly number[]> = {
  duplicate: [440, 440, 220],
  issued: [523, 659, 784],
  uncertain: [880, 440, 880, 440],
};
let context: AudioContext | undefined;
export function prepareAudio(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch { /* Text feedback remains available when sound is unavailable. */ }
}
export function playOperationSound(kind: OperationSound): void {
  prepareAudio();
  if (!context) return;
  const now = context.currentTime;
  SOUND_PATTERNS[kind].forEach((frequency, index) => {
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();
    const start = now + index * 0.19;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.15, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    oscillator.connect(gain); gain.connect(context!.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start); oscillator.stop(start + 0.17);
  });
}
