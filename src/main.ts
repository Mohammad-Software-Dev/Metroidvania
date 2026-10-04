import Phaser from 'phaser';
import './style.css';

type AbilityState = { dash: boolean; doubleJump: boolean };
type SaveState = { abilities: AbilityState; shards: number; bossDefeated: boolean };

type ControlKeys = {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  jump: Phaser.Input.Keyboard.Key;
  dash: Phaser.Input.Keyboard.Key;
  attack: Phaser.Input.Keyboard.Key;
  restart: Phaser.Input.Keyboard.Key;
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
  private keys!: ControlKeys;
  private soundscape = new Soundscape();
  private abilities: AbilityState = { dash: false, doubleJump: false };
  private health = 5;
  private maxHealth = 5;
  private shards = 0;
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
  private vignette!: Phaser.GameObjects.Graphics;

  constructor() { super('lumenwild'); }

  create(): void {
    this.loadSave();
    this.createTextures();
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#081326');

    this.createBackdrop();
    this.createWorld();
    this.createPlayer();
    this.createEnemies();
    this.createPickups();
    this.createHud();
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
    this.updatePlayer(time);
    this.updateVisuals(time);
    this.updateEnemies(time);
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
    p.setDisplaySize(w, h).refreshBody();
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
    this.player = this.physics.add.sprite(this.checkpoint.x, this.checkpoint.y, 'player');
    this.player.setDepth(8).setBounce(0.02).setCollideWorldBounds(true);
    this.player.setSize(31, 50).setOffset(14, 10);
    this.player.setMaxVelocity(470, 900);
    this.player.setDragX(1700);
    this.tweens.add({ targets: this.playerGlow, scale: 1.14, alpha: 0.055, yoyo: true, repeat: -1, duration: 1250, ease: 'Sine.inOut' });
  }

  private createEnemies(): void {
    this.enemies = this.physics.add.group({ collideWorldBounds: true });
    const spawnSlime = (x: number, y: number, left: number, right: number) => {
      const e = this.enemies.create(x, y, 'slime') as Phaser.Physics.Arcade.Sprite;
      e.setDepth(7).setSize(38, 26).setBounce(0.1).setDataEnabled();
      e.setData('hp', 2).setData('kind', 'slime').setData('left', left).setData('right', right).setData('dir', 1);
    };
    spawnSlime(780, 860, 620, 870);
    spawnSlime(1510, 730, 1380, 1600);
    spawnSlime(2230, 860, 2070, 2300);
    spawnSlime(2770, 690, 2670, 2860);
    spawnSlime(3340, 630, 3240, 3420);
    spawnSlime(3920, 670, 3830, 3970);

    if (!this.bossDefeated) {
      const boss = this.enemies.create(4650, 840, 'boss') as Phaser.Physics.Arcade.Sprite;
      boss.setDepth(7).setSize(88, 72).setBounce(0.5).setDataEnabled();
      boss.setData('hp', 9).setData('kind', 'boss').setData('dir', -1).setData('nextLeap', 0);
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
      const s = this.pickups.create(x, y, 'shard') as Phaser.Physics.Arcade.Sprite;
      s.setData('type', 'shard').setData('index', i).setDepth(6);
      this.tweens.add({ targets: s, y: y - 12, angle: 8, yoyo: true, repeat: -1, duration: 1000 + (i % 4) * 130, ease: 'Sine.inOut' });
    });

    if (!this.abilities.dash) {
      const dash = this.pickups.create(1590, 505, 'dash-orb') as Phaser.Physics.Arcade.Sprite;
      dash.setData('type', 'dash').setDepth(6);
      this.tweens.add({ targets: dash, scale: 1.12, angle: 12, yoyo: true, repeat: -1, duration: 1200, ease: 'Sine.inOut' });
    }
    if (!this.abilities.doubleJump) {
      const jump = this.pickups.create(3410, 395, 'jump-orb') as Phaser.Physics.Arcade.Sprite;
      jump.setData('type', 'doubleJump').setDepth(6);
      this.tweens.add({ targets: jump, scale: 1.12, angle: -12, yoyo: true, repeat: -1, duration: 1250, ease: 'Sine.inOut' });
    }
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
  }

  private setupControls(): void {
    const keyboard = this.input.keyboard!;
    const cursors = keyboard.createCursorKeys();
    const wasd = keyboard.addKeys('W,A,S,D,SPACE,SHIFT,J,R') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys = {
      left: wasd.A,
      right: wasd.D,
      up: wasd.W,
      down: wasd.S,
      jump: wasd.SPACE,
      dash: wasd.SHIFT,
      attack: wasd.J,
      restart: wasd.R,
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

  private padState(): { x: number; jump: boolean; dash: boolean; attack: boolean } {
    const pad = this.input.gamepad?.getPad(0);
    if (!pad) return { x: 0, jump: false, dash: false, attack: false };
    const axis = Math.abs(pad.leftStick.x) > 0.18 ? pad.leftStick.x : 0;
    return {
      x: axis,
      jump: Boolean(pad.A),
      dash: Boolean(pad.X || pad.R1),
      attack: Boolean(pad.B || pad.Y),
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
    this.soundscape.attack();
    const x = this.player.x + this.facing * 39;
    const slash = this.add.arc(x, this.player.y, 33, this.facing > 0 ? 300 : 120, this.facing > 0 ? 70 : 250, false, palette.sun, 0.62).setDepth(9);
    this.tweens.add({ targets: slash, alpha: 0, scale: 1.45, duration: 125, onComplete: () => slash.destroy() });

    const zone = this.add.zone(x, this.player.y, 64, 58);
    this.physics.add.existing(zone);
    const zoneBody = zone.body as Phaser.Physics.Arcade.Body;
    zoneBody.setAllowGravity(false);
    this.physics.add.overlap(zone, this.enemies, (_z, enemy) => this.damageEnemy(enemy as Phaser.Physics.Arcade.Sprite, 1));
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

    if (!this.dashing) {
      const stretch = Phaser.Math.Clamp(speedY / 1900, -0.10, 0.12);
      this.player.setScale(1 - stretch * 0.35, 1 + stretch);
      this.player.setAngle(Phaser.Math.Clamp(body.velocity.x / 105, -5, 5));
    }

    if (this.dashing && time - this.lastTrailAt > 34) {
      this.lastTrailAt = time;
      const ghost = this.add.image(this.player.x - this.facing * 12, this.player.y, 'player')
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
    this.enemies.getChildren().forEach(child => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const phase = Math.sin(time * 0.006 + enemy.x * 0.01);
      if (enemy.getData('kind') === 'boss') {
        enemy.setScale(1 + phase * 0.025, 1 - phase * 0.018);
        enemy.setAngle(phase * 1.3);
        const dist = this.player.x - enemy.x;
        enemy.setVelocityX(Phaser.Math.Clamp(dist * 0.55, -185, 185));
        enemy.setFlipX(dist < 0);
        const body = enemy.body as Phaser.Physics.Arcade.Body;
        if (time > (enemy.getData('nextLeap') as number) && body.blocked.down) {
          enemy.setData('nextLeap', time + 1700);
          enemy.setVelocityY(-390);
          enemy.setVelocityX(Math.sign(dist || 1) * 270);
          this.burst(enemy.x, enemy.y + 38, palette.violet, 10, 180);
          this.ring(enemy.x, enemy.y + 26, palette.pink);
        }
        return;
      }
      enemy.setScale(1 + phase * 0.035, 1 - phase * 0.04);
      enemy.setAngle(phase * 1.8);
      let dir = enemy.getData('dir') as number;
      const left = enemy.getData('left') as number;
      const right = enemy.getData('right') as number;
      if (enemy.x < left) dir = 1;
      if (enemy.x > right) dir = -1;
      enemy.setData('dir', dir).setVelocityX(dir * 68).setFlipX(dir < 0);
    });
  }

  private damageEnemy(enemy: Phaser.Physics.Arcade.Sprite, amount: number): void {
    if (!enemy.active) return;
    const lastHit = enemy.getData('lastHit') as number | undefined;
    if (lastHit && this.time.now - lastHit < 150) return;
    enemy.setData('lastHit', this.time.now);
    const hp = (enemy.getData('hp') as number) - amount;
    enemy.setData('hp', hp);
    enemy.setTintFill(0xffffff);
    this.time.delayedCall(70, () => enemy.active && enemy.clearTint());
    enemy.setVelocityX(this.facing * 220);
    this.burst(enemy.x, enemy.y, enemy.getData('kind') === 'boss' ? palette.pink : palette.sky, 8, 160);
    this.cameras.main.shake(65, 0.0025);
    if (hp <= 0) {
      const boss = enemy.getData('kind') === 'boss';
      this.burst(enemy.x, enemy.y, boss ? palette.sun : palette.mint, boss ? 26 : 12, boss ? 300 : 190);
      enemy.disableBody(true, true);
      if (boss) {
        this.bossDefeated = true;
        this.soundscape.victory();
        this.toast('The Gloomkeeper remembers how to smile. The Heart Shrine is awake!', 3600);
        this.cameras.main.flash(500, 255, 210, 107);
        this.save();
      }
    }
  }

  private damagePlayer(amount: number, sourceX = this.player.x): void {
    if (this.time.now < this.invulnerableUntil || this.dashing || this.won) return;
    this.invulnerableUntil = this.time.now + 900;
    this.health -= amount;
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
    this.cameras.main.fadeOut(120, 8, 18, 38);
    this.time.delayedCall(130, () => this.cameras.main.fadeIn(330, 8, 18, 38));
    this.updateHud();
    this.toast('Back on your feet. The wild is cheering for you.');
  }

  private collectPickup(pickup: Phaser.Physics.Arcade.Sprite): void {
    if (!pickup.active) return;
    const type = pickup.getData('type') as string;
    pickup.disableBody(true, true);
    this.soundscape.collect();
    this.burst(pickup.x, pickup.y, type === 'dash' ? palette.sky : type === 'doubleJump' ? palette.pink : palette.sun, 14, 210);
    if (type === 'shard') {
      this.shards++;
      this.toast(this.shards % 5 === 0 ? `Joy shard ×${this.shards} — the world feels brighter.` : `Joy shard ×${this.shards}`, 1200);
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
        this.toast(wall.getData('gate') ? 'Crystal gate shattered — the Moss Grotto is open!' : 'A hidden canopy path opens!');
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
    const body = this.add.text(640, 350, `You found ${this.shards} joy shards and taught the Gloomkeeper a brighter rhythm.\n\nLumenwild is a small world, but it remembers every brave little jump.`, { fontFamily: 'system-ui, sans-serif', fontSize: '21px', color: '#dffcff', align: 'center', lineSpacing: 8, wordWrap: { width: 590 } }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
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

    leftPanel.setScrollFactor(0);
    this.updateHud();
  }

  private updateHud(): void {
    this.heartText.setText(`${'♥'.repeat(Math.max(0, this.health))}${'·'.repeat(Math.max(0, this.maxHealth - this.health))}`);
    this.shardText.setText(`✦  ${this.shards} JOY SHARDS`);
    const dash = this.abilities.dash ? '↠ SHIFT  SKY DASH' : '◇ DASH DORMANT';
    const jump = this.abilities.doubleJump ? '✦ SPACE×2  PETAL LEAP' : '◇ LEAP DORMANT';
    this.abilityText.setText(`${dash}     ${jump}     ⚔ J  SWIPE`);
  }

  private updateBiome(): void {
    const x = this.player.x;
    const next = x < 1900 ? 'SUNMEADOW' : x < 3650 ? 'MOSS GROTTO' : 'TWILIGHT CANOPY';
    if (next === this.biome) return;
    this.biome = next;
    this.areaText.setText(next).setAlpha(0);
    this.tweens.add({ targets: this.areaText, alpha: 1, duration: 600 });
  }

  private updateObjective(): void {
    let text = 'Climb toward the bright pulse above →';
    if (this.abilities.dash && this.player.x < 2050) text = 'Dash through the crystal gate →';
    else if (this.abilities.dash && !this.abilities.doubleJump) text = 'Find the pink pulse in the grotto →';
    else if (this.abilities.doubleJump && !this.bossDefeated) text = 'Rise into the canopy and meet its guardian →';
    else if (this.bossDefeated) text = 'Carry the joy to the Heart Shrine →';
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
    const controls = this.add.text(640, 421, 'MOVE  A D / ← →     JUMP  Space     ATTACK  J\nAbilities bloom as you explore  •  Gamepad supported', {
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
      }
    } catch {
      localStorage.removeItem(SAVE_KEY);
    }
  }

  private save(): void {
    const state: SaveState = { abilities: this.abilities, shards: this.shards, bossDefeated: this.bossDefeated };
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
