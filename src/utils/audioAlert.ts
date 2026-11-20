/**
 * نظام التنبيه الصوتي الحاد والمكثف (High-Pitch Warning Sound / Beep)
 * لتنبيه المستخدم ميدانياً فور استبعاد أو تجاهل أي سطر من الورقة.
 * تم تصميمه باستخدام Web Audio API ليعمل على كافة الأجهزة والهواتف الذكية دون ملفات صوتية خارجية.
 */

export function playHighPitchWarningAlert(): void {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // تشغيل الاهتزاز في الهواتف الميدانية (Haptic Alert)
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([250, 100, 250, 100, 400]);
    }

    const now = ctx.currentTime;

    // دالة توليد نبضة حادة بتردد وترتيب زمني محدد
    const playPulse = (frequency: number, startTime: number, duration: number, type: OscillatorType = 'sawtooth') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, startTime);

      // هجوم سريع مع تخامد لإنتاج صوت Beep حاد ومسموع في بيئات المستودعات
      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.exponentialRampToValueAtTime(0.8, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    // نغمة تحذير ثلاثية حادة (Triple Piercing Warning Alert):
    // Pulse 1: 950 Hz
    // Pulse 2: 1350 Hz (High Pitch)
    // Pulse 3: 1100 Hz
    playPulse(950, now, 0.16, 'sawtooth');
    playPulse(1350, now + 0.20, 0.20, 'square');
    playPulse(1100, now + 0.44, 0.24, 'sawtooth');
  } catch (e) {
    console.warn('Audio alert playback failed:', e);
  }
}
