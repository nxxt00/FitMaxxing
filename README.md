# FitMaxxing

Gamified posture-correction workout tracker with Apex Legends-inspired mechanics. Built to fix your posture through pushups, planks, stretches, and other bodyweight exercises.

## Features

- **XP & Ranked Progression** - Two separate systems: XP for levels (cosmetic, packs), RP for ranked climb (Bronze → Apex Predator)
- **Rank Difficulty Scaling** - Higher ranks = harder daily/weekly challenges (1.0x → 1.525x scaling)
- **Legend System** - 5 Apex-style legends (Wraith, Octane, Lifeline, Bloodhound, Gibraltar) with unique XP perks. Pick once per week.
- **Daily Challenges** - 3 random daily goals that scale with your rank
- **Weekly Goals** - Larger goals with bigger RP rewards
- **Apex Packs** - Earn packs every level up. Drops training programs or practical perks (not useless cosmetics)
- **Training Programs** - Unlocked from packs (Foundation Builder, Posture Fix, Apex Athlete)
- **Perks** - 2x XP boosts, rest day tokens, custom presets
- **Quick Log Sidebar** - Always-visible left panel with one-click exercise logging
- **Apex Penalties** - Auto-log workouts based on Apex Legends match outcomes
- **Dark/Light Mode** - Full theme support
- **History with Deletion** - Track and delete individual workouts

## Stack

- **Backend:** Node.js + Express + SQLite (better-sqlite3)
- **Frontend:** Single-page HTML/CSS/JS (no build step)
- **Deployment:** Docker Compose

## Quick Start

```bash
docker-compose up -d
```

Access at `http://localhost:3000` or behind a reverse proxy.

## Development

The app lives in two places:
- `backend/server.js` - All API logic, database, gamification
- `frontend/index.html` - Entire UI (single file, no framework)

Edit either, then:
```bash
docker-compose up -d --build
```

## Versioning

Tags follow `v*.*.*` (e.g., `v1.0.0`, `v1.1.0`). Each major version is pushed to GHCR for easy rollbacks.

## License

MIT
