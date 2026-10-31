import { Program as OglProgram, type OGLRenderingContext, type UniformInfo } from "ogl";

/* ----------------------------------------------------------------------------
   SHADERS THAT COMPILE BESIDE THE PAGE

   OGL's Program reads each shader's log the moment it has compiled it, and
   the program's status the moment it has linked it -- and both questions
   make the page wait for their answers. Asked in turn for every program in
   the scene, that waiting was most of its setup, measured: 7 to 33 ms a
   program, about 270 of the 400 ms the setup took on the main thread. The
   same sources compiled a second time took as long again, so no cache was
   going to hide it.

   This Program asks nothing when it is made. It hands the driver the sources
   and the link and goes on, so every program compiles at once and none of
   them in front of the page. `whenCompiled` then waits for them without
   blocking, through KHR_parallel_shader_compile, which can say whether a
   program is done without waiting for it to be. What OGL reads at link time
   -- the logs, the status, every uniform and attribute location -- is read
   when the program is first used, by which point there is nothing left to
   wait for.

   Without the extension nothing can be waited for in the background, so the
   programs are finished one per task instead: each still blocks, but only
   for itself, and the page gets a turn between them.
-------------------------------------------------------------------------------*/

type Sources = { vertex: string; fragment: string };

/** Per context: every program handed to the driver and not yet finished. */
const pendingOn = new WeakMap<object, Map<Program, Sources>>();

function pendingFor(gl: object) {
  let pending = pendingOn.get(gl);
  if (!pending) {
    pending = new Map();
    pendingOn.set(gl, pending);
  }
  return pending;
}

type Parallel = { COMPLETION_STATUS_KHR: number };

export class Program extends OglProgram {
  /* No fields. OGL calls setShaders from inside its own constructor, before
     a subclass's fields exist, and an initialised field would be set after
     it and wipe whatever setShaders had stored -- so the state lives in
     pendingOn instead. */

  setShaders({ vertex, fragment }: Sources) {
    const gl = this.gl;
    // Switched on before the first compile is handed over.
    gl.getExtension("KHR_parallel_shader_compile");
    if (vertex) {
      gl.shaderSource(this.vertexShader, vertex);
      gl.compileShader(this.vertexShader);
    }
    if (fragment) {
      gl.shaderSource(this.fragmentShader, fragment);
      gl.compileShader(this.fragmentShader);
    }
    gl.linkProgram(this.program);
    pendingFor(gl).set(this, { vertex, fragment });
  }

  /** What OGL reads once a program has linked: the second half of OGL
      1.0.11's setShaders. Waits for the link if it has not finished, and
      does nothing the second time. */
  finish() {
    const gl = this.gl;
    const pending = pendingOn.get(gl);
    const sources = pending?.get(this);
    if (!pending || !sources) return;
    pending.delete(this);

    /* The one change from OGL: the shaders' logs are read only when the
       link has failed. Reading a log waits on more than the link does --
       30 to 65 ms a shader, measured, on programs already reported done --
       and a program that linked has nothing in them worth the wait. */
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const { vertex, fragment } = sources;
      const vlog = gl.getShaderInfoLog(this.vertexShader);
      const flog = gl.getShaderInfoLog(this.fragmentShader);
      if (vertex && vlog) console.warn(`${vlog}\nVertex Shader\n${numbered(vertex)}`);
      if (fragment && flog) console.warn(`${flog}\nFragment Shader\n${numbered(fragment)}`);
      console.warn(gl.getProgramInfoLog(this.program));
      return;
    }

    this.uniformLocations = new Map();
    const uniforms: number = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniforms; i++) {
      const uniform = gl.getActiveUniform(this.program, i) as UniformInfo;
      this.uniformLocations.set(uniform, gl.getUniformLocation(this.program, uniform.name) as WebGLUniformLocation);
      // Array and struct uniforms: the name, then its components.
      const split = uniform.name.match(/(\w+)/g) as string[];
      uniform.uniformName = split[0];
      uniform.nameComponents = split.slice(1);
    }

    this.attributeLocations = new Map();
    const order: string[] = [];
    const attributes: number = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < attributes; i++) {
      const attribute = gl.getActiveAttrib(this.program, i) as WebGLActiveInfo;
      const location = gl.getAttribLocation(this.program, attribute.name);
      // Built-in inputs such as gl_InstanceID have no location.
      if (location === -1) continue;
      order[location] = attribute.name;
      this.attributeLocations.set(attribute, location);
    }
    this.attributeOrder = order.join("");
  }

  /* OGL's Mesh uses its program before its geometry reads the attribute
     locations, so finishing here covers both. */
  use(options?: { flipFaces?: boolean }) {
    this.finish();
    super.use(options);
  }

  remove() {
    pendingOn.get(this.gl)?.delete(this);
    super.remove();
  }
}

/** Resolves once every program made on this context has compiled, linked
    and been finished -- including any made while it waits. Polled, never
    waited on, where the browser offers a way to ask. */
export function whenCompiled(gl: OGLRenderingContext): Promise<void> {
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as Parallel | null;
  return new Promise((resolve) => {
    const step = () => {
      const pending = pendingOn.get(gl);
      // A lost context answers nothing: let the first draw fail as it would have.
      if (!pending || pending.size === 0 || gl.isContextLost()) {
        resolve();
        return;
      }
      /* One program finished per task: finishing can still wait on the
         driver, and between programs the page gets its turn. Nothing else
         is asked of a pending program -- not even isProgram, which waits for
         the link like any other question and was measured undoing the whole
         point, one program at a time. Deletion goes through remove(), which
         takes a program off the list. */
      let next: Program | undefined;
      if (parallel) {
        for (const program of pending.keys()) {
          if (gl.getProgramParameter(program.program, parallel.COMPLETION_STATUS_KHR)) {
            next = program;
            break;
          }
        }
      } else {
        next = pending.keys().next().value;
      }
      next?.finish();
      setTimeout(step, next ? 0 : 16);
    };
    // After the task that made the programs, not at the end of it.
    setTimeout(step, 0);
  });
}

function numbered(source: string) {
  return source
    .split("\n")
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");
}
