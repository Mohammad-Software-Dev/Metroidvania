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

    make('player', 48, 58, g => {
      g.fillStyle(0x0e2745).fillRoundedRect(8, 13, 32, 39, 13);
      g.fillStyle(palette.mint).fillCircle(24, 19, 16);
      g.fillStyle(0xd5ffe8).fillCircle(18, 17, 5).fillCircle(30, 17, 5);
      g.fillStyle(0x173653).fillCircle(19, 17, 2).fillCircle(31, 17, 2);
      g.fillStyle(palette.sun).fillTriangle(21, 4, 27, 4, 24, 12);
      g.fillStyle(palette.peach).fillRoundedRect(12, 43, 9, 10, 4).fillRoundedRect(27, 43, 9, 10, 4);
    });

    make('platform', 64, 32, g => {
      g.fillStyle(0x173c4c).fillRoundedRect(0, 5, 64, 27, 9);
      g.fillStyle(0x2e6d62).fillRoundedRect(0, 2, 64, 15, 8);
      g.fillStyle(palette.lime).fillRoundedRect(3, 0, 58, 6, 3);
      g.fillStyle(0x7fd67f, 0.65).fillCircle(13, 9, 3).fillCircle(45, 10, 2);
    });

    make('crystal', 54, 106, g => {
      g.fillStyle(0x4b4d9d, 0.92).fillTriangle(4, 104, 16, 8, 30, 104);
      g.fillStyle(palette.violet, 0.95).fillTriangle(20, 104, 34, 0, 51, 104);
      g.lineStyle(4, 0xc8c2ff, 0.75).lineBetween(16, 15, 27, 93).lineBetween(34, 9, 41, 89);
    });

    make('slime', 46, 34, g => {
      g.fillStyle(0x17475b).fillRoundedRect(4, 12, 38, 20, 10);
      g.fillStyle(palette.sky).fillCircle(23, 15, 16);
      g.fillStyle(palette.white).fillCircle(17, 14, 4).fillCircle(29, 14, 4);
      g.fillStyle(palette.ink).fillCircle(18, 15, 2).fillCircle(30, 15, 2);
      g.fillStyle(palette.pink).fillCircle(11, 22, 3).fillCircle(35, 22, 3);
    });

    make('boss', 112, 92, g => {
      g.fillStyle(0x271e58).fillRoundedRect(8, 28, 96, 58, 25);
      g.fillStyle(0x6f5bd1).fillCircle(56, 37, 36);
      g.fillStyle(palette.pink).fillTriangle(20, 28, 31, 2, 40, 30).fillTriangle(72, 30, 84, 2, 94, 31);
      g.fillStyle(palette.white).fillCircle(42, 36, 8).fillCircle(70, 36, 8);
      g.fillStyle(palette.ink).fillCircle(44, 38, 4).fillCircle(72, 38, 4);
      g.lineStyle(5, palette.sun, 0.9).arc(56, 51, 18, 0.2, Math.PI - 0.2, false);
    });

    make('shard', 24, 28, g => {
      g.fillStyle(palette.sun, 0.35).fillCircle(12, 14, 12);
      g.fillStyle(0xfff0a3).fillTriangle(12, 0, 23, 13, 12, 27).fillTriangle(12, 0, 1, 13, 12, 27);
      g.fillStyle(0xffffff, 0.75).fillTriangle(12, 3, 15, 12, 12, 17);
    });

    make('dash-orb', 58, 58, g => {
      g.fillStyle(palette.sky, 0.22).fillCircle(29, 29, 28);
      g.lineStyle(4, palette.sky, 0.8).strokeCircle(29, 29, 22);
      g.fillStyle(0xd9fbff).fillTriangle(14, 29, 38, 14, 30, 27).fillTriangle(30, 31, 44, 29, 20, 45);
    });

    make('jump-orb', 58, 58, g => {
      g.fillStyle(palette.pink, 0.2).fillCircle(29, 29, 28);
      g.lineStyle(4, palette.pink, 0.8).strokeCircle(29, 29, 22);
      g.fillStyle(0xffe3f1).fillTriangle(29, 10, 45, 31, 35, 28).fillTriangle(23, 28, 13, 31, 29, 48);
    });

    make('spike', 46, 30, g => {
      g.fillStyle(0x7e3958).fillTriangle(0, 30, 11, 2, 22, 30).fillTriangle(16, 30, 30, 0, 44, 30);
      g.fillStyle(palette.pink, 0.55).fillTriangle(7, 25, 11, 7, 16, 25);
    });

    make('spark', 16, 16, g => {
      g.fillStyle(0xffffff, 0.95).fillCircle(8, 8, 4);
      g.fillStyle(palette.sun, 0.25).fillCircle(8, 8, 8);
    });
  }

  private createBackdrop(): void {
    const sky = this.add.graphics().setScrollFactor(0);
    const bands = [0x081326, 0x0b1f38, 0x10304a, 0x18495f, 0x1e6873, 0x2f8a87];
    bands.forEach((c, i) => sky.fillStyle(c).fillRect(0, i * 125, 1280, 130));

    for (let layer = 0; layer < 3; layer++) {
      const factor = 0.08 + layer * 0.08;
      const color = [0x17324c, 0x1b4a5a, 0x245f61][layer];
      for (let i = 0; i < 24; i++) {
        const x = i * 260 + (layer * 83) % 200;
        const h = 110 + ((i * 73 + layer * 41) % 180);
        const hill = this.add.ellipse(x, 815 - layer * 38, 420, h * 2, color, 0.92).setOrigin(0.5, 1).setScrollFactor(factor);
        hill.setDepth(-30 + layer);
      }
    }

    for (let i = 0; i < 95; i++) {
      const x = (i * 211) % WORLD_W;
      const y = 90 + (i * 97) % 680;
      const mote = this.add.circle(x, y, 1.5 + (i % 3), i % 4 === 0 ? palette.sun : palette.white, 0.18 + (i % 5) * 0.05)
        .setScrollFactor(0.14 + (i % 3) * 0.05)
        .setDepth(-20);
      this.tweens.add({ targets: mote, y: y - 18 - (i % 24), alpha: { from: mote.alpha, to: mote.alpha * 0.25 }, yoyo: true, repeat: -1, duration: 2200 + (i % 7) * 330, ease: 'Sine.inOut' });
    }

    const sun = this.add.circle(1060, 125, 72, palette.sun, 0.16).setScrollFactor(0.02).setDepth(-40);
    this.add.circle(1060, 125, 38, 0xffefb1, 0.24).setScrollFactor(0.02).setDepth(-39);
    this.tweens.add({ targets: sun, scale: 1.12, alpha: 0.22, yoyo: true, repeat: -1, duration: 2800, ease: 'Sine.inOut' });

    // World-space flora silhouettes that change character across the journey.
    for (let x = 100; x < WORLD_W; x += 135) {
      const zone = x < 1850 ? 0 : x < 3600 ? 1 : 2;
      const colors = [0x275f61, 0x38566b, 0x4a3d72];
      const stalk = this.add.rectangle(x, 900, 12 + (x % 9), 70 + (x % 80), colors[zone], 0.7).setOrigin(0.5, 1).setDepth(-2);
      stalk.setRotation(((x % 5) - 2) * 0.03);
      this.add.circle(x - 14, 840 - (x % 50), 17, colors[zone], 0.68).setDepth(-2);
      this.add.circle(x + 16, 858 - (x % 40), 14, colors[zone], 0.68).setDepth(-2);
    }
  }

  private addPlatform(x: number, y: number, w: number, h = 32): Phaser.Physics.Arcade.Sprite {
    const p = this.platforms.create(x, y, 'platform') as Phaser.Physics.Arcade.Sprite;
    p.setDisplaySize(w, h).refreshBody();
    return p;
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
    const shrineGlow = this.add.circle(5215, 572, 80, palette.sun, 0.10).setDepth(1);
    this.add.circle(5215, 572, 45, palette.sun, 0.16).setDepth(1);
    this.add.rectangle(5215, 665, 110, 22, 0x3a4660).setDepth(1);
    this.add.triangle(5215, 610, 0, 80, 45, 0, 90, 80, palette.white, 0.45).setDepth(2);
    this.tweens.add({ targets: shrineGlow, scale: 1.3, alpha: 0.2, yoyo: true, repeat: -1, duration: 1900 });

    // Decorative flowers.
    for (let x = 120; x < WORLD_W; x += 173) {
      const color = x < 1850 ? palette.sun : x < 3600 ? palette.mint : palette.pink;
      this.add.circle(x, 897 - (x % 13), 5, color, 0.9).setDepth(2);
      this.add.circle(x - 6, 899 - (x % 13), 4, color, 0.55).setDepth(2);
      this.add.circle(x + 6, 899 - (x % 13), 4, color, 0.55).setDepth(2);
    }
  }

  private createCheckpoint(x: number, y: number, name: string): void {
    const glow = this.add.circle(x, y - 64, 32, palette.mint, 0.12).setDepth(1);
    this.add.circle(x, y - 64, 15, palette.mint, 0.4).setDepth(2);
    this.add.rectangle(x, y - 24, 8, 56, 0xbcebc7, 0.7).setDepth(2);
    this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.23, yoyo: true, repeat: -1, duration: 1700 });
    this.add.text(x, y - 112, name, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#b9f4d7' })
      .setOrigin(0.5).setAlpha(0.55).setDepth(2);
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(this.checkpoint.x, this.checkpoint.y, 'player');
    this.player.setDepth(8).setBounce(0.02).setCollideWorldBounds(true);
    this.player.setSize(30, 48).setOffset(9, 8);
    this.player.setMaxVelocity(470, 900);
    this.player.setDragX(1700);
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
      this.player.clearTint();
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

  private updateEnemies(time: number): void {
    this.enemies.getChildren().forEach(child => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      if (enemy.getData('kind') === 'boss') {
        const dist = this.player.x - enemy.x;
        enemy.setVelocityX(Phaser.Math.Clamp(dist * 0.55, -185, 185));
        enemy.setFlipX(dist < 0);
        const body = enemy.body as Phaser.Physics.Arcade.Body;
        if (time > (enemy.getData('nextLeap') as number) && body.blocked.down) {
          enemy.setData('nextLeap', time + 1700);
          enemy.setVelocityY(-390);
          enemy.setVelocityX(Math.sign(dist || 1) * 270);
          this.burst(enemy.x, enemy.y + 38, palette.violet, 10, 180);
        }
        return;
      }
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
    this.player.clearTint().setAlpha(1).setVelocity(0).setPosition(this.checkpoint.x, this.checkpoint.y);
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
    const leftPanel = this.add.rectangle(24, 22, 280, 88, 0x071326, 0.72).setOrigin(0).setScrollFactor(0).setDepth(50).setStrokeStyle(2, 0x76dfc8, 0.22);
    leftPanel.setScrollFactor(0);
    this.heartText = this.add.text(42, 37, '', { fontFamily: 'system-ui, sans-serif', fontSize: '25px', color: '#ff7e9f' }).setScrollFactor(0).setDepth(51);
    this.shardText = this.add.text(43, 73, '', { fontFamily: 'system-ui, sans-serif', fontSize: '17px', fontStyle: '700', color: '#ffe788' }).setScrollFactor(0).setDepth(51);
    this.abilityText = this.add.text(314, 29, '', { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: '700', color: '#d8f8ff', backgroundColor: '#071326bb', padding: { x: 14, y: 10 } }).setScrollFactor(0).setDepth(51);
    this.areaText = this.add.text(1238, 28, 'SUNMEADOW', { fontFamily: 'system-ui, sans-serif', fontSize: '16px', fontStyle: '800', color: '#efffff' }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
    this.objectiveText = this.add.text(1238, 56, '', { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#a8d9dc', align: 'right' }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
    this.toastText = this.add.text(640, 640, '', { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: '700', color: '#f7fbff', backgroundColor: '#071326dd', padding: { x: 18, y: 11 }, align: 'center' }).setOrigin(0.5).setScrollFactor(0).setDepth(70).setAlpha(0);
    this.updateHud();
  }

  private updateHud(): void {
    this.heartText.setText(`${'♥'.repeat(Math.max(0, this.health))}${'♡'.repeat(Math.max(0, this.maxHealth - this.health))}`);
    this.shardText.setText(`✦ ${this.shards} joy shards`);
    const dash = this.abilities.dash ? 'SHIFT  Sky Dash' : '◇ Dash sleeping';
    const jump = this.abilities.doubleJump ? 'SPACE×2  Petal Leap' : '◇ Leap sleeping';
    this.abilityText.setText(`${dash}    ${jump}    J  Spark Swipe`);
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
    const shade = this.add.rectangle(640, 360, 1280, 720, 0x041020, 0.66).setScrollFactor(0).setDepth(90);
    const glow = this.add.circle(640, 300, 170, palette.mint, 0.08).setScrollFactor(0).setDepth(91);
    const title = this.add.text(640, 255, 'LUMENWILD', { fontFamily: 'system-ui, sans-serif', fontSize: '76px', fontStyle: '900', color: '#f6ffcf', stroke: '#15344b', strokeThickness: 8 }).setOrigin(0.5).setScrollFactor(0).setDepth(92);
    const sub = this.add.text(640, 325, 'a tiny joyful metroidvania', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: '700', color: '#a9f1df', letterSpacing: 3 }).setOrigin(0.5).setScrollFactor(0).setDepth(92);
    const controls = this.add.text(640, 414, 'MOVE  A D / ← →     JUMP  Space     ATTACK  J\nAbilities bloom as you explore • Gamepad supported', { fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: '#dbefff', align: 'center', lineSpacing: 11 }).setOrigin(0.5).setScrollFactor(0).setDepth(92);
    const start = this.add.text(640, 510, 'press any key or click to bloom', { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: '800', color: '#ffe796' }).setOrigin(0.5).setScrollFactor(0).setDepth(92);
    this.titleCard = this.add.container(0, 0, [shade, glow, title, sub, controls, start]).setDepth(90);
    this.tweens.add({ targets: glow, scale: 1.15, alpha: 0.13, yoyo: true, repeat: -1, duration: 2000 });
    this.tweens.add({ targets: start, alpha: 0.35, yoyo: true, repeat: -1, duration: 900 });
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
