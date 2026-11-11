/**
 * AudioEngine.js
 * 100% procedural WebAudio synthesizer & reactive meadow soundscape for Tiny Glade.
 * Zero external audio assets; respects browser user-gesture unlock & headless safety.
 */

const MARIMBA_SCALE_HZ = [
  293.66, // D4
  329.63, // E4
  369.99, // F#4
  440.00, // A4
  493.88, // B4
  587.33, // D5
  659.25, // E5
  739.99, // F#5
  880.00, // A5
];

const HARP_SCALE_HZ = [
  293.66, // D4
  329.63, // E4
  369.99, // F#4
  440.00, // A4
  493.88, // B4
  587.33, // D5
  659.25, // E5
  739.99, // F#5
];

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export class AudioEngine {
  constructor(opts = {}) {
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.echoInput = null;

    this.muted = Boolean(opts.muted ?? false);
    this.volume = clamp(Number(opts.volume ?? 0.72), 0, 1);

    this._noiseBuffer = null;
    this._breezeNode = null;
    this._breezeFilterLP = null;
    this._breezeGain = null;

    this._ambienceTime = 0;
    this._birdTimer = 1.8 + Math.random() * 2.5;
    this._cricketTimer = 1.2 + Math.random() * 2.0;
    this._harpTimer = 3.2 + Math.random() * 4.0;
    this._lastHarpIndex = -1;

    this._lastBrickTime = 0;
    this._lastPathTime = 0;
    this._lastSplashTime = 0;
    this._lastTickTime = 0;

    this._boundGestureUnlock = () => {
      this.unlock();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this._boundGestureUnlock, { passive: true });
      window.addEventListener('keydown', this._boundGestureUnlock, { passive: true });
    }
  }

  /**
   * Unlocks or initializes the WebAudio context on a user gesture.
   */
  unlock() {
    if (typeof window === 'undefined') return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    try {
      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this._buildGraph();
      }
      if (this.ctx.state === 'suspended') {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
      if (this.ctx.state === 'running' && this._boundGestureUnlock) {
        window.removeEventListener('pointerdown', this._boundGestureUnlock);
        window.removeEventListener('keydown', this._boundGestureUnlock);
        this._boundGestureUnlock = null;
      }
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  _isReady() {
    return Boolean(this.ctx && !this.muted && this.ctx.state === 'running');
  }

  _buildGraph() {
    const ctx = this.ctx;
    if (!ctx) return;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.16;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;
    this.masterGain.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    // Warm valley echo send for acoustic harp, birds & completion chimes
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.24;
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 1750;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.24;
    const wet = ctx.createGain();
    wet.gain.value = 0.20;

    delay.connect(echoFilter);
    echoFilter.connect(feedback);
    feedback.connect(delay);
    echoFilter.connect(wet);
    wet.connect(this.masterGain);
    this.echoInput = delay;

    // Synthesize reusable 4-second pink-ish noise buffer (zero runtime allocations)
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * 4.0);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      // Smooth loop crossfade at buffer boundaries
      const edge = Math.min(i, length - 1 - i);
      const fade = edge < 1024 ? edge / 1024 : 1.0;
      data[i] = clamp(pink * fade, -0.95, 0.95);
    }
    this._noiseBuffer = buffer;

    // Continuous gentle meadow breeze loop
    const breezeSrc = ctx.createBufferSource();
    breezeSrc.buffer = this._noiseBuffer;
    breezeSrc.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.7;

    const breezeGain = ctx.createGain();
    breezeGain.gain.value = 0.0;

    breezeSrc.connect(hp);
    hp.connect(lp);
    lp.connect(breezeGain);
    breezeGain.connect(this.masterGain);
    breezeSrc.start();

    this._breezeNode = breezeSrc;
    this._breezeFilterLP = lp;
    this._breezeGain = breezeGain;
  }

  setMuted(bool) {
    this.muted = Boolean(bool);
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.03);
    }
    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    if (this.ctx && this.masterGain && !this.muted) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.volume, now, 0.03);
    }
  }

  getVolume() {
    return this.volume;
  }

  _playNoiseGrain(startTime, duration, filterType, freq, q, peakGain, endFreq = null, destination = null) {
    const ctx = this.ctx;
    if (!ctx || !this._noiseBuffer) return;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const maxOffset = Math.max(0, this._noiseBuffer.duration - duration - 0.05);
    const offset = Math.random() * maxOffset;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, startTime);
    if (endFreq !== null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), startTime + duration);
    }
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.006, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(destination || this.masterGain);

    src.start(startTime, offset, duration + 0.02);
    src.stop(startTime + duration + 0.03);
  }

  _connectPanned(node, pan) {
    const ctx = this.ctx;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      node.connect(panner);
      panner.connect(this.masterGain);
      return panner;
    }
    node.connect(this.masterGain);
    return null;
  }

  /**
   * Signature Tiny Glade warm wooden/stone marimba clack pitched gently along strokes.
   */
  playBrickPop(stepIndex = 0) {
    this.unlock();
    if (!this._isReady()) return;

    const now = this.ctx.currentTime;
    if (now - this._lastBrickTime < 0.022) return;
    this._lastBrickTime = now;

    try {
      const ctx = this.ctx;
      const scaleLen = MARIMBA_SCALE_HZ.length;
      const period = (scaleLen - 1) * 2;
      const raw = Math.abs(Math.floor(Number(stepIndex) || 0)) % period;
      const idx = raw < scaleLen ? raw : period - raw;
      const jitter = 1 + (Math.random() - 0.5) * 0.016;
      const freq = MARIMBA_SCALE_HZ[idx] * jitter;

      // Fundamental warm rosewood/stone tone
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 1.03, now);
      osc.frequency.exponentialRampToValueAtTime(freq, now + 0.028);

      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, now);
      bodyGain.gain.linearRampToValueAtTime(0.20, now + 0.003);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.125);

      osc.connect(bodyGain);
      bodyGain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.135);

      // Classic marimba 4th harmonic transient
      const overtone = ctx.createOscillator();
      overtone.type = 'triangle';
      overtone.frequency.setValueAtTime(freq * 3.96, now);

      const overGain = ctx.createGain();
      overGain.gain.setValueAtTime(0.0001, now);
      overGain.gain.linearRampToValueAtTime(0.055, now + 0.002);
      overGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

      overtone.connect(overGain);
      overGain.connect(this.masterGain);
      overtone.start(now);
      overtone.stop(now + 0.04);

      // Tactile limestone/mortar micro-clack
      this._playNoiseGrain(now, 0.022, 'bandpass', 1250 + idx * 90, 3.2, 0.09);
    } catch {
      // Ignore transient scheduling errors
    }
  }

  /**
   * Warm stone foundation settle + celebratory 4-note marimba/harp grace chord.
   */
  playBuildComplete() {
    this.unlock();
    if (!this._isReady()) return;

    try {
      const ctx = this.ctx;
      const now = this.ctx.currentTime;

      // Soft stone settle thud
      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(132, now);
      thud.frequency.exponentialRampToValueAtTime(58, now + 0.14);

      const thudGain = ctx.createGain();
      thudGain.gain.setValueAtTime(0.0001, now);
      thudGain.gain.linearRampToValueAtTime(0.22, now + 0.006);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      thud.connect(thudGain);
      thudGain.connect(this.masterGain);
      thud.start(now);
      thud.stop(now + 0.18);

      // Cozy D-major arpeggio (D4 -> A4 -> D5 -> F#5)
      const notes = [293.66, 440.0, 587.33, 739.99];
      for (let i = 0; i < notes.length; i++) {
        const t = now + 0.02 + i * 0.048;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(notes[i], t);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2200, t);
        lp.frequency.exponentialRampToValueAtTime(680, t + 0.38);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12 - i * 0.012, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);

        osc.connect(lp);
        lp.connect(g);
        g.connect(this.masterGain);
        if (this.echoInput) g.connect(this.echoInput);

        osc.start(t);
        osc.stop(t + 0.45);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Crisp terracotta/slate ceramic tile snap.
   */
  playRoofClick() {
    this.unlock();
    if (!this._isReady()) return;

    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const jitter = 1 + (Math.random() - 0.5) * 0.04;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(680 * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(510 * jitter, now + 0.065);

      const chime = ctx.createOscillator();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(1490 * jitter, now);

      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.0001, now);
      g1.gain.linearRampToValueAtTime(0.16, now + 0.002);
      g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, now);
      g2.gain.linearRampToValueAtTime(0.06, now + 0.002);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

      osc.connect(g1);
      chime.connect(g2);
      g1.connect(this.masterGain);
      g2.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.085);
      chime.start(now);
      chime.stop(now + 0.04);

      this._playNoiseGrain(now, 0.018, 'bandpass', 2350 * jitter, 4.5, 0.08);
    } catch {
      // Ignore
    }
  }

  /**
   * Dry-stone crumble tumble + soft dust puff.
   */
  playDemolish() {
    this.unlock();
    if (!this._isReady()) return;

    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;

      const offsets = [0, 0.038, 0.082, 0.135];
      const freqs = [255, 205, 162, 118];
      for (let i = 0; i < offsets.length; i++) {
        const t = now + offsets[i];
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        const f = freqs[i] * (0.94 + Math.random() * 0.12);
        osc.frequency.setValueAtTime(f * 1.15, t);
        osc.frequency.exponentialRampToValueAtTime(f * 0.68, t + 0.075);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.14 - i * 0.02, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.1);

        this._playNoiseGrain(t, 0.032, 'bandpass', 720 - i * 95, 2.2, 0.08);
      }

      // Soft dust puff
      this._playNoiseGrain(now + 0.015, 0.25, 'lowpass', 880, 0.9, 0.12, 190);
    } catch {
      // Ignore
    }
  }

  /**
   * Tactile cobble/gravel brush stroke.
   */
  playPathStroke() {
    this.unlock();
    if (!this._isReady()) return;

    const now = this.ctx.currentTime;
    if (now - this._lastPathTime < 0.048) return;
    this._lastPathTime = now;

    try {
      const ctx = this.ctx;
      this._playNoiseGrain(now, 0.038, 'bandpass', 960 + Math.random() * 350, 2.4, 0.09);
      this._playNoiseGrain(now + 0.014, 0.030, 'bandpass', 2100 + Math.random() * 500, 3.0, 0.06);

      const pebble = ctx.createOscillator();
      pebble.type = 'sine';
      const pf = 340 + Math.random() * 130;
      pebble.frequency.setValueAtTime(pf, now);
      pebble.frequency.exponentialRampToValueAtTime(pf * 0.8, now + 0.03);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.065, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.034);

      pebble.connect(g);
      g.connect(this.masterGain);
      pebble.start(now);
      pebble.stop(now + 0.04);
    } catch {
      // Ignore
    }
  }

  /**
   * Crystal pond droplet plop + gentle water ripple wash.
   */
  playWaterSplash() {
    this.unlock();
    if (!this._isReady()) return;

    const now = this.ctx.currentTime;
    if (now - this._lastSplashTime < 0.13) return;
    this._lastSplashTime = now;

    try {
      const ctx = this.ctx;
      const playDroplet = (t, fStart, fEnd, amp, dur) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(fStart, t);
        osc.frequency.exponentialRampToValueAtTime(fEnd, t + dur);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.015);

        osc.connect(g);
        g.connect(this.masterGain);
        if (this.echoInput) g.connect(this.echoInput);
        osc.start(t);
        osc.stop(t + dur + 0.025);
      };

      const jitter = 0.92 + Math.random() * 0.18;
      playDroplet(now, 255 * jitter, 720 * jitter, 0.14, 0.075);
      playDroplet(now + 0.052, 390 * jitter, 940 * jitter, 0.09, 0.062);

      // Gentle splashy ripple wash
      this._playNoiseGrain(now + 0.008, 0.22, 'bandpass', 1150 * jitter, 1.8, 0.095, 420);
    } catch {
      // Ignore
    }
  }

  /**
   * Gentle cute filtered formant sheep bleat ("baaa~").
   */
  playSheepBleat() {
    this.unlock();
    if (!this._isReady()) return;

    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const dur = 0.46;
      const pitchScale = 0.94 + Math.random() * 0.16;
      const baseFreq = 248 * pitchScale;

      // Glottal sawtooth source with soft vibrato ("ba-a-a-a")
      const carrier = ctx.createOscillator();
      carrier.type = 'sawtooth';
      carrier.frequency.setValueAtTime(baseFreq * 0.94, now);
      carrier.frequency.linearRampToValueAtTime(baseFreq * 1.06, now + 0.11);
      carrier.frequency.linearRampToValueAtTime(baseFreq * 0.88, now + dur);

      const vibrato = ctx.createOscillator();
      vibrato.type = 'sine';
      vibrato.frequency.setValueAtTime(6.9, now);

      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.setValueAtTime(10.5, now);
      vibrato.connect(vibratoDepth);
      vibratoDepth.connect(carrier.frequency);

      // Pre-soften harsh high harmonics before vocal tract formants
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.setValueAtTime(2500, now);

      // Parallel vocal tract vowel formants ("aa / ae")
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.setValueAtTime(770 * pitchScale, now);
      f1.Q.value = 5.2;

      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.setValueAtTime(1640 * pitchScale, now);
      f2.Q.value = 6.0;

      const nasal = ctx.createBiquadFilter();
      nasal.type = 'bandpass';
      nasal.frequency.setValueAtTime(420 * pitchScale, now);
      nasal.Q.value = 3.5;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.22, now + 0.042);
      env.gain.setValueAtTime(0.19, now + dur - 0.14);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      // Subtle amplitude tremolo synchronized with vibrato
      const tremDepth = ctx.createGain();
      tremDepth.gain.setValueAtTime(0.035, now);
      vibrato.connect(tremDepth);
      tremDepth.connect(env.gain);

      carrier.connect(soften);
      soften.connect(f1);
      soften.connect(f2);
      soften.connect(nasal);
      f1.connect(env);
      f2.connect(env);
      nasal.connect(env);

      env.connect(this.masterGain);
      if (this.echoInput) env.connect(this.echoInput);

      vibrato.start(now);
      carrier.start(now);
      vibrato.stop(now + dur + 0.03);
      carrier.stop(now + dur + 0.03);
    } catch {
      // Ignore
    }
  }

  /**
   * Subtle tactile wooden UI button/swatch tick.
   */
  playUiTick() {
    this.unlock();
    if (!this._isReady()) return;

    const now = this.ctx.currentTime;
    if (now - this._lastTickTime < 0.018) return;
    this._lastTickTime = now;

    try {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.022);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.075, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.026);

      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.03);
    } catch {
      // Ignore
    }
  }

  /**
   * Updates continuous meadow ambience:
   * - Soft filtered breeze noise scaled by windStrength
   * - Occasional daytime songbird chirps
   * - Evening cricket trills when nightFactor > 0.4
   * - Sparse warm pentatonic plucked acoustic harp/lute notes
   */
  updateAmbience(dt, envState = {}) {
    if (!this._isReady()) return;

    const safeDt = clamp(Number(dt) || 0.016, 0.0, 0.1);
    this._ambienceTime += safeDt;

    const windStrength = clamp(Number(envState.windStrength ?? 0.4), 0, 2.0);
    const nightFactor = clamp(Number(envState.nightFactor ?? 0.0), 0, 1.0);
    const now = this.ctx.currentTime;

    // 1. Modulate filtered meadow breeze smoothly
    if (this._breezeGain && this._breezeFilterLP) {
      const gust = 0.5 + 0.5 * Math.sin(this._ambienceTime * 0.47) * Math.cos(this._ambienceTime * 0.19);
      const targetGain = (0.012 + windStrength * 0.038) * (0.78 + gust * 0.44);
      const targetCutoff = 280 + windStrength * 260 + gust * 140;
      this._breezeGain.gain.setTargetAtTime(targetGain, now, 0.18);
      this._breezeFilterLP.frequency.setTargetAtTime(targetCutoff, now, 0.22);
    }

    // 2. Occasional daytime songbird chirps
    if (nightFactor < 0.52) {
      this._birdTimer -= safeDt;
      if (this._birdTimer <= 0) {
        this._birdTimer = 3.6 + Math.random() * 5.2;
        const dayWeight = clamp(1.0 - nightFactor * 1.8, 0.15, 1.0);
        this._playSongbirdPhrase(dayWeight);
      }
    }

    // 3. Evening & night cricket trills when nightFactor > 0.4
    if (nightFactor > 0.4) {
      this._cricketTimer -= safeDt;
      if (this._cricketTimer <= 0) {
        this._cricketTimer = 1.6 + Math.random() * 3.0;
        const nightWeight = clamp((nightFactor - 0.4) / 0.6, 0.1, 1.0);
        this._playCricketTrill(nightWeight);
      }
    }

    // 4. Sparse warm pentatonic plucked acoustic harp/lute notes
    this._harpTimer -= safeDt;
    if (this._harpTimer <= 0) {
      this._harpTimer = 6.2 + Math.random() * 7.5;
      this._playHarpPluck(nightFactor);
    }
  }

  _playSongbirdPhrase(weight = 1.0) {
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const pan = (Math.random() * 2 - 1) * 0.75;
      const notesCount = 2 + Math.floor(Math.random() * 3);
      const base = 2250 + Math.random() * 850;

      const phraseBus = ctx.createGain();
      phraseBus.gain.value = 1.0;
      this._connectPanned(phraseBus, pan);
      if (this.echoInput) phraseBus.connect(this.echoInput);

      let offset = 0;
      for (let i = 0; i < notesCount; i++) {
        const t = now + offset;
        const dur = 0.055 + Math.random() * 0.05;
        const f0 = base * (0.9 + Math.random() * 0.32);
        const f1 = f0 * (Math.random() > 0.4 ? 1.24 : 0.82);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f1, t + dur);

        const g = ctx.createGain();
        const peak = 0.032 * weight * (0.8 + Math.random() * 0.35);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.010);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        osc.connect(g);
        g.connect(phraseBus);
        osc.start(t);
        osc.stop(t + dur + 0.015);

        offset += dur + 0.025 + Math.random() * 0.04;
      }
    } catch {
      // Ignore
    }
  }

  _playCricketTrill(weight = 1.0) {
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const pan = (Math.random() * 2 - 1) * 0.8;
      const pulses = 3 + Math.floor(Math.random() * 3);
      const carrierFreq = 4120 + Math.random() * 340;

      const trillBus = ctx.createGain();
      trillBus.gain.value = 1.0;
      this._connectPanned(trillBus, pan);

      for (let i = 0; i < pulses; i++) {
        const t = now + i * 0.038;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(carrierFreq, t);

        const g = ctx.createGain();
        const peak = 0.018 * weight;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);

        osc.connect(g);
        g.connect(trillBus);
        osc.start(t);
        osc.stop(t + 0.03);
      }
    } catch {
      // Ignore
    }
  }

  _playHarpPluck(nightFactor = 0) {
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      let idx = Math.floor(Math.random() * HARP_SCALE_HZ.length);
      if (idx === this._lastHarpIndex) {
        idx = (idx + 2) % HARP_SCALE_HZ.length;
      }
      this._lastHarpIndex = idx;

      const playSingleString = (t, freq, amp, pan) => {
        const osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, t);

        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2.0, t);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2100, t);
        lp.frequency.exponentialRampToValueAtTime(420, t + 1.65);

        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(amp, t + 0.008);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 1.85);

        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(amp * 0.28, t + 0.005);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

        osc1.connect(lp);
        osc2.connect(g2);
        g2.connect(lp);
        lp.connect(g1);

        this._connectPanned(g1, pan);
        if (this.echoInput) g1.connect(this.echoInput);

        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 1.9);
        osc2.stop(t + 0.7);
      };

      const baseAmp = 0.058 * (1.0 - nightFactor * 0.2);
      const pan = (Math.random() - 0.5) * 0.5;
      playSingleString(now, HARP_SCALE_HZ[idx], baseAmp, pan);

      // Occasional tender grace fifth/third companion pluck
      if (Math.random() < 0.38) {
        const companionIdx = (idx + (Math.random() < 0.5 ? 2 : 3)) % HARP_SCALE_HZ.length;
        playSingleString(now + 0.21 + Math.random() * 0.12, HARP_SCALE_HZ[companionIdx], baseAmp * 0.76, -pan * 0.7);
      }
    } catch {
      // Ignore
    }
  }

  dispose() {
    if (typeof window !== 'undefined' && this._boundGestureUnlock) {
      window.removeEventListener('pointerdown', this._boundGestureUnlock);
      window.removeEventListener('keydown', this._boundGestureUnlock);
      this._boundGestureUnlock = null;
    }
    if (this._breezeNode) {
      try {
        this._breezeNode.stop();
      } catch {
        // Ignore
      }
      this._breezeNode = null;
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        // Ignore
      }
      this.ctx = null;
    }
  }
}
