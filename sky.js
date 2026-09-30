/*
 * Procedural sky for the hero. Original code, no external assets.
 * Four "times of day" crossfade by lerping shader uniforms.
 * Pauses off-screen and in background tabs; renders one still frame
 * when the visitor prefers reduced motion.
 */
(function () {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

  const PRESETS = {
    dawn:  { top: "#5F7FBF", mid: "#AFC0E4", hor: "#F7CDB4", cloud: "#FFF3EA", shade: "#B3A2B9", sun: "#FFC592", stars: 0.0,  cover: 0.56, tone: "light", label: "Dawn" },
    day:   { top: "#2F6FD0", mid: "#7EAFEA", hor: "#DCEAF8", cloud: "#FFFFFF", shade: "#A4B9D6", sun: "#FFF3DC", stars: 0.0,  cover: 0.52, tone: "light", label: "Day" },
    dusk:  { top: "#1E2350", mid: "#6C4F86", hor: "#F0967A", cloud: "#FFC9AE", shade: "#4E3F69", sun: "#FFAE78", stars: 0.35, cover: 0.5,  tone: "dark",  label: "Dusk" },
    night: { top: "#03050B", mid: "#0A1330", hor: "#1C2A52", cloud: "#34426A", shade: "#0B1127", sun: "#4A5FA8", stars: 1.0,  cover: 0.38, tone: "dark",  label: "Night" },
  };

  const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse;
uniform vec3 uTop, uMid, uHor, uCloud, uShade, uSun;
uniform float uStars, uCover;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<6;i++){ v+=a*noise(p); p=m*p; a*=.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);

  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.5, uv.y));
  col = mix(col, uTop, smoothstep(0.45, 1.05, uv.y));

  vec2 sun = vec2(asp * 0.74, 0.2) + uMouse * vec2(0.03, 0.02);
  float d = length(p - sun);
  col += uSun * (exp(-d * 3.2) * 0.5 + exp(-d * 22.) * 0.35);

  // stars
  vec2 g = p * 150.; vec2 id = floor(g); vec2 f = fract(g) - .5;
  float h = hash(id);
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - .5;
  float star = smoothstep(.09, 0., length(f - o * .7)) * step(.986, h);
  star *= .55 + .45 * sin(uTime * (1.2 + h * 3.) + h * 60.);
  float starMask = uStars * smoothstep(.15, .7, uv.y);

  // clouds: flattened, domain-warped fbm drifting sideways, parallax with pointer
  float t = uTime * 0.011;
  vec2 q = vec2(p.x * 1.15 + t + uMouse.x * .04, p.y * 2.7 + uMouse.y * .03);
  float warp = fbm(q * 1.25 + vec2(0., t * .6));
  float c = fbm(q * 1.75 + warp * .95 + vec2(t * 1.6, 0.));
  float c2 = fbm((q + normalize(sun - p) * .045) * 1.75 + warp * .95 + vec2(t * 1.6, 0.));
  float dens = smoothstep(1. - uCover, 1. - uCover + .38, c);
  dens *= smoothstep(1.1, .3, uv.y) * .96;
  float light = clamp((c - c2) * 4.5 + .55, 0., 1.);
  vec3 cloud = mix(uShade, uCloud, light);
  cloud += uSun * exp(-d * 2.5) * .25 * light;

  col += vec3(1.) * star * starMask * (1. - dens);
  col = mix(col, cloud, dens);
  col += (hash(gl_FragCoord.xy + fract(uTime)) - .5) / 128.;
  gl_FragColor = vec4(col, 1.);
}`;

  function createSky(canvas, opts) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    const state = { preset: opts.preset || "day", onTone: opts.onTone || function () {} };
    const cur = {}; const from = {}; const to = {};
    const keys = ["top", "mid", "hor", "cloud", "shade", "sun"];
    const setTarget = (name, instant) => {
      const pr = PRESETS[name];
      keys.forEach((k) => { to[k] = hex(pr[k]); if (instant || !cur[k]) cur[k] = to[k].slice(); from[k] = cur[k].slice(); });
      to.stars = pr.stars; to.cover = pr.cover;
      if (instant || cur.stars == null) { cur.stars = pr.stars; cur.cover = pr.cover; }
      from.stars = cur.stars; from.cover = cur.cover;
      state.t0 = performance.now();
      state.preset = name;
      state.onTone(pr.tone, name);
    };

    if (!gl) {
      canvas.classList.add("sky-fallback");
      setTarget(state.preset, true);
      return { set: (n) => setTarget(n, true), presets: PRESETS, get preset() { return state.preset; } };
    }

    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add("sky-fallback"); return { set() {}, presets: PRESETS }; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ["uRes", "uTime", "uMouse", "uTop", "uMid", "uHor", "uCloud", "uShade", "uSun", "uStars", "uCover"].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mouse = [0, 0], mouseT = [0, 0];
    let visible = true, raf = 0, last = 0, elapsed = 40 + Math.random() * 200;

    function resize() {
      // Clouds are soft, so rendering below native resolution costs nothing visible.
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.55;
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    }

    const ease = (x) => 1 - Math.pow(1 - x, 3);
    function frame(now) {
      raf = 0;
      const dt = last ? Math.min(now - last, 50) : 16; last = now;
      if (!reduce.matches) elapsed += dt / 1000;
      const k = ease(Math.min(1, (now - (state.t0 || 0)) / 1400));
      keys.forEach((key) => { for (let i = 0; i < 3; i++) cur[key][i] = from[key][i] + (to[key][i] - from[key][i]) * k; });
      cur.stars = from.stars + (to.stars - from.stars) * k;
      cur.cover = from.cover + (to.cover - from.cover) * k;
      mouse[0] += (mouseT[0] - mouse[0]) * 0.04; mouse[1] += (mouseT[1] - mouse[1]) * 0.04;

      resize();
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, elapsed);
      gl.uniform2f(U.uMouse, mouse[0], mouse[1]);
      gl.uniform3fv(U.uTop, cur.top); gl.uniform3fv(U.uMid, cur.mid); gl.uniform3fv(U.uHor, cur.hor);
      gl.uniform3fv(U.uCloud, cur.cloud); gl.uniform3fv(U.uShade, cur.shade); gl.uniform3fv(U.uSun, cur.sun);
      gl.uniform1f(U.uStars, cur.stars); gl.uniform1f(U.uCover, cur.cover);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const settling = k < 1 || Math.abs(mouseT[0] - mouse[0]) > 0.001;
      if (visible && !document.hidden && (!reduce.matches || settling)) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };

    new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) kick(); }, { threshold: 0 }).observe(canvas);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("resize", kick, { passive: true });
    reduce.addEventListener?.("change", kick);
    window.addEventListener("pointermove", (e) => {
      if (reduce.matches || e.pointerType !== "mouse") return;
      mouseT[0] = e.clientX / window.innerWidth - 0.5;
      mouseT[1] = 0.5 - e.clientY / window.innerHeight;
      kick();
    }, { passive: true });

    setTarget(state.preset, true);
    kick();

    return {
      presets: PRESETS,
      get preset() { return state.preset; },
      set(name) { if (PRESETS[name] && name !== state.preset) { setTarget(name, false); kick(); } },
    };
  }

  window.LoupeSky = { create: createSky, presets: PRESETS };
})();
