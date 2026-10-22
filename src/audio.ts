interface ToneOptions {
  freq: number;
  end?: number;
  duration?: number;
  type?: OscillatorType;
  volume?: number;
  delay?: number;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private muted = false;
  private master: GainNode | null = null;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.045, this.ctx.currentTime, 0.02);
    }
  }

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.045;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private tone({
    freq,
    end = freq,
    duration = 0.09,
    type = 'sine',
    volume = 1,
    delay = 0,
  }: ToneOptions): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, end), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  click(): void {
    this.tone({ freq: 760, end: 620, duration: 0.035, type: 'triangle', volume: 0.35 });
  }

  place(): void {
    this.tone({ freq: 240, end: 300, duration: 0.08, type: 'triangle', volume: 0.7 });
    this.tone({ freq: 480, end: 560, duration: 0.11, type: 'sine', volume: 0.35, delay: 0.03 });
  }

  connect(): void {
    this.tone({ freq: 520, end: 660, duration: 0.07, type: 'sine', volume: 0.5 });
    this.tone({ freq: 780, end: 980, duration: 0.09, type: 'sine', volume: 0.3, delay: 0.05 });
  }

  disconnect(): void {
    this.tone({ freq: 340, end: 220, duration: 0.08, type: 'triangle', volume: 0.35 });
  }

  upgrade(): void {
    this.tone({ freq: 420, end: 630, duration: 0.12, type: 'triangle', volume: 0.5 });
    this.tone({ freq: 630, end: 840, duration: 0.16, type: 'sine', volume: 0.3, delay: 0.08 });
  }

  dismantle(): void {
    this.tone({ freq: 300, end: 140, duration: 0.13, type: 'sawtooth', volume: 0.18 });
  }

  deny(): void {
    this.tone({ freq: 150, end: 110, duration: 0.1, type: 'square', volume: 0.12 });
  }

  discover(): void {
    const notes = [392, 523.25, 659.25, 783.99];
    notes.forEach((freq, index) => {
      this.tone({ freq, duration: 0.22, type: 'sine', volume: 0.32, delay: index * 0.075 });
    });
  }
}
