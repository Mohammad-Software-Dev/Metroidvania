# Lumenwild

A joyful, self-contained browser Metroidvania built with **TypeScript + Phaser + Vite**.

Explore three connected biomes, collect joy shards, unlock movement abilities, break through ability gates, fight the Gloomkeeper, and restore the Heart Shrine. All game art is generated procedurally at runtime, so there are no external image assets or licensing concerns.

## Play locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Production build

```bash
npm run build
npm run preview
```

The production bundle is written to `dist/` and can be deployed to any static host.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | A / D or arrows | Left stick |
| Jump | Space / W / Up | A |
| Attack | J | B / Y |
| Dash (after unlock) | Shift | X / RB |
| World map | M | Select |
| Respawn | R | — |

## Game-feel features

- acceleration/deceleration instead of binary movement
- coyote time and jump buffering
- mid-air double-jump upgrade
- fast dash with screen shake, particles, and crystal-gate breaking
- responsive melee attack with knockback
- checkpoints and forgiving respawn
- local save state for abilities, shards, memory petals, miniboss/boss progress, and discovered biomes
- full-screen world map with live player position, landmarks, objectives, and completion status
- three dash-gated secret alcoves plus a fourth memory petal awarded by the Brambleheart miniboss
- Heart Bloom completion reward: recover all four memory petals to permanently gain a sixth heart
- springcap launchers that create alternate traversal lines and preserve double-jump flow
- Glowwing aerial enemies with pursuit behavior and Thornpod ranged enemies with parryable seed projectiles
- Brambleheart mid-game miniboss with charge behavior, dedicated intro, health bar, and secret reward
- friendly NPC encounters that surface exploration hints and world lore
- keyboard + gamepad support
- parallax scenery, animated motes, procedural VFX, and synthesized WebAudio feedback
- runtime-authored sprite sheets with frame-based idle, run, jump, fall, attack, dash, hurt, slime, and boss animations
- biome-specific repeating terrain tiles so long platforms keep crisp surface detail instead of stretched textures
- foreground foliage/crystal occlusion layers for stronger scene depth
- two-phase Gloomkeeper presentation with attack telegraphs, landing impact VFX, and animated boss states
- responsive 16:9 canvas that scales to the browser window

## Tech

- TypeScript
- Phaser 3
- Vite
- WebAudio API
- LocalStorage

## Deployment

A GitHub Pages workflow is included at `.github/workflows/pages.yml`. The repository needs one one-time GitHub setting before the deployment can publish:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Run **Deploy game to GitHub Pages** manually from the Actions tab.

The workflow is intentionally manual until Pages is enabled, so normal code pushes keep CI green. When run, it installs dependencies, builds the Vite production bundle, uploads `dist/` as the Pages artifact, and deploys it through the `github-pages` environment.

Because Vite is configured with `base: './'`, the generated `dist/` works on the repository subpath as well as other static hosts.
