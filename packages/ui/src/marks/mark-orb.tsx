import { MARK_ART } from "@repo/brand";
import { useEffect, useRef } from "react";
import { fitCanvas, paintLoop, roleChannels } from "../components/landing/landing-paint.js";

const TONE_ROLES = [
  "--ui-color-ground",
  "--ui-color-accent",
  "--ui-color-accent-text",
  "--ui-color-ink",
] as const;

const DEEP_MIX = 0.55;

const REACH = { START: 1.5, FULL: 1 } as const;

const SPRING = { STIFFNESS: 60, MAX_STEP: 0.033 } as const;

const BALL_SHARE = 0.82;

const CELLS_ACROSS = 420;

const MASK = { SIZE: 1024, BEVEL_BLUR: "blur(14px)" } as const;

const VERTEX = "#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 res; uniform float t; uniform float px; uniform vec2 m; uniform float near; uniform sampler2D mark; uniform vec3 pal[5];
out vec4 o;
float bayer(vec2 p){ int x=int(mod(p.x,8.)), y=int(mod(p.y,8.));
  int b[64]=int[64](0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21);
  return (float(b[y*8+x])+.5)/64.; }
vec4 logo(vec2 p){ return texture(mark, vec2(p.x*.5+.5, .5-p.y*.5)); }
vec3 tone(float v, float d){ int k = int(clamp(floor(clamp(v,0.,1.)*4. + d), 0., 4.)); return pal[k]; }
float studio(vec3 rd, float t, vec2 m, float near){
  float a = t*.12 + m.x*.5*near; float c = cos(a), s = sin(a);
  rd = vec3(c*rd.x + s*rd.z, rd.y, -s*rd.x + c*rd.z);
  float top = smoothstep(.45, .75, rd.y) * smoothstep(.95, .6, abs(rd.x));
  float strip = smoothstep(.55, .8, rd.x) * smoothstep(.55, .25, abs(rd.y));
  float rim = smoothstep(.2, .6, -rd.z) * smoothstep(.5, .1, abs(rd.y + .1)) * .7;
  return clamp(.06 + top*.95 + strip*.8 + rim, 0., 1.);
}
void main(){
  vec2 cell = floor(gl_FragCoord.xy/px)*px + px*.5;
  float S = min(res.x, res.y) * ${BALL_SHARE};
  vec2 p = (cell - res*.5) / (S*.5);
  float r = length(p), d = bayer(gl_FragCoord.xy/px);
  vec4 lg = r < 1. ? logo(p) : vec4(0.);
  vec3 col = pal[0];
  if (lg.r > .5) {
    vec3 n = vec3(p, sqrt(max(0., 1.-r*r)));
    float e = .012;
    vec2 g = vec2(logo(p+vec2(e,0.)).b - logo(p-vec2(e,0.)).b, logo(p+vec2(0.,e)).b - logo(p-vec2(0.,e)).b) / (2.*e);
    n = normalize(n + vec3(-g*.045, 0.) * (.6 + clamp(1. - lg.b, 0., 1.)));
    vec3 rd = reflect(vec3(0.,0.,-1.), n);
    vec3 l = normalize(mix(normalize(vec3(-.55, .6, .75)), normalize(vec3(m*1.2, .6)), near*.85));
    float spec = pow(clamp(dot(reflect(-l,n), vec3(0.,0.,1.)),0.,1.), 48.);
    float fres = pow(1.-n.z, 3.);
    col = tone(clamp(studio(rd, t, m, near)*.85 + spec*.9 + fres*.18, 0., 1.)*(.94 + .06*sin(t*1.3)), d);
  } else if (r < 1.) {
    vec4 w = logo(p + vec2(0., .03));
    if (w.r > .5) col = tone(.28, d);
  }
  o = vec4(col, 1.);
}`;

interface Lean {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  near: number;
  want: number;
}

function paletteOf(canvas: HTMLCanvasElement): Float32Array {
  const [ground, accent, link, ink] = TONE_ROLES.map((role) => roleChannels(canvas, role));
  const deep = (accent ?? [0, 0, 0]).map(
    (c, i) => c * (1 - DEEP_MIX) + (ground?.[i] ?? 0) * DEEP_MIX,
  );
  return new Float32Array([
    ...(ground ?? []),
    ...deep,
    ...(accent ?? []),
    ...(link ?? []),
    ...(ink ?? []),
  ]);
}

function markTexture(gl: WebGL2RenderingContext): void {
  const canvas = document.createElement("canvas");
  canvas.width = MASK.SIZE;
  canvas.height = MASK.SIZE;
  const context = canvas.getContext("2d");
  if (!context) return;
  const path = new Path2D(MARK_ART.PATH);
  context.scale(MASK.SIZE / 100, MASK.SIZE / 100);
  context.fillStyle = "#f00";
  context.fill(path);
  context.globalCompositeOperation = "lighter";
  context.filter = MASK.BEVEL_BLUR;
  context.fillStyle = "#00f";
  context.fill(path);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function ballProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(kind);
    if (shader) {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
  }
  gl.linkProgram(program);
  gl.useProgram.call(gl, program);
  return program;
}

function ballDrawer(canvas: HTMLCanvasElement): ((t: number, lean: Lean) => void) | undefined {
  const gl = canvas.getContext("webgl2");
  if (!gl) return undefined;
  const program = ballProgram(gl);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  markTexture(gl);
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform3fv(at("pal"), paletteOf(canvas));
  gl.uniform1i(at("mark"), 0);
  return (t, lean) => {
    fitCanvas(canvas);
    const { width, height } = canvas;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(at("res"), width, height);
    gl.uniform1f(at("t"), t);
    gl.uniform1f(at("px"), Math.max(2, Math.round(width / CELLS_ACROSS)));
    gl.uniform2f(at("m"), lean.x, lean.y);
    gl.uniform1f(at("near"), lean.near);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

function stepLean(lean: Lean, dt: number): void {
  const damping = 2 * Math.sqrt(SPRING.STIFFNESS);
  lean.vx += ((lean.tx - lean.x) * SPRING.STIFFNESS - lean.vx * damping) * dt;
  lean.vy += ((lean.ty - lean.y) * SPRING.STIFFNESS - lean.vy * damping) * dt;
  lean.x += lean.vx * dt;
  lean.y += lean.vy * dt;
  lean.near += (lean.want - lean.near) * Math.min(1, dt * 4);
}

export function MarkOrb(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const draw = ballDrawer(canvas);
    if (!draw) return undefined;
    const lean: Lean = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, near: 0, want: 0 };
    let previous = 0;
    const onMove = (event: PointerEvent): void => {
      const box = canvas.getBoundingClientRect();
      const half = (Math.min(box.width, box.height) * BALL_SHARE) / 2;
      lean.tx = (event.clientX - box.left - box.width / 2) / half;
      lean.ty = -(event.clientY - box.top - box.height / 2) / half;
      const reach = Math.hypot(lean.tx, lean.ty);
      lean.want = Math.max(0, Math.min(1, (REACH.START - reach) / (REACH.START - REACH.FULL)));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    const stop = paintLoop(canvas, (t) => {
      stepLean(lean, Math.min(SPRING.MAX_STEP, t - previous || SPRING.MAX_STEP));
      previous = t;
      draw(t, lean);
    });
    return () => {
      stop();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <canvas ref={ref} className="ui-landing-orb" />;
}
