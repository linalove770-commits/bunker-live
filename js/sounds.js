'use strict';

/**
 * Атмосферные звуки на Web Audio API — без внешних файлов.
 * Всё синтезируется на лету, поэтому игра не тянет за собой ассеты.
 */
(function () {
  let ctx = null;
  let muted = false;

  function audio() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  }

  /** Один тон с огибающей. */
  function tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.06, slideTo = null, delay = 0 }) {
    const ac = audio();
    if (!ac || muted) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Короткий шумовой «удар» — для сирены и изгнания. */
  function noise({ dur = 0.3, gain = 0.05, delay = 0 }) {
    const ac = audio();
    if (!ac || muted) return;
    const frames = Math.floor(ac.sampleRate * dur);
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ac.createBufferSource();
    const amp = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(filter).connect(amp).connect(ac.destination);
    src.start(ac.currentTime + delay);
  }

  const SOUNDS = {
    start: () => { tone({ freq: 120, dur: 0.5, type: 'sawtooth', gain: 0.05, slideTo: 60 }); noise({ dur: 0.5, gain: 0.04 }); },
    round: () => { tone({ freq: 320, dur: 0.12, type: 'triangle', gain: 0.05 }); tone({ freq: 420, dur: 0.14, type: 'triangle', gain: 0.05, delay: 0.1 }); },
    reveal: () => { tone({ freq: 660, dur: 0.1, type: 'sine', gain: 0.04 }); tone({ freq: 880, dur: 0.1, type: 'sine', gain: 0.03, delay: 0.07 }); },
    vote: () => { tone({ freq: 200, dur: 0.28, type: 'square', gain: 0.035 }); },
    exile: () => { noise({ dur: 0.6, gain: 0.06 }); tone({ freq: 90, dur: 0.7, type: 'sawtooth', gain: 0.05, slideTo: 45 }); },
    special: () => { tone({ freq: 520, dur: 0.09, type: 'square', gain: 0.04 }); tone({ freq: 780, dur: 0.09, type: 'square', gain: 0.04, delay: 0.06 }); tone({ freq: 1040, dur: 0.12, type: 'square', gain: 0.035, delay: 0.12 }); },
    tick: () => { tone({ freq: 1000, dur: 0.04, type: 'sine', gain: 0.03 }); },
    finale: () => { tone({ freq: 160, dur: 1.2, type: 'sawtooth', gain: 0.05, slideTo: 320 }); noise({ dur: 1.2, gain: 0.05 }); },
    join: () => { tone({ freq: 700, dur: 0.08, type: 'sine', gain: 0.035 }); },
  };

  let lastTick = 0;

  window.BunkerSounds = {
    play(name) {
      const fn = SOUNDS[name];
      if (fn) fn();
    },
    /** Тик последних секунд — не чаще раза в секунду. */
    tick(remaining) {
      if (remaining > 5 || remaining <= 0) return;
      const now = Date.now();
      if (now - lastTick < 900) return;
      lastTick = now;
      SOUNDS.tick();
    },
    setMuted(value) { muted = !!value; },
    isMuted() { return muted; },
    /** Разблокировка контекста после первого касания (требование браузеров). */
    unlock() { const ac = audio(); if (ac && ac.state === 'suspended') ac.resume(); },
  };
})();
