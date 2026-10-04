import Phaser from 'phaser';
import './style.css';

type AbilityState = { dash: boolean; doubleJump: boolean };
type SaveState = {
  abilities: AbilityState;
  shards: number;
  bossDefeated: boolean;
  petals?: string[];
  minibossDefeated?: boolean;
  visitedBiomes?: string[];
};

type ControlKeys = {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  jump: Phaser.Input.Keyboard.Key;
  dash: Phaser.Input.Keyboard.Key;
  attack: Phaser.Input.Keyboard.Key;
  restart: Phaser.Input.Keyboard.Key;
  map: Phaser.Input.Keyboard.Key;
  arrowLeft: Phaser.Input.Keyboard.Key;
  arrowRight: Phaser.Input.Keyboard.Key;
  arrowUp: Phaser.Input.Keyboard.Key;
};

const SAVE_KEY = 'lumenwild-save-v1';
const WORLD_W = 5400;
const WORLD_H = 1080;
const GROUND_Y = 930;

const palette = {
  ink: 0x081326,
  night: 0x0d2140,
  blue: 0x174a72,
  sky: 0x55c8d2,
  mint: 0x72e6b1,
  lime: 0xb9f27c,
  sun: 0xffd66b,
  peach: 0xff9f7c,
  pink: 0xff7eb6,
  violet: 0x9b7bff,
  white: 0xf7fbff,
  danger: 0xff5b6e,
};

class Soundscape {
  private ctx?: AudioContext;
  private master?: GainNode;
  private ambientTimer?: number;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.12;
      this.master.connect(this.ctx.destination);
      this.startAmbient();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.12, slide = 0): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  jump(): void { this.tone(430, 0.12, 'triangle', 0.08, 160); }
  dash(): void { this.tone(180, 0.16, 'sawtooth', 0.07, 420); }
  hit(): void { this.tone(110, 0.18, 'square', 0.08, -30); }
  attack(): void { this.tone(250, 0.09, 'triangle', 0.06, 120); }
  collect(): void {
    this.tone(600, 0.16, 'sine', 0.08, 180);
    window.setTimeout(() => this.tone(820, 0.18, 'sine', 0.06, 100), 70);
  }
  unlockAbility(): void {
    [392, 523, 659, 784].forEach((f, i) => window.setTimeout(() => this.tone(f, 0.35, 'triangle', 0.07, 70), i * 90));
  }
  victory(): void {
    [392, 494, 587, 784, 988].forEach((f, i) => window.setTimeout(() => this.tone(f, 0.45, 'sine', 0.08, 80), i * 130));
  }

  private startAmbient(): void {
    if (this.ambientTimer) return;
    const chime = () => {
      if (document.visibilityState === 'visible') {
        const base = [196, 220, 247, 294][Math.floor(Math.random() * 4)];
        this.tone(base, 1.6, 'sine', 0.018, base * 0.25);
      }
      this.ambientTimer = window.setTimeout(chime, 2200 + Math.random() * 2600);
    };
    this.ambientTimer = window.setTimeout(chime, 900);
  }
}

class LumenwildScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private breakables!: Phaser.Physics.Arcade.StaticGroup;
  private enemies!: Phaser.Physics.Arcade.Group;
  private hazards!: Phaser.Physics.Arcade.StaticGroup;
  private pickups!: Phaser.Physics.Arcade.Group;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private springPads!: Phaser.Physics.Arcade.StaticGroup;
  private npcs: Phaser.GameObjects.Image[] = [];
  private keys!: ControlKeys;
  private soundscape = new Soundscape();
  private abilities: AbilityState = { dash: false, doubleJump: false };
  private health = 5;
  private maxHealth = 5;
  private shards = 0;
  private memoryPetals = new Set<string>();
  private minibossDefeated = false;
  private visitedBiomes = new Set<string>();
  private extraJumps = 0;
  private facing = 1;
  private dashing = false;
  private dashReadyAt = 0;
  private attacking = false;
  private invulnerableUntil = 0;
  private checkpoint = new Phaser.Math.Vector2(220, 820);
  private bossDefeated = false;
  private started = false;
  private won = false;
  private lastGrounded = 0;
  private jumpQueuedAt = -9999;
  private heartText!: Phaser.GameObjects.Text;
  private shardText!: Phaser.GameObjects.Text;
  private abilityText!: Phaser.GameObjects.Text;
  private areaText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private titleCard!: Phaser.GameObjects.Container;
  private biome = '';
  private playerGlow!: Phaser.GameObjects.Arc;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private lastTrailAt = 0;
  private lastDustAt = 0;
  private wasGrounded = false;
  private vignette!: Phaser.GameObjects.Graphics;
  private biomeWash!: Phaser.GameObjects.Rectangle;
  private bossBarGroup!: Phaser.GameObjects.Container;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private miniBarGroup!: Phaser.GameObjects.Container;
  private miniBarFill!: Phaser.GameObjects.Rectangle;
  private bossIntroPlayed = false;
  private miniIntroPlayed = false;
  private mapOpen = false;
  private mapPadHeld = false;
  private mapOverlay!: Phaser.GameObjects.Container;
  private mapMarker!: Phaser.GameObjects.Arc;
  private mapStatusText!: Phaser.GameObjects.Text;
  private lastNpcSpoken = '';


  constructor() { super('lumenwild'); }

  create(): void {
    this.loadSave();
    this.createTextures();
    this.createContentTextures();
    this.createSpriteSheets();
    this.createAnimations();
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#081326');

    this.createBackdrop();
    this.createWorld();
    this.createForegroundDetails();
    this.createPlayer();
    this.createEnemies();
    this.createPickups();
    this.createExpandedContent();
    this.createHud();
    this.createMapOverlay();
    this.createScreenFx();
    this.setupControls();
    this.setupCollisions();

    this.cameras.main.startFollow(this.player, true, 0.075, 0.075, 0, 70);
    this.cameras.main.setDeadzone(220, 110);
    this.cameras.main.fadeIn(650, 7, 16, 35);

    this.physics.world.pause();
    this.showTitleCard();
    this.input.keyboard?.once('keydown', () => this.beginAdventure());
    this.input.once('pointerdown', () => this.beginAdventure());
    this.input.gamepad?.once('down', () => this.beginAdventure());
  }

  update(time: number): void {
    if (!this.started || this.won) return;

    const pad = this.padState();
    const keyboardMap = Phaser.Input.Keyboard.JustDown(this.keys.map);
    const padMap = pad.map && !this.mapPadHeld;
    this.mapPadHeld = pad.map;
    if (keyboardMap || padMap) {
      this.toggleMap();
      return;
    }
    if (this.mapOpen) {
      this.updateMapMarker();
      return;
    }

    this.updatePlayer(time);
    this.updateVisuals(time);
    this.updateEnemies(time);
    this.updateProjectiles(time);
    this.updateNpcs();
    this.updateBiome();
    this.updateObjective();
    this.checkBreakables();
    this.checkShrine();
  }

  private createTextures(): void {
    const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.textures.exists(key)) return;
      const g = this.add.graphics();
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };

    make('player', 58, 68, g => {
      // Cape / body silhouette.
      g.fillStyle(0x0b1d38, 0.95).fillTriangle(12, 58, 29, 25, 48, 59);
      g.fillStyle(0x15385b).fillRoundedRect(12, 23, 34, 34, 13);
      g.fillStyle(0x285b75, 0.9).fillRoundedRect(15, 27, 28, 25, 10);

      // Lumen head with soft outer rim.
      g.fillStyle(0x9ff6ca, 0.22).fillCircle(29, 21, 20);
      g.fillStyle(palette.mint).fillCircle(29, 21, 16);
      g.fillStyle(0xe8fff1).fillCircle(23, 19, 5).fillCircle(35, 19, 5);
      g.fillStyle(0x173653).fillCircle(24, 20, 2).fillCircle(36, 20, 2);
      g.fillStyle(0x5aa985, 0.7).fillRoundedRect(22, 28, 14, 3, 2);

      // Crown sprout and leaf.
      g.fillStyle(palette.sun).fillTriangle(25, 7, 29, 0, 33, 8);
      g.fillStyle(palette.lime).fillEllipse(37, 6, 13, 7);
      g.fillStyle(0x5ba85e).fillTriangle(31, 9, 43, 4, 35, 12);

      // Boots and scarf details.
      g.fillStyle(palette.peach).fillRoundedRect(14, 52, 11, 11, 4).fillRoundedRect(34, 52, 11, 11, 4);
      g.fillStyle(0xffd6bd).fillRoundedRect(17, 54, 7, 4, 2).fillRoundedRect(35, 54, 7, 4, 2);
      g.fillStyle(palette.sun, 0.9).fillTriangle(43, 30, 57, 35, 44, 39);
      g.fillStyle(0xffffff, 0.45).fillCircle(20, 14, 3);
    });

    make('platform', 96, 48, g => {
      g.fillStyle(0x102a3d).fillRoundedRect(0, 8, 96, 40, 12);
      g.fillStyle(0x173c4c).fillRoundedRect(0, 4, 96, 34, 11);
      g.fillStyle(0x2e6d62).fillRoundedRect(0, 1, 96, 19, 9);
      g.fillStyle(palette.lime).fillRoundedRect(2, 0, 92, 7, 4);
      g.fillStyle(0x9fe47a, 0.72).fillEllipse(17, 6, 20, 8).fillEllipse(63, 7, 28, 8);
      g.fillStyle(0x0d2736, 0.38).fillCircle(18, 29, 4).fillCircle(39, 36, 3).fillCircle(72, 27, 5);
      g.lineStyle(2, 0x4c8774, 0.4).lineBetween(13, 18, 29, 17).lineBetween(60, 21, 84, 20);
    });

    make('crystal', 64, 118, g => {
      g.fillStyle(0x383c86, 0.52).fillTriangle(2, 116, 18, 10, 34, 116);
      g.fillStyle(0x6557c8, 0.88).fillTriangle(18, 116, 38, 0, 60, 116);
      g.fillStyle(0xb29cff, 0.72).fillTriangle(36, 111, 49, 31, 61, 116);
      g.fillStyle(0xe6dcff, 0.36).fillTriangle(36, 8, 40, 79, 51, 30);
      g.lineStyle(3, 0xded6ff, 0.72).lineBetween(18, 17, 30, 101).lineBetween(39, 10, 49, 100);
    });

    make('slime', 54, 42, g => {
      g.fillStyle(0x092a3a, 0.55).fillEllipse(27, 36, 45, 10);
      g.fillStyle(0x17475b).fillRoundedRect(5, 16, 44, 22, 12);
      g.fillStyle(0x42a8a4).fillCircle(27, 18, 18);
      g.fillStyle(palette.sky).fillCircle(27, 15, 15);
      g.fillStyle(palette.white).fillCircle(20, 14, 4).fillCircle(34, 14, 4);
      g.fillStyle(palette.ink).fillCircle(21, 15, 2).fillCircle(35, 15, 2);
      g.fillStyle(palette.pink).fillCircle(12, 25, 3).fillCircle(42, 25, 3);
      g.fillStyle(0xd9ffff, 0.55).fillEllipse(21, 8, 9, 5);
      g.lineStyle(2, 0x235a6d, 0.8).arc(27, 23, 8, 0.18, Math.PI - 0.18, false);
    });

    make('boss', 132, 110, g => {
      g.fillStyle(0x140f35, 0.52).fillEllipse(66, 99, 112, 18);
      g.fillStyle(0x271e58).fillRoundedRect(10, 34, 112, 64, 28);
      g.fillStyle(0x5148a6).fillCircle(66, 43, 42);
      g.fillStyle(0x7667db).fillCircle(66, 40, 34);
      g.fillStyle(palette.pink).fillTriangle(22, 35, 37, 2, 46, 39).fillTriangle(86, 39, 99, 2, 112, 36);
      g.fillStyle(0xdcb7ff, 0.46).fillTriangle(33, 31, 38, 9, 43, 34).fillTriangle(94, 33, 99, 9, 104, 31);
      g.fillStyle(palette.white).fillCircle(50, 40, 9).fillCircle(82, 40, 9);
      g.fillStyle(palette.ink).fillCircle(53, 42, 4).fillCircle(85, 42, 4);
      g.fillStyle(0xffffff, 0.62).fillCircle(48, 37, 2).fillCircle(80, 37, 2);
      g.lineStyle(5, palette.sun, 0.9).arc(66, 57, 21, 0.15, Math.PI - 0.15, false);
      g.fillStyle(0xa78bff, 0.35).fillCircle(29, 68, 8).fillCircle(103, 68, 8);
      g.fillStyle(0x1d1849).fillRoundedRect(25, 83, 26, 15, 7).fillRoundedRect(81, 83, 26, 15, 7);
    });

    make('shard', 30, 34, g => {
      g.fillStyle(palette.sun, 0.18).fillCircle(15, 17, 15);
      g.fillStyle(0xffef9c).fillTriangle(15, 0, 29, 16, 15, 33).fillTriangle(15, 0, 1, 16, 15, 33);
      g.fillStyle(0xffffff, 0.82).fillTriangle(15, 3, 19, 14, 15, 19);
      g.lineStyle(2, 0xfff6c8, 0.7).lineBetween(5, 16, 25, 16);
    });

    make('dash-orb', 70, 70, g => {
      g.fillStyle(palette.sky, 0.11).fillCircle(35, 35, 34);
      g.lineStyle(3, 0xa9f8ff, 0.28).strokeCircle(35, 35, 29);
      g.lineStyle(4, palette.sky, 0.78).strokeCircle(35, 35, 23);
      g.fillStyle(0xe5fdff).fillTriangle(17, 35, 47, 16, 37, 31).fillTriangle(37, 39, 54, 35, 24, 55);
      g.fillStyle(0xffffff, 0.65).fillCircle(20, 18, 3).fillCircle(52, 22, 2);
    });

    make('jump-orb', 70, 70, g => {
      g.fillStyle(palette.pink, 0.10).fillCircle(35, 35, 34);
      g.lineStyle(3, 0xffd2e9, 0.28).strokeCircle(35, 35, 29);
      g.lineStyle(4, palette.pink, 0.78).strokeCircle(35, 35, 23);
      g.fillStyle(0xffeaf4).fillTriangle(35, 13, 54, 37, 42, 33).fillTriangle(28, 33, 16, 37, 35, 57);
      g.fillStyle(0xffffff, 0.7).fillCircle(50, 18, 3).fillCircle(17, 24, 2);
    });

    make('spike', 52, 34, g => {
      g.fillStyle(0x4b2946).fillTriangle(0, 34, 13, 2, 25, 34).fillTriangle(18, 34, 34, 0, 51, 34);
      g.fillStyle(0x9a466d).fillTriangle(6, 31, 13, 8, 19, 31);
      g.fillStyle(palette.pink, 0.55).fillTriangle(25, 30, 34, 5, 42, 30);
      g.lineStyle(2, 0xffa1c7, 0.45).lineBetween(33, 7, 34, 27);
    });

    make('spark', 18, 18, g => {
      g.fillStyle(0xffffff, 0.98).fillCircle(9, 9, 4);
      g.fillStyle(palette.sun, 0.24).fillCircle(9, 9, 9);
    });

    make('leaf', 32, 22, g => {
      g.fillStyle(0x76cf75).fillEllipse(14, 11, 27, 13);
      g.fillStyle(0xaee97f, 0.7).fillEllipse(10, 8, 13, 6);
      g.lineStyle(2, 0x397b57, 0.7).lineBetween(3, 15, 29, 7);
    });

    make('fern', 54, 72, g => {
      g.lineStyle(5, 0x255b54, 0.9).lineBetween(27, 70, 28, 14);
      for (let i = 0; i < 5; i++) {
        const y = 22 + i * 9;
        g.fillStyle(i % 2 ? 0x3f8a68 : 0x54a86e, 0.9).fillEllipse(17, y, 26, 8).fillEllipse(38, y + 3, 24, 8);
      }
      g.fillStyle(palette.mint, 0.7).fillCircle(28, 11, 5);
    });

    make('mushroom', 52, 58, g => {
      g.fillStyle(0xd7dbcb).fillRoundedRect(22, 25, 9, 31, 5);
      g.fillStyle(0x7c5bd1).fillEllipse(27, 25, 47, 26);
      g.fillStyle(0xb89cff).fillEllipse(27, 21, 39, 18);
      g.fillStyle(0xf6ebff, 0.78).fillCircle(16, 18, 4).fillCircle(35, 17, 3).fillCircle(29, 26, 2);
    });

    make('crystal-bud', 42, 62, g => {
      g.fillStyle(0x433b88, 0.45).fillCircle(21, 49, 17);
      g.fillStyle(0x8f7cf2).fillTriangle(3, 56, 14, 15, 24, 56);
      g.fillStyle(0xc3b4ff).fillTriangle(15, 56, 28, 2, 39, 56);
      g.fillStyle(0xf2ecff, 0.6).fillTriangle(27, 8, 31, 31, 35, 17);
    });

    make('cloud', 118, 52, g => {
      g.fillStyle(0xbce8e7, 0.16).fillEllipse(58, 33, 112, 26);
      g.fillStyle(0xd7f7ef, 0.15).fillCircle(37, 27, 22).fillCircle(64, 20, 29).fillCircle(89, 30, 18);
    });

    make('petal', 18, 12, g => {
      g.fillStyle(0xffbad8, 0.9).fillEllipse(9, 6, 16, 8);
      g.fillStyle(0xffe4ef, 0.65).fillEllipse(6, 4, 7, 4);
    });
  }

  private createContentTextures(): void {
    const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.textures.exists(key)) return;
      const g = this.add.graphics();
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };

    make('memory-petal', 42, 42, g => {
      g.fillStyle(palette.pink, 0.11).fillCircle(21, 21, 20);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
        const x = 21 + Math.cos(a) * 10;
        const y = 21 + Math.sin(a) * 10;
        g.fillStyle(i % 2 ? 0xffbddc : 0xffe0ef, 0.95).fillEllipse(x, y, 13, 8);
      }
      g.fillStyle(palette.sun).fillCircle(21, 21, 5);
      g.fillStyle(0xffffff, 0.7).fillCircle(19, 19, 2);
    });

    make('spring-cap', 72, 38, g => {
      g.fillStyle(0x132d3d, 0.55).fillEllipse(36, 33, 62, 10);
      g.fillStyle(0xd7dbcb).fillRoundedRect(31, 18, 10, 18, 5);
      g.fillStyle(0x6b55bd).fillEllipse(36, 17, 66, 30);
      g.fillStyle(0xa58df0).fillEllipse(36, 13, 56, 21);
      g.fillStyle(0xf4eaff, 0.7).fillCircle(20, 11, 4).fillCircle(43, 8, 3).fillCircle(54, 16, 3);
      g.lineStyle(2, 0xd5c9ff, 0.45).strokeEllipse(36, 14, 55, 20);
    });

    make('glowwing', 56, 40, g => {
      g.fillStyle(palette.sky, 0.16).fillCircle(28, 20, 19);
      g.fillStyle(0xa9f6ff, 0.5).fillEllipse(13, 20, 24, 13);
      g.fillStyle(0xa9f6ff, 0.5).fillEllipse(43, 20, 24, 13);
      g.fillStyle(0x244a68).fillEllipse(28, 21, 18, 27);
      g.fillStyle(palette.mint).fillCircle(28, 14, 8);
      g.fillStyle(palette.white).fillCircle(25, 13, 2.7).fillCircle(31, 13, 2.7);
      g.fillStyle(palette.ink).fillCircle(25.5, 13.5, 1.2).fillCircle(31.5, 13.5, 1.2);
      g.fillStyle(palette.sun).fillTriangle(25, 5, 28, 0, 31, 5);
    });

    make('thornpod', 54, 64, g => {
      g.fillStyle(0x214638).fillRoundedRect(24, 31, 7, 31, 3);
      g.fillStyle(0x426a48).fillEllipse(16, 47, 25, 10).fillEllipse(39, 49, 25, 10);
      g.fillStyle(0x5e8a53).fillCircle(27, 25, 20);
      g.fillStyle(0x88bc62).fillCircle(27, 21, 15);
      g.fillStyle(0x18322f).fillCircle(21, 20, 3).fillCircle(33, 20, 3);
      g.fillStyle(palette.danger).fillCircle(27, 29, 4);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        g.lineStyle(3, 0xb9f27c, 0.7).lineBetween(27 + Math.cos(a) * 16, 25 + Math.sin(a) * 16, 27 + Math.cos(a) * 24, 25 + Math.sin(a) * 24);
      }
    });

    make('seed', 18, 18, g => {
      g.fillStyle(palette.danger, 0.17).fillCircle(9, 9, 9);
      g.fillStyle(0xdff28b).fillCircle(9, 9, 5);
      g.fillStyle(0xffffff, 0.65).fillCircle(7, 7, 1.5);
    });

    make('brambleheart', 116, 104, g => {
      g.fillStyle(0x0f2829, 0.45).fillEllipse(58, 94, 94, 15);
      g.fillStyle(0x173f38).fillRoundedRect(15, 35, 86, 55, 24);
      g.fillStyle(0x3b734c).fillCircle(58, 40, 35);
      g.fillStyle(0x66a65e).fillCircle(58, 36, 27);
      g.fillStyle(palette.pink, 0.85).fillEllipse(26, 29, 25, 12).fillEllipse(90, 29, 25, 12);
      g.fillStyle(palette.sun).fillCircle(58, 38, 12);
      g.fillStyle(palette.white).fillCircle(49, 33, 6).fillCircle(67, 33, 6);
      g.fillStyle(0x18322f).fillCircle(51, 34, 3).fillCircle(69, 34, 3);
      g.lineStyle(4, 0x173f38, 1).arc(58, 50, 13, 0.2, Math.PI - 0.2, false);
      g.lineStyle(5, 0x426a48, 1).lineBetween(20, 53, 2, 35).lineBetween(96, 53, 114, 35);
      g.fillStyle(0x243f34).fillRoundedRect(25, 77, 25, 13, 6).fillRoundedRect(66, 77, 25, 13, 6);
    });

    make('wanderer', 52, 68, g => {
      g.fillStyle(0x0d2638).fillTriangle(8, 63, 26, 25, 46, 63);
      g.fillStyle(0x31566a).fillRoundedRect(11, 25, 31, 34, 12);
      g.fillStyle(0xb9f27c).fillCircle(26, 21, 14);
      g.fillStyle(0xf5fff9).fillCircle(21, 20, 4).fillCircle(31, 20, 4);
      g.fillStyle(palette.ink).fillCircle(22, 20, 2).fillCircle(32, 20, 2);
      g.fillStyle(palette.pink).fillEllipse(12, 12, 18, 9).fillEllipse(40, 12, 18, 9);
      g.fillStyle(palette.sun).fillCircle(26, 4, 4);
    });
  }

  private createSpriteSheets(): void {
    const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.closePath();
    };

    if (!this.textures.exists('player-sheet')) {
      const fw = 72;
      const fh = 80;
      const frames = [
        { name: 'idle0', pose: 'idle', t: 0 },
        { name: 'idle1', pose: 'idle', t: 1 },
        { name: 'idle2', pose: 'idle', t: 2 },
        { name: 'idle3', pose: 'idle', t: 3 },
        { name: 'run0', pose: 'run', t: 0 },
        { name: 'run1', pose: 'run', t: 1 },
        { name: 'run2', pose: 'run', t: 2 },
        { name: 'run3', pose: 'run', t: 3 },
        { name: 'jump', pose: 'jump', t: 0 },
        { name: 'fall', pose: 'fall', t: 0 },
        { name: 'attack0', pose: 'attack', t: 0 },
        { name: 'attack1', pose: 'attack', t: 1 },
        { name: 'attack2', pose: 'attack', t: 2 },
        { name: 'dash', pose: 'dash', t: 0 },
        { name: 'hurt', pose: 'hurt', t: 0 },
      ] as const;
      const tex = this.textures.createCanvas('player-sheet', fw * frames.length, fh);
      if (tex) {
        const ctx = tex.getContext();
        frames.forEach((frame, index) => {
          const ox = index * fw;
          const bob = frame.pose === 'idle' ? [0, -1.5, -2.5, -1][frame.t] : 0;
          const run = frame.pose === 'run';
          const attack = frame.pose === 'attack';
          const dash = frame.pose === 'dash';
          const hurt = frame.pose === 'hurt';
          const airborne = frame.pose === 'jump' || frame.pose === 'fall';
          const lean = dash ? 7 : attack ? 3 + frame.t * 2 : run ? 2 : hurt ? -3 : 0;
          const leg = run ? [-5, 4, 6, -4][frame.t] : frame.pose === 'jump' ? -4 : frame.pose === 'fall' ? 4 : 0;
          const squashY = dash ? 0.88 : hurt ? 0.93 : 1;
          const squashX = dash ? 1.10 : hurt ? 1.05 : 1;
          ctx.save();
          ctx.translate(ox + fw / 2, 40 + bob);
          ctx.rotate((lean * Math.PI) / 180);
          ctx.scale(squashX, squashY);

          // Cape, with pose-dependent sweep.
          ctx.fillStyle = 'rgba(8,22,45,0.96)';
          ctx.beginPath();
          ctx.moveTo(-18, 8);
          ctx.quadraticCurveTo(-20 - (dash ? 13 : run ? 5 : 0), 25, -17 - (dash ? 16 : 2), 31);
          ctx.lineTo(17, 31);
          ctx.quadraticCurveTo(15, 13, 12, 7);
          ctx.closePath();
          ctx.fill();

          // Torso.
          ctx.fillStyle = hurt ? '#274b68' : '#15385b';
          rounded(ctx, -17, 2, 34, 37, 13);
          ctx.fill();
          ctx.fillStyle = '#285b75';
          rounded(ctx, -13, 8, 26, 23, 9);
          ctx.fill();

          // Boots.
          ctx.fillStyle = '#ff9f7c';
          const leftLegY = 31 + leg;
          const rightLegY = 31 - leg;
          rounded(ctx, -15, leftLegY, 11, 11, 4); ctx.fill();
          rounded(ctx, 4, rightLegY, 11, 11, 4); ctx.fill();
          ctx.fillStyle = '#ffd6bd';
          rounded(ctx, -13, leftLegY + 3, 8, 4, 2); ctx.fill();
          rounded(ctx, 5, rightLegY + 3, 8, 4, 2); ctx.fill();

          // Head halo and head.
          ctx.fillStyle = hurt ? 'rgba(255,126,182,0.20)' : 'rgba(159,246,202,0.20)';
          ctx.beginPath(); ctx.arc(0, -15, 21, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = hurt ? '#8ed5b3' : '#72e6b1';
          ctx.beginPath(); ctx.arc(0, -15, 16.5, 0, Math.PI * 2); ctx.fill();

          // Face.
          const blink = frame.pose === 'idle' && frame.t === 2;
          ctx.strokeStyle = '#173653';
          ctx.fillStyle = '#e8fff1';
          if (blink) {
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-9, -16); ctx.lineTo(-4, -16); ctx.moveTo(4, -16); ctx.lineTo(9, -16); ctx.stroke();
          } else {
            ctx.beginPath(); ctx.arc(-7, -16, 4.5, 0, Math.PI * 2); ctx.arc(7, -16, 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#173653';
            ctx.beginPath(); ctx.arc(-6.5, -15.5, 2, 0, Math.PI * 2); ctx.arc(7.5, -15.5, 2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.beginPath(); ctx.arc(-7.5, -17, 1, 0, Math.PI * 2); ctx.arc(6.5, -17, 1, 0, Math.PI * 2); ctx.fill();
          }
          ctx.strokeStyle = '#4e9777';
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (hurt) {
            ctx.moveTo(-5, -7); ctx.quadraticCurveTo(0, -11, 5, -7);
          } else {
            ctx.moveTo(-5, -9); ctx.quadraticCurveTo(0, -5, 5, -9);
          }
          ctx.stroke();

          // Sprout and leaf.
          ctx.fillStyle = '#ffd66b';
          ctx.beginPath(); ctx.moveTo(-4, -29); ctx.lineTo(0, -38); ctx.lineTo(5, -28); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#b9f27c';
          ctx.beginPath(); ctx.ellipse(8, -34, 7, 3.5, -0.25, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#5ba85e'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(1, -29); ctx.lineTo(11, -35); ctx.stroke();

          // Scarf and arm language.
          ctx.fillStyle = '#ffd66b';
          ctx.beginPath();
          ctx.moveTo(13, -2);
          ctx.lineTo(attack ? 31 : dash ? 34 : 24, attack ? -8 + frame.t * 4 : dash ? 6 : 5);
          ctx.lineTo(13, 9);
          ctx.closePath();
          ctx.fill();

          if (attack) {
            ctx.strokeStyle = 'rgba(255,240,163,0.95)';
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            const swing = [-0.85, -0.15, 0.65][frame.t];
            ctx.beginPath();
            ctx.arc(11, 4, 26, swing - 0.35, swing + 0.35);
            ctx.stroke();
          }

          if (airborne) {
            ctx.fillStyle = frame.pose === 'jump' ? 'rgba(255,126,182,0.26)' : 'rgba(85,200,210,0.20)';
            ctx.beginPath(); ctx.ellipse(-20, 14, 8, 4, -0.8, 0, Math.PI * 2); ctx.ellipse(20, 14, 8, 4, 0.8, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
          tex.add(frame.name, 0, ox, 0, fw, fh);
        });
        tex.refresh();
      }
    }

    if (!this.textures.exists('slime-sheet')) {
      const fw = 60;
      const fh = 48;
      const tex = this.textures.createCanvas('slime-sheet', fw * 4, fh);
      if (tex) {
        const ctx = tex.getContext();
        for (let i = 0; i < 4; i++) {
          const ox = i * fw;
          const sy = [1, 0.90, 1.05, 0.94][i];
          const sx = [1, 1.08, 0.96, 1.05][i];
          ctx.save();
          ctx.translate(ox + 30, 25);
          ctx.scale(sx, sy);
          ctx.fillStyle = 'rgba(3,16,29,0.34)';
          ctx.beginPath(); ctx.ellipse(0, 17, 24, 5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#17475b';
          rounded(ctx, -23, -6, 46, 28, 13); ctx.fill();
          ctx.fillStyle = '#55c8d2';
          ctx.beginPath(); ctx.arc(0, -5, 17, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(217,255,255,0.45)';
          ctx.beginPath(); ctx.ellipse(-7, -13, 8, 4, -0.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f7fbff';
          ctx.beginPath(); ctx.arc(-7, -6, 4.2, 0, Math.PI * 2); ctx.arc(7, -6, 4.2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#081326';
          ctx.beginPath(); ctx.arc(-6, -5, 2, 0, Math.PI * 2); ctx.arc(8, -5, 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ff7eb6';
          ctx.beginPath(); ctx.arc(-15, 4, 3, 0, Math.PI * 2); ctx.arc(15, 4, 3, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#245d6e';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 1, 8, 0.2, Math.PI - 0.2); ctx.stroke();
          ctx.restore();
          tex.add(`bounce${i}`, 0, ox, 0, fw, fh);
        }
        tex.refresh();
      }
    }

    if (!this.textures.exists('boss-sheet')) {
      const fw = 144;
      const fh = 122;
      const names = ['idle0', 'idle1', 'charge0', 'charge1', 'leap', 'rage', 'hurt'] as const;
      const tex = this.textures.createCanvas('boss-sheet', fw * names.length, fh);
      if (tex) {
        const ctx = tex.getContext();
        names.forEach((name, i) => {
          const ox = i * fw;
          const charge = name.startsWith('charge');
          const rage = name === 'rage';
          const hurt = name === 'hurt';
          const leap = name === 'leap';
          const pulse = name === 'idle1' ? 1.04 : charge ? 1.07 : rage ? 1.09 : 1;
          ctx.save();
          ctx.translate(ox + 72, 61);
          ctx.scale(pulse, leap ? 0.93 : 1);
          ctx.fillStyle = 'rgba(11,8,35,0.42)';
          ctx.beginPath(); ctx.ellipse(0, 43, 57, 10, 0, 0, Math.PI * 2); ctx.fill();

          // Outer mantle and head.
          ctx.fillStyle = rage ? '#3b205f' : '#271e58';
          rounded(ctx, -56, -17, 112, 67, 29); ctx.fill();
          ctx.fillStyle = hurt ? '#8c79d8' : rage ? '#9255d4' : '#6658c7';
          ctx.beginPath(); ctx.arc(0, -14, 40, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(220,183,255,0.18)';
          ctx.beginPath(); ctx.arc(-12, -26, 23, 0, Math.PI * 2); ctx.fill();

          // Ears / crown.
          ctx.fillStyle = rage ? '#ff7eb6' : '#c38fff';
          ctx.beginPath(); ctx.moveTo(-43, -18); ctx.lineTo(-29, -51); ctx.lineTo(-18, -15); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(19, -15); ctx.lineTo(32, -51); ctx.lineTo(44, -18); ctx.closePath(); ctx.fill();

          // Eyes.
          ctx.fillStyle = '#f7fbff';
          ctx.beginPath(); ctx.arc(-16, -17, 9, 0, Math.PI * 2); ctx.arc(16, -17, 9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = charge || rage ? '#ff5b6e' : '#081326';
          ctx.beginPath(); ctx.arc(-13, -15, charge ? 5 : 4, 0, Math.PI * 2); ctx.arc(19, -15, charge ? 5 : 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath(); ctx.arc(-16, -20, 2, 0, Math.PI * 2); ctx.arc(16, -20, 2, 0, Math.PI * 2); ctx.fill();

          // Mouth changes by state.
          ctx.strokeStyle = rage || charge ? '#ffe58f' : '#ffd66b';
          ctx.lineWidth = 5;
          ctx.beginPath();
          if (hurt) {
            ctx.arc(0, 4, 14, Math.PI + 0.2, Math.PI * 2 - 0.2);
          } else if (charge || rage) {
            ctx.arc(0, 2, 15, 0.1, Math.PI - 0.1);
          } else {
            ctx.arc(0, 0, 20, 0.2, Math.PI - 0.2);
          }
          ctx.stroke();

          // Feet.
          ctx.fillStyle = '#1d1849';
          rounded(ctx, -43, 31, 27, 15, 7); ctx.fill();
          rounded(ctx, 16, 31, 27, 15, 7); ctx.fill();

          if (charge || rage) {
            ctx.strokeStyle = rage ? 'rgba(255,126,182,0.72)' : 'rgba(155,123,255,0.65)';
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(0, -5, charge ? 49 : 53, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.restore();
          tex.add(name, 0, ox, 0, fw, fh);
        });
        tex.refresh();
      }
    }

    if (!this.textures.exists('terrain-sheet')) {
      const fw = 96;
      const fh = 56;
      const names = ['meadow', 'grotto', 'canopy'] as const;
      const tex = this.textures.createCanvas('terrain-sheet', fw * names.length, fh);
      if (tex) {
        const ctx = tex.getContext();
        names.forEach((name, i) => {
          const ox = i * fw;
          ctx.save();
          ctx.translate(ox, 0);
          const base = name === 'meadow' ? '#173c4c' : name === 'grotto' ? '#152f43' : '#23264d';
          const top = name === 'meadow' ? '#72a95e' : name === 'grotto' ? '#34806d' : '#6555a0';
          const edge = name === 'meadow' ? '#b9f27c' : name === 'grotto' ? '#72e6b1' : '#b69aff';
          ctx.fillStyle = base;
          ctx.fillRect(0, 7, fw, fh - 7);
          ctx.fillStyle = top;
          ctx.fillRect(0, 0, fw, 17);
          ctx.fillStyle = edge;
          ctx.fillRect(0, 0, fw, 5);

          if (name === 'meadow') {
            ctx.fillStyle = '#345f4e';
            for (let x = 9; x < fw; x += 23) {
              ctx.beginPath(); ctx.ellipse(x, 27 + (x % 7), 8, 3, -0.35, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = 'rgba(255,214,107,0.34)';
            ctx.beginPath(); ctx.arc(18, 8, 3, 0, Math.PI * 2); ctx.arc(69, 11, 2, 0, Math.PI * 2); ctx.fill();
          } else if (name === 'grotto') {
            ctx.fillStyle = '#0e2333';
            for (let x = 8; x < fw; x += 19) {
              ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x + 7, 45); ctx.lineTo(x + 14, 18); ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = 'rgba(114,230,177,0.35)';
            ctx.beginPath(); ctx.arc(15, 20, 3, 0, Math.PI * 2); ctx.arc(57, 33, 2.5, 0, Math.PI * 2); ctx.arc(83, 22, 2, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.fillStyle = '#171a3b';
            for (let x = 6; x < fw; x += 18) {
              ctx.beginPath(); ctx.moveTo(x, 17); ctx.lineTo(x + 9, 52); ctx.lineTo(x + 14, 17); ctx.closePath(); ctx.fill();
            }
            ctx.strokeStyle = 'rgba(195,180,255,0.34)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(15, 18); ctx.lineTo(24, 35); ctx.lineTo(34, 29); ctx.lineTo(43, 49); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(63, 20); ctx.lineTo(72, 31); ctx.lineTo(84, 18); ctx.stroke();
          }

          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(0, 5, fw, 2);
          ctx.restore();
          tex.add(name, 0, ox, 0, fw, fh);
        });
        tex.refresh();
      }
    }
  }

  private createAnimations(): void {
    const make = (key: string, frames: Phaser.Types.Animations.AnimationFrame[], frameRate: number, repeat = -1) => {
      if (!this.anims.exists(key)) this.anims.create({ key, frames, frameRate, repeat });
    };
    const p = (name: string) => ({ key: 'player-sheet', frame: name });
    make('player-idle', ['idle0', 'idle1', 'idle2', 'idle3'].map(p), 5);
    make('player-run', ['run0', 'run1', 'run2', 'run3'].map(p), 11);
    make('player-jump', [p('jump')], 1);
    make('player-fall', [p('fall')], 1);
    make('player-attack', ['attack0', 'attack1', 'attack2'].map(p), 14, 0);
    make('player-dash', [p('dash')], 1);
    make('player-hurt', [p('hurt')], 1);

    const slime = (name: string) => ({ key: 'slime-sheet', frame: name });
    make('slime-bounce', ['bounce0', 'bounce1', 'bounce2', 'bounce3'].map(slime), 7);

    const boss = (name: string) => ({ key: 'boss-sheet', frame: name });
    make('boss-idle', ['idle0', 'idle1'].map(boss), 3);
    make('boss-charge', ['charge0', 'charge1'].map(boss), 8);
    make('boss-leap', [boss('leap')], 1);
    make('boss-rage', ['rage', 'charge1'].map(boss), 7);
    make('boss-hurt', [boss('hurt')], 1);
  }

  private createBackdrop(): void {
    const sky = this.add.graphics().setScrollFactor(0).setDepth(-60);
    const bands = [0x061021, 0x091c33, 0x0d2b45, 0x12425a, 0x1b6070, 0x2d7f7b];
    bands.forEach((c, i) => sky.fillStyle(c).fillRect(0, i * 122, 1280, 128));

    // Static horizon glow.
    sky.fillStyle(0x9be7d3, 0.055).fillCircle(1080, 126, 190);
    sky.fillStyle(0xffe6a0, 0.07).fillCircle(1080, 126, 100);

    // Large slow-moving cloud forms.
    for (let i = 0; i < 10; i++) {
      const cloud = this.add.image(90 + i * 610, 130 + (i % 4) * 92, 'cloud')
        .setScrollFactor(0.035 + (i % 3) * 0.02)
        .setScale(1.25 + (i % 3) * 0.35)
        .setAlpha(0.5)
        .setDepth(-55);
      this.tweens.add({ targets: cloud, x: cloud.x + 80 + (i % 3) * 30, yoyo: true, repeat: -1, duration: 11000 + i * 640, ease: 'Sine.inOut' });
    }

    // Three parallax ridge layers.
    for (let layer = 0; layer < 3; layer++) {
      const factor = 0.06 + layer * 0.075;
      const color = [0x122943, 0x174355, 0x20595b][layer];
      for (let i = 0; i < 27; i++) {
        const x = i * 235 + (layer * 97) % 180;
        const h = 120 + ((i * 71 + layer * 43) % 190);
        this.add.ellipse(x, 835 - layer * 34, 390, h * 2, color, 0.86)
          .setOrigin(0.5, 1)
          .setScrollFactor(factor)
          .setDepth(-48 + layer);
      }
    }

    // Biome haze — subtle color shifts behind the play space.
    this.add.rectangle(900, 540, 1800, 1080, 0xffd56b, 0.035).setDepth(-28);
    this.add.rectangle(2730, 540, 1760, 1080, 0x49c6ac, 0.045).setDepth(-28);
    this.add.rectangle(4500, 540, 1800, 1080, 0x9b7bff, 0.06).setDepth(-28);

    // Sunmeadow distant flowers and soft tree crowns.
    for (let x = 110; x < 1850; x += 180) {
      const trunkH = 130 + (x % 95);
      this.add.rectangle(x, 910, 15, trunkH, 0x214e50, 0.65).setOrigin(0.5, 1).setDepth(-12);
      this.add.circle(x - 22, 910 - trunkH + 22, 34, 0x2f6a61, 0.58).setDepth(-13);
      this.add.circle(x + 23, 910 - trunkH + 8, 42, 0x397b67, 0.54).setDepth(-13);
      this.add.circle(x, 910 - trunkH - 14, 30, 0x4a8b68, 0.48).setDepth(-13);
      const bloom = this.add.circle(x + 14, 910 - trunkH - 26, 7, x % 360 === 0 ? palette.pink : palette.sun, 0.7).setDepth(-11);
      this.tweens.add({ targets: bloom, scale: 1.35, alpha: 0.42, yoyo: true, repeat: -1, duration: 1700 + (x % 500) });
    }

    // Moss Grotto: stalactites, giant mushrooms, hanging vines.
    for (let x = 1910; x < 3600; x += 150) {
      const h = 90 + (x % 140);
      this.add.triangle(x, 34, 0, 0, 54, 0, 27, h, 0x122f42, 0.72).setOrigin(0.5, 0).setDepth(-10);
      if (x % 300 < 170) {
        const mush = this.add.image(x + 55, 830 - (x % 120), 'mushroom').setScale(1.45 + (x % 3) * 0.22).setAlpha(0.48).setDepth(-9);
        this.tweens.add({ targets: mush, angle: { from: -2, to: 2 }, yoyo: true, repeat: -1, duration: 2500 + (x % 700), ease: 'Sine.inOut' });
      }
      const vine = this.add.graphics().setDepth(-8);
      vine.lineStyle(5, 0x286052, 0.45);
      vine.beginPath();
      vine.moveTo(x - 38, 0);
      vine.lineTo(x - 36, 74 + (x % 130));
      vine.lineTo(x - 46, 128 + (x % 85));
      vine.strokePath();
    }

    // Twilight Canopy: huge trunks and luminous crowns.
    for (let x = 3660; x < WORLD_W; x += 235) {
      const trunkW = 52 + (x % 28);
      this.add.rectangle(x, 970, trunkW, 560, 0x1f254d, 0.78).setOrigin(0.5, 1).setDepth(-14);
      this.add.ellipse(x, 395 + (x % 80), 250, 145, 0x363163, 0.54).setDepth(-15);
      this.add.circle(x - 70, 410 + (x % 60), 65, 0x47396e, 0.5).setDepth(-15);
      this.add.circle(x + 75, 385 + (x % 75), 76, 0x514075, 0.46).setDepth(-15);
      this.add.circle(x + 20, 380, 7, palette.pink, 0.45).setDepth(-13);
    }

    // Floating atmospheric motes.
    for (let i = 0; i < 130; i++) {
      const x = (i * 197) % WORLD_W;
      const y = 70 + (i * 83) % 700;
      const zoneColor = x < 1850 ? palette.sun : x < 3600 ? palette.mint : palette.pink;
      const mote = this.add.circle(x, y, 1.2 + (i % 3), zoneColor, 0.13 + (i % 5) * 0.035)
        .setScrollFactor(0.12 + (i % 4) * 0.035)
        .setDepth(-18);
      this.tweens.add({
        targets: mote,
        y: y - 22 - (i % 35),
        x: x + ((i % 2) ? 11 : -11),
        alpha: { from: mote.alpha, to: mote.alpha * 0.25 },
        yoyo: true,
        repeat: -1,
        duration: 2300 + (i % 9) * 310,
        ease: 'Sine.inOut',
      });
    }

    const sun = this.add.circle(1060, 125, 72, palette.sun, 0.11).setScrollFactor(0.02).setDepth(-58);
    this.add.circle(1060, 125, 39, 0xffefb1, 0.19).setScrollFactor(0.02).setDepth(-57);
    this.tweens.add({ targets: sun, scale: 1.18, alpha: 0.18, yoyo: true, repeat: -1, duration: 3100, ease: 'Sine.inOut' });

    this.createWorldLandmarks();
  }

  private addPlatform(x: number, y: number, w: number, h = 32): Phaser.Physics.Arcade.Sprite {
    const p = this.platforms.create(x, y, 'platform') as Phaser.Physics.Arcade.Sprite;
    p.setDisplaySize(w, h).setAlpha(0).refreshBody();
    const frame = x < 1850 ? 'meadow' : x < 3600 ? 'grotto' : 'canopy';
    this.add.tileSprite(x, y, w, h, 'terrain-sheet', frame)
      .setDepth(1)
      .setTileScale(1, Math.max(0.82, h / 50));
    this.decoratePlatform(x, y, w, h);
    return p;
  }

  private decoratePlatform(x: number, y: number, w: number, h: number): void {
    const zone = x < 1850 ? 0 : x < 3600 ? 1 : 2;
    const accent = [palette.sun, palette.mint, palette.pink][zone];
    const count = Math.max(2, Math.floor(w / 120));
    for (let i = 0; i < count; i++) {
      const px = x - w * 0.42 + (i + 0.5) * (w * 0.84 / count);
      if (zone === 0) {
        const leaf = this.add.image(px, y - h * 0.55, 'leaf').setScale(0.62 + (i % 3) * 0.1).setDepth(3).setAlpha(0.86);
        leaf.setAngle(i % 2 ? 13 : -11);
      } else if (zone === 1) {
        const fern = this.add.image(px, y - h * 0.58 - 18, 'fern').setScale(0.48 + (i % 2) * 0.08).setDepth(3).setAlpha(0.7);
        fern.setFlipX(i % 2 === 0);
      } else {
        const bud = this.add.image(px, y - h * 0.56 - 13, 'crystal-bud').setScale(0.38 + (i % 3) * 0.06).setDepth(3).setAlpha(0.66);
        this.tweens.add({ targets: bud, alpha: 0.92, yoyo: true, repeat: -1, duration: 1500 + i * 230, ease: 'Sine.inOut' });
      }
      if ((i + Math.round(x / 100)) % 3 === 0) {
        this.add.circle(px + 12, y - h * 0.56 - 3, 3.2, accent, 0.75).setDepth(4);
      }
    }
  }

  private createWorldLandmarks(): void {
    // Sunmeadow hero landmark: giant dandelion clock.
    this.add.rectangle(640, 845, 13, 300, 0x315d54, 0.5).setOrigin(0.5, 1).setDepth(-4);
    const bloom = this.add.circle(640, 538, 54, 0xffefad, 0.12).setStrokeStyle(2, 0xffefad, 0.16).setDepth(-4);
    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18;
      this.add.ellipse(640 + Math.cos(a) * 48, 538 + Math.sin(a) * 48, 18, 6, 0xfff3be, 0.23).setRotation(a).setDepth(-4);
    }
    this.tweens.add({ targets: bloom, scale: 1.12, alpha: 0.2, yoyo: true, repeat: -1, duration: 2600 });

    // Grotto landmark: luminous mushroom tower.
    const giantMush = this.add.image(2550, 700, 'mushroom').setScale(3.8).setAlpha(0.26).setDepth(-5);
    this.add.circle(2550, 615, 94, palette.violet, 0.035).setDepth(-6);
    this.tweens.add({ targets: giantMush, angle: { from: -1.3, to: 1.3 }, yoyo: true, repeat: -1, duration: 4800, ease: 'Sine.inOut' });

    // Canopy landmark: moon gate.
    this.add.circle(4660, 330, 170, 0xd9d5ff, 0.045).setStrokeStyle(8, 0xa998ff, 0.08).setDepth(-7);
    this.add.circle(4692, 305, 115, 0x071326, 0.72).setDepth(-6);
    for (let i = 0; i < 9; i++) {
      const star = this.add.circle(4480 + i * 55, 165 + (i % 3) * 44, 2 + (i % 2), 0xf4e9ff, 0.38).setDepth(-6);
      this.tweens.add({ targets: star, alpha: 0.08, yoyo: true, repeat: -1, duration: 900 + i * 170 });
    }
  }

  private createForegroundDetails(): void {
    const place = (x: number, y: number, key: string, scale: number, alpha: number, flip = false) => {
      const image = this.add.image(x, y, key)
        .setScale(scale)
        .setAlpha(alpha)
        .setFlipX(flip)
        .setDepth(24)
        .setScrollFactor(1.035);
      this.tweens.add({
        targets: image,
        angle: { from: flip ? 2.5 : -2.5, to: flip ? -2.5 : 2.5 },
        yoyo: true,
        repeat: -1,
        duration: 3600 + (Math.floor(x) % 1400),
        ease: 'Sine.inOut',
      });
      return image;
    };

    // Meadow leaves briefly sweep the lower frame edge.
    place(350, 930, 'fern', 2.2, 0.12, false);
    place(1020, 950, 'leaf', 4.4, 0.10, true);
    place(1710, 925, 'fern', 2.0, 0.11, true);

    // Grotto silhouettes feel closer and denser.
    place(2180, 905, 'mushroom', 2.3, 0.10, false);
    place(2860, 930, 'fern', 2.8, 0.14, true);
    place(3480, 910, 'mushroom', 2.0, 0.09, true);

    // Canopy foreground crystal growths create depth near the boss arena.
    place(3890, 920, 'crystal-bud', 2.8, 0.10, false);
    place(4560, 930, 'crystal-bud', 3.4, 0.12, true);
    place(5200, 920, 'fern', 2.4, 0.08, true);
  }

  private createWorld(): void {
    this.platforms = this.physics.add.staticGroup();
    this.breakables = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup();

    // Sunmeadow
    this.addPlatform(460, GROUND_Y, 920, 55);
    this.addPlatform(1110, 865, 260, 34);
    this.addPlatform(1420, 790, 240, 34);
    this.addPlatform(1660, 885, 260, 34);
    this.addPlatform(1280, 655, 210, 30);
    this.addPlatform(1580, 560, 200, 30);
    this.addPlatform(1770, 720, 170, 30);

    // Crystal threshold & Moss Grotto
    this.addPlatform(2060, GROUND_Y, 520, 55);
    this.addPlatform(2450, 850, 230, 34);
    this.addPlatform(2750, 750, 240, 34);
    this.addPlatform(3090, 870, 260, 34);
    this.addPlatform(3260, 690, 220, 32);
    this.addPlatform(3030, 545, 200, 32);
    this.addPlatform(3400, 450, 250, 32);
    this.addPlatform(3530, 850, 190, 32);

    // Twilight Canopy — double-jump path
    this.addPlatform(3800, GROUND_Y, 430, 55);
    this.addPlatform(3890, 730, 175, 30);
    this.addPlatform(4120, 585, 180, 30);
    this.addPlatform(4360, 735, 230, 30);
    this.addPlatform(4700, GROUND_Y, 650, 55);
    this.addPlatform(5040, 790, 220, 32);
    this.addPlatform(5250, 650, 180, 32);

    const wall = this.breakables.create(1940, 820, 'crystal') as Phaser.Physics.Arcade.Sprite;
    wall.setPosition(1940, 720).setDisplaySize(96, 420).refreshBody().setData('gate', true);
    const upperCrystal = this.breakables.create(3660, 565, 'crystal') as Phaser.Physics.Arcade.Sprite;
    upperCrystal.setDisplaySize(82, 270).refreshBody().setData('gate', false);

    [930, 2320, 2940, 3500, 4030, 4470].forEach((x, i) => {
      const spike = this.hazards.create(x, GROUND_Y - 39, 'spike') as Phaser.Physics.Arcade.Sprite;
      spike.setDisplaySize(i % 2 ? 90 : 68, 42).refreshBody();
    });

    this.createCheckpoint(1080, 810, 'Sunbell');
    this.createCheckpoint(2820, 696, 'Mossbell');
    this.createCheckpoint(4230, 530, 'Moonbell');

    // Final shrine.
    const shrineGlow = this.add.circle(5215, 572, 106, palette.sun, 0.055).setDepth(1);
    const shrineInner = this.add.circle(5215, 572, 57, palette.sun, 0.13).setDepth(1);
    this.add.circle(5215, 570, 25, 0xfff4bd, 0.20).setDepth(2);
    this.add.rectangle(5215, 665, 126, 24, 0x333c62).setDepth(1);
    this.add.rectangle(5215, 657, 108, 8, 0x7667a8, 0.65).setDepth(2);
    this.add.triangle(5215, 610, 0, 84, 45, 0, 90, 84, palette.white, 0.42).setDepth(2);
    this.add.triangle(5215, 603, 17, 70, 45, 17, 73, 70, palette.sun, 0.22).setDepth(3);
    for (let i = 0; i < 7; i++) {
      const mote = this.add.circle(5165 + i * 17, 535 + (i % 3) * 28, 2 + (i % 2), palette.sun, 0.45).setDepth(3);
      this.tweens.add({ targets: mote, y: mote.y - 24, alpha: 0.1, yoyo: true, repeat: -1, duration: 1100 + i * 190 });
    }
    this.tweens.add({ targets: [shrineGlow, shrineInner], scale: 1.28, alpha: '+=0.07', yoyo: true, repeat: -1, duration: 1900 });

    // Decorative flowers.
    for (let x = 120; x < WORLD_W; x += 173) {
      const color = x < 1850 ? palette.sun : x < 3600 ? palette.mint : palette.pink;
      this.add.circle(x, 897 - (x % 13), 5, color, 0.9).setDepth(2);
      this.add.circle(x - 6, 899 - (x % 13), 4, color, 0.55).setDepth(2);
      this.add.circle(x + 6, 899 - (x % 13), 4, color, 0.55).setDepth(2);
    }
  }

  private createCheckpoint(x: number, y: number, name: string): void {
    const halo = this.add.circle(x, y - 67, 44, palette.mint, 0.055).setDepth(1);
    const glow = this.add.circle(x, y - 67, 28, palette.mint, 0.14).setDepth(1);
    this.add.circle(x, y - 67, 12, 0xe9fff4, 0.78).setDepth(3);
    this.add.circle(x, y - 67, 6, palette.mint, 0.95).setDepth(4);
    this.add.rectangle(x, y - 27, 7, 59, 0x9acdb9, 0.75).setDepth(2);
    this.add.ellipse(x, y + 3, 38, 10, 0x163c42, 0.48).setDepth(1);
    this.tweens.add({ targets: [halo, glow], scale: 1.25, alpha: '+=0.08', yoyo: true, repeat: -1, duration: 1800, ease: 'Sine.inOut' });
    this.add.text(x, y - 120, name.toUpperCase(), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      fontStyle: '800',
      color: '#c9ffe6',
      letterSpacing: 2,
    }).setOrigin(0.5).setAlpha(0.62).setDepth(2);
  }

  private createPlayer(): void {
    this.playerShadow = this.add.ellipse(this.checkpoint.x, this.checkpoint.y + 30, 48, 13, 0x020817, 0.34).setDepth(4);
    this.playerGlow = this.add.circle(this.checkpoint.x, this.checkpoint.y, 34, palette.mint, 0.10).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
    this.player = this.physics.add.sprite(this.checkpoint.x, this.checkpoint.y, 'player-sheet', 'idle0');
    this.player.play('player-idle');
    this.player.setDepth(8).setBounce(0.02).setCollideWorldBounds(true);
    this.player.setSize(30, 49).setOffset(21, 20);
    this.player.setMaxVelocity(470, 900);
    this.player.setDragX(1700);
    this.tweens.add({ targets: this.playerGlow, scale: 1.14, alpha: 0.055, yoyo: true, repeat: -1, duration: 1250, ease: 'Sine.inOut' });
  }

  private createEnemies(): void {
    this.enemies = this.physics.add.group({ collideWorldBounds: true });
    const spawnSlime = (x: number, y: number, left: number, right: number) => {
      const e = this.enemies.create(x, y, 'slime-sheet', 'bounce0') as Phaser.Physics.Arcade.Sprite;
      e.play('slime-bounce');
      e.setDepth(7).setSize(39, 27).setOffset(10, 17).setBounce(0.1).setDataEnabled();
      e.setData('hp', 2).setData('kind', 'slime').setData('left', left).setData('right', right).setData('dir', 1);
    };
    spawnSlime(780, 860, 620, 870);
    spawnSlime(1510, 730, 1380, 1600);
    spawnSlime(2230, 860, 2070, 2300);
    spawnSlime(2770, 690, 2670, 2860);
    spawnSlime(3340, 630, 3240, 3420);
    spawnSlime(3920, 670, 3830, 3970);

    if (!this.bossDefeated) {
      const boss = this.enemies.create(4650, 840, 'boss-sheet', 'idle0') as Phaser.Physics.Arcade.Sprite;
      boss.play('boss-idle');
      boss.setDepth(7).setSize(92, 75).setOffset(26, 37).setBounce(0.5).setDataEnabled();
      boss.setData('hp', 9).setData('kind', 'boss').setData('dir', -1).setData('nextLeap', 1100).setData('phase', 1).setData('wasAirborne', false);
    }
  }

  private createPickups(): void {
    this.pickups = this.physics.add.group({ allowGravity: false, immovable: true });
    const shards = [
      [520, 790], [1130, 800], [1320, 595], [1600, 500], [1780, 660],
      [2390, 790], [2760, 690], [3060, 485], [3410, 390], [3860, 665],
      [4130, 525], [4390, 675], [5030, 730],
    ];
    shards.forEach(([x, y], i) => {
      const glow = this.add.circle(x, y, 18, palette.sun, 0.07).setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
      const s = this.pickups.create(x, y, 'shard') as Phaser.Physics.Arcade.Sprite;
      s.setData('type', 'shard').setData('index', i).setData('glow', glow).setDepth(6);
      this.tweens.add({ targets: s, y: y - 12, angle: 8, yoyo: true, repeat: -1, duration: 1000 + (i % 4) * 130, ease: 'Sine.inOut' });
      this.tweens.add({ targets: glow, scale: 1.55, alpha: 0.015, yoyo: true, repeat: -1, duration: 1200 + (i % 4) * 150, ease: 'Sine.inOut' });
    });

    if (!this.abilities.dash) {
      const dashGlow = this.add.circle(1590, 505, 48, palette.sky, 0.065).setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
      const dash = this.pickups.create(1590, 505, 'dash-orb') as Phaser.Physics.Arcade.Sprite;
      dash.setData('type', 'dash').setData('glow', dashGlow).setDepth(6);
      this.tweens.add({ targets: dash, scale: 1.12, angle: 12, yoyo: true, repeat: -1, duration: 1200, ease: 'Sine.inOut' });
      this.tweens.add({ targets: dashGlow, scale: 1.35, alpha: 0.02, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.inOut' });
    }
    if (!this.abilities.doubleJump) {
      const jumpGlow = this.add.circle(3410, 395, 48, palette.pink, 0.06).setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
      const jump = this.pickups.create(3410, 395, 'jump-orb') as Phaser.Physics.Arcade.Sprite;
      jump.setData('type', 'doubleJump').setData('glow', jumpGlow).setDepth(6);
      this.tweens.add({ targets: jump, scale: 1.12, angle: -12, yoyo: true, repeat: -1, duration: 1250, ease: 'Sine.inOut' });
      this.tweens.add({ targets: jumpGlow, scale: 1.35, alpha: 0.018, yoyo: true, repeat: -1, duration: 1550, ease: 'Sine.inOut' });
    }
  }

  private createExpandedContent(): void {
    this.projectiles = this.physics.add.group({ allowGravity: false });
    this.springPads = this.physics.add.staticGroup();

    const springData = [
      [1185, 823],
      [2670, 708],
      [3875, 687],
    ];
    springData.forEach(([x, y], i) => {
      const spring = this.springPads.create(x, y, 'spring-cap') as Phaser.Physics.Arcade.Sprite;
      spring.setDepth(5).setSize(58, 18).setOffset(7, 13).refreshBody().setData('index', i);
      this.tweens.add({ targets: spring, scaleY: { from: 0.96, to: 1.04 }, yoyo: true, repeat: -1, duration: 850 + i * 110, ease: 'Sine.inOut' });
    });

    // Three optional dash-gated alcoves, one in each biome.
    const secrets = [
      { id: 'sun-echo', gateX: 1710, gateY: 485, gateH: 145, platformX: 1810, platformY: 515, petalX: 1845, petalY: 457 },
      { id: 'moss-whisper', gateX: 3440, gateY: 330, gateH: 150, platformX: 3535, platformY: 340, petalX: 3560, petalY: 285 },
      { id: 'moon-memory', gateX: 4925, gateY: 535, gateH: 155, platformX: 5030, platformY: 525, petalX: 5070, petalY: 468 },
    ];
    for (const secret of secrets) {
      this.addPlatform(secret.platformX, secret.platformY, 170, 27);
      const gate = this.breakables.create(secret.gateX, secret.gateY, 'crystal') as Phaser.Physics.Arcade.Sprite;
      gate.setDisplaySize(56, secret.gateH).refreshBody().setData('secretId', secret.id).setData('gate', false);
      if (!this.memoryPetals.has(secret.id)) this.spawnMemoryPetal(secret.id, secret.petalX, secret.petalY);
    }

    // New standard enemy archetypes.
    const spawnGlowwing = (x: number, y: number, left: number, right: number) => {
      const e = this.enemies.create(x, y, 'glowwing') as Phaser.Physics.Arcade.Sprite;
      const body = e.body as Phaser.Physics.Arcade.Body;
      body.setAllowGravity(false);
      e.setDepth(7).setSize(42, 29).setOffset(7, 6).setDataEnabled();
      e.setData('hp', 2).setData('kind', 'glowwing').setData('homeY', y).setData('left', left).setData('right', right).setData('dir', 1);
      this.tweens.add({ targets: e, scaleY: 0.88, yoyo: true, repeat: -1, duration: 340, ease: 'Sine.inOut' });
    };
    spawnGlowwing(1390, 560, 1230, 1650);
    spawnGlowwing(2510, 615, 2330, 2830);
    spawnGlowwing(4080, 500, 3860, 4380);

    const spawnThornpod = (x: number, y: number, facing: number) => {
      const e = this.enemies.create(x, y, 'thornpod') as Phaser.Physics.Arcade.Sprite;
      e.setDepth(7).setSize(40, 50).setOffset(7, 12).setDataEnabled();
      e.setImmovable(true);
      e.setData('hp', 3).setData('kind', 'thornpod').setData('dir', facing).setData('nextShot', this.time.now + 900 + (x % 700));
    };
    spawnThornpod(2470, 797, -1);
    spawnThornpod(4340, 680, 1);

    if (!this.minibossDefeated) {
      const mini = this.enemies.create(2860, 678, 'brambleheart') as Phaser.Physics.Arcade.Sprite;
      mini.setDepth(7).setSize(84, 72).setOffset(16, 27).setBounce(0.15).setDataEnabled();
      mini.setData('hp', 7).setData('kind', 'miniboss').setData('left', 2660).setData('right', 2915).setData('dir', -1).setData('nextCharge', this.time.now + 1200);
    } else if (!this.memoryPetals.has('brambleheart')) {
      this.spawnMemoryPetal('brambleheart', 2860, 650);
    }

    this.createNpc(880, 853, 'Pip', 'The Sunbell says bright things hide behind violet glass.');
    this.createNpc(2350, 794, 'Nema', 'The grotto mushrooms remember how high you dared to jump.');
    this.createNpc(4140, 525, 'Miri', 'Four memory petals make the wild hum in harmony. Find every hidden echo.');
  }

  private spawnMemoryPetal(id: string, x: number, y: number): void {
    if (this.memoryPetals.has(id)) return;
    const glow = this.add.circle(x, y, 28, palette.pink, 0.075).setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
    const petal = this.pickups.create(x, y, 'memory-petal') as Phaser.Physics.Arcade.Sprite;
    petal.setData('type', 'memoryPetal').setData('id', id).setData('glow', glow).setDepth(6);
    this.tweens.add({ targets: petal, y: y - 13, angle: 18, yoyo: true, repeat: -1, duration: 1150, ease: 'Sine.inOut' });
    this.tweens.add({ targets: glow, scale: 1.5, alpha: 0.02, yoyo: true, repeat: -1, duration: 1350, ease: 'Sine.inOut' });
  }

  private createNpc(x: number, y: number, name: string, line: string): void {
    const npc = this.add.image(x, y, 'wanderer').setDepth(6).setDataEnabled();
    npc.setData('npcName', name).setData('line', line).setData('spoken', false);
    const halo = this.add.circle(x, y - 5, 28, palette.lime, 0.035).setDepth(5);
    npc.setData('halo', halo);
    this.tweens.add({ targets: npc, y: y - 5, yoyo: true, repeat: -1, duration: 1450 + (x % 400), ease: 'Sine.inOut' });
    this.tweens.add({ targets: halo, alpha: 0.07, scale: 1.2, yoyo: true, repeat: -1, duration: 1800 });
    this.npcs.push(npc);
  }

  private updateNpcs(): void {
    let nearAny = false;
    for (const npc of this.npcs) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
      if (dist < 120) {
        nearAny = true;
        const id = npc.getData('npcName') as string;
        if (this.lastNpcSpoken !== id) {
          this.lastNpcSpoken = id;
          this.toast(`${id}: “${npc.getData('line') as string}”`, 3100);
        }
      }
    }
    if (!nearAny) this.lastNpcSpoken = '';
  }

  private updateProjectiles(time: number): void {
    this.projectiles.getChildren().forEach(child => {
      const p = child as Phaser.Physics.Arcade.Sprite;
      const born = p.getData('born') as number;
      if (!p.active) return;
      p.rotation += 0.12;
      if (time - born > 3600 || p.x < 0 || p.x > WORLD_W || p.y < 0 || p.y > WORLD_H) p.destroy();
    });
  }

  private fireSeed(enemy: Phaser.Physics.Arcade.Sprite): void {
    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const speed = 245;
    const p = this.projectiles.create(enemy.x, enemy.y - 8, 'seed') as Phaser.Physics.Arcade.Sprite;
    p.setDepth(8).setSize(12, 12).setData('born', this.time.now);
    p.setVelocity((dx / len) * speed, (dy / len) * speed);
    this.burst(enemy.x, enemy.y - 5, palette.lime, 5, 65);
  }

  private setupCollisions(): void {
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.breakables);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.enemies, this.breakables);
    this.physics.add.overlap(this.player, this.hazards, () => this.damagePlayer(1));
    this.physics.add.overlap(this.player, this.enemies, (_p, enemy) => {
      const e = enemy as Phaser.Physics.Arcade.Sprite;
      if (this.dashing && e.getData('kind') !== 'boss') this.damageEnemy(e, 1);
      else this.damagePlayer(e.getData('kind') === 'boss' ? 2 : 1, e.x);
    });
    this.physics.add.overlap(this.player, this.pickups, (_p, pickup) => this.collectPickup(pickup as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.player, this.springPads, (_p, spring) => {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      if (body.velocity.y < 40) return;
      const cap = spring as Phaser.Physics.Arcade.Sprite;
      this.player.setVelocityY(-625);
      this.extraJumps = this.abilities.doubleJump ? 1 : 0;
      this.soundscape.jump();
      this.ring(cap.x, cap.y - 8, palette.violet);
      this.burst(cap.x, cap.y - 12, palette.pink, 8, 100);
      cap.setScale(1.12, 0.72);
      this.time.delayedCall(90, () => cap.active && cap.setScale(1));
    });
    this.physics.add.overlap(this.player, this.projectiles, (_p, projectile) => {
      const seed = projectile as Phaser.Physics.Arcade.Sprite;
      if (!seed.active) return;
      seed.destroy();
      this.damagePlayer(1, seed.x);
    });
  }

  private setupControls(): void {
    const keyboard = this.input.keyboard!;
    const cursors = keyboard.createCursorKeys();
    const wasd = keyboard.addKeys('W,A,S,D,SPACE,SHIFT,J,R,M') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys = {
      left: wasd.A,
      right: wasd.D,
      up: wasd.W,
      down: wasd.S,
      jump: wasd.SPACE,
      dash: wasd.SHIFT,
      attack: wasd.J,
      restart: wasd.R,
      map: wasd.M,
      arrowLeft: cursors.left,
      arrowRight: cursors.right,
      arrowUp: cursors.up,
    };
  }

  private isDown(key: Phaser.Input.Keyboard.Key, alt?: Phaser.Input.Keyboard.Key): boolean {
    return key.isDown || Boolean(alt?.isDown);
  }

  private justDown(key: Phaser.Input.Keyboard.Key, alt?: Phaser.Input.Keyboard.Key): boolean {
    return Phaser.Input.Keyboard.JustDown(key) || Boolean(alt && Phaser.Input.Keyboard.JustDown(alt));
  }

  private padState(): { x: number; jump: boolean; dash: boolean; attack: boolean; map: boolean } {
    const pad = this.input.gamepad?.getPad(0);
    if (!pad) return { x: 0, jump: false, dash: false, attack: false, map: false };
    const axis = Math.abs(pad.leftStick.x) > 0.18 ? pad.leftStick.x : 0;
    return {
      x: axis,
      jump: Boolean(pad.A),
      dash: Boolean(pad.X || pad.R1),
      attack: Boolean(pad.B || pad.Y),
      map: Boolean(pad.buttons[8]?.pressed),
    };
  }

  private updatePlayer(time: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const onGround = body.blocked.down || body.touching.down;
    if (onGround) {
      this.lastGrounded = time;
      this.extraJumps = this.abilities.doubleJump ? 1 : 0;
    }

    const pad = this.padState();
    const move = (this.isDown(this.keys.left, this.keys.arrowLeft) ? -1 : 0) + (this.isDown(this.keys.right, this.keys.arrowRight) ? 1 : 0) || Math.sign(pad.x);
    if (!this.dashing) {
      if (move !== 0) {
        this.player.setAccelerationX(move * (onGround ? 1250 : 820));
        this.facing = move;
        this.player.setFlipX(move < 0);
      } else {
        this.player.setAccelerationX(0);
      }
    }

    const keyboardJump = this.justDown(this.keys.jump) || this.justDown(this.keys.up, this.keys.arrowUp);
    const padJump = pad.jump && !this.player.getData('padJumpHeld');
    this.player.setData('padJumpHeld', pad.jump);
    if (keyboardJump || padJump) this.jumpQueuedAt = time;

    if (time - this.jumpQueuedAt < 130) {
      const coyote = time - this.lastGrounded < 125;
      if (onGround || coyote) {
        this.jumpQueuedAt = -9999;
        this.player.setVelocityY(-470);
        this.soundscape.jump();
        this.burst(this.player.x, this.player.y + 22, palette.mint, 7, 120);
      } else if (this.extraJumps > 0) {
        this.jumpQueuedAt = -9999;
        this.extraJumps--;
        this.player.setVelocityY(-445);
        this.soundscape.jump();
        this.ring(this.player.x, this.player.y, palette.pink);
      }
    }

    const dashPressed = Phaser.Input.Keyboard.JustDown(this.keys.dash) || (pad.dash && !this.player.getData('padDashHeld'));
    this.player.setData('padDashHeld', pad.dash);
    if (dashPressed) this.tryDash(time);

    const attackPressed = Phaser.Input.Keyboard.JustDown(this.keys.attack) || (pad.attack && !this.player.getData('padAttackHeld'));
    this.player.setData('padAttackHeld', pad.attack);
    if (attackPressed) this.attack();

    if (Phaser.Input.Keyboard.JustDown(this.keys.restart)) this.respawn();

    if (this.player.y > WORLD_H - 30) this.respawn();
    this.checkCheckpoint();
  }

  private tryDash(time: number): void {
    if (!this.abilities.dash) {
      this.toast('A little more courage… something bright is waiting above.');
      return;
    }
    if (time < this.dashReadyAt || this.dashing) return;
    this.dashing = true;
    this.player.play('player-dash', true);
    this.dashReadyAt = time + 620;
    this.soundscape.dash();
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.allowGravity = false;
    this.player.setAcceleration(0).setVelocity(this.facing * 650, 0);
    this.player.setTint(0xb9ffff);
    this.cameras.main.shake(90, 0.0025);
    this.burst(this.player.x, this.player.y, palette.sky, 12, 220);
    this.time.delayedCall(155, () => {
      if (!this.player.active) return;
      this.dashing = false;
      body.allowGravity = true;
      this.player.clearTint().setScale(1).setAngle(0);
      this.player.setVelocityX(this.facing * 320);
    });
  }

  private attack(): void {
    if (this.attacking) return;
    this.attacking = true;
    this.player.play('player-attack', true);
    this.soundscape.attack();
    const x = this.player.x + this.facing * 39;
    const slash = this.add.arc(x, this.player.y, 33, this.facing > 0 ? 300 : 120, this.facing > 0 ? 70 : 250, false, palette.sun, 0.62).setDepth(9);
    this.tweens.add({ targets: slash, alpha: 0, scale: 1.45, duration: 125, onComplete: () => slash.destroy() });

    const zone = this.add.zone(x, this.player.y, 64, 58);
    this.physics.add.existing(zone);
    const zoneBody = zone.body as Phaser.Physics.Arcade.Body;
    zoneBody.setAllowGravity(false);
    this.physics.add.overlap(zone, this.enemies, (_z, enemy) => this.damageEnemy(enemy as Phaser.Physics.Arcade.Sprite, 1));
    this.physics.add.overlap(zone, this.projectiles, (_z, projectile) => {
      const seed = projectile as Phaser.Physics.Arcade.Sprite;
      if (!seed.active) return;
      this.burst(seed.x, seed.y, palette.sun, 5, 75);
      seed.destroy();
      this.soundscape.collect();
    });
    this.time.delayedCall(95, () => zone.destroy());
    this.time.delayedCall(210, () => { this.attacking = false; });
  }

  private updateVisuals(time: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speedX = Math.abs(body.velocity.x);
    const speedY = body.velocity.y;
    const grounded = body.blocked.down || body.touching.down;

    this.playerGlow.setPosition(this.player.x, this.player.y - 2);
    this.playerGlow.setAlpha(this.dashing ? 0.22 : 0.07 + Math.min(speedX / 7000, 0.045));
    this.playerGlow.setFillStyle(this.dashing ? palette.sky : this.extraJumps === 0 && this.abilities.doubleJump && !grounded ? palette.pink : palette.mint, 1);

    const shadowScale = Phaser.Math.Clamp(1.05 - Math.abs(speedY) / 1250, 0.62, 1.05);
    this.playerShadow.setPosition(this.player.x, this.player.y + 31);
    this.playerShadow.setScale(shadowScale, 1);
    this.playerShadow.setAlpha(grounded ? 0.34 : 0.16);

    if (!this.wasGrounded && grounded && Math.abs(speedY) > 120) {
      this.player.setScale(1.12, 0.88);
      this.time.delayedCall(75, () => this.player.active && this.player.setScale(1));
      const color = this.player.x < 1900 ? palette.sun : this.player.x < 3650 ? palette.mint : palette.pink;
      this.burst(this.player.x, this.player.y + 26, color, 5, 72);
    }
    this.wasGrounded = grounded;

    if (!this.dashing) {
      this.player.setAngle(Phaser.Math.Clamp(body.velocity.x / 125, -4, 4));
    }

    if (this.dashing) {
      this.player.play('player-dash', true);
    } else if (this.attacking) {
      this.player.play('player-attack', true);
    } else if (time < this.invulnerableUntil - 620) {
      this.player.play('player-hurt', true);
    } else if (!grounded) {
      this.player.play(speedY < 15 ? 'player-jump' : 'player-fall', true);
    } else if (speedX > 55) {
      this.player.play('player-run', true);
    } else {
      this.player.play('player-idle', true);
    }

    if (this.dashing && time - this.lastTrailAt > 34) {
      this.lastTrailAt = time;
      const ghost = this.add.image(this.player.x - this.facing * 12, this.player.y, 'player-sheet', this.player.frame.name)
        .setFlipX(this.player.flipX)
        .setTint(0x8ff5ff)
        .setAlpha(0.30)
        .setScale(this.player.scaleX, this.player.scaleY)
        .setDepth(7);
      this.tweens.add({
        targets: ghost,
        x: ghost.x - this.facing * 34,
        alpha: 0,
        scaleX: ghost.scaleX * 0.88,
        scaleY: ghost.scaleY * 0.88,
        duration: 180,
        ease: 'Quad.out',
        onComplete: () => ghost.destroy(),
      });
    }

    if (grounded && speedX > 120 && time - this.lastDustAt > 120) {
      this.lastDustAt = time;
      const color = this.player.x < 1900 ? palette.sun : this.player.x < 3650 ? palette.mint : palette.pink;
      const puff = this.add.ellipse(this.player.x - this.facing * 15, this.player.y + 28, 16, 7, color, 0.28).setDepth(6);
      this.tweens.add({
        targets: puff,
        x: puff.x - this.facing * 19,
        y: puff.y - 7,
        scaleX: 1.65,
        alpha: 0,
        duration: 260,
        ease: 'Quad.out',
        onComplete: () => puff.destroy(),
      });
    }
  }

  private createScreenFx(): void {
    this.biomeWash = this.add.rectangle(640, 360, 1280, 720, palette.sun, 0.018)
      .setScrollFactor(0)
      .setDepth(47)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.vignette = this.add.graphics().setScrollFactor(0).setDepth(80);
    this.vignette.fillStyle(0x020611, 0.13).fillRect(0, 0, 1280, 18);
    this.vignette.fillStyle(0x020611, 0.13).fillRect(0, 702, 1280, 18);
    this.vignette.fillStyle(0x020611, 0.10).fillRect(0, 0, 22, 720);
    this.vignette.fillStyle(0x020611, 0.10).fillRect(1258, 0, 22, 720);

    const topGlow = this.add.ellipse(640, -80, 900, 260, 0xa8fff1, 0.025).setScrollFactor(0).setDepth(49);
    this.tweens.add({ targets: topGlow, alpha: 0.055, scaleX: 1.08, yoyo: true, repeat: -1, duration: 4200, ease: 'Sine.inOut' });

    for (let i = 0; i < 10; i++) {
      const petal = this.add.image(80 + i * 137, 55 + (i % 4) * 130, 'petal')
        .setScrollFactor(0)
        .setAlpha(0.045)
        .setDepth(48)
        .setAngle(i * 23);
      this.tweens.add({
        targets: petal,
        y: petal.y + 55,
        x: petal.x + (i % 2 ? 18 : -18),
        angle: petal.angle + 90,
        alpha: 0.015,
        yoyo: true,
        repeat: -1,
        duration: 5200 + i * 320,
        ease: 'Sine.inOut',
      });
    }
  }

  private updateEnemies(time: number): void {
    let bossPresented = false;
    let miniPresented = false;
    this.enemies.getChildren().forEach(child => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const kind = enemy.getData('kind') as string;

      if (kind === 'boss') {
        const bossHp = enemy.getData('hp') as number;
        let phase = enemy.getData('phase') as number;
        bossPresented = this.player.x > 4250 && bossHp > 0;
        if (bossPresented && !this.bossIntroPlayed) {
          this.bossIntroPlayed = true;
          enemy.setData('nextLeap', time + 1450);
          this.showBossIntro();
        }
        this.bossBarFill.setScale(Phaser.Math.Clamp(bossHp / 9, 0, 1), 1);

        if (bossHp <= 4 && phase === 1) {
          phase = 2;
          enemy.setData('phase', 2);
          this.bossBarFill.setFillStyle(palette.sun, 0.95);
          enemy.play('boss-rage', true);
          this.ring(enemy.x, enemy.y - 5, palette.pink);
          this.burst(enemy.x, enemy.y, palette.sun, 18, 230);
          this.cameras.main.flash(250, 190, 120, 255);
          this.toast('MOONRAGE! The Gloomkeeper finds a faster rhythm.', 2200);
        }

        const dist = this.player.x - enemy.x;
        const body = enemy.body as Phaser.Physics.Arcade.Body;
        const nextLeap = enemy.getData('nextLeap') as number;
        const grounded = body.blocked.down || body.touching.down;
        const wasAirborne = Boolean(enemy.getData('wasAirborne'));

        if (grounded && wasAirborne) {
          enemy.setData('wasAirborne', false);
          this.ring(enemy.x, enemy.y + 37, phase === 2 ? palette.sun : palette.violet);
          this.burst(enemy.x, enemy.y + 42, phase === 2 ? palette.pink : palette.violet, phase === 2 ? 15 : 10, 165);
          this.cameras.main.shake(phase === 2 ? 145 : 90, phase === 2 ? 0.005 : 0.003);
        }

        const telegraphWindow = phase === 2 ? 260 : 350;
        if (grounded && time > nextLeap - telegraphWindow && time < nextLeap && enemy.getData('telegraphFor') !== nextLeap) {
          enemy.setData('telegraphFor', nextLeap);
          enemy.play('boss-charge', true);
          this.ring(enemy.x, enemy.y + 22, phase === 2 ? palette.sun : palette.pink);
        }

        if (time > nextLeap && grounded) {
          enemy.setData('nextLeap', time + (phase === 2 ? 1080 : 1680));
          enemy.setData('wasAirborne', true);
          enemy.play('boss-leap', true);
          enemy.setVelocityY(phase === 2 ? -435 : -390);
          enemy.setVelocityX(Math.sign(dist || 1) * (phase === 2 ? 325 : 270));
          this.burst(enemy.x, enemy.y + 38, phase === 2 ? palette.pink : palette.violet, 11, 185);
        } else if (grounded && time < nextLeap - telegraphWindow) {
          enemy.play(phase === 2 ? 'boss-rage' : 'boss-idle', true);
          enemy.setVelocityX(Phaser.Math.Clamp(dist * (phase === 2 ? 0.68 : 0.5), phase === 2 ? -205 : -155, phase === 2 ? 205 : 155));
        } else if (!grounded) {
          enemy.play('boss-leap', true);
        }
        enemy.setFlipX(dist < 0);
        return;
      }

      if (kind === 'glowwing') {
        const left = enemy.getData('left') as number;
        const right = enemy.getData('right') as number;
        const homeY = enemy.getData('homeY') as number;
        let dir = enemy.getData('dir') as number;
        if (enemy.x < left) dir = 1;
        if (enemy.x > right) dir = -1;
        const close = Math.abs(this.player.x - enemy.x) < 230 && Math.abs(this.player.y - enemy.y) < 220;
        const targetY = close ? this.player.y - 25 : homeY + Math.sin(time * 0.003 + enemy.x) * 38;
        enemy.setData('dir', dir);
        enemy.setVelocity(dir * (close ? 125 : 82), Phaser.Math.Clamp((targetY - enemy.y) * 2.1, -145, 145));
        enemy.setFlipX(dir < 0);
        enemy.setAngle(Math.sin(time * 0.006 + enemy.x) * 7);
        return;
      }

      if (kind === 'thornpod') {
        enemy.setVelocity(0);
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
        const nextShot = enemy.getData('nextShot') as number;
        enemy.setFlipX(this.player.x < enemy.x);
        if (dist < 520 && time > nextShot) {
          enemy.setData('nextShot', time + 1750);
          enemy.setTint(0xdff28b);
          this.time.delayedCall(120, () => enemy.active && enemy.clearTint());
          this.fireSeed(enemy);
        }
        return;
      }

      if (kind === 'miniboss') {
        const hp = enemy.getData('hp') as number;
        const distanceToPlayer = Math.abs(this.player.x - enemy.x);
        miniPresented = distanceToPlayer < 470 && hp > 0;
        this.miniBarFill.setScale(Phaser.Math.Clamp(hp / 7, 0, 1), 1);
        if (miniPresented && !this.miniIntroPlayed) {
          this.miniIntroPlayed = true;
          enemy.setData('nextCharge', time + 1150);
          this.showMiniBossIntro();
        }
        let dir = enemy.getData('dir') as number;
        const left = enemy.getData('left') as number;
        const right = enemy.getData('right') as number;
        if (enemy.x < left) dir = 1;
        if (enemy.x > right) dir = -1;
        const nextCharge = enemy.getData('nextCharge') as number;
        const body = enemy.body as Phaser.Physics.Arcade.Body;
        const grounded = body.blocked.down || body.touching.down;
        if (grounded && time > nextCharge) {
          dir = Math.sign(this.player.x - enemy.x) || dir;
          enemy.setData('nextCharge', time + (hp <= 3 ? 1150 : 1650));
          enemy.setVelocityX(dir * (hp <= 3 ? 330 : 255));
          enemy.setVelocityY(-250);
          this.ring(enemy.x, enemy.y + 30, palette.lime);
          this.burst(enemy.x, enemy.y + 34, palette.mint, 9, 130);
        } else if (grounded) {
          enemy.setVelocityX(dir * (hp <= 3 ? 95 : 68));
        }
        enemy.setData('dir', dir).setFlipX(dir < 0);
        enemy.setAngle(Math.sin(time * 0.005) * 2);
        return;
      }

      // Default slime patrol.
      enemy.play('slime-bounce', true);
      let dir = enemy.getData('dir') as number;
      const left = enemy.getData('left') as number;
      const right = enemy.getData('right') as number;
      if (enemy.x < left) dir = 1;
      if (enemy.x > right) dir = -1;
      enemy.setData('dir', dir).setVelocityX(dir * 68).setFlipX(dir < 0);
    });
    this.bossBarGroup.setAlpha(bossPresented ? 1 : 0);
    this.miniBarGroup.setAlpha(miniPresented && !bossPresented ? 1 : 0);
  }

  private damageEnemy(enemy: Phaser.Physics.Arcade.Sprite, amount: number): void {
    if (!enemy.active) return;
    const lastHit = enemy.getData('lastHit') as number | undefined;
    if (lastHit && this.time.now - lastHit < 150) return;
    enemy.setData('lastHit', this.time.now);
    const hp = (enemy.getData('hp') as number) - amount;
    enemy.setData('hp', hp);
    if (enemy.getData('kind') === 'boss') enemy.play('boss-hurt', true);
    enemy.setTintFill(0xffffff);
    this.time.delayedCall(70, () => enemy.active && enemy.clearTint());
    enemy.setVelocityX(this.facing * 220);
    this.burst(enemy.x, enemy.y, enemy.getData('kind') === 'boss' ? palette.pink : palette.sky, 8, 160);
    this.cameras.main.shake(65, 0.0025);
    if (hp <= 0) {
      const kind = enemy.getData('kind') as string;
      const boss = kind === 'boss';
      const miniboss = kind === 'miniboss';
      this.burst(enemy.x, enemy.y, boss ? palette.sun : miniboss ? palette.pink : palette.mint, boss ? 26 : miniboss ? 20 : 12, boss ? 300 : miniboss ? 240 : 190);
      const deathX = enemy.x;
      const deathY = enemy.y;
      enemy.disableBody(true, true);
      if (boss) {
        this.bossDefeated = true;
        this.soundscape.victory();
        this.toast('The Gloomkeeper remembers how to smile. The Heart Shrine is awake!', 3600);
        this.cameras.main.flash(500, 255, 210, 107);
        this.save();
      } else if (miniboss) {
        this.minibossDefeated = true;
        this.soundscape.unlockAbility();
        this.cameras.main.flash(320, 130, 255, 175);
        this.toast('BRAMBLEHEART BLOOMS! A memory petal drifts free.', 3000);
        this.spawnMemoryPetal('brambleheart', deathX, deathY - 36);
        this.save();
      }
    }
  }

  private damagePlayer(amount: number, sourceX = this.player.x): void {
    if (this.time.now < this.invulnerableUntil || this.dashing || this.won) return;
    this.invulnerableUntil = this.time.now + 900;
    this.health -= amount;
    this.player.play('player-hurt', true);
    this.soundscape.hit();
    this.player.setVelocity((this.player.x - sourceX >= 0 ? 1 : -1) * 260, -290);
    this.player.setTintFill(0xffd2d8);
    this.cameras.main.shake(180, 0.007);
    this.updateHud();
    this.tweens.add({ targets: this.player, alpha: 0.35, yoyo: true, repeat: 5, duration: 75, onComplete: () => { this.player.setAlpha(1); this.player.clearTint(); } });
    if (this.health <= 0) this.time.delayedCall(260, () => this.respawn());
  }

  private respawn(): void {
    this.health = this.maxHealth;
    this.dashing = false;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.allowGravity = true;
    this.player.clearTint().setAlpha(1).setScale(1).setAngle(0).setVelocity(0).setPosition(this.checkpoint.x, this.checkpoint.y);
    this.player.play('player-idle', true);
    this.cameras.main.fadeOut(120, 8, 18, 38);
    this.time.delayedCall(130, () => this.cameras.main.fadeIn(330, 8, 18, 38));
    this.updateHud();
    this.toast('Back on your feet. The wild is cheering for you.');
  }

  private collectPickup(pickup: Phaser.Physics.Arcade.Sprite): void {
    if (!pickup.active) return;
    const type = pickup.getData('type') as string;
    const glow = pickup.getData('glow') as Phaser.GameObjects.Arc | undefined;
    if (glow) {
      this.tweens.killTweensOf(glow);
      glow.destroy();
    }
    pickup.disableBody(true, true);
    this.soundscape.collect();
    this.burst(pickup.x, pickup.y, type === 'dash' ? palette.sky : type === 'doubleJump' ? palette.pink : palette.sun, 14, 210);
    if (type === 'shard') {
      this.shards++;
      this.toast(this.shards % 5 === 0 ? `Joy shard ×${this.shards} — the world feels brighter.` : `Joy shard ×${this.shards}`, 1200);
    } else if (type === 'memoryPetal') {
      const id = pickup.getData('id') as string;
      this.memoryPetals.add(id);
      this.cameras.main.flash(260, 255, 155, 215);
      if (this.memoryPetals.size >= 4 && this.maxHealth < 6) {
        this.maxHealth = 6;
        this.health = 6;
        this.soundscape.unlockAbility();
        this.ring(this.player.x, this.player.y, palette.sun);
        this.toast('HEART BLOOM! Four memories resonate — maximum health increased.', 3600);
      } else {
        this.toast(`MEMORY PETAL ${this.memoryPetals.size}/4 — a hidden piece of Lumenwild remembers you.`, 2600);
      }
    } else if (type === 'dash') {
      this.abilities.dash = true;
      this.soundscape.unlockAbility();
      this.cameras.main.flash(480, 100, 230, 255);
      this.toast('SKY DASH BLOOMED!  Shift / X / RB to burst forward.', 3400);
    } else if (type === 'doubleJump') {
      this.abilities.doubleJump = true;
      this.extraJumps = 1;
      this.soundscape.unlockAbility();
      this.cameras.main.flash(480, 255, 126, 182);
      this.toast('PETAL LEAP BLOOMED!  Jump again in mid-air.', 3400);
    }
    this.updateHud();
    this.save();
  }

  private checkCheckpoint(): void {
    const bells = [
      { x: 1080, y: 810, name: 'Sunbell' },
      { x: 2820, y: 696, name: 'Mossbell' },
      { x: 4230, y: 530, name: 'Moonbell' },
    ];
    for (const bell of bells) {
      if (Math.abs(this.player.x - bell.x) < 46 && Math.abs(this.player.y - bell.y) < 120 && this.checkpoint.x !== bell.x) {
        this.checkpoint.set(bell.x, bell.y);
        this.health = this.maxHealth;
        this.updateHud();
        this.soundscape.collect();
        this.ring(bell.x, bell.y - 50, palette.mint);
        this.toast(`${bell.name} rings — checkpoint restored.`);
      }
    }
  }

  private checkBreakables(): void {
    if (!this.dashing) return;
    this.breakables.getChildren().forEach(child => {
      const wall = child as Phaser.Physics.Arcade.Sprite;
      if (!wall.active) return;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, wall.x, wall.y) < 105) {
        this.burst(wall.x, wall.y, palette.violet, 22, 300);
        wall.disableBody(true, true);
        this.cameras.main.shake(220, 0.009);
        const secretId = wall.getData('secretId') as string | undefined;
        this.toast(
          wall.getData('gate')
            ? 'Crystal gate shattered — the Moss Grotto is open!'
            : secretId
              ? 'A secret alcove opens — something remembers you inside.'
              : 'A hidden canopy path opens!',
        );
      }
    });
  }

  private checkShrine(): void {
    if (this.player.x < 5140 || this.player.y > 760 || this.won) return;
    if (!this.bossDefeated) {
      this.toast('The Heart Shrine is sleeping. A lonely guardian still waits below.');
      return;
    }
    this.winGame();
  }

  private winGame(): void {
    this.won = true;
    this.soundscape.victory();
    this.player.setVelocity(0);
    this.cameras.main.flash(900, 255, 229, 160);
    const panel = this.add.rectangle(640, 360, 720, 390, 0x071326, 0.9).setScrollFactor(0).setDepth(100).setStrokeStyle(3, palette.sun, 0.65);
    const title = this.add.text(640, 265, 'THE WILD IS GLOWING AGAIN', { fontFamily: 'system-ui, sans-serif', fontSize: '42px', fontStyle: '900', color: '#fff3b0', align: 'center' }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    const body = this.add.text(640, 350, `You found ${this.shards} joy shards, recovered ${this.memoryPetals.size}/4 memory petals, and taught the Gloomkeeper a brighter rhythm.\n\nLumenwild is a small world, but it remembers every brave little jump.`, { fontFamily: 'system-ui, sans-serif', fontSize: '21px', color: '#dffcff', align: 'center', lineSpacing: 8, wordWrap: { width: 590 } }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    const hint = this.add.text(640, 485, 'Press R to wander again', { fontFamily: 'system-ui, sans-serif', fontSize: '17px', color: '#9fe7c7' }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    this.tweens.add({ targets: [panel, title, body, hint], alpha: { from: 0, to: 1 }, y: '-=16', duration: 700, ease: 'Cubic.out' });
    this.input.keyboard?.on('keydown-R', () => this.scene.restart());
  }

  private createHud(): void {
    const leftPanel = this.add.rectangle(22, 20, 292, 92, 0x061224, 0.78)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(50)
      .setStrokeStyle(2, 0x8df2cf, 0.20);
    this.add.rectangle(34, 31, 5, 68, palette.mint, 0.5).setOrigin(0).setScrollFactor(0).setDepth(51);
    this.add.circle(62, 55, 17, palette.pink, 0.11).setScrollFactor(0).setDepth(51);
    this.add.circle(62, 55, 7, palette.pink, 0.5).setScrollFactor(0).setDepth(52);

    this.heartText = this.add.text(87, 39, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '24px',
      fontStyle: '800',
      color: '#ff8fb0',
      stroke: '#36152b',
      strokeThickness: 3,
    }).setScrollFactor(0).setDepth(52);

    this.shardText = this.add.text(51, 77, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      fontStyle: '800',
      color: '#ffe995',
      letterSpacing: 0.5,
    }).setScrollFactor(0).setDepth(52);

    this.abilityText = this.add.text(328, 27, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      fontStyle: '800',
      color: '#d8f8ff',
      backgroundColor: '#061224cc',
      padding: { x: 15, y: 11 },
    }).setScrollFactor(0).setDepth(51);

    this.areaText = this.add.text(1238, 27, 'SUNMEADOW', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '17px',
      fontStyle: '900',
      color: '#efffff',
      stroke: '#061224',
      strokeThickness: 4,
      letterSpacing: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);

    this.objectiveText = this.add.text(1238, 58, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontStyle: '600',
      color: '#addce0',
      align: 'right',
      backgroundColor: '#06122499',
      padding: { x: 9, y: 6 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);

    this.toastText = this.add.text(640, 642, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      fontStyle: '800',
      color: '#f7fbff',
      backgroundColor: '#061224e6',
      padding: { x: 20, y: 12 },
      align: 'center',
      stroke: '#061224',
      strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(70).setAlpha(0);

    const bossPlate = this.add.rectangle(640, 681, 552, 46, 0x070d20, 0.82)
      .setStrokeStyle(2, palette.pink, 0.24)
      .setScrollFactor(0);
    const bossLabel = this.add.text(640, 665, 'GLOOMKEEPER  •  KEEPER OF THE CANOPY', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      fontStyle: '900',
      color: '#f4ddff',
      letterSpacing: 1.8,
    }).setOrigin(0.5).setScrollFactor(0);
    const bossTrack = this.add.rectangle(382, 688, 516, 9, 0x211a48, 0.9).setOrigin(0, 0.5).setScrollFactor(0);
    this.bossBarFill = this.add.rectangle(382, 688, 516, 9, palette.pink, 0.9).setOrigin(0, 0.5).setScrollFactor(0);
    const bossShine = this.add.rectangle(382, 686, 516, 2, 0xffd4e9, 0.55).setOrigin(0, 0.5).setScrollFactor(0);
    this.bossBarGroup = this.add.container(0, 0, [bossPlate, bossLabel, bossTrack, this.bossBarFill, bossShine])
      .setScrollFactor(0)
      .setDepth(68)
      .setAlpha(0);

    const miniPlate = this.add.rectangle(640, 681, 470, 42, 0x071810, 0.84)
      .setStrokeStyle(2, palette.lime, 0.24)
      .setScrollFactor(0);
    const miniLabel = this.add.text(640, 665, 'BRAMBLEHEART  •  ROOTBOUND DREAMER', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      fontStyle: '900',
      color: '#e8ffd0',
      letterSpacing: 1.7,
    }).setOrigin(0.5).setScrollFactor(0);
    const miniTrack = this.add.rectangle(420, 688, 440, 8, 0x173320, 0.9).setOrigin(0, 0.5).setScrollFactor(0);
    this.miniBarFill = this.add.rectangle(420, 688, 440, 8, palette.lime, 0.9).setOrigin(0, 0.5).setScrollFactor(0);
    const miniShine = this.add.rectangle(420, 686, 440, 2, 0xecffd2, 0.45).setOrigin(0, 0.5).setScrollFactor(0);
    this.miniBarGroup = this.add.container(0, 0, [miniPlate, miniLabel, miniTrack, this.miniBarFill, miniShine])
      .setScrollFactor(0)
      .setDepth(67)
      .setAlpha(0);

    leftPanel.setScrollFactor(0);
    this.updateHud();
  }

  private createMapOverlay(): void {
    const shade = this.add.rectangle(640, 360, 1280, 720, 0x020713, 0.86);
    const panel = this.add.rectangle(640, 350, 760, 500, 0x071326, 0.97)
      .setStrokeStyle(2, palette.mint, 0.28);
    const title = this.add.text(640, 128, 'LUMENWILD FIELD MAP', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '24px',
      fontStyle: '900',
      color: '#efffff',
      letterSpacing: 3,
    }).setOrigin(0.5);

    const route = this.add.graphics();
    route.lineStyle(6, 0x7ab7a7, 0.24);
    route.beginPath();
    route.moveTo(350, 350);
    route.lineTo(525, 318);
    route.lineTo(690, 382);
    route.lineTo(860, 298);
    route.lineTo(945, 350);
    route.strokePath();

    const regions = [
      { x: 405, y: 350, w: 180, h: 112, color: palette.sun, name: 'SUNMEADOW' },
      { x: 640, y: 350, w: 205, h: 145, color: palette.mint, name: 'MOSS GROTTO' },
      { x: 875, y: 350, w: 200, h: 125, color: palette.violet, name: 'TWILIGHT CANOPY' },
    ];
    const regionObjects: Phaser.GameObjects.GameObject[] = [];
    for (const region of regions) {
      const rect = this.add.rectangle(region.x, region.y, region.w, region.h, region.color, 0.075)
        .setStrokeStyle(2, region.color, 0.34);
      const label = this.add.text(region.x, region.y + region.h * 0.36, region.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        fontStyle: '900',
        color: '#dffcff',
        letterSpacing: 1.3,
      }).setOrigin(0.5);
      regionObjects.push(rect, label);
    }

    const symbols: Phaser.GameObjects.GameObject[] = [];
    const symbolData = [
      [420, 334, palette.mint, '◉'],
      [640, 340, palette.mint, '◉'],
      [825, 320, palette.mint, '◉'],
      [490, 292, palette.sky, '↠'],
      [720, 286, palette.pink, '✦'],
      [900, 372, palette.danger, '◆'],
      [930, 302, palette.sun, '△'],
    ] as const;
    for (const [x, y, color, glyph] of symbolData) {
      const dot = this.add.circle(x, y, 13, color, 0.12).setStrokeStyle(1, color, 0.4);
      const text = this.add.text(x, y, glyph, { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: '900', color: '#f7fbff' }).setOrigin(0.5);
      symbols.push(dot, text);
    }

    const legend = this.add.text(640, 493,
      '◉ CHECKPOINT     ↠ DASH BLOOM     ✦ PETAL LEAP     ◆ GUARDIAN     △ HEART SHRINE\n' +
      '❀ Memory petals hide behind breakable crystal alcoves.  Springcaps launch you upward.',
      {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#badfe0',
        align: 'center',
        lineSpacing: 10,
      }).setOrigin(0.5);

    this.mapStatusText = this.add.text(640, 550, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      fontStyle: '800',
      color: '#ffe8a0',
      align: 'center',
    }).setOrigin(0.5);

    const hint = this.add.text(640, 590, 'M / SELECT  •  close map', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      fontStyle: '800',
      color: '#9fdcca',
      letterSpacing: 1.5,
    }).setOrigin(0.5);

    this.mapMarker = this.add.circle(350, 350, 8, palette.white, 0.9)
      .setStrokeStyle(3, palette.pink, 0.75);

    this.mapOverlay = this.add.container(0, 0, [
      shade, panel, title, route, ...regionObjects, ...symbols, legend, this.mapStatusText, hint, this.mapMarker,
    ]).setScrollFactor(0).setDepth(95).setVisible(false);
  }

  private toggleMap(): void {
    this.mapOpen = !this.mapOpen;
    this.mapOverlay.setVisible(this.mapOpen);
    if (this.mapOpen) {
      this.player.setAccelerationX(0).setVelocityX(0);
      this.physics.world.pause();
      this.updateMapMarker();
      this.cameras.main.shake(60, 0.001);
    } else {
      this.physics.world.resume();
    }
  }

  private updateMapMarker(): void {
    const mapX = 345 + Phaser.Math.Clamp(this.player.x / WORLD_W, 0, 1) * 600;
    const elevation = Phaser.Math.Clamp((GROUND_Y - this.player.y) / 580, -0.1, 1);
    const mapY = 382 - elevation * 115;
    this.mapMarker.setPosition(mapX, mapY);
    this.mapStatusText.setText(
      `${this.biome || 'SUNMEADOW'}   •   ${this.memoryPetals.size}/4 MEMORY PETALS   •   ` +
      `${this.minibossDefeated ? 'BRAMBLEHEART BLOOMED' : 'BRAMBLEHEART STIRS'}   •   ` +
      `${this.memoryPetals.size >= 4 ? 'HEART BLOOM AWAKENED' : 'HEART BLOOM DORMANT'}   •   ` +
      `${this.bossDefeated ? 'GLOOMKEEPER RESTORED' : 'CANOPY GUARDIAN AWAITS'}`,
    );
  }

  private updateHud(): void {
    this.heartText.setText(`${'♥'.repeat(Math.max(0, this.health))}${'·'.repeat(Math.max(0, this.maxHealth - this.health))}`);
    this.shardText.setText(`✦  ${this.shards} SHARDS     ❀  ${this.memoryPetals.size}/4 MEMORIES`);
    const dash = this.abilities.dash ? '↠ SHIFT  SKY DASH' : '◇ DASH DORMANT';
    const jump = this.abilities.doubleJump ? '✦ SPACE×2  PETAL LEAP' : '◇ LEAP DORMANT';
    this.abilityText.setText(`${dash}     ${jump}     ⚔ J  SWIPE     M  MAP`);
  }

  private updateBiome(): void {
    const x = this.player.x;
    const next = x < 1900 ? 'SUNMEADOW' : x < 3650 ? 'MOSS GROTTO' : 'TWILIGHT CANOPY';
    if (next === this.biome) return;
    this.biome = next;
    if (!this.visitedBiomes.has(next)) {
      this.visitedBiomes.add(next);
      this.save();
    }
    const wash = next === 'SUNMEADOW' ? palette.sun : next === 'MOSS GROTTO' ? palette.mint : palette.violet;
    this.biomeWash.setFillStyle(wash, 1).setAlpha(0);
    this.tweens.add({ targets: this.biomeWash, alpha: next === 'TWILIGHT CANOPY' ? 0.035 : 0.022, duration: 900, ease: 'Sine.out' });
    this.areaText.setText(next).setAlpha(0);
    this.tweens.add({ targets: this.areaText, alpha: 1, duration: 600 });
    this.showAreaCard(next);
  }

  private showAreaCard(name: string): void {
    const subtitle = name === 'SUNMEADOW'
      ? 'where every small step catches light'
      : name === 'MOSS GROTTO'
        ? 'old roots, soft echoes, hidden bloom'
        : 'moonlit branches above the sleeping wild';

    const line = this.add.rectangle(640, 198, 230, 2, palette.mint, 0.34)
      .setScrollFactor(0)
      .setDepth(64)
      .setScale(0.2, 1)
      .setAlpha(0);
    const title = this.add.text(640, 222, name, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '30px',
      fontStyle: '900',
      color: '#f5fff9',
      stroke: '#061224',
      strokeThickness: 6,
      letterSpacing: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(65).setAlpha(0);
    const sub = this.add.text(640, 260, subtitle.toUpperCase(), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      fontStyle: '800',
      color: name === 'SUNMEADOW' ? '#ffe8a0' : name === 'MOSS GROTTO' ? '#aef5d9' : '#d9c9ff',
      letterSpacing: 2.5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(65).setAlpha(0);

    this.tweens.add({
      targets: line,
      alpha: { from: 0, to: 1 },
      scaleX: 1,
      duration: 420,
      ease: 'Cubic.out',
      hold: 1150,
      yoyo: true,
      onComplete: () => line.destroy(),
    });
    this.tweens.add({
      targets: [title, sub],
      alpha: { from: 0, to: 1 },
      y: '-=8',
      duration: 420,
      ease: 'Cubic.out',
      hold: 1050,
      yoyo: true,
      onComplete: () => { title.destroy(); sub.destroy(); },
    });
  }

  private showMiniBossIntro(): void {
    const wash = this.add.rectangle(640, 360, 1280, 720, 0x17391f, 0)
      .setScrollFactor(0)
      .setDepth(62);
    const eyebrow = this.add.text(640, 262, 'A ROOTBOUND SONG WAKES', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      fontStyle: '900',
      color: '#c9ffa4',
      letterSpacing: 3.2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(66).setAlpha(0);
    const name = this.add.text(640, 305, 'BRAMBLEHEART', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '35px',
      fontStyle: '900',
      color: '#f2ffd8',
      stroke: '#10251a',
      strokeThickness: 7,
      letterSpacing: 2.5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(66).setAlpha(0);
    const hint = this.add.text(640, 347, 'Its bloom hides a memory petal', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      fontStyle: '800',
      color: '#b9e9c2',
      letterSpacing: 1.5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(66).setAlpha(0);

    this.tweens.add({ targets: wash, alpha: 0.10, duration: 240, hold: 520, yoyo: true, onComplete: () => wash.destroy() });
    this.tweens.add({
      targets: [eyebrow, name, hint],
      alpha: { from: 0, to: 1 },
      y: '-=8',
      duration: 300,
      ease: 'Cubic.out',
      hold: 620,
      yoyo: true,
      onComplete: () => { eyebrow.destroy(); name.destroy(); hint.destroy(); },
    });
    this.cameras.main.shake(110, 0.0018);
  }

  private showBossIntro(): void {
    const wash = this.add.rectangle(640, 360, 1280, 720, 0x2a164d, 0)
      .setScrollFactor(0)
      .setDepth(62);
    const eyebrow = this.add.text(640, 245, 'THE CANOPY STIRS', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      fontStyle: '900',
      color: '#ffb7da',
      letterSpacing: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(66).setAlpha(0);
    const name = this.add.text(640, 293, 'GLOOMKEEPER', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '45px',
      fontStyle: '900',
      color: '#fff1b8',
      stroke: '#1b1037',
      strokeThickness: 8,
      letterSpacing: 3,
      shadow: { offsetX: 0, offsetY: 8, color: '#000000', blur: 14, fill: true },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(66).setAlpha(0);
    const role = this.add.text(640, 342, 'KEEPER OF THE TWILIGHT RHYTHM', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      fontStyle: '800',
      color: '#d9c9ff',
      letterSpacing: 2.8,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(66).setAlpha(0);

    this.cameras.main.zoomTo(1.055, 420, 'Sine.easeOut');
    this.tweens.add({
      targets: wash,
      alpha: 0.12,
      duration: 300,
      yoyo: true,
      hold: 650,
      onComplete: () => wash.destroy(),
    });
    this.tweens.add({
      targets: [eyebrow, name, role],
      alpha: { from: 0, to: 1 },
      y: '-=10',
      duration: 360,
      ease: 'Cubic.out',
      hold: 700,
      yoyo: true,
      onComplete: () => {
        eyebrow.destroy();
        name.destroy();
        role.destroy();
        this.cameras.main.zoomTo(1, 520, 'Sine.easeInOut');
      },
    });
    this.cameras.main.shake(180, 0.002);
  }

  private updateObjective(): void {
    let text = 'Climb toward the bright pulse above →';
    if (this.abilities.dash && this.player.x < 2050) text = 'Dash through the crystal gate →';
    else if (this.abilities.dash && !this.abilities.doubleJump) text = 'Find the pink pulse in the grotto →';
    else if (this.abilities.doubleJump && !this.bossDefeated) text = 'Rise into the canopy and meet its guardian →';
    else if (this.bossDefeated) text = 'Carry the joy to the Heart Shrine →';
    if (this.memoryPetals.size < 4 && this.abilities.dash) text += `   ❀ ${this.memoryPetals.size}/4 hidden memories`;
    this.objectiveText.setText(text);
  }

  private toast(message: string, duration = 2200): void {
    this.toastText.setText(message);
    this.tweens.killTweensOf(this.toastText);
    this.toastText.setAlpha(0).setY(650);
    this.tweens.add({ targets: this.toastText, alpha: 1, y: 628, duration: 220, ease: 'Cubic.out', hold: duration, yoyo: true });
  }

  private burst(x: number, y: number, color: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = speed * (0.45 + Math.random() * 0.55);
      const dot = this.add.circle(x, y, 2 + Math.random() * 4, color, 0.9).setDepth(20);
      this.tweens.add({ targets: dot, x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist, alpha: 0, scale: 0.2, duration: 320 + Math.random() * 340, ease: 'Quad.out', onComplete: () => dot.destroy() });
    }
  }

  private ring(x: number, y: number, color: number): void {
    const ring = this.add.circle(x, y, 18, color, 0).setStrokeStyle(4, color, 0.75).setDepth(18);
    this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 360, ease: 'Cubic.out', onComplete: () => ring.destroy() });
  }

  private showTitleCard(): void {
    const shade = this.add.rectangle(640, 360, 1280, 720, 0x030a17, 0.73).setScrollFactor(0).setDepth(90);
    const glowOuter = this.add.circle(640, 292, 205, palette.mint, 0.035).setScrollFactor(0).setDepth(91);
    const glow = this.add.circle(640, 292, 145, palette.mint, 0.075).setScrollFactor(0).setDepth(91);
    const moon = this.add.circle(640, 245, 82, 0xf2ffd8, 0.055).setScrollFactor(0).setDepth(91).setStrokeStyle(2, 0xe9ffc8, 0.10);

    const rays: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < 16; i++) {
      const ray = this.add.rectangle(640, 292, 4, 110, i % 2 ? palette.sun : palette.mint, 0.09)
        .setOrigin(0.5, 1)
        .setRotation((Math.PI * 2 * i) / 16)
        .setScrollFactor(0)
        .setDepth(91);
      rays.push(ray);
    }

    const title = this.add.text(640, 254, 'LUMENWILD', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '78px',
      fontStyle: '900',
      color: '#f6ffcf',
      stroke: '#0b223c',
      strokeThickness: 9,
      letterSpacing: 3,
      shadow: { offsetX: 0, offsetY: 8, color: '#000000', blur: 16, fill: true },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(93);

    const sub = this.add.text(640, 326, 'A JOYFUL LITTLE METROIDVANIA', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      fontStyle: '800',
      color: '#b7f4df',
      letterSpacing: 5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(93);

    const divider = this.add.rectangle(640, 372, 350, 2, palette.mint, 0.18).setScrollFactor(0).setDepth(92);
    const controls = this.add.text(640, 421, 'MOVE  A D / ← →     JUMP  Space     ATTACK  J     MAP  M\nAbilities bloom as you explore  •  Gamepad supported', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '17px',
      color: '#dbefff',
      align: 'center',
      lineSpacing: 12,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(93);

    const startPlate = this.add.rectangle(640, 515, 334, 48, 0x0b2035, 0.82)
      .setStrokeStyle(2, palette.sun, 0.24)
      .setScrollFactor(0)
      .setDepth(92);
    const start = this.add.text(640, 515, 'PRESS ANY KEY OR CLICK TO BLOOM', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      fontStyle: '900',
      color: '#ffe796',
      letterSpacing: 1.4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(93);

    this.titleCard = this.add.container(0, 0, [shade, glowOuter, glow, moon, ...rays, title, sub, divider, controls, startPlate, start]).setDepth(90);
    this.tweens.add({ targets: glowOuter, scale: 1.18, alpha: 0.065, yoyo: true, repeat: -1, duration: 2600, ease: 'Sine.inOut' });
    this.tweens.add({ targets: glow, scale: 1.08, alpha: 0.11, yoyo: true, repeat: -1, duration: 1900, ease: 'Sine.inOut' });
    this.tweens.add({ targets: rays, angle: '+=360', duration: 26000, repeat: -1 });
    this.tweens.add({ targets: startPlate, scaleX: 1.035, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.inOut' });
    this.tweens.add({ targets: start, alpha: 0.48, yoyo: true, repeat: -1, duration: 900 });
  }

  private beginAdventure(): void {
    if (this.started) return;
    this.started = true;
    this.soundscape.unlock();
    this.physics.world.resume();
    this.tweens.add({ targets: this.titleCard, alpha: 0, duration: 420, ease: 'Cubic.out', onComplete: () => this.titleCard.destroy(true) });
    this.toast('Welcome, little light. Follow what glows.');
  }

  private loadSave(): void {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as SaveState | null;
      if (parsed) {
        this.abilities = { dash: Boolean(parsed.abilities?.dash), doubleJump: Boolean(parsed.abilities?.doubleJump) };
        this.shards = Number.isFinite(parsed.shards) ? parsed.shards : 0;
        this.bossDefeated = Boolean(parsed.bossDefeated);
        this.memoryPetals = new Set(Array.isArray(parsed.petals) ? parsed.petals : []);
        this.minibossDefeated = Boolean(parsed.minibossDefeated);
        this.visitedBiomes = new Set(Array.isArray(parsed.visitedBiomes) ? parsed.visitedBiomes : []);
        if (this.memoryPetals.size >= 4) {
          this.maxHealth = 6;
          this.health = 6;
        }
      }
    } catch {
      localStorage.removeItem(SAVE_KEY);
    }
  }

  private save(): void {
    const state: SaveState = {
      abilities: this.abilities,
      shards: this.shards,
      bossDefeated: this.bossDefeated,
      petals: [...this.memoryPetals],
      minibossDefeated: this.minibossDefeated,
      visitedBiomes: [...this.visitedBiomes],
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#081326',
  pixelArt: false,
  antialias: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 1150 },
      debug: false,
    },
  },
  input: { gamepad: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  scene: [LumenwildScene],
};

new Phaser.Game(config);
