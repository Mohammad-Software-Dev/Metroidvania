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
| Respawn | R | — |

## Game-feel features

- acceleration/deceleration instead of binary movement
- coyote time and jump buffering
- mid-air double-jump upgrade
- fast dash with screen shake, particles, and crystal-gate breaking
- responsive melee attack with knockback
- checkpoints and forgiving respawn
- local save state for abilities, shards, and boss progress
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

Because Vite is configured with `base: './'`, the generated `dist/` works on static subpaths as well as root domains. For GitHub Pages, build the project and publish `dist/` through your preferred Pages workflow.
