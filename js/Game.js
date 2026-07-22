import {
  CAT_CHARACTER,
  CAT_INTACT,
  CAT_PARTICLE,
  CAT_WALL,
  H,
  LASER_COOLDOWN_MS,
  LASER_FLASH_MS,
  LASER_RANGE,
  PHYS_H,
  PHYS_W,
  SOLVER_BUSY_DYNAMIC_COUNT,
  SPAWN_LAYOUT,
  PHYS_ACTIVE_MARGIN_PX,
  VIEW_CULL_MARGIN_PX,
  Vec2,
  W,
  contentW,
  m2px,
  originX,
  particleTunables,
  pl,
  px2m,
  terrainTop,
} from "./config.js";
import { Camera } from "./Camera.js";
import { Character } from "./Character.js";
import { FrameFps, MsMeter } from "./FpsMeter.js";
import { Renderer } from "./Renderer.js";
import { Terrain } from "./Terrain.js";
import { mushTextureDataURL } from "./rockMush.js";

const WALL_MASK = CAT_WALL | CAT_INTACT | CAT_PARTICLE | CAT_CHARACTER;

export class Game {
  constructor() {
    window.game = this;
    this.renderer = null;
    this.canvas = null;
    this.world = null;
    this.camera = null;
    this.terrain = null;
    this.character = null;

    this.lasers = [];
    this.keys = Object.create(null);
    this.mouseSX = W / 2;
    this.mouseSY = H / 2;

    this.pointers = new Map();
    this.pinch = null;
    this.firing = false;
    this.lastFireAt = 0;

    this.worldMs = new MsMeter();
    this.renderMs = new MsMeter();
    this.frameFps = new FrameFps();

    this.statIntact = document.getElementById("stat-intact");
    this.statFree = document.getElementById("stat-free");
    this.statBodies = document.getElementById("stat-bodies");
    this.statWorldMs = document.getElementById("stat-world-ms");
    this.statRenderMs = document.getElementById("stat-render-ms");
    this.statFps = document.getElementById("stat-fps");
    this.statJoints = document.getElementById("stat-joints");
    this.debugPhys = false;
    this.debugOnly = false;
    this.debugCheckbox = document.getElementById("debug-phys");
    this.debugOnlyCheckbox = document.getElementById("debug-only");
    this.debugLegend = document.getElementById("debug-legend");
    this._hudIntact = -1;
    this._hudFree = -1;
    this._hudDyn = -1;
    this._hudWorld = "";
    this._hudRender = "";
    this._hudFps = "";
  }

  async init() {
    this.renderer = new Renderer();
    await this.renderer.init();
    this.canvas = this.renderer.canvas;

    this.world = new pl.World(Vec2(0, 22));
    this.addWall(PHYS_W / 2, PHYS_H + 10, PHYS_W + 40, 20);
    this.addWall(-10, PHYS_H / 2, 20, PHYS_H + 40);
    this.addWall(PHYS_W + 10, PHYS_H / 2, 20, PHYS_H + 40);

    this.camera = new Camera(originX + contentW / 2, terrainTop - 40);
    this.terrain = new Terrain(this.world, {
      boxes: this.renderer.boxes,
      particles: this.renderer.particles,
      particleBuckets: this.renderer.particleBuckets,
      particleTextures: this.renderer.particleTextures,
      rockTexturesByOrder: this.renderer.rockTexturesByOrder,
      rockMushRecipes: this.renderer.rockMushRecipes,
    });

    this.bindContacts();
    this.bindInput();
  }

  addWall(x, y, w, h) {
    const b = this.world.createBody({
      type: "static",
      position: Vec2(px2m(x), px2m(y)),
    });
    b.setUserData({ kind: "wall" });
    b.createFixture(pl.Box(px2m(w / 2), px2m(h / 2)), {
      friction: 0.6,
      filterCategoryBits: CAT_WALL,
      filterMaskBits: WALL_MASK,
    });
  }

  kindOf(body) {
    const d = body && body.getUserData();
    return d && d.kind;
  }

  contactPair(contact) {
    const a = contact.getFixtureA().getBody();
    const b = contact.getFixtureB().getBody();
    return [a, b, this.kindOf(a), this.kindOf(b)];
  }

  bindContacts() {
    this.world.on("begin-contact", (contact) => {
      const [, , ka, kb] = this.contactPair(contact);
      if (ka === "character" || kb === "character") {
        const other = ka === "character" ? kb : ka;
        if (other === "wall" || other === "intact" || other === "particle") {
          if (this.character) this.character.addGroundContact();
        }
      }
    });
    this.world.on("end-contact", (contact) => {
      const [, , ka, kb] = this.contactPair(contact);
      if (ka === "character" || kb === "character") {
        const other = ka === "character" ? kb : ka;
        if (other === "wall" || other === "intact" || other === "particle") {
          if (this.character) this.character.removeGroundContact();
        }
      }
    });
  }

  distOf(pts) {
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  bindInput() {
    const canvas = this.canvas;

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.mouseSX = e.clientX;
      this.mouseSY = e.clientY;

      if (this.pointers.size === 1) {
        this.firing = true;
        this.pinch = null;
      } else if (this.pointers.size === 2) {
        this.firing = false;
        const pts = [...this.pointers.values()];
        this.pinch = { dist: this.distOf(pts), zoom0: this.camera.zoom };
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      this.mouseSX = e.clientX;
      this.mouseSY = e.clientY;
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2 && this.pinch) {
        const pts = [...this.pointers.values()];
        const d = this.distOf(pts);
        this.camera.setZoomAbsolute(this.pinch.zoom0 * (d / this.pinch.dist));
      }
    });

    window.addEventListener("pointermove", (e) => {
      this.mouseSX = e.clientX;
      this.mouseSY = e.clientY;
    });

    const endPointer = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) this.firing = false;
      else if (this.pointers.size === 1) this.firing = true;
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.camera.setZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );

    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (e.code === "F3") {
        e.preventDefault();
        this.debugPhys = !this.debugPhys;
        if (this.debugCheckbox) this.debugCheckbox.checked = this.debugPhys;
        if (this.debugLegend) this.debugLegend.hidden = !this.debugPhys;
        if (!this.debugPhys) {
          this.renderer.clearDebug();
          if (this.statJoints) this.statJoints.textContent = "0";
          if (this.debugOnly) {
            this.debugOnly = false;
            if (this.debugOnlyCheckbox) this.debugOnlyCheckbox.checked = false;
            this.renderer.setSpritesVisible(true);
          }
        }
        return;
      }
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "Space",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.code)
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });

    document
      .getElementById("zoomin")
      .addEventListener("click", () => this.camera.setZoom(1.35));
    document
      .getElementById("zoomout")
      .addEventListener("click", () => this.camera.setZoom(1 / 1.35));
    document
      .getElementById("reset")
      .addEventListener("click", () => this.reset());

    if (this.debugCheckbox) {
      this.debugCheckbox.addEventListener("change", () => {
        this.debugPhys = this.debugCheckbox.checked;
        if (this.debugLegend) this.debugLegend.hidden = !this.debugPhys;
        if (!this.debugPhys) {
          this.renderer.clearDebug();
          if (this.statJoints) this.statJoints.textContent = "0";
          // Can't stay "debug only" with physics debug off.
          if (this.debugOnly) {
            this.debugOnly = false;
            if (this.debugOnlyCheckbox) this.debugOnlyCheckbox.checked = false;
            this.renderer.setSpritesVisible(true);
          }
        }
      });
    }

    if (this.debugOnlyCheckbox) {
      this.debugOnlyCheckbox.addEventListener("change", () => {
        this.debugOnly = this.debugOnlyCheckbox.checked;
        this.renderer.setSpritesVisible(!this.debugOnly);
        if (this.debugOnly) {
          this.debugPhys = true;
          if (this.debugCheckbox) this.debugCheckbox.checked = true;
          if (this.debugLegend) this.debugLegend.hidden = false;
        }
      });
    }

    this.bindParticleTunables();
    this.bindMushPreview();
  }

  bindMushPreview() {
    const check = document.getElementById("mush-preview");
    const panel = document.getElementById("mush-preview-panel");
    const orderSel = document.getElementById("mush-order");
    const gallery = document.getElementById("mush-gallery");
    if (!check || !panel || !orderSel || !gallery) return;

    const byOrder = this.renderer && this.renderer.rockTexturesByOrder;
    if (!byOrder) return;

    orderSel.replaceChildren();
    for (let o = 1; o < byOrder.length; o++) {
      const list = byOrder[o];
      if (!list || !list.length) continue;
      const opt = document.createElement("option");
      opt.value = String(o);
      const side = list[0].width | 0;
      opt.textContent = `order ${o} · ${list.length} var · ${side}px`;
      orderSel.appendChild(opt);
    }

    const renderGallery = () => {
      gallery.replaceChildren();
      const order = Number(orderSel.value) || 1;
      const variants = byOrder[order] || [];
      for (let i = 0; i < variants.length; i++) {
        const fig = document.createElement("figure");
        const img = document.createElement("img");
        img.src = mushTextureDataURL(variants[i]);
        img.alt = `order ${order} v${i}`;
        const cap = document.createElement("figcaption");
        cap.textContent = `v${i}`;
        fig.append(img, cap);
        gallery.appendChild(fig);
      }
    };

    check.addEventListener("change", () => {
      panel.hidden = !check.checked;
      if (check.checked) renderGallery();
    });
    orderSel.addEventListener("change", () => {
      if (check.checked) renderGallery();
    });
  }

  bindParticleTunables() {
    const collideEl = document.getElementById("particle-collide");
    const maxEl = document.getElementById("max-particles");
    const settleEl = document.getElementById("settle-frames");
    const ageEl = document.getElementById("particle-age");

    if (collideEl) {
      collideEl.checked = particleTunables.collide;
      collideEl.addEventListener("change", () => {
        particleTunables.collide = collideEl.checked;
        if (this.terrain) this.terrain.setParticleCollide(particleTunables.collide);
      });
    }

    const bindNum = (el, key, { min = 0, max = 1e9, onChange } = {}) => {
      if (!el) return;
      el.value = String(particleTunables[key]);
      const apply = () => {
        let n = Number(el.value);
        if (!Number.isFinite(n)) n = particleTunables[key];
        n = Math.max(min, Math.min(max, n | 0));
        el.value = String(n);
        particleTunables[key] = n;
        if (onChange) onChange(n);
      };
      el.addEventListener("change", apply);
    };

    bindNum(maxEl, "maxFree", {
      min: 1,
      max: 5000,
      onChange: () => {
        if (this.terrain) this.terrain.enforceParticleCap();
      },
    });
    bindNum(settleEl, "settleFrames", { min: 0, max: 600 });
    bindNum(ageEl, "maxAgeMs", { min: 0, max: 120000 });
  }

  spawnCharacter() {
    if (this.character) {
      this.character.destroy();
      this.character = null;
    }
    const x = originX + SPAWN_LAYOUT.x;
    const y = terrainTop + SPAWN_LAYOUT.y;
    this.character = new Character(this.world, x, y, this.renderer.actors);
  }

  fireLaser() {
    if (!this.character || !this.character.body) return;
    const ang = this.character.aimAngle(
      this.mouseSX,
      this.mouseSY,
      this.camera,
      this.camera.viewScale(),
    );
    // Start at body center (not pushed along aim). Planck ignores fixtures that
    // contain p1 — a gap toward the ground put p1 inside the box underfoot, so
    // that intact node was skipped entirely.
    const p1 = this.character.body.getPosition();
    const p2 = Vec2(
      p1.x + Math.cos(ang) * LASER_RANGE,
      p1.y + Math.sin(ang) * LASER_RANGE,
    );

    let closest = null;
    this.world.rayCast(p1, p2, (fixture, point, _normal, fraction) => {
      const kind = this.kindOf(fixture.getBody());
      if (kind === "character") return -1;
      if (kind !== "intact" && kind !== "particle" && kind !== "wall")
        return -1;
      closest = { body: fixture.getBody(), kind, point, fraction };
      return fraction;
    });

    const end = closest ? closest.point : p2;
    this.lasers.push({
      x0: m2px(p1.x),
      y0: m2px(p1.y),
      x1: m2px(end.x),
      y1: m2px(end.y),
      until: performance.now() + LASER_FLASH_MS,
    });

    if (!closest) return;
    if (closest.kind === "intact") {
      const data = closest.body.getUserData();
      if (data && data.gameObject) {
        this.terrain.breakNode(
          data.gameObject,
          m2px(closest.point.x),
          m2px(closest.point.y),
        );
      }
    } else if (closest.kind === "particle") {
      this.terrain.deleteParticle(closest.body);
    }
  }

  updateLasers(now) {
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      if (this.lasers[i].until < now) this.lasers.splice(i, 1);
    }
  }

  draw() {
    const vs = this.camera.viewScale();
    const view = {
      scale: vs,
      camera: this.camera,
      mouseSX: this.mouseSX,
      mouseSY: this.mouseSY,
    };

    this.renderer.applyCamera(this.camera);
    this.terrain.syncGfx(
      this.camera.viewBounds(VIEW_CULL_MARGIN_PX),
      this.camera.viewBounds(PHYS_ACTIVE_MARGIN_PX),
    );
    this.renderer.drawLasers(this.lasers, vs);
    if (this.character) this.character.syncGfx(view);
    if (this.debugPhys) {
      const n = this.renderer.drawDebug(this.world, vs);
      if (this.statJoints) this.statJoints.textContent = String(n);
    }
    this.renderer.render();

    // DOM writes are expensive — only when values change.
    const intactN = this.terrain.intact.size;
    const freeN = this.terrain.freeParticles.length;
    const dynN = this.terrain.dynamicCount();
    if (intactN !== this._hudIntact) {
      this._hudIntact = intactN;
      this.statIntact.textContent = intactN;
    }
    if (freeN !== this._hudFree) {
      this._hudFree = freeN;
      this.statFree.textContent = freeN;
    }
    if (dynN !== this._hudDyn) {
      this._hudDyn = dynN;
      this.statBodies.textContent = dynN;
    }
    const wMs = this.worldMs.ms.toFixed(2);
    const rMs = this.renderMs.ms.toFixed(2);
    const fps = this.frameFps.fps.toFixed(0);
    if (wMs !== this._hudWorld) {
      this._hudWorld = wMs;
      this.statWorldMs.textContent = wMs;
    }
    if (rMs !== this._hudRender) {
      this._hudRender = rMs;
      this.statRenderMs.textContent = rMs;
    }
    if (fps !== this._hudFps) {
      this._hudFps = fps;
      this.statFps.textContent = fps;
    }
  }

  reset() {
    this.terrain.reset();
    this.lasers.length = 0;
    this.renderer.clearLasers();
    this.camera.resetZoom();
    this.spawnCharacter();
    this.camera.follow(this.character);
  }

  loop = (t) => {
    this.frameFps.tick(t);

    this.worldMs.begin();
    if (this.character) this.character.update(this.keys);
    if (this.firing && t - this.lastFireAt >= LASER_COOLDOWN_MS) {
      this.fireLaser();
      this.lastFireAt = t;
    }
    // const dyn = this.terrain.dynamicCount();
    // if (dyn < SOLVER_BUSY_DYNAMIC_COUNT) {
    this.world.step(1 / 60, 5, 5);
    // } else {
    // this.world.step(1 / 60, 4, 1);
    // }
    this.terrain.cullParticles(t);
    this.terrain.coalesceQuiet(this.camera.viewBounds(VIEW_CULL_MARGIN_PX));
    this.updateLasers(t);
    this.camera.follow(this.character);
    this.worldMs.end();

    this.renderMs.begin();
    this.draw();
    this.renderMs.end();

    requestAnimationFrame(this.loop);
  };

  async start() {
    await this.init();
    this.terrain.initFromLayout();
    this.spawnCharacter();
    this.camera.follow(this.character);
    requestAnimationFrame(this.loop);
  }
}
