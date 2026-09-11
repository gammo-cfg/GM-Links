(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const hexToRgb01 = (hex) => {
    const normalized = hex.replace('#', '').trim();
    const value = normalized.length === 3
      ? normalized.split('').map((c) => c + c).join('')
      : normalized;
    const int = Number.parseInt(value, 16);
    return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
  };

  class SignalShader {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas?.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance'
      });
      this.program = null;
      this.buffer = null;
      this.raf = 0;
      this.start = performance.now();
      this.pointer = { x: 0.5, y: 0.5 };
      this.accent = hexToRgb01('#ff4b00');
      this.accentTarget = [...this.accent];
      this.motionEnabled = !reducedMotion.matches;
      this.onResize = this.onResize.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onVisibility = this.onVisibility.bind(this);
    }

    init() {
      const gl = this.gl;
      if (!gl) return false;

      const vertex = `
        attribute vec2 aPosition;
        void main() {
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `;

      const fragment = `
        precision highp float;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform vec2 uPointer;
        uniform vec3 uAccent;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = rot * p * 2.03 + 13.7;
            a *= 0.49;
          }
          return v;
        }

        float lineField(vec2 p, float t) {
          float n = fbm(p * 1.18 + vec2(t * 0.16, -t * 0.11));
          float n2 = fbm(p * 2.25 - vec2(t * 0.08, t * 0.13));
          float wave = sin((p.x * 1.7 + n * 2.2 + t * 0.18) * 3.2) * 0.5 + 0.5;
          return smoothstep(0.82, 1.0, wave + n2 * 0.24);
        }

        void main() {
          vec2 frag = gl_FragCoord.xy;
          vec2 uv = frag / uResolution;
          vec2 p = (frag * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);
          float t = uTime;

          vec2 pointer = (uPointer * 2.0 - 1.0);
          pointer.x *= uResolution.x / uResolution.y;
          float pd = length(p - pointer * 0.55);

          p.x += sin(p.y * 1.45 + t * 0.12) * 0.10;
          p.y += cos(p.x * 1.15 - t * 0.10) * 0.08;

          float field = lineField(p, t);
          float filament = smoothstep(0.15, 0.0, abs(fbm(p * 1.55 + t * 0.025) - 0.57));
          float pulse = 0.74 + 0.26 * sin(t * 0.42);
          float pointerGlow = exp(-pd * 2.7) * 0.22;

          vec3 black = vec3(0.012, 0.012, 0.013);
          vec3 smoke = vec3(0.045, 0.043, 0.041);
          vec3 color = mix(black, smoke, fbm(p * 0.75 + 2.0) * 0.45);
          color += uAccent * field * 0.24;
          color += uAccent * filament * 0.075 * pulse;
          color += uAccent * pointerGlow;

          float beam = exp(-abs(p.y + 0.16 + sin(p.x * 0.75 + t * 0.16) * 0.10) * 11.0);
          color += uAccent * beam * 0.055;

          float vignette = smoothstep(1.35, 0.28, length((uv - 0.5) * vec2(1.10, 0.85)));
          color *= mix(0.45, 1.0, vignette);
          color = pow(color, vec3(0.92));

          gl_FragColor = vec4(color, 1.0);
        }
      `;

      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          console.warn('Shader compile failed:', gl.getShaderInfoLog(shader));
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      };

      const vs = compile(gl.VERTEX_SHADER, vertex);
      const fs = compile(gl.FRAGMENT_SHADER, fragment);
      if (!vs || !fs) return false;

      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.warn('Shader link failed:', gl.getProgramInfoLog(this.program));
        return false;
      }

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      gl.useProgram(this.program);

      const position = gl.getAttribLocation(this.program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      this.uniforms = {
        resolution: gl.getUniformLocation(this.program, 'uResolution'),
        time: gl.getUniformLocation(this.program, 'uTime'),
        pointer: gl.getUniformLocation(this.program, 'uPointer'),
        accent: gl.getUniformLocation(this.program, 'uAccent')
      };

      window.addEventListener('resize', this.onResize, { passive: true });
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      document.addEventListener('visibilitychange', this.onVisibility);
      this.onResize();
      this.draw();
      return true;
    }

    onResize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(innerWidth * dpr));
      const height = Math.max(1, Math.round(innerHeight * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
      }
    }

    onPointerMove(event) {
      if (!finePointer.matches) return;
      this.pointer.x = clamp(event.clientX / innerWidth, 0, 1);
      this.pointer.y = clamp(1 - event.clientY / innerHeight, 0, 1);
    }

    onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      } else if (!this.raf) {
        this.draw();
      }
    }

    setAccent(hex) {
      this.accentTarget = hexToRgb01(hex);
    }

    setMotion(enabled) {
      this.motionEnabled = enabled && !reducedMotion.matches;
      if (!this.raf && !document.hidden) this.draw();
    }

    draw() {
      this.raf = 0;
      if (document.hidden) return;
      const gl = this.gl;
      if (!gl || !this.program) return;

      for (let i = 0; i < 3; i++) {
        this.accent[i] += (this.accentTarget[i] - this.accent[i]) * 0.055;
      }

      const time = this.motionEnabled ? (performance.now() - this.start) / 1000 : 2.4;
      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.time, time);
      gl.uniform2f(this.uniforms.pointer, this.pointer.x, this.pointer.y);
      gl.uniform3f(this.uniforms.accent, this.accent[0], this.accent[1], this.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (this.motionEnabled || this.accent.some((v, i) => Math.abs(v - this.accentTarget[i]) > 0.002)) {
        this.raf = requestAnimationFrame(() => this.draw());
      }
    }
  }

  const shader = new SignalShader(document.getElementById('signal-canvas'));
  shader.init();

  const setCssAccent = (hex) => {
    const [r, g, b] = hexToRgb01(hex).map((v) => Math.round(v * 255));
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    shader.setAccent(hex);
  };

  const channels = [...document.querySelectorAll('.channel')];
  channels.forEach((channel) => {
    const accent = channel.dataset.accent || '#ff4b00';
    channel.addEventListener('pointerenter', () => setCssAccent(accent));
    channel.addEventListener('focus', () => setCssAccent(accent));
    channel.addEventListener('pointerleave', () => setCssAccent('#ff4b00'));
    channel.addEventListener('blur', () => setCssAccent('#ff4b00'));
  });

  const boot = document.getElementById('boot');
  let introFinished = false;
  const markIntroFinished = () => {
    if (introFinished) return;
    introFinished = true;
    document.dispatchEvent(new CustomEvent('gammo:intro-finished'));
  };
  const finishBoot = () => {
    if (!boot) {
      markIntroFinished();
      return;
    }
    boot.classList.add('is-done');
    if (reducedMotion.matches) markIntroFinished();
  };
  boot?.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'opacity' && boot.classList.contains('is-done')) markIntroFinished();
  });
  if (reducedMotion.matches) finishBoot();
  else window.addEventListener('load', () => setTimeout(finishBoot, 820), { once: true });

  const clock = document.getElementById('local-clock');
  const updateClock = () => {
    if (!clock) return;
    clock.textContent = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date());
  };
  updateClock();
  setInterval(updateClock, 1000);

  document.getElementById('current-year').textContent = String(new Date().getFullYear());

  const grid = document.getElementById('layout-grid');
  const gridToggle = document.getElementById('grid-toggle');
  const toggleGrid = () => {
    const visible = grid.classList.toggle('is-visible');
    gridToggle?.setAttribute('aria-pressed', String(visible));
  };
  gridToggle?.addEventListener('click', toggleGrid);

  const readMotionPreference = () => {
    try { return localStorage.getItem('gammo-motion'); } catch { return null; }
  };
  const writeMotionPreference = (value) => {
    try { localStorage.setItem('gammo-motion', value); } catch { /* storage can be blocked */ }
  };
  let motionEnabled = !reducedMotion.matches && readMotionPreference() !== 'off';
  const motionToggle = document.getElementById('motion-toggle');
  const motionLabel = document.getElementById('motion-label');
  const applyMotion = () => {
    body.classList.toggle('motion-off', !motionEnabled);
    motionToggle?.setAttribute('aria-pressed', String(!motionEnabled));
    if (motionLabel) motionLabel.textContent = motionEnabled ? 'MOTION' : 'STATIC';
    shader.setMotion(motionEnabled);
  };
  const toggleMotion = () => {
    if (reducedMotion.matches) return;
    motionEnabled = !motionEnabled;
    writeMotionPreference(motionEnabled ? 'on' : 'off');
    applyMotion();
  };
  motionToggle?.addEventListener('click', toggleMotion);
  applyMotion();

  reducedMotion.addEventListener?.('change', (event) => {
    if (event.matches) motionEnabled = false;
    applyMotion();
  });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key.toLowerCase() === 'g') toggleGrid();
    if (event.key.toLowerCase() === 'm') toggleMotion();
  });

  const toast = document.getElementById('toast');
  let toastTimer = 0;
  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
  };

  const backgroundAudio = document.getElementById('background-audio');
  const audioControl = document.getElementById('audio-control');
  const audioToggle = document.getElementById('audio-toggle');
  const audioPanel = document.getElementById('audio-panel');
  const audioSlider = document.getElementById('audio-volume');
  const audioOutput = document.getElementById('audio-output');
  const audioValue = document.getElementById('audio-value');
  const audioMute = document.getElementById('audio-mute');
  const DEFAULT_VOLUME = 0.20;
  let audioFadeRaf = 0;
  let audioStarted = false;

  const readAudioNumber = (key, fallback) => {
    try {
      const stored = Number.parseFloat(localStorage.getItem(key));
      return Number.isFinite(stored) ? stored : fallback;
    } catch { return fallback; }
  };
  const readAudioFlag = (key, fallback) => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : stored === 'true';
    } catch { return fallback; }
  };
  const writeAudioPreference = (key, value) => {
    try { localStorage.setItem(key, String(value)); } catch { /* storage can be blocked */ }
  };

  let audioVolume = clamp(readAudioNumber('gammo-audio-volume', DEFAULT_VOLUME), 0, 1);
  let audioMuted = readAudioFlag('gammo-audio-muted', false) || audioVolume === 0;

  const syncAudioUi = () => {
    const percent = Math.round(audioVolume * 100);
    if (backgroundAudio) {
      backgroundAudio.muted = audioMuted;
      if (!audioFadeRaf) backgroundAudio.volume = audioVolume;
    }
    if (audioSlider) audioSlider.value = String(percent);
    if (audioOutput) audioOutput.value = `${percent}%`;
    if (audioOutput) audioOutput.textContent = `${percent}%`;
    if (audioValue) audioValue.textContent = audioMuted ? 'OFF' : `${percent}%`;
    if (audioMute) {
      audioMute.textContent = audioMuted ? 'UNMUTE' : 'MUTE';
      audioMute.setAttribute('aria-pressed', String(audioMuted));
    }
    audioToggle?.classList.toggle('is-muted', audioMuted);
    audioToggle?.setAttribute('aria-label', `Background music controls, ${audioMuted ? 'muted' : `${percent} percent`}`);
  };

  const fadeAudioTo = (target) => {
    if (!backgroundAudio || audioMuted) return;
    cancelAnimationFrame(audioFadeRaf);
    const from = backgroundAudio.volume;
    const start = performance.now();
    const duration = 1100;
    const step = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      backgroundAudio.volume = from + (target - from) * (1 - Math.pow(1 - t, 3));
      if (t < 1) audioFadeRaf = requestAnimationFrame(step);
      else audioFadeRaf = 0;
    };
    audioFadeRaf = requestAnimationFrame(step);
  };

  const startBackgroundAudio = async ({ showBlockedHint = false } = {}) => {
    if (!introFinished || !backgroundAudio || audioStarted || audioMuted || audioVolume <= 0) return false;
    try {
      backgroundAudio.muted = false;
      backgroundAudio.volume = 0;
      await backgroundAudio.play();
      audioStarted = true;
      fadeAudioTo(audioVolume);
      return true;
    } catch (error) {
      backgroundAudio.volume = audioVolume;
      audioStarted = false;
      if (showBlockedHint && error?.name === 'NotAllowedError') {
        showToast('SOUND READY · TAP TO ENABLE');
      }
      return false;
    }
  };

  const setAudioVolume = (value, { persist = true } = {}) => {
    cancelAnimationFrame(audioFadeRaf);
    audioFadeRaf = 0;
    audioVolume = clamp(value, 0, 1);
    if (audioVolume > 0) audioMuted = false;
    else audioMuted = true;
    if (backgroundAudio) {
      backgroundAudio.volume = audioVolume;
      backgroundAudio.muted = audioMuted;
    }
    if (persist) {
      writeAudioPreference('gammo-audio-volume', audioVolume.toFixed(2));
      writeAudioPreference('gammo-audio-muted', audioMuted);
    }
    syncAudioUi();
    if (!audioMuted) startBackgroundAudio();
  };

  const setAudioMuted = (muted, { persist = true } = {}) => {
    audioMuted = Boolean(muted);
    if (audioMuted) {
      cancelAnimationFrame(audioFadeRaf);
      audioFadeRaf = 0;
    }
    if (backgroundAudio) {
      backgroundAudio.muted = audioMuted;
      backgroundAudio.volume = audioVolume;
    }
    if (persist) writeAudioPreference('gammo-audio-muted', audioMuted);
    syncAudioUi();
    if (!audioMuted) startBackgroundAudio();
  };

  const setAudioPanelOpen = (open) => {
    if (!audioPanel || !audioToggle) return;
    audioPanel.hidden = !open;
    audioToggle.setAttribute('aria-expanded', String(open));
  };

  audioToggle?.addEventListener('click', () => {
    const opening = audioPanel?.hidden ?? false;
    setAudioPanelOpen(opening);
    startBackgroundAudio();
  });
  audioSlider?.addEventListener('input', () => {
    const next = Number(audioSlider.value) / 100;
    setAudioVolume(next);
  });
  audioMute?.addEventListener('click', () => setAudioMuted(!audioMuted));

  document.addEventListener('pointerdown', (event) => {
    if (audioPanel && !audioPanel.hidden && audioControl && !audioControl.contains(event.target)) {
      setAudioPanelOpen(false);
    }
    startBackgroundAudio();
  }, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setAudioPanelOpen(false);
    if (!event.metaKey && !event.ctrlKey && !event.altKey) startBackgroundAudio();
  });

  backgroundAudio?.addEventListener('error', () => {
    if (audioValue) audioValue.textContent = 'ERR';
    showToast('AUDIO SIGNAL UNAVAILABLE');
  });
  syncAudioUi();

  const startAudioAtIntroEnd = () => {
    if (!audioMuted && audioVolume > 0) startBackgroundAudio({ showBlockedHint: true });
  };
  if (introFinished) startAudioAtIntroEnd();
  else document.addEventListener('gammo:intro-finished', startAudioAtIntroEnd, { once: true });

  const shareButton = document.getElementById('share-button');
  shareButton?.addEventListener('click', async () => {
    const data = { title: 'GAMMO — Signal Hub', text: 'Find GAMMO online.', url: location.href };
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(data.url);
        showToast('SIGNAL LINK COPIED');
      } else {
        const field = document.createElement('textarea');
        field.value = data.url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        showToast(copied ? 'SIGNAL LINK COPIED' : 'SHARE UNAVAILABLE');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('SHARE UNAVAILABLE');
    }
  });

  if (finePointer.matches) {
    const cursor = document.getElementById('cursor-orbit');
    let cx = innerWidth / 2, cy = innerHeight / 2, tx = cx, ty = cy, cursorRaf = 0;

    const renderCursor = () => {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      cursor.style.left = `${cx}px`;
      cursor.style.top = `${cy}px`;
      cursorRaf = requestAnimationFrame(renderCursor);
    };
    cursorRaf = requestAnimationFrame(renderCursor);

    window.addEventListener('pointermove', (event) => {
      tx = event.clientX; ty = event.clientY;
      cursor?.classList.add('is-visible');
      root.style.setProperty('--mouse-x', `${tx}px`);
      root.style.setProperty('--mouse-y', `${ty}px`);

      if (motionEnabled && !reducedMotion.matches) {
        const nx = (event.clientX / innerWidth - 0.5);
        const ny = (event.clientY / innerHeight - 0.5);
        root.style.setProperty('--hero-x', `${nx * -8}px`);
        root.style.setProperty('--hero-y', `${ny * -5}px`);
        root.style.setProperty('--core-x', `${nx * 15}px`);
        root.style.setProperty('--core-y', `${ny * 12}px`);
      }
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => cursor?.classList.remove('is-visible'));
    document.querySelectorAll('a, button').forEach((item) => {
      item.addEventListener('pointerenter', () => cursor?.classList.add('is-link'));
      item.addEventListener('pointerleave', () => cursor?.classList.remove('is-link'));
    });
  }
})();
