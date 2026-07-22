import {
  CAT_CHARACTER,
  CAT_INTACT,
  CAT_PARTICLE,
  CAT_WALL,
  CHAR_SIZE,
  H,
  LASER_COOLDOWN_MS,
  LASER_FLASH_MS,
  LASER_RANGE,
  PHYS_H,
  PHYS_W,
  SOLVER_BUSY_DYNAMIC_COUNT,
  VIEW_CULL_MARGIN_PX,
  Vec2,
  W,
  contentW,
  m2px,
  originX,
  pl,
  px2m,
  terrainTop,
} from "./config.js";
import { Camera } from "./Camera.js";
import { Character } from "./Character.js";
import { FrameFps, MsMeter } from "./FpsMeter.js";
import { Renderer } from "./Renderer.js";
import { Terrain } from "./Terrain.js";

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
      particleTexture: this.renderer.particleTexture,
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
  }

  spawnCharacter() {
    if (this.character) {
      this.character.destroy();
      this.character = null;
    }
    const x = originX + contentW / 2;
    const y = terrainTop - CHAR_SIZE * 3;
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
    this.terrain.syncGfx(this.camera.viewBounds(VIEW_CULL_MARGIN_PX));
    this.renderer.drawLasers(this.lasers, vs);
    if (this.character) this.character.syncGfx(view);
    this.renderer.render();

    this.statIntact.textContent = this.terrain.intact.size;
    this.statFree.textContent = this.terrain.freeParticles.length;
    this.statBodies.textContent = this.terrain.dynamicCount();
    this.statWorldMs.textContent = this.worldMs.ms.toFixed(2);
    this.statRenderMs.textContent = this.renderMs.ms.toFixed(2);
    this.statFps.textContent = this.frameFps.fps.toFixed(0);
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
    const dyn = this.terrain.dynamicCount();
    if (dyn < SOLVER_BUSY_DYNAMIC_COUNT) {
      this.world.step(1 / 60, 5, 2);
    } else {
      this.world.step(1 / 60, 4, 1);
    }
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
