// Trackmania-style HUD for the new blocks: a banner naming the effects the car has (turbo, no engine, a new car...),
// like TM2020's "Display an alert when you drive on a special block", and, when Wheel info is on in the settings, what
// each tyre is on, its grip and how wet, icy or muddy it is. Page only, loaded after tm_vehicles.js.
// Nothing comes back from the worker: like tm_water.js and tm_vehicles.js this works it all out from the car states the
// page already gets, frame by frame (VisualCar.setCarState calls TM.hud.state with every physics frame's state), the
// same way tm_runtime.js fxStep decides it. It rides on tm_water's car hooks (TM.water.track / update / dispose) for the
// rest, so anything that already calls those gets this too.
// Only the car the HUD is for: the one the game's speedometer shows (TM.hud.focus, called next to it: the player's car,
// or the watched car of a replay), or Not So Weekly Shorts' __getPlayerState. Ghosts and other racers never show.
self.TM.hud = (() => {
  const TM = self.TM;
  const W = TM.water;
  // The runtime's own tables where it exports them (tm_runtime.js), so the page and the physics agree. TURBO is not
  // exported (yet), and an older runtime has no REACTOR: these copies are the effect lengths in physics frames (1 ms).
  const TURBO = TM.TURBO ?? { Turbo: { frames: 1000 }, Super: { frames: 1400 }, Ultra: { frames: 1800 } };
  const REACTOR = TM.REACTOR ?? { ReactorUp: { frames: 6000 }, ReactorDown: { frames: 6000 }, Reactor2Up: { frames: 6000 }, Reactor2Down: { frames: 6000 } };
  // Which boost a reactor plate gives (up along its arrow, down against it): the runtime's own pick, on the same states.
  // An older runtime had one boost per plate type.
  const reactorPick = typeof TM.reactorPick == 'function' ? TM.reactorPick : (q) => (q.type in REACTOR ? q.type : null);
  const GATES = TM.vehicleGates ?? { CarSnow: 'Snow', CarRally: 'Rally', CarDesert: 'Desert', CarStadium: 'Stadium' };
  const VEHICLES = TM.VEHICLES ?? {};
  const SURFACES = TM.surfaces ?? [];
  const WET = TM.WATER ?? { soak: 0.6, dry: 0.1, under: 0.45, wetGrip: { road: 0.15 } };
  const ICING = TM.ICING ?? { surfaces: [3, 4, 7], on: 0.8, off: 0.4, grip: 0.5 };
  // The runtime's own tyre model where it has one (wet, iced and muddy tyres per wheel): the same code steps the tyres
  // here, so the panel shows exactly what the physics has. Without it (an older runtime) the copies below stand in.
  const TYRES = TM.TYRES && typeof TM.TYRES.step == 'function' && typeof TM.TYRES.grip == 'function' ? TM.TYRES : null;
  const ROULETTE = ['Turbo', 'Super', 'Ultra']; // the runtime's pick by the frame the car crosses it: frames % 3
  const RESPAWN = 5; // the runtime's respawn test: the car moved more than this in one frame (units, Manhattan)
  // Bumpers, the reset plate and a new car have nothing that lasts, so their chip stays this long (race frames, 1.5 s).
  const ONE_SHOT = 1500;

  // ---- what the banner says -----------------------------------------------------------------------------------------
  // One chip per kind of effect, in this order. good: a boost (green bar), bad: a handicap (red), info: white.
  const BOOST = 0,
    REACT = 1,
    SLOW = 2,
    CRUISE = 3,
    NO_ENGINE = 4,
    NO_BRAKE = 5,
    NO_STEER = 6,
    FRAGILE = 7,
    CAR = 8,
    BUMP = 9,
    RESET = 10;
  const KIND = ['good', 'good', 'bad', 'bad', 'bad', 'bad', 'bad', 'bad', 'info', 'info', 'info'];
  const LABEL = {
    Turbo: 'TURBO',
    Super: 'SUPER TURBO',
    Ultra: 'ULTRA TURBO',
    ReactorUp: 'REACTOR BOOST',
    ReactorDown: 'REACTOR BOOST DOWN',
    Reactor2Up: 'SUPER REACTOR BOOST',
    Reactor2Down: 'SUPER REACTOR BOOST DOWN',
    Bumper: 'BUMPER',
    Bumper2: 'SUPER BUMPER',
    Snow: 'SNOW CAR',
    Rally: 'RALLY CAR',
    Desert: 'DESERT CAR',
    Stadium: 'STADIUM CAR',
  };
  const FIXED = [null, null, 'SLOW-MO', 'CRUISE CONTROL', 'NO ENGINE', 'NO BRAKES', 'NO STEERING', 'FRAGILE', null, null, 'RESET'];

  // ---- per car --------------------------------------------------------------------------------------------------------
  const cars = new WeakMap(); // car -> its zones and the effects, vehicle and tyres the runtime gives it
  const AIR = -2; // wheel surface codes: a part.u, -1 stock road (TM's Tech), AIR off the ground

  function fresh(trackData) {
    const zones = TM.zones(trackData);
    return {
      track: trackData,
      zones,
      water: zones.filter((z) => z.type == 'Water' || z.type == 'Shallow'),
      inside: new Uint8Array(zones.length),
      cells: null, // TM.surfaceIndex, built when the car is first watched
      watch: false, // only the car the HUD shows is followed; the rest cost nothing
      f: -1,
      done: false,
      lastCp: 0,
      has: false,
      x: 0,
      y: 0,
      z: 0,
      boost: null,
      boostLeft: 0,
      reactor: null,
      reactorLeft: 0,
      thrust: false, // the reactor is pushing (the gas is held)
      slow: false,
      noEngine: false,
      noBrake: false,
      noSteer: false,
      cruise: false,
      fragile: false,
      vehicle: 'Stadium',
      cpVehicle: 'Stadium',
      shotLabel: [null, null, null], // CAR, BUMP, RESET: what the chip says and until which race frame
      shotUntil: [0, 0, 0],
      wet: 0,
      ice: new Float32Array(4),
      tyre: TYRES ? [0, 1, 2, 3].map(TYRES.fresh) : null, // each wheel's {wet, ice, mud} (TYRES)
      wheel: new Int8Array(4).fill(AIR), // surface code per wheel, last frame
      inWater: new Uint8Array(4), // the wheel is under a water surface
      brake: false,
    };
  }

  // Every effect ends (tm_runtime.js clear): on a Reset plate, a checkpoint and a respawn. The vehicle and the tyres stay.
  function clear(c) {
    c.boost = c.reactor = null;
    c.boostLeft = c.reactorLeft = 0;
    c.slow = c.noEngine = c.noBrake = c.noSteer = c.cruise = c.fragile = false;
  }
  function restart(c, s) {
    clear(c);
    c.vehicle = c.cpVehicle = 'Stadium';
    c.inside.fill(0);
    c.lastCp = s.nextCheckpointIndex;
    c.has = false;
    c.done = false;
    clean(c);
    c.wheel.fill(AIR);
    c.inWater.fill(0);
    c.shotLabel.fill(null);
  }
  // Clean, dry tyres (a respawn, a new car).
  function clean(c) {
    c.wet = 0;
    c.ice.fill(0);
    if (c.tyre) for (const t of c.tyre) t.wet = t.ice = t.mud = 0;
  }
  // A one-shot chip (CAR, BUMP or RESET) from this race frame on.
  function shot(c, k, label, frames) {
    c.shotLabel[k - CAR] = label;
    c.shotUntil[k - CAR] = frames + ONE_SHOT;
  }

  // One physics frame, in the runtime's order: controls (fxControls), then respawn, checkpoint, zones, tyres, timers (fxStep).
  function step(c, s) {
    const p = s.position;
    if (c.f < 0 || s.frames < c.f || !s.hasStarted) restart(c, s);
    c.f = s.frames;
    if (c.done) return;
    if (s.finishFrames != null) {
      // The runtime does nothing more once the car is through the finish; nor does the banner.
      c.done = true;
      clear(c);
      c.shotLabel.fill(null);
      return;
    }
    // Slow motion: the runtime holds every other frame, sending the last state again with only the clock moved on. Effects
    // do not count down on those frames.
    if (c.slow && c.has && p.x === c.x && p.y === c.y && p.z === c.z) return;
    // The reset key (or a fragile car breaking: the runtime presses it for the car) ends every effect; the controls in the
    // state are the ones the car got, after the effects filtered them.
    const reset = !!s.controls?.reset;
    if (reset) clear(c);
    if ((c.has && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) + Math.abs(p.z - c.z) > RESPAWN) || (reset && c.lastCp > 0)) {
      clear(c);
      c.vehicle = c.cpVehicle;
      clean(c);
      c.shotLabel.fill(null); // a bumper or gate passed before the respawn is no news any more
    }
    const cp = s.nextCheckpointIndex;
    if (cp > c.lastCp) {
      clear(c);
      c.cpVehicle = c.vehicle;
    }
    c.lastCp = cp;

    let water = null;
    for (let i = 0; i < c.zones.length; i++) {
      const q = c.zones[i],
        hit = p.x >= q.min[0] && p.x <= q.max[0] && p.y >= q.min[1] && p.y <= q.max[1] && p.z >= q.min[2] && p.z <= q.max[2];
      if ((q.type == 'Water' || q.type == 'Shallow') && p.x >= q.min[0] && p.x <= q.max[0] && p.z >= q.min[2] && p.z <= q.max[2] && p.y >= q.min[1] - 1 && p.y <= q.surface + 3) water = q;
      if (!hit) {
        c.inside[i] = 0;
        continue;
      }
      if (c.inside[i]) continue;
      c.inside[i] = 1;
      switch (q.type) {
        case 'Turbo':
        case 'Super':
        case 'Ultra':
          c.boost = q.type;
          c.boostLeft = TURBO[q.type].frames;
          break;
        case 'Roulette':
          c.boost = ROULETTE[s.frames % 3];
          c.boostLeft = TURBO[c.boost].frames;
          break;
        case 'ReactorUp':
        case 'ReactorDown':
        case 'Reactor2Up':
        case 'Reactor2Down':
        case 'ReactorOriented':
        case 'Reactor2Oriented': {
          // up or down by the car's move since the last frame (or its nose), exactly as fxStep picks it
          const moved = c.has && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) + Math.abs(p.z - c.z) < RESPAWN,
            Q = s.quaternion,
            r = reactorPick(q, moved ? p.x - c.x : 0, moved ? p.y - c.y : 0, moved ? p.z - c.z : 0, Q.x, Q.y, Q.z, Q.w);
          if (r && REACTOR[r]) {
            c.reactor = r;
            c.reactorLeft = REACTOR[r].frames;
          }
          break;
        }
        case 'Slow':
          c.slow = true;
          break;
        case 'Reset':
          clear(c);
          shot(c, RESET, FIXED[RESET], s.frames);
          break;
        case 'NoEngine':
          c.noEngine = true;
          break;
        case 'NoBrake':
          c.noBrake = true;
          break;
        case 'NoSteer':
          c.noSteer = true;
          break;
        case 'Cruise':
          c.cruise = true;
          break;
        case 'Fragile':
          c.fragile = true;
          break;
        case 'Bumper':
        case 'Bumper2':
          shot(c, BUMP, LABEL[q.type], s.frames);
          break;
        default:
          if (q.type in GATES && GATES[q.type] != c.vehicle) {
            // A new car has new tyres (as in the runtime; an older one only thawed them).
            c.vehicle = GATES[q.type];
            if (c.tyre) clean(c);
            else c.ice.fill(0);
            shot(c, CAR, LABEL[c.vehicle], s.frames);
          }
      }
    }
    tyres(c, s, water);
    if (c.boostLeft > 0) c.boostLeft--;
    if (c.reactorLeft > 0) c.reactorLeft--;
    // The reactor only pushes while the gas is held (the runtime's c.gas, from the controls the car got).
    c.thrust = c.reactorLeft > 0 && !!s.controls?.up && !s.controls?.down;
    c.x = p.x;
    c.y = p.y;
    c.z = p.z;
    c.has = true;
  }

  // Which surface each wheel is on, and its tyre's state. With the runtime's TYRES: its own step, per wheel, with what
  // fxStep gives it (the surface, in water or not, the heat from the tyre's skidInfo), per physics frame (1 ms).
  // Without: the older runtime's wet tyres (one wetness for the car: soaks while the car's underside is in water, dries
  // on the ground but not on ice) and iced tyres (per wheel: ices on the surfaces its car ices on, thaws on other ground).
  function tyres(c, s, water) {
    if (!c.cells && typeof TM.surfaceIndex == 'function') c.cells = TM.surfaceIndex(c.track);
    if (c.tyre) {
      const level = water ? water.surface ?? water.max[1] : 0,
        under = water != null && s.position.y - (WET.under ?? 0.45) < level,
        skid = s.wheelSkidInfo;
      for (let w = 0; w < 4; w++) {
        const k = s.wheelContact[w],
          heat = TYRES.heatOf(skid ? skid[w] : 1);
        if (!k) {
          c.wheel[w] = AIR;
          c.inWater[w] = under ? 1 : 0;
          TYRES.step(c.tyre[w], AIR, under, heat, c.vehicle, 0.001);
          continue;
        }
        const p = k.position,
          n = k.normal,
          u = c.cells ? TM.surfaceAt(c.cells, p.x - n.x * 0.1, p.y - n.y * 0.1, p.z - n.z * 0.1) : null;
        c.wheel[w] = u ?? -1;
        c.inWater[w] = water != null && p.y < level ? 1 : 0;
        TYRES.step(c.tyre[w], u, c.inWater[w] == 1, heat, c.vehicle, 0.001);
      }
      c.brake = !!s.controls?.down;
      return;
    }
    const V = VEHICLES[c.vehicle],
      ices = V?.ices ?? ICING.surfaces,
      level = water ? water.surface ?? water.max[1] : 0,
      under = water != null && s.position.y - (WET.under ?? 0.45) < level;
    let contacts = 0,
      iceWheels = 0;
    for (let w = 0; w < 4; w++) {
      const k = s.wheelContact[w];
      if (!k) {
        c.wheel[w] = AIR;
        c.inWater[w] = under ? 1 : 0;
        continue;
      }
      contacts++;
      const p = k.position,
        n = k.normal,
        u = c.cells ? TM.surfaceAt(c.cells, p.x - n.x * 0.1, p.y - n.y * 0.1, p.z - n.z * 0.1) : null,
        icy = u != null && ICING.surfaces.includes(u);
      c.wheel[w] = u ?? -1;
      c.inWater[w] = water != null && p.y < level ? 1 : 0;
      if (u != null && SURFACES[u]?.ice) iceWheels++;
      if (icy && ices.includes(u)) c.ice[w] = Math.min(1, c.ice[w] + ICING.on * 0.001);
      else if (!icy && c.ice[w] > 0) c.ice[w] = Math.max(0, c.ice[w] - ICING.off * 0.001);
    }
    if (under) c.wet = Math.min(1, c.wet + WET.soak * 0.001);
    else if (c.wet > 0 && contacts > 0 && iceWheels == 0) c.wet = Math.max(0, c.wet - WET.dry * 0.001);
    c.brake = !!s.controls?.down;
  }

  // A wheel's grip as the runtime sets it (tm_runtime.js fxStep), as a share of the Stadium car's on dry stock road:
  // the surface (front or rear tyres), wood's braking grip, the vehicle's multiplier, then wet and iced tyres. Left out:
  // the cap on extra grip under heavy load (the page has no suspension forces), plastic countersteer and bugslides.
  function gripOf(c, w) {
    if (c.tyre) return TYRES.grip(c.wheel[w], c.tyre[w], c.vehicle, c.brake, w >= 2);
    const u = c.wheel[w],
      S = u >= 0 ? SURFACES[u] : null,
      V = VEHICLES[c.vehicle];
    let grip = S ? (w < 2 ? S.gripFront : S.gripRear) : 1; // wheels 0 and 1 are the front ones
    if (S && S.brakeGrip && c.brake) grip = Math.min(grip, S.brakeGrip);
    if (V) grip *= (w >= 2 && V.rearGrip ? V.rearGrip : V.grip)[u < 0 || u == 8 ? 0 : u + 1];
    if (c.wet > 0) grip *= 1 - (WET.wetGrip?.[u < 0 ? 'road' : u] ?? 0) * c.wet;
    if (c.ice[w] > 0 && !(u >= 0 && ICING.surfaces.includes(u))) grip *= 1 - ICING.grip * c.ice[w];
    return grip;
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------
  // In PolyTrack's own HUD style: its timer's boxes (surface colour with slanted ends round a darker inner box) for the
  // banner, its speedometer's box for the wheels, ForcedSquare italic from the page. The wheels are laid out like
  // Openplanet's Wheels display for Trackmania (a row per tyre, the wheel turning with the steering), on a canvas.
  const CSS = `
.be-hud-fx { position: absolute; left: 50%; top: 230px; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; width: max-content; max-width: calc(100% - 380px); transform: translateX(-50%); pointer-events: none; }
.be-hud-chip { display: none; margin: 0; padding: 0 10px 8px; background-color: var(--surface-color); opacity: 0.9; clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 8px 100%); }
.be-hud-chip.on { display: block; animation: be-hud-in 0.15s ease-out; }
.be-hud-chip > p { position: relative; margin: 0; padding: 7px 16px 8px; background-color: var(--surface-tertiary-color); color: var(--text-color); font-size: 26px; white-space: nowrap; clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 100%, 6px 100%); }
.be-hud-chip > p > i { position: absolute; left: 10px; right: 10px; bottom: 2px; height: 3px; background-color: var(--be-hud-c); transform-origin: 0 50%; }
.be-hud-chip.good { --be-hud-c: #5f5; }
.be-hud-chip.bad { --be-hud-c: #f55; }
.be-hud-chip.info { --be-hud-c: var(--text-color); }
.be-hud-chip.idle > p > i { opacity: 0.35; }
@keyframes be-hud-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 0.9; transform: none; } }
.be-hud-wheels { position: absolute; right: var(--safe-area-horizontal); bottom: 100px; display: none; pointer-events: none; }
.be-hud-wheels.on { display: block; }
`;
  // Every string the HUD writes, made once, so drawing a frame allocates nothing.
  const pct = (prefix) => Array.from({ length: 101 }, (_, i) => prefix + i + '%');
  const GRIP_TEXT = Array.from({ length: 401 }, (_, i) => i + '%'),
    PCT = pct(''),
    BARS = 40, // steps of a chip's time bar
    BAR = Array.from({ length: BARS + 1 }, (_, i) => 'scaleX(' + i / BARS + ')');
  // Wheel surface names by code + 2 (AIR, stock road, then part.u 0-8), and one for a wheel under water.
  const NAMES = ['Air', 'Road', 'Plastic', 'Wood', 'Penalty grass', 'Ice', 'Bobsleigh', 'Dirt', 'Grass', 'Snow', 'Road'],
    WATER_NAME = 'Water';

  // The panel at 100%: 230 x 370 like Openplanet's, in PolyTrack's speedometer box (8 px slant, 8 x 10 padding), a
  // darker box per tyre (6 px slant) 4 apart, front left, front right, rear left, rear right, the left tyres' wheels on the
  // left and the right ones' on the right.
  const PT = {
    w: 230,
    h: 370,
    padX: 10,
    padY: 8,
    rowGap: 4,
    slant: 8,
    rowSlant: 6,
    inset: 8,
    wheelW: 26,
    textGap: 10,
    name: 20,
    small: 16,
    motionScale: 5,
    font: 'ForcedSquare, Arial, sans-serif',
    tyre: [11, 17, 43], // darker than the tyre's box
    slip: '#ffd24d',
    ice: [223, 244, 255],
    dirt: [217, 160, 102],
    wet: [136, 204, 255],
  };
  // The page's own colours (PolyTrack's :root variables), read when the panel is made.
  const THEME = { surface: '#28346a', tertiary: '#192042', text: '#fff' };
  const HEX = (c) => 'rgb(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')';

  let fx = null,
    panel = null,
    pen = null;
  const chips = [];
  let wheelsOn = false,
    wheelsSize = 0.625, // the Wheel info size setting: a share of the 230 x 370 panel
    shown = null, // the car on screen
    focusCar = null,
    focusAt = 0,
    lastDraw = 0,
    nextLayout = 0;

  function el(tag, className, parent) {
    const e = document.createElement(tag);
    e.className = className;
    parent?.appendChild(e);
    return e;
  }
  function build() {
    if (!document.getElementById('be-hud-style')) {
      const st = document.createElement('style');
      st.id = 'be-hud-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    fx = el('div', 'be-hud-fx');
    for (let k = 0; k < KIND.length; k++) {
      const chip = el('div', 'be-hud-chip ' + KIND[k], fx),
        p = el('p', '', chip),
        text = document.createTextNode('');
      p.appendChild(text);
      chips.push({ el: chip, text, bar: el('i', '', p), label: null, step: -1, idle: false });
    }
    panel = el('canvas', 'be-hud-wheels');
    pen = panel.getContext('2d');
    try {
      const st = getComputedStyle(document.documentElement);
      for (const [k, v] of [['surface', '--surface-color'], ['tertiary', '--surface-tertiary-color'], ['text', '--text-color']]) THEME[k] = st.getPropertyValue(v).trim() || THEME[k];
    } catch (e) {}
  }
  // The race's HUD element, so the banner hides with the rest of the HUD; #ui when there is none.
  function attach() {
    if (!fx) build();
    const all = document.querySelectorAll('.game-ui'),
      parent = all[all.length - 1] ?? document.getElementById('ui');
    if (!parent) return false;
    parent.append(fx, panel);
    nextLayout = 0;
    return true;
  }

  function setChip(k, label, part) {
    const ch = chips[k];
    if (label !== ch.label) {
      ch.label = label;
      if (label) {
        ch.text.data = label;
        ch.el.classList.add('on');
      } else ch.el.classList.remove('on');
      nextLayout = 0; // the banner's width changed
    }
    if (!label) return;
    const st = part < 0 ? BARS : Math.max(0, Math.min(BARS, Math.ceil(part * BARS)));
    if (st != ch.step) {
      ch.step = st;
      ch.bar.style.transform = BAR[st];
    }
  }
  function banner(c) {
    const on = c && !c.done;
    setChip(BOOST, on && c.boostLeft > 0 ? LABEL[c.boost] : null, on && c.boost ? c.boostLeft / TURBO[c.boost].frames : 0);
    setChip(REACT, on && c.reactorLeft > 0 ? LABEL[c.reactor] : null, on && c.reactor ? c.reactorLeft / REACTOR[c.reactor].frames : 0);
    // Off the gas the reactor's bar dims: the boost is still on, but not pushing.
    const idle = !!(on && c.reactorLeft > 0 && !c.thrust);
    if (idle != chips[REACT].idle) chips[REACT].el.classList.toggle('idle', (chips[REACT].idle = idle));
    setChip(SLOW, on && c.slow ? FIXED[SLOW] : null, -1);
    setChip(CRUISE, on && c.cruise ? FIXED[CRUISE] : null, -1);
    setChip(NO_ENGINE, on && c.noEngine ? FIXED[NO_ENGINE] : null, -1);
    setChip(NO_BRAKE, on && c.noBrake ? FIXED[NO_BRAKE] : null, -1);
    setChip(NO_STEER, on && c.noSteer ? FIXED[NO_STEER] : null, -1);
    setChip(FRAGILE, on && c.fragile ? FIXED[FRAGILE] : null, -1);
    for (let i = 0; i < 3; i++) {
      const left = on ? c.shotUntil[i] - c.f : 0;
      setChip(CAR + i, left > 0 ? c.shotLabel[i] : null, left / ONE_SHOT);
    }
  }
  // Each wheel's steering, spin and slip, from the car states (state below). Openplanet turns the wheel by its steer angle
  // and scrolls the bars by its rotation; the page has the front wheels' steering and each wheel's spin per frame.
  function motion(c, s, now) {
    const m = c.motion || (c.motion = { steer: 0, rot: new Float64Array(4), spin: new Float32Array(4), skid: new Float32Array(4), at: now });
    const dt = Math.min(0.1, Math.max(0, (now - m.at) / 1000));
    m.at = now;
    m.steer = s.steering || 0;
    for (let w = 0; w < 4; w++) {
      if (s.wheelContact[w]) m.spin[w] = 1000 * (s.wheelDeltaRotation?.[w] || 0); // radians a second, as VisualCar
      m.rot[w] += m.spin[w] * dt;
      m.skid[w] = s.wheelContact[w] ? s.wheelSkidInfo?.[w] ?? 1 : 1;
    }
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // A box with its left side slanted, as PolyTrack's speedometer (the top left corner cut in by slant).
  function slanted(x, y, w, h, slant) {
    pen.beginPath();
    pen.moveTo(x + slant, y);
    pen.lineTo(x + w, y);
    pen.lineTo(x + w, y + h);
    pen.lineTo(x, y + h);
    pen.closePath();
  }
  // The wheel turned by its steer angle, a dark tyre tinted by icing, mud and wetness, its tread scrolling as it spins.
  function wheelVisual(x, y, w, h, steer, rot, ice, dirt, wet) {
    pen.save();
    pen.translate(x + w / 2, y + h / 2);
    pen.rotate(-steer);
    pen.translate(-(x + w / 2), -(y + h / 2));
    let fill = PT.tyre;
    if (ice > 0) fill = mix(fill, PT.ice, ice * 0.8);
    if (dirt > 0) fill = mix(fill, PT.dirt, dirt * 0.8);
    if (wet > 0) fill = mix(fill, PT.wet, wet * 0.8);
    pen.fillStyle = HEX(fill.map(Math.round));
    pen.fillRect(x, y, w, h);
    pen.save();
    pen.beginPath();
    pen.rect(x, y, w, h);
    pen.clip();
    pen.globalAlpha = 0.16;
    pen.fillStyle = THEME.text;
    const step = 12,
      n = Math.floor(h / step) + 1,
      shift = (rot * PT.motionScale) % step;
    for (let i = -1; i < n; i++) pen.fillRect(x, y + Math.round(i * step + shift), w, 5);
    pen.restore();
    pen.restore();
  }
  // Words in a line from the tyre's outer side inwards: [colour, text, opacity] each, 8 apart.
  function words(x, y, right, list) {
    let at = x;
    pen.textAlign = right ? 'right' : 'left';
    for (const [color, text, alpha] of right ? list.slice().reverse() : list) {
      pen.globalAlpha = alpha ?? 1;
      pen.fillStyle = color;
      pen.fillText(text, at, y);
      const w = pen.measureText(text).width + 8;
      at += right ? -w : w;
    }
    pen.globalAlpha = 1;
  }
  function wheels(car, c) {
    const k = wheelsSize,
      dpr = Math.min(3, window.devicePixelRatio || 1) * k,
      cssW = Math.round(PT.w * k),
      cssH = Math.round(PT.h * k),
      cw = Math.round(PT.w * dpr),
      ch = Math.round(PT.h * dpr);
    if (panel.width != cw || panel.height != ch) {
      panel.width = cw;
      panel.height = ch;
      panel.style.width = cssW + 'px';
      panel.style.height = cssH + 'px';
      nextLayout = 0;
    }
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, PT.w, PT.h);
    pen.globalAlpha = 0.9; // the speedometer's opacity
    slanted(0, 0, PT.w, PT.h, PT.slant);
    pen.fillStyle = THEME.surface;
    pen.fill();
    pen.globalAlpha = 1;
    pen.textBaseline = 'top';
    const m = c.motion,
      dirtOf = c.tyre ? null : TM.vehicles?.tyres?.(car),
      rowW = PT.w - PT.padX * 2,
      rowH = (PT.h - PT.padY * 2 - PT.rowGap * 3) / 4,
      wheelH = rowH - PT.inset * 2;
    for (let w = 0; w < 4; w++) {
      const right = w % 2 == 1,
        x0 = PT.padX,
        y = PT.padY + w * (rowH + PT.rowGap),
        t = c.tyre?.[w],
        ice = t ? t.ice : c.ice[w],
        dirt = t ? t.mud : dirtOf ? dirtOf[w]?.mud ?? dirtOf[w]?.dirt ?? 0 : 0,
        wet = t ? t.wet : c.wet,
        steer = m && w < 2 ? m.steer : 0;
      slanted(x0, y, rowW, rowH, PT.rowSlant);
      pen.fillStyle = THEME.tertiary;
      pen.fill();
      const wx = right ? x0 + rowW - PT.inset - PT.wheelW : x0 + PT.rowSlant + PT.inset;
      wheelVisual(wx, y + PT.inset, PT.wheelW, wheelH, steer, m ? m.rot[w] : 0, ice, dirt, wet);
      // The surface and grip, then a slipping tyre, then how icy, muddy and wet it is.
      const u = c.wheel[w],
        tx = right ? wx - PT.textGap : wx + PT.wheelW + PT.textGap,
        name = c.inWater[w] ? WATER_NAME : NAMES[u + 2];
      let ly = y + PT.inset;
      pen.font = PT.name + 'px ' + PT.font;
      words(tx, ly, right, u == AIR ? [[THEME.text, name]] : [[THEME.text, name], [THEME.text, GRIP_TEXT[Math.min(400, Math.max(0, Math.round(gripOf(c, w) * 100)))], 0.5]]);
      ly += PT.name + 6;
      pen.font = PT.small + 'px ' + PT.font;
      if (m && u != AIR && m.skid[w] < 0.9) {
        words(tx, ly, right, [[PT.slip, 'Slip']]);
        ly += PT.small + 4;
      }
      const states = [];
      if (ice > 0.005) states.push([HEX(PT.ice), 'Icy ' + PCT[level(ice)]]);
      if (dirt > 0.005) states.push([HEX(PT.dirt), (t ? 'Muddy ' : 'Dirty ') + PCT[level(dirt)]]);
      if (wet > 0.005) states.push([HEX(PT.wet), 'Wet ' + PCT[level(wet)]]);
      if (states.length) words(tx, ly, right, states);
    }
  }
  function level(v) {
    return Math.max(0, Math.min(100, Math.round(v * 100)));
  }

  // ---- where it goes ------------------------------------------------------------------------------------------------
  // Below everything else at the top middle, above everything at the bottom right (the speedometer, a timer at the bottom
  // that reaches that far). Measured twice a second, in #ui's own (unscaled) pixels. At the top: the game's reset hint
  // ("Press R to return to the last checkpoint", shown while the car is slow, as a No engine plate leaves it) is 150 px
  // down with a 32 px line and a 24 px one 16 px under it, so the banner starts at 230; a timer set to the top and NSWS's
  // checkpoint splits push it further down. The splits are only drawn for a few seconds after a checkpoint, so their box
  // is the one their style gives them: 130 px from the top, three rows of 33 + 4 + 33 + 31 px.
  const TOP = 230,
    GAP = 8,
    SPLITS = 101;
  function layout(parent) {
    const ui = document.getElementById('ui');
    if (!ui) return;
    const R = ui.getBoundingClientRect(),
      k = R.width > 0 ? ui.offsetWidth / R.width : 1,
      Wd = ui.offsetWidth,
      Ht = ui.offsetHeight,
      box = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 ? { l: (r.left - R.left) * k, r: (r.right - R.left) * k, t: (r.top - R.top) * k, b: (r.bottom - R.top) * k } : null;
      };
    // Top middle: the banner's widest reach.
    const half = Math.min(fx.offsetWidth || 0, Wd - 380) / 2 + 20,
      fl = Wd / 2 - half,
      fr = Wd / 2 + half;
    let top = TOP;
    for (const e of parent.querySelectorAll('.timer-ui.up > div, .speedometer-ui.up, .nsws-tags .plate')) {
      const b = box(e);
      if (b && b.r > fl && b.l < fr && b.t < Ht / 2) top = Math.max(top, b.b + GAP);
    }
    const sp = parent.querySelector('.nsws-splits');
    if (sp) {
      const b = box(sp),
        t = parseFloat(getComputedStyle(sp).top) || TOP;
      top = Math.max(top, (b ? Math.max(b.b, t + SPLITS) : t + SPLITS) + GAP);
    }
    fx.style.top = Math.round(top) + 'px';
    // Bottom right: the panel's reach.
    const pl = Wd - (panel.offsetWidth || 270);
    let bottom = 0;
    for (const e of parent.querySelectorAll('.speedometer-ui:not(.up):not(.hidden), .timer-ui:not(.up):not(.hidden) > div')) {
      const b = box(e);
      if (b && b.r > pl && b.t > Ht / 2) bottom = Math.max(bottom, Ht - b.t + 4);
    }
    panel.style.bottom = Math.round(bottom) + 'px';
  }

  function hide() {
    if (!fx) return;
    banner(null);
    panel.classList.remove('on');
    shown = null;
  }
  function draw(car, c) {
    if ((!fx || !fx.isConnected) && !attach()) return;
    const now = performance.now();
    if (car !== shown) {
      shown = car;
      nextLayout = 0;
    }
    // NSWS's photo mode takes the HUD away.
    const off = !!self.__PolyFX?.photo?.active;
    banner(off ? null : c);
    const panelOn = wheelsOn && !off && c.has && !c.done; // from the car's first frame: nothing is known before
    if (panelOn != panel.classList.contains('on')) {
      panel.classList.toggle('on', panelOn);
      nextLayout = 0;
    }
    // Every frame, as Openplanet draws it (the bars scroll).
    if (panelOn && now - lastDraw > 4) {
      lastDraw = now;
      wheels(car, c);
    }
    if (now >= nextLayout) {
      nextLayout = now + 500;
      layout(fx.parentElement);
    }
  }

  // The car the speedometer shows: the game says so every frame (focus); NSWS's own pages have __getPlayerState.
  function focused() {
    if (focusCar && performance.now() - focusAt < 1000) return focusCar;
    try {
      return self.__getPlayerState?.() ?? null;
    } catch (e) {
      return null;
    }
  }

  // ---- hooks --------------------------------------------------------------------------------------------------------
  function track(car, trackData) {
    try {
      cars.set(car, fresh(trackData));
    } catch (e) {
      console.warn('HUD off:', e);
    }
  }
  function update(car) {
    const c = cars.get(car);
    if (!c || car !== focused()) return;
    c.watch = true;
    draw(car, c);
  }
  function dispose(car) {
    if (car === shown) hide();
    if (car === focusCar) focusCar = null;
    cars.delete(car);
  }

  if (W) {
    const { track: t0, update: u0, dispose: d0 } = W;
    W.track = function (car, trackData) {
      t0.call(this, car, trackData);
      track(car, trackData);
    };
    W.update = function (car, sw, dt, state, three) {
      u0.call(this, car, sw, dt, state, three);
      try {
        update(car);
      } catch (e) {
        cars.delete(car);
        hide();
        console.warn('HUD off:', e);
      }
    };
    W.dispose = function (car) {
      d0.call(this, car);
      dispose(car);
    };
  }

  return {
    // Every car state the page gets (VisualCar.setCarState), before the car draws it.
    state(car, s) {
      const c = cars.get(car);
      if (c && c.watch && s)
        try {
          step(c, s);
          if (wheelsOn) motion(c, s, performance.now());
        } catch (e) {
          cars.delete(car);
          console.warn('HUD off:', e);
        }
      // then a hovering car's wheels go quiet (tm_vehicles.js quiet: no skid smoke or marks)
      try {
        TM.vehicles?.quiet?.(car, s);
      } catch (e) {}
    },
    // The car the HUD is for, each frame, from where the game updates its speedometer.
    focus(car) {
      focusCar = car;
      focusAt = performance.now();
    },
    // The Wheel info setting.
    setWheels(on) {
      wheelsOn = !!on;
      if (!wheelsOn && panel) panel.classList.remove('on');
    },
    // The Wheel info size setting (1 = Openplanet's own size).
    setWheelsSize(k) {
      wheelsSize = k > 0 ? Math.min(3, Math.max(0.1, k)) : 0.5;
    },
    get wheels() {
      return wheelsOn;
    },
    // What the HUD has for a car: its effects, vehicle and tyres (frames: the race frame it is at). The game reads it
    // every frame (noEngine), so the tyre lists are only made when a test reads them.
    of(car) {
      const c = cars.get(car);
      if (!c) return null;
      return {
        frames: c.f,
        vehicle: c.vehicle,
        boost: c.boostLeft > 0 ? c.boost : null,
        reactor: c.reactorLeft > 0 ? c.reactor : null,
        reactorLeft: c.reactorLeft, // physics frames left, as the runtime's (tm_vehicles.js times the wheel jets by it)
        reactorThrust: c.thrust,
        slow: c.slow,
        noEngine: c.noEngine,
        noBrake: c.noBrake,
        noSteer: c.noSteer,
        cruise: c.cruise,
        fragile: c.fragile,
        get wet() {
          return c.tyre ? c.tyre.map((t) => t.wet) : c.wet;
        },
        get ice() {
          return c.tyre ? c.tyre.map((t) => t.ice) : [...c.ice];
        },
        get mud() {
          return c.tyre ? c.tyre.map((t) => t.mud) : null;
        },
        get wheels() {
          return [...c.wheel];
        },
        get grip() {
          return [0, 1, 2, 3].map((w) => (c.wheel[w] == AIR ? null : gripOf(c, w)));
        },
      };
    },
  };
})();
