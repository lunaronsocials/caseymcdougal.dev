/*! cm-liquid-button.js — Liquid Glass Button (vanilla, zero deps)
 *  A refractive glass pill with a WebGL chromatic-metal orb and a rotating
 *  gradient stroke. Drop this file in, add `data-lgb` to a <button>, done:
 *
 *    <script src="cm-liquid-button.js" defer></script>
 *    <button data-lgb>Get started</button>
 *
 *  Options (attributes):
 *    data-lgb-preset="chrome|northern"   color stops (default chrome)
 *    data-lgb-crisp="false"              put the shader UNDER the glass so the
 *                                        pill's lens warps it (original recipe)
 *  JS API: CMLiquidButton.upgrade(el, options) for full control —
 *    { preset, gradient:[...hex], orb, stroke, crispOrb, forceFallback,
 *      glass:{refraction,frost,dispersion,depth,light}, orbSettings:{...} }
 *  Cleanup: CMLiquidButton.destroy(el) stops the render loop, disconnects
 *    observers, and restores the original button — call it before removing
 *    upgraded buttons in an SPA. Browsers cap live WebGL contexts (~8-16
 *    per page), so keep the count of simultaneously upgraded buttons low.
 *
 *  Notes that cost real debugging time — keep them in mind when editing:
 *  - SVG-URL backdrop-filters only render in Chromium. Safari/Firefox parse
 *    the syntax (CSS.supports lies) but paint nothing → UA detection + a
 *    plain blur fallback, with the orb lifted above the glass.
 *  - Never call loseContext() on cleanup: a lost context sticks to the
 *    canvas, so anything re-running setup gets a dead context back.
 *  - The SVG filter region must overhang the element (-15%/130%) or rim
 *    displacement samples transparent → colored fringe lines.
 *  - The canvas is 2× supersampled: the disc is ~70 css px and the metal
 *    ribbons are fine lines — at plain DPR they alias into mush.
 *  - rgbSplit must stay smaller than the ribbon line width (0.03 good,
 *    0.1 too wide) or the channels never overlap → no white metal cores.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------- support */

  var isChromium = typeof navigator !== 'undefined' && /Chrom(e|ium)\//.test(navigator.userAgent);
  var svgBackdropOK = isChromium && typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#x)');

  /* -------------------------------------------------------------- styles */

  var STYLE_ID = 'lgb-styles';

  var CSS_TEXT = '' +
'.lgb {\n' +
'  --lgb-pad: 0.55em;\n' +
'  --lgb-orb: 2.6em;\n' +
'  position: relative;\n' +
'  display: inline-flex;\n' +
'  align-items: center;\n' +
'  gap: 0.75em;\n' +
'  padding: var(--lgb-pad) 1.5em var(--lgb-pad) var(--lgb-pad);\n' +
'  border: 0;\n' +
'  border-radius: 999px;\n' +
'  background: transparent;\n' +
'  font: 600 1.05rem/1 system-ui, -apple-system, sans-serif;\n' +
'  color: var(--lgb-text, #333);\n' +
'  cursor: pointer;\n' +
'  isolation: isolate;\n' +
'  -webkit-tap-highlight-color: transparent;\n' +
'  transition: transform 0.25s cubic-bezier(0.3, 0.7, 0.4, 1.2);\n' +
'}\n' +
'.lgb:hover { transform: translateY(-2px) scale(1.02); }\n' +
'.lgb:active { transform: translateY(0) scale(0.99); }\n' +
'.lgb:focus-visible { outline: 2px solid var(--lgb-text, #333); outline-offset: 4px; }\n' +
'.lgb:disabled { cursor: not-allowed; opacity: 0.5; }\n' +
'.lgb:disabled:hover { transform: none; }\n' +
'.lgb__stroke, .lgb__orbicon { transition: opacity 0.25s ease; }\n' +
'.lgb:hover .lgb__stroke { opacity: 1; }\n' +
'.lgb:hover .lgb__orbicon { opacity: 1; }\n' +
'@media (prefers-reduced-motion: reduce) {\n' +
'  .lgb { transition: none; }\n' +
'  .lgb:hover { transform: none; }\n' +
'}\n' +
'.lgb__label { position: relative; z-index: 3; text-shadow: 0 1px 2px rgba(255,255,255,0.25); }\n' +
'.lgb__glass {\n' +
'  position: absolute; inset: 0;\n' +
'  border-radius: inherit;\n' +
'  z-index: 1;\n' +
'  pointer-events: none;\n' +
'  background: var(--lgb-tint, rgba(255,255,255,0.06));\n' +
'  box-shadow:\n' +
'    inset 0 1px 1px rgba(255,255,255, calc(var(--lgb-light, 0.5) * 0.9)),\n' +
'    inset 0 -0.4em 0.9em rgba(30,40,35, calc(var(--lgb-depth, 0.5) * 0.22)),\n' +
'    inset 0 0 0 1px rgba(255,255,255, 0.28),\n' +
'    0 12px 30px -8px rgba(30,40,35, 0.35);\n' +
'}\n' +
'.lgb__glass::after {\n' +
"  content: '';\n" +
'  position: absolute; inset: 1px;\n' +
'  border-radius: inherit;\n' +
'  background: linear-gradient(\n' +
'    to bottom,\n' +
'    rgba(255,255,255, calc(var(--lgb-light, 0.5) * 0.35)),\n' +
'    rgba(255,255,255, 0) 45%\n' +
'  );\n' +
'}\n' +
'@property --lgb-a {\n' +
"  syntax: '<angle>';\n" +
'  inherits: false;\n' +
'  initial-value: 0deg;\n' +
'}\n' +
'@keyframes lgb-spin { to { --lgb-a: 360deg; } }\n' +
'.lgb__stroke {\n' +
'  position: absolute; inset: 0;\n' +
'  border-radius: inherit;\n' +
'  z-index: 2;\n' +
'  pointer-events: none;\n' +
'  padding: 1.5px;\n' +
'  background: conic-gradient(from var(--lgb-a, 0deg), var(--lgb-stroke-stops));\n' +
'  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n' +
'  -webkit-mask-composite: xor;\n' +
'  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n' +
'  mask-composite: exclude;\n' +
'  animation: lgb-spin 6s linear infinite;\n' +
'  opacity: 0.9;\n' +
'}\n' +
'@media (prefers-reduced-motion: reduce) {\n' +
'  .lgb__stroke { animation: none; }\n' +
'}\n' +
'/* crisp mode (and fallback, where blur would smear it): orb above the glass */\n' +
'.lgb--crisp .lgb__orb, .lgb--fb .lgb__orb { z-index: 2; }\n' +
'/* the shader disc lives BELOW the glass so the pill lens can warp it */\n' +
'.lgb__orb {\n' +
'  position: relative;\n' +
'  z-index: 0;\n' +
'  width: var(--lgb-orb);\n' +
'  height: var(--lgb-orb);\n' +
'  border-radius: 50%;\n' +
'  overflow: hidden;\n' +
'  flex: none;\n' +
'}\n' +
'.lgb__orb canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }\n' +
'.lgb--crisp .lgb__orb canvas { filter: blur(1.4px); }\n' +
'/* bezel + icon overlay sits ABOVE the glass: ring and icon stay crisp while\n' +
'   the shader underneath swims through the refraction */\n' +
'.lgb__orbtop {\n' +
'  position: absolute;\n' +
'  left: var(--lgb-pad);\n' +
'  top: 50%;\n' +
'  transform: translateY(-50%);\n' +
'  width: var(--lgb-orb);\n' +
'  height: var(--lgb-orb);\n' +
'  border-radius: 50%;\n' +
'  z-index: 2;\n' +
'  pointer-events: none;\n' +
'  display: grid;\n' +
'  place-items: center;\n' +
'  /* fishbowl: dark dome over the shader, clear middle, deep rim */\n' +
'  background:\n' +
'    radial-gradient(120% 90% at 30% 15%, rgba(255,255,255,0.16), rgba(255,255,255,0) 38%),\n' +
'    radial-gradient(circle at 50% 42%, rgba(0,0,0,0) 54%, rgba(40,44,50,0.28) 78%, rgba(28,32,38,0.55) 97%);\n' +
'  box-shadow:\n' +
'    inset 0 0 7px 2px rgba(255,255,255,0.3),\n' +
'    inset 0 -4px 9px rgba(0,0,0,0.55);\n' +
'}\n' +
'/* bezel ring: masked 2px band with a backdrop-filter so it samples the\n' +
'   shader + page behind it and drifts with the background; the white tint\n' +
'   alone still reads as a gradient ring without backdrop-filter support */\n' +
'.lgb__orbtop::before {\n' +
"  content: '';\n" +
'  position: absolute;\n' +
'  inset: 0;\n' +
'  border-radius: 50%;\n' +
'  padding: 2px;\n' +
'  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n' +
'  -webkit-mask-composite: xor;\n' +
'  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n' +
'  mask-composite: exclude;\n' +
'  background: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 55%, rgba(255,255,255,0.72));\n' +
'  -webkit-backdrop-filter: blur(4px) brightness(1.6) saturate(1.4);\n' +
'  backdrop-filter: blur(4px) brightness(1.6) saturate(1.4);\n' +
'}\n' +
'.lgb__orbicon {\n' +
'  position: relative;\n' +
'  color: #fff;\n' +
'  line-height: 0;\n' +
'  opacity: 0.9;\n' +
'  filter: drop-shadow(0 0 6px rgba(255,255,255,0.55)) drop-shadow(0 0 1px rgba(255,255,255,0.7));\n' +
'}\n';

  function injectStyles() {
    var existing = document.getElementById(STYLE_ID);
    if (existing) {
      if (existing.textContent !== CSS_TEXT) existing.textContent = CSS_TEXT;
      return;
    }
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS_TEXT;
    document.head.appendChild(el);
  }

  /* -------------------------------------------------------- glass filter */

  // Lens displacement map: R encodes x (0..255 left->right), G encodes y.
  var LENS_URI = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<linearGradient id="x" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient>' +
    '<linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/></linearGradient>' +
    '<rect width="64" height="64" fill="url(#x)"/>' +
    '<rect width="64" height="64" fill="url(#y)" style="mix-blend-mode:screen"/>' +
    '</svg>');

  // Radial edge mask (black center -> white rim): droplet edges warp, center stays.
  var EDGE_MASK_URI = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="30%" stop-color="black"/><stop offset="77%" stop-color="white"/></radialGradient><rect width="64" height="64" fill="url(#g)"/></svg>');

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Builds the lens filter. Channels are displaced at slightly different
  // scales (chromatic dispersion), isolated with color matrices, then
  // screen-blended back together (disjoint channels -> screen == additive).
  function buildGlassFilter(fid, g) {
    var svg = svgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    svg.style.position = 'absolute';
    var filter = svgEl('filter', {
      id: fid, x: '-15%', y: '-15%', width: '130%', height: '130%',
      'color-interpolation-filters': 'sRGB'
    });

    filter.appendChild(svgEl('feImage', { href: LENS_URI, result: 'lens', preserveAspectRatio: 'none' }));
    filter.appendChild(svgEl('feImage', { href: EDGE_MASK_URI, result: 'edge', preserveAspectRatio: 'none' }));
    // mix(neutral 0.5, lens, edgeMask): pure lens bend at the rim, calm center
    filter.appendChild(svgEl('feComposite', {
      in: 'lens', in2: 'edge', operator: 'arithmetic',
      k1: '1', k2: '0', k3: '-0.5', k4: '0.5', result: 'dispMapRaw'
    }));
    filter.appendChild(svgEl('feGaussianBlur', { in: 'dispMapRaw', stdDeviation: '5', result: 'dispMap' }));
    filter.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: String(g.frost), result: 'frosted' }));

    var spread = g.dispersion * 0.25;

    if (g.dispersion <= 0) {
      filter.appendChild(svgEl('feDisplacementMap', {
        in: 'frosted', in2: 'dispMap', scale: String(g.refraction),
        xChannelSelector: 'R', yChannelSelector: 'G'
      }));
      svg.appendChild(filter);
      return svg;
    }

    var channels = [
      ['R', g.refraction * (1 + spread), '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['G', g.refraction, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['B', g.refraction * (1 - spread), '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']
    ];
    channels.forEach(function (ch) {
      filter.appendChild(svgEl('feDisplacementMap', {
        in: 'frosted', in2: 'dispMap', scale: String(ch[1]),
        xChannelSelector: 'R', yChannelSelector: 'G', result: 'disp' + ch[0]
      }));
      filter.appendChild(svgEl('feColorMatrix', {
        in: 'disp' + ch[0], type: 'matrix', values: ch[2], result: 'ch' + ch[0]
      }));
    });
    filter.appendChild(svgEl('feBlend', { in: 'chR', in2: 'chG', mode: 'screen', result: 'rg' }));
    filter.appendChild(svgEl('feBlend', { in: 'rg', in2: 'chB', mode: 'screen' }));
    svg.appendChild(filter);
    return svg;
  }

  /* ------------------------------------------------------- chromatic orb */

  // mostly-dark stops with white ribbons = dark chrome disc; the rainbow
  // comes from RGB split along the ribbon edges, not from the stops
  var PRESETS = {
    chrome: ['#5c6168', '#f2f5f8', '#70757d', '#ffffff', '#545963', '#5e626a'],
    northern: ['#5e6b62', '#f6f3ea', '#71806f', '#dfe8df', '#576459', '#606d61']
  };

  var MAX_STOPS = 8;

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  var VERT = 'attribute vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

  var FRAG = '' +
'precision highp float;\n' +
'uniform vec2 uRes;\n' +
'uniform float uTime;\n' +
'uniform vec3 uStops[' + MAX_STOPS + '];\n' +
'uniform float uStopCount;\n' +
'uniform float uScale;\n' +
'uniform float uRepeats;\n' +
'uniform float uAngle;\n' +
'uniform float uStretch;\n' +
'uniform float uRgbSplit;\n' +
'uniform float uEvolution;\n' +
'uniform float uOffset;\n' +
'\n' +
'// WebGL1: no variable uniform-array indexing — constant loop, accumulate mix\n' +
'vec3 ramp(float t) {\n' +
'  t = clamp(t, 0.0, 1.0);\n' +
'  vec3 c = uStops[0];\n' +
'  for (int i = 1; i < ' + MAX_STOPS + '; i++) {\n' +
'    if (float(i) <= uStopCount - 1.0) {\n' +
'      float a = (uStopCount - 1.0) * t - (float(i) - 1.0);\n' +
'      c = mix(c, uStops[i], clamp(a, 0.0, 1.0));\n' +
'    }\n' +
'  }\n' +
'  return c;\n' +
'}\n' +
'\n' +
'// two-stage domain warp: warp the warp, so ribbons meander like liquid\n' +
'// metal. All time terms are sin/cos, so the loop is seamless.\n' +
'float field(vec2 p, float t) {\n' +
'  vec2 q = vec2(\n' +
'    sin(p.y * 2.3 + sin(t) * 1.7 + p.x * 1.3),\n' +
'    cos(p.x * 2.1 - cos(t * 0.8) * 1.5 + p.y * 1.7)\n' +
'  );\n' +
'  vec2 r = vec2(\n' +
'    sin((p.y + q.x) * 3.1 + cos(t * 0.6) * 1.3),\n' +
'    cos((p.x + q.y) * 2.7 + sin(t * 0.9))\n' +
'  );\n' +
'  return p.x * uScale + (0.5 * q.x + 0.35 * r.y) * uEvolution;\n' +
'}\n' +
'\n' +
'// split is applied in band-phase space (fraction of one band period)\n' +
'float bandv(float c, float split, float t) {\n' +
'  float f = fract(c * uRepeats + split + uOffset + 0.12 * sin(t * 0.7));\n' +
'  float tri = abs(f * 2.0 - 1.0);\n' +
'  // soft, wide edges: bands melt into each other like blurry reflections\n' +
'  // on polished chrome (steep edges read as graphic stripes, not liquid)\n' +
'  return smoothstep(0.06, 0.94, tri);\n' +
'}\n' +
'\n' +
'void main() {\n' +
'  vec2 p = gl_FragCoord.xy / uRes - 0.5;\n' +
'  p.x *= uRes.x / uRes.y;\n' +
'  float ca = cos(uAngle), sa = sin(uAngle);\n' +
'  p = mat2(ca, -sa, sa, ca) * p;\n' +
'  p.y *= uStretch;\n' +
'  float t = uTime;\n' +
'  float c = field(p, t);\n' +
'  // chromatic aberration: offset the sampling coordinate per channel so\n' +
'  // red/blue fringes hug the ribbon edges\n' +
'  vec3 col;\n' +
'  col.r = ramp(bandv(c, uRgbSplit, t)).r;\n' +
'  col.g = ramp(bandv(c, 0.0, t)).g;\n' +
'  col.b = ramp(bandv(c, -uRgbSplit, t)).b;\n' +
'  gl_FragColor = vec4(col, 1.0);\n' +
'}';

  function startOrb(canvas, stops, s) {
    var gl = null;
    try {
      gl = canvas.getContext('webgl', { antialias: true });
    } catch (e) { /* no WebGL */ }
    if (!gl) return; // transparent canvas -> conic fallback disc shows through

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('lgb orb shader:', gl.getShaderInfoLog(sh));
        throw new Error('shader compile failed');
      }
      return sh;
    }

    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('lgb orb link:', gl.getProgramInfoLog(prog));
        throw new Error('link failed');
      }
    } catch (e) {
      return;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    function U(name) { return gl.getUniformLocation(prog, name); }
    var uRes = U('uRes'), uTime = U('uTime'), uStops = U('uStops'),
        uStopCount = U('uStopCount'), uScale = U('uScale'), uRepeats = U('uRepeats'),
        uAngle = U('uAngle'), uStretch = U('uStretch'), uRgbSplit = U('uRgbSplit'),
        uEvolution = U('uEvolution'), uOffset = U('uOffset');

    var flat = new Float32Array(MAX_STOPS * 3);
    stops.slice(0, MAX_STOPS).forEach(function (c, i) {
      var rgb = hexToRgb(c);
      flat[i * 3] = rgb[0]; flat[i * 3 + 1] = rgb[1]; flat[i * 3 + 2] = rgb[2];
    });

    function size() {
      // 2x supersample — see header note. Cap the backing store: past ~320px
      // the ribbons are already smooth, and cost grows quadratically (a huge
      // button otherwise drags the SVG lens filter down with it).
      var dpr = 2 * Math.max(window.devicePixelRatio || 1, 1);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      var capScale = Math.min(1, 320 / Math.max(w, h));
      w = Math.round(w * capScale);
      h = Math.round(h * capScale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    }

    function draw(ms) {
      size();
      // tranmautritam's recipe: the shader is animated by ping-ponging the
      // parameters themselves between two states (eased auto-reverse):
      //   Depth 125%->200% · RGB split 10%->15% · Scale 100%->200%
      //   Angle -180->0 · Offset 0%->-100%
      // k is the eased 0..1..0 loop phase; each uniform lerps its range.
      var phase = (ms % s.animCycle) / s.animCycle;
      var pp = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      var k = pp * pp * (3 - 2 * pp); // smoothstep ease both ways
      gl.uniform3fv(uStops, flat);
      gl.uniform1f(uStopCount, Math.min(stops.length, MAX_STOPS));
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (ms / 1000) * s.speed);
      gl.uniform1f(uScale, s.scale / (1 + k));                       // zoom 100% -> 200% (fewer, fatter ribbons)
      gl.uniform1f(uRepeats, s.repeats);
      gl.uniform1f(uAngle, s.angle + (k - 1) * Math.PI);             // -180deg -> 0
      gl.uniform1f(uStretch, s.stretch);
      gl.uniform1f(uRgbSplit, s.rgbSplit * (1 + 0.5 * k));           // 10% -> 15%
      gl.uniform1f(uEvolution, s.evolution * (1.25 + 0.75 * k));     // depth 125% -> 200%
      gl.uniform1f(uOffset, -k);                                     // 0% -> -100% (one period)
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var reduced = typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    var stopped = false;
    var rafId = 0;
    var io = null;
    var ro = null;

    draw(performance.now()); // never blank: one frame immediately
    if (!reduced) {
      // don't burn frames while offscreen or in a hidden tab
      var visible = true;
      if (typeof IntersectionObserver !== 'undefined') {
        io = new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
        });
        io.observe(canvas);
      }
      var loop = function (ms) {
        if (stopped) return;
        if (visible && !document.hidden) draw(ms);
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () { if (!stopped) draw(performance.now()); });
      ro.observe(canvas);
    }

    // the destroy() handle: stop drawing and release the observers.
    // Deliberately no loseContext() — see the header note.
    return function () {
      stopped = true;
      cancelAnimationFrame(rafId);
      if (io) io.disconnect();
      if (ro) ro.disconnect();
    };
  }

  /* ----------------------------------------------------------- component */

  var DEFAULT_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2c.62 5.5 3.88 8.76 9.38 9.38v1.24C15.88 13.24 12.62 16.5 12 22h-1.24C10.14 16.5 6.88 13.24 1.38 12.62v-1.24C6.88 10.76 10.14 7.5 10.76 2z"/></svg>';

  var uidCounter = 0;

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src) for (var k in src) target[k] = src[k];
    }
    return target;
  }

  function upgrade(el, options) {
    if (el.dataset.lgbReady) return el;
    el.dataset.lgbReady = '1';
    injectStyles();

    var o = assign({
      preset: el.dataset.lgbPreset === 'northern' ? 'northern' : 'chrome',
      gradient: null,
      orb: true,
      orbIcon: DEFAULT_ICON,
      stroke: true,
      crispOrb: el.dataset.lgbCrisp !== 'false',
      forceFallback: false,
      glass: {},
      orbSettings: {}
    }, options);

    var stops = o.gradient || PRESETS[o.preset];
    var g = assign({ refraction: 32, frost: 1.5, dispersion: 0.35, depth: 0.5, light: 0.5 }, o.glass);
    var orbSettings = assign({
      scale: 1, repeats: 2.2, angle: 0.6, stretch: 1.4,
      speed: 0.5, evolution: 0.8, rgbSplit: 0.01,
      animCycle: 9000 // ms for one there-and-back of the parameter animation
    }, o.orbSettings);

    var useSvgGlass = svgBackdropOK && !o.forceFallback;
    var added = [];      // every node injected, so destroy() can undo it
    var stopOrb = null;
    el.classList.add('lgb');
    if (!useSvgGlass) el.classList.add('lgb--fb');
    if (o.crispOrb) el.classList.add('lgb--crisp');

    // existing content becomes the label
    var label = document.createElement('span');
    label.className = 'lgb__label';
    while (el.firstChild) label.appendChild(el.firstChild);

    if (o.glass !== false) {
      var fid = 'lgb-filter-' + (++uidCounter);
      var filterSvg = buildGlassFilter(fid, g);
      el.appendChild(filterSvg);
      added.push(filterSvg);
      var glass = document.createElement('span');
      glass.className = 'lgb__glass';
      glass.setAttribute('aria-hidden', 'true');
      glass.style.setProperty('--lgb-depth', g.depth);
      glass.style.setProperty('--lgb-light', g.light);
      if (useSvgGlass) {
        glass.style.backdropFilter = 'url(#' + fid + ')';
        glass.style.webkitBackdropFilter = 'url(#' + fid + ')';
      } else {
        // Safari/Firefox can't do SVG backdrop-filters; plain frosted glass
        glass.style.backdropFilter = 'blur(' + (g.frost * 4 + 4) + 'px) saturate(1.5)';
        glass.style.webkitBackdropFilter = 'blur(' + (g.frost * 4 + 4) + 'px) saturate(1.5)';
      }
      el.appendChild(glass);
      added.push(glass);
    }

    if (o.stroke) {
      var stroke = document.createElement('span');
      stroke.className = 'lgb__stroke';
      stroke.setAttribute('aria-hidden', 'true');
      stroke.style.setProperty('--lgb-stroke-stops', stops.concat(stops[0]).join(', '));
      el.appendChild(stroke);
      added.push(stroke);
    }

    if (o.orb) {
      var orb = document.createElement('span');
      orb.className = 'lgb__orb';
      orb.setAttribute('aria-hidden', 'true');
      // never a blank hole: conic disc from the same stops until GL draws
      orb.style.background = 'conic-gradient(from 210deg, ' + stops.concat(stops[0]).join(', ') + ')';
      var canvas = document.createElement('canvas');
      orb.appendChild(canvas);
      el.appendChild(orb);

      var orbtop = document.createElement('span');
      orbtop.className = 'lgb__orbtop';
      orbtop.setAttribute('aria-hidden', 'true');
      if (o.orbIcon) {
        var icon = document.createElement('span');
        icon.className = 'lgb__orbicon';
        icon.innerHTML = o.orbIcon;
        orbtop.appendChild(icon);
      }
      el.appendChild(orbtop);
      added.push(orb, orbtop);

      stopOrb = startOrb(canvas, stops, orbSettings) || null;
    }

    el.appendChild(label);
    el._lgb = { added: added, label: label, stopOrb: stopOrb };
    return el;
  }

  function destroy(el) {
    var rec = el._lgb;
    if (!rec) return el;
    if (rec.stopOrb) rec.stopOrb();
    rec.added.forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    // unwrap the label so the button's original content is restored
    while (rec.label.firstChild) el.insertBefore(rec.label.firstChild, rec.label);
    if (rec.label.parentNode) rec.label.parentNode.removeChild(rec.label);
    el.classList.remove('lgb', 'lgb--fb', 'lgb--crisp');
    delete el.dataset.lgbReady;
    delete el._lgb;
    return el;
  }

  function init(root) {
    (root || document).querySelectorAll('[data-lgb]').forEach(function (el) { upgrade(el); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }

  window.CMLiquidButton = { upgrade: upgrade, init: init, destroy: destroy, PRESETS: PRESETS };
})();
