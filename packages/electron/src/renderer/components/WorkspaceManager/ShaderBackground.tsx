// ShaderBackground — the Auracle launcher's living dot-reveal backdrop,
// ported to the IDE so the Workspace Manager welcome pane and the desktop
// launcher share ONE identical animated background (dots reveal from the
// centre and twinkle).
//
// The launcher renders this via three.js + @react-three/fiber
// (auracle-desktop `CanvasRevealEffect`). Dragging those two heavy deps into
// the IDE just to draw one fullscreen quad would be pure bloat, so this runs
// the *exact same* GLSL fragment shader through a raw WebGL2 canvas — same
// grid, same motion, zero new dependencies. Params mirror the launcher's
// ShellBackground: white dots, dotSize 6, totalSize 20, reverse off.
//
// The readability overlays (veil + centre vignette + top/bottom fades) match
// ShellBackground so the two screens read identically.
import { useEffect, useRef } from 'react';

// Fragment shader copied verbatim from the launcher's DotMatrix
// (auracle-desktop/src/components/ui/canvas-reveal-effect.tsx). Do not fork
// the motion — both surfaces must move identically.
const FRAG = `#version 300 es
precision mediump float;
in vec2 fragCoord;

uniform float u_time;
uniform float u_opacities[10];
uniform vec3 u_colors[6];
uniform float u_total_size;
uniform float u_dot_size;
uniform vec2 u_resolution;
uniform int u_reverse;

out vec4 fragColor;

float PHI = 1.61803398874989484820459;
float random(vec2 xy) {
    return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
}

void main() {
    vec2 st = fragCoord.xy;
    st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
    st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

    float opacity = step(0.0, st.x);
    opacity *= step(0.0, st.y);

    vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

    float frequency = 5.0;
    float show_offset = random(st2);
    float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
    opacity *= u_opacities[int(rand * 10.0)];
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

    vec3 color = u_colors[int(show_offset * 6.0)];

    float animation_speed_factor = 0.5;
    vec2 center_grid = u_resolution / 2.0 / u_total_size;
    float dist_from_center = distance(center_grid, st2);

    float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);

    float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
    float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);

    float current_timing_offset;
    if (u_reverse == 1) {
        current_timing_offset = timing_offset_outro;
        opacity *= 1.0 - step(current_timing_offset, u_time * animation_speed_factor);
        opacity *= clamp((step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
    } else {
        current_timing_offset = timing_offset_intro;
        opacity *= step(current_timing_offset, u_time * animation_speed_factor);
        opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
    }

    fragColor = vec4(color, opacity);
    fragColor.rgb *= fragColor.a;
}`;

// Fullscreen-quad vertex shader — mirrors the launcher's three.js vertex
// stage: derive fragCoord (in u_resolution space, y-flipped) from clip coords.
const VERT = `#version 300 es
precision mediump float;
in vec2 a_pos;
uniform vec2 u_resolution;
out vec2 fragCoord;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  fragCoord = (a_pos + vec2(1.0)) * 0.5 * u_resolution;
  fragCoord.y = u_resolution.y - fragCoord.y;
}`;

// Launcher ShellBackground params.
const OPACITIES = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1.0];
const COLORS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]; // 6 × white
const TOTAL_SIZE = 20.0;
const DOT_SIZE = 6.0;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[ShaderBackground] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
    if (!gl) return; // WebGL2 unavailable — the black container is a fine fallback.

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[ShaderBackground] program link failed:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // Fullscreen quad (two triangles).
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Static uniforms (match the launcher's DotMatrix).
    gl.uniform1fv(gl.getUniformLocation(prog, 'u_opacities'), OPACITIES);
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_colors'), COLORS);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_total_size'), TOTAL_SIZE);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_dot_size'), DOT_SIZE);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_reverse'), 0);
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');

    // Additive blend, matching three's CustomBlending (SrcAlpha, One).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      // The launcher feeds u_resolution at 2× CSS size; mirror it so the dot
      // grid pitch is identical regardless of this display's DPR.
      gl.uniform2f(uRes, canvas.clientWidth * 2, canvas.clientHeight * 2);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let lost = false;
    const start = performance.now();

    const draw = (t: number) => {
      gl.uniform1f(uTime, t);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    if (reduced) {
      // Motion-sensitive: draw one fully-revealed frame as a static dot field.
      draw(8.0);
    } else {
      const loop = () => {
        if (lost) return;
        draw((performance.now() - start) / 1000);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      if (raf) cancelAnimationFrame(raf);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      lost = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black" aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      {/* Readability overlays — identical layering to the launcher's ShellBackground. */}
      <div className="absolute inset-0 bg-black/15" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.5)_0%,_transparent_70%)]" />
      <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-black to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black to-transparent" />
    </div>
  );
}
