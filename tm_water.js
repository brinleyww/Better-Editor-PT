// Water look: the see-through, rippling water material, and the splashes and spray a car throws up from water.
// Page only, loaded after tm_runtime.js. Physics (drag, bounces) lives in tm_runtime.js; this file only draws.
self.TM.water = (() => {
  const time = { value: 0 };
  let material = null;
  let ticking = false;
  const tick = (t) => {
    time.value = t / 1000;
    requestAnimationFrame(tick);
  };

  // A few travelling waves bend the normals of flat water, so the sun glints off moving ripples; the water is more
  // see-through looking straight down and close to opaque at a grazing angle, the way real water reflects the sky.
  const WAVES = `
    vec2 beWaveSlope(vec2 p, float t) {
      vec2 g = vec2(0.0);
      vec2 d; float k, a, w, ph;
      d = normalize(vec2(1.0, 0.35)); k = 0.31; a = 0.16; w = 1.3; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(-0.6, 1.0)); k = 0.53; a = 0.09; w = 1.9; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(0.2, -1.0)); k = 1.17; a = 0.035; w = 2.7; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(-1.0, -0.4)); k = 2.3; a = 0.016; w = 3.6; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(0.8, 0.9)); k = 4.1; a = 0.007; w = 5.1; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      return g;
    }
  `;

  function makeMaterial(three) {
    const m = new three._4j({ vertexColors: true, transparent: true, opacity: 0.58, roughness: 0.06, metalness: 0.1, side: 2 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.beTime = time;
      sh.vertexShader = 'varying vec3 vBeWorld;\n' + sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 beW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          beW = instanceMatrix * beW;
        #endif
        vBeWorld = (modelMatrix * beW).xyz;`,
      );
      sh.fragmentShader = 'uniform float beTime;\nvarying vec3 vBeWorld;\n' + WAVES + sh.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          vec3 beN = (vec4(normal, 0.0) * viewMatrix).xyz;
          float beUp = smoothstep(0.6, 0.95, abs(beN.y));
          vec2 beG = beWaveSlope(vBeWorld.xz, beTime);
          vec3 beWave = normalize(vec3(-beG.x, 1.0, -beG.y)) * sign(beN.y);
          normal = normalize(mix(normal, (viewMatrix * vec4(beWave, 0.0)).xyz, beUp));
          float beF = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          diffuseColor.a = mix(diffuseColor.a, 0.94, beF);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.9, 1.0), beF * 0.45);
        }`,
      );
    };
    // Its own program, so it never shares a compiled shader with the plain block material.
    m.customProgramCacheKey = () => 'be-water';
    return m;
  }

  // ---- splashes ---------------------------------------------------------------------------------------------------
  const MAX = 900; // droplets alive at once, per scene
  const GRAVITY = 22;
  const systems = new WeakMap(); // scene wrapper -> droplets and foam rings
  const cars = new WeakMap(); // car -> its water boxes and what it was doing last frame

  const canvasTexture = (three, draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    draw(c.getContext('2d'));
    const t = new three.gPd(c);
    t.needsUpdate = true;
    return t;
  };

  function system(three, sw) {
    let s = systems.get(sw);
    if (s) return s;
    const pos = new Float32Array(MAX * 3).fill(-1e5);
    const geo = new three.LoY();
    geo.setAttribute('position', new three.THS(pos, 3));
    const drop = canvasTexture(three, (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.45, 'rgba(225,242,255,0.85)');
      r.addColorStop(1, 'rgba(200,230,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    const pts = new three.ONl(geo, new three.BH$({ size: 0.55, map: drop, transparent: true, depthWrite: false, color: 0xeaf6ff, opacity: 0.9 }));
    pts.frustumCulled = false;
    sw.scene.add(pts);
    const ringTex = canvasTexture(three, (g) => {
      const r = g.createRadialGradient(32, 32, 14, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,0)');
      r.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      r.addColorStop(0.8, 'rgba(235,247,255,0.5)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    const plane = new three.bdM(1, 1);
    plane.rotateX(-Math.PI / 2);
    s = { pts, pos, geo, vel: new Float32Array(MAX * 3), floor: new Float32Array(MAX), live: 0, rings: [], ringTex, plane, three, sw };
    systems.set(sw, s);
    return s;
  }

  function emit(s, x, y, z, vx, vy, vz, floor) {
    if (s.live >= MAX) return;
    const i = s.live++,
      k = i * 3;
    s.pos[k] = x;
    s.pos[k + 1] = y;
    s.pos[k + 2] = z;
    s.vel[k] = vx;
    s.vel[k + 1] = vy;
    s.vel[k + 2] = vz;
    s.floor[i] = floor;
  }

  function ring(s, x, y, z, size) {
    const m = new s.three.eaF(s.plane, new s.three.V9B({ map: s.ringTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    m.position.set(x, y + 0.05, z);
    m.scale.setScalar(size);
    s.sw.scene.add(m);
    s.rings.push({ m, age: 0, size });
  }

  // strength 0..1. vx/vz: the car's velocity along the water, so the spray is thrown forward with it.
  function splash(s, x, y, z, vx, vz, strength) {
    const n = Math.round(60 + 260 * strength),
      speed = Math.hypot(vx, vz),
      fx = speed > 0.1 ? vx / speed : 0,
      fz = speed > 0.1 ? vz / speed : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        out = (2 + Math.random() * 7) * (0.5 + strength),
        side = i % 3 == 0;
      // A third go out to the sides as two sheets, the rest up and around the car.
      let dx = Math.cos(a) * out,
        dz = Math.sin(a) * out;
      if (side) {
        const sgn = Math.random() < 0.5 ? -1 : 1;
        dx = -fz * sgn * (5 + Math.random() * 9) * (0.5 + strength);
        dz = fx * sgn * (5 + Math.random() * 9) * (0.5 + strength);
      }
      emit(s, x + (Math.random() - 0.5) * 2.4, y + 0.1, z + (Math.random() - 0.5) * 2.4, vx * 0.45 + dx, (3 + Math.random() * 9) * (0.4 + strength), vz * 0.45 + dz, y);
    }
    ring(s, x, y, z, 3 + 6 * strength);
  }

  function update(car, sw, dt, state, three) {
    const c = cars.get(car);
    if (!c || !c.zones.length || !state) return;
    const s = system(three, sw);
    const p = state.position,
      f = state.frames;
    // Velocity from the physics frames, not render frames, so a stall or catch-up never fakes a splash.
    if (f != c.f) {
      const steps = Math.max(1, f - c.f);
      if (c.f >= 0 && steps < 200) {
        c.pvy = c.vy;
        c.vx = ((p.x - c.x) / steps) * 1000;
        c.vy = ((p.y - c.y) / steps) * 1000;
        c.vz = ((p.z - c.z) / steps) * 1000;
      }
      c.f = f;
      c.x = p.x;
      c.y = p.y;
      c.z = p.z;
      let zone = null;
      for (const q of c.zones)
        if (p.x >= q.min[0] && p.x <= q.max[0] && p.z >= q.min[2] && p.z <= q.max[2] && p.y >= q.min[1] - 1 && p.y <= q.max[1] + 4) {
          zone = q;
          break;
        }
      if (zone && steps < 200) {
        const top = zone.surface ?? zone.max[1],
          low = p.y - 0.45 - top, // car underside relative to the surface
          speed = Math.hypot(c.vx, c.vz);
        const strength = Math.min(1, Math.max(0, (-c.pvy - 2) / 18 + speed / 260));
        // Hitting the surface on the way down, or coming back up off it after a bounce.
        if (c.cool <= 0 && low < 0.3 && c.pvy < -3 && (c.wasAbove || c.vy > 1)) {
          splash(s, p.x, top, p.z, c.vx, c.vz, strength);
          c.cool = 120;
        }
        // Spray along the surface while the car skims or drives through shallow water.
        if (low > -1.4 && low < 0.6 && speed > 8) {
          const n = Math.min(10, speed / 14);
          for (let i = 0; i < n; i++) {
            const sgn = i % 2 ? 1 : -1,
              fx = c.vx / speed,
              fz = c.vz / speed,
              out = 1.5 + Math.random() * 3 + speed * 0.04;
            emit(s, p.x - fx * 1.6 + -fz * sgn * 1.1, top + 0.05, p.z - fz * 1.6 + fx * sgn * 1.1, c.vx * 0.3 - fz * sgn * out, 1.5 + Math.random() * (2 + speed * 0.05), c.vz * 0.3 + fx * sgn * out, top);
          }
        }
        c.wasAbove = low > 0.2;
      } else c.wasAbove = true;
      c.cool -= steps;
    }
    step(s, dt);
  }

  function step(s, dt) {
    // Several cars (ghosts) share one scene: move the droplets once per drawn frame.
    if (s.stepped == time.value) return;
    s.stepped = time.value;
    for (let i = 0; i < s.live; i++) {
      const k = i * 3;
      s.vel[k + 1] -= GRAVITY * dt;
      s.pos[k] += s.vel[k] * dt;
      s.pos[k + 1] += s.vel[k + 1] * dt;
      s.pos[k + 2] += s.vel[k + 2] * dt;
      // A droplet is gone once it falls back below the water it came from.
      if (s.pos[k + 1] < s.floor[i] - 0.2 && s.vel[k + 1] < 0) {
        const j = --s.live,
          l = j * 3;
        for (let a = 0; a < 3; a++) {
          s.pos[k + a] = s.pos[l + a];
          s.vel[k + a] = s.vel[l + a];
          s.pos[l + a] = -1e5;
        }
        s.floor[i] = s.floor[j];
        i--;
      }
    }
    s.geo.attributes.position.needsUpdate = true;
    s.geo.setDrawRange(0, s.live);
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.age += dt;
      r.m.scale.setScalar(r.size * (1 + r.age * 2.2));
      r.m.material.opacity = Math.max(0, 0.85 * (1 - r.age / 1.4));
      if (r.age > 1.4) {
        s.sw.scene.remove(r.m);
        r.m.material.dispose();
        s.rings.splice(i, 1);
      }
    }
  }

  return {
    material(three) {
      if (!material) material = makeMaterial(three);
      if (!ticking && typeof requestAnimationFrame == 'function') {
        ticking = true;
        requestAnimationFrame(tick);
      }
      return material;
    },
    // A new car on a track: remember where its water is.
    track(car, trackData) {
      try {
        const zones = self.TM.zones(trackData).filter((z) => z.type == 'Water' || z.type == 'Shallow');
        cars.set(car, { zones, f: -1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pvy: 0, wasAbove: true, cool: 0 });
      } catch (e) {
        console.warn('Water splashes off:', e);
      }
    },
    update,
    dispose(car) {
      cars.delete(car);
    },
  };
})();
