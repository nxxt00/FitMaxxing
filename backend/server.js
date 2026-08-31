const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_PATH = process.env.DB_PATH || '/app/data/fitmaxxing.db';

app.use(cors());
app.use(express.json());

// Initialize database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_type TEXT NOT NULL,
    reps INTEGER NOT NULL,
    unit TEXT NOT NULL,
    xp_earned INTEGER NOT NULL,
    notes TEXT,
    source TEXT DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS user_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_workout_date DATE,
    streak_freeze_available INTEGER DEFAULT 0,
    selected_legend TEXT DEFAULT 'wraith',
    season_xp INTEGER DEFAULT 0,
    current_rank TEXT DEFAULT 'Bronze IV',
    packs_opened INTEGER DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    achievement_key TEXT NOT NULL UNIQUE,
    achievement_name TEXT NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_key TEXT NOT NULL,
    challenge_text TEXT NOT NULL,
    target_value INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    xp_reward INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    challenge_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_rarity TEXT NOT NULL,
    acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    equipped INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS weekly_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_type TEXT NOT NULL,
    target_value INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    week_start DATE NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_key TEXT NOT NULL UNIQUE,
    program_name TEXT NOT NULL,
    description TEXT,
    duration_days INTEGER NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active INTEGER DEFAULT 0,
    started_at DATETIME,
    completed_at DATETIME,
    current_day INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS program_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    day_number INTEGER NOT NULL,
    exercise_type TEXT NOT NULL,
    target_reps INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    FOREIGN KEY (program_id) REFERENCES programs(id)
  );

  CREATE TABLE IF NOT EXISTS perks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    perk_key TEXT NOT NULL UNIQUE,
    perk_name TEXT NOT NULL,
    perk_type TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    activated_at DATETIME,
    expires_at DATETIME,
    used INTEGER DEFAULT 0,
    acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Add new columns if they don't exist
const userStatsColumns = db.prepare("PRAGMA table_info(user_stats)").all();
const userColumnNames = new Set(userStatsColumns.map(c => c.name));

const userMigrations = [
  { name: 'selected_legend', sql: "ALTER TABLE user_stats ADD COLUMN selected_legend TEXT DEFAULT 'wraith'" },
  { name: 'season_xp', sql: 'ALTER TABLE user_stats ADD COLUMN season_xp INTEGER DEFAULT 0' },
  { name: 'current_rank', sql: "ALTER TABLE user_stats ADD COLUMN current_rank TEXT DEFAULT 'Bronze IV'" },
  { name: 'packs_opened', sql: 'ALTER TABLE user_stats ADD COLUMN packs_opened INTEGER DEFAULT 0' },
  { name: 'streak_freeze_available', sql: 'ALTER TABLE user_stats ADD COLUMN streak_freeze_available INTEGER DEFAULT 0' },
  { name: 'legend_week_start', sql: 'ALTER TABLE user_stats ADD COLUMN legend_week_start TEXT' }
];

userMigrations.forEach(m => {
  if (!userColumnNames.has(m.name)) {
    console.log(`Migrating user_stats: adding column ${m.name}`);
    db.exec(m.sql);
  }
});

const workoutsColumns = db.prepare("PRAGMA table_info(workouts)").all();
const workoutColumnNames = new Set(workoutsColumns.map(c => c.name));

if (!workoutColumnNames.has('unit')) {
  console.log('Migrating workouts: adding unit column');
  db.exec("ALTER TABLE workouts ADD COLUMN unit TEXT DEFAULT 'reps'");
  db.exec("UPDATE workouts SET unit = 'seconds' WHERE exercise_type IN ('planks', 'wall_sits')");
  db.exec("UPDATE workouts SET unit = 'reps' WHERE exercise_type IN ('pushups', 'squats', 'stretches', 'chest_stretch', 'neck_stretch', 'cat_cow')");
}

if (!workoutColumnNames.has('source')) {
  console.log('Migrating workouts: adding source column');
  db.exec("ALTER TABLE workouts ADD COLUMN source TEXT DEFAULT 'manual'");
}

const perksColumns = db.prepare("PRAGMA table_info(perks)").all();
const perksColumnNames = new Set(perksColumns.map(c => c.name));
if (!perksColumnNames.has('acquired_at')) {
  console.log('Migrating perks: adding acquired_at column');
  db.exec("ALTER TABLE perks ADD COLUMN acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP");
}

db.prepare('INSERT OR IGNORE INTO user_stats (id, total_xp, level, current_streak, longest_streak, selected_legend, season_xp, current_rank, packs_opened, streak_freeze_available) VALUES (1, 0, 1, 0, 0, ?, 0, ?, 0, 0)').run('wraith', 'Bronze IV');

// Rank thresholds
const RANK_TIERS = [
  { name: 'Bronze IV', min: 0, max: 500 },
  { name: 'Bronze III', min: 500, max: 1000 },
  { name: 'Bronze II', min: 1000, max: 1500 },
  { name: 'Bronze I', min: 1500, max: 2000 },
  { name: 'Silver IV', min: 2000, max: 2500 },
  { name: 'Silver III', min: 2500, max: 3000 },
  { name: 'Silver II', min: 3000, max: 3500 },
  { name: 'Silver I', min: 3500, max: 4000 },
  { name: 'Gold IV', min: 4000, max: 4500 },
  { name: 'Gold III', min: 4500, max: 5000 },
  { name: 'Gold II', min: 5000, max: 5500 },
  { name: 'Gold I', min: 5500, max: 6000 },
  { name: 'Platinum IV', min: 6000, max: 7000 },
  { name: 'Platinum III', min: 7000, max: 8000 },
  { name: 'Platinum II', min: 8000, max: 9000 },
  { name: 'Platinum I', min: 9000, max: 10000 },
  { name: 'Diamond IV', min: 10000, max: 12000 },
  { name: 'Diamond III', min: 12000, max: 14000 },
  { name: 'Diamond II', min: 14000, max: 16000 },
  { name: 'Diamond I', min: 16000, max: 18000 },
  { name: 'Master', min: 18000, max: 22000 },
  { name: 'Apex Predator', min: 22000, max: Infinity }
];

function getRank(seasonXP) {
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (seasonXP >= RANK_TIERS[i].min) {
      return RANK_TIERS[i].name;
    }
  }
  return RANK_TIERS[0].name;
}

function getRankProgress(seasonXP) {
  const currentRank = getRank(seasonXP);
  const rankData = RANK_TIERS.find(r => r.name === currentRank);
  if (!rankData || rankData.max === Infinity) {
    return { current: seasonXP, needed: seasonXP, percent: 100 };
  }
  const progress = seasonXP - rankData.min;
  const needed = rankData.max - rankData.min;
  return {
    current: progress,
    needed: needed,
    percent: Math.round((progress / needed) * 100)
  };
}

// Exercise definitions
// Stretches curated for desk-sitters: doorway chest (rounded shoulders),
// lateral neck flex (tech neck), cat-cow (thoracic mobility).
const EXERCISES = {
  pushups: { name: 'Pushups', unit: 'reps', youtubeId: 'IODxDxX7oi4' },
  planks: { name: 'Plank', unit: 'seconds', youtubeId: 'ASdvN_XEl_c' },
  chest_stretch: { name: 'Chest Stretch', unit: 'seconds', youtubeId: 'O8rJw_TmC1Y' },
  neck_stretch: { name: 'Neck Stretch', unit: 'seconds', youtubeId: 'FRNtLrMf-1A' },
  cat_cow: { name: 'Cat-Cow', unit: 'reps', youtubeId: 'LIVJZZyZ2qM' },
  squats: { name: 'Squats', unit: 'reps', youtubeId: 'aclHkVaku9U' },
  wall_sits: { name: 'Wall Sit', unit: 'seconds', youtubeId: 'w7qVVT_h_lI' }
};

const LEGENDS = {
  wraith: {
    name: 'Wraith',
    title: 'The Void Pilot',
    perk: '+10% XP for core & stretches',
    bonusTypes: ['planks', 'chest_stretch', 'neck_stretch', 'cat_cow'],
    bonusMultiplier: 1.1,
    color: '#a78bfa',
    emoji: '👻'
  },
  octane: {
    name: 'Octane',
    title: 'The Adrenaline Junkie',
    perk: '+20% XP for legs (squats, wall sits)',
    bonusTypes: ['squats', 'wall_sits'],
    bonusMultiplier: 1.2,
    color: '#f59e0b',
    emoji: '⚡'
  },
  lifeline: {
    name: 'Lifeline',
    title: 'The Combat Medic',
    perk: '+15% XP for everything',
    bonusTypes: ['pushups', 'planks', 'chest_stretch', 'neck_stretch', 'cat_cow', 'squats', 'wall_sits'],
    bonusMultiplier: 1.15,
    color: '#10b981',
    emoji: '💚'
  },
  bloodhound: {
    name: 'Bloodhound',
    title: 'The All-Seeing',
    perk: '+25% XP for first workout each day',
    bonusTypes: [],
    bonusMultiplier: 1.0,
    firstWorkoutBonus: 1.25,
    color: '#ef4444',
    emoji: '🐺'
  },
  gibraltar: {
    name: 'Gibraltar',
    title: 'The Shielded Fortress',
    perk: '+30% XP for wall sits > 60s',
    bonusTypes: ['wall_sits'],
    bonusMultiplier: 1.0,
    conditionalBonus: { type: 'wall_sits', minReps: 60, multiplier: 1.3 },
    color: '#3b82f6',
    emoji: '🛡️'
  }
};

// Rank difficulty scaling with sub-tier progression
const RANK_INDEX = {};
RANK_TIERS.forEach((tier, i) => { RANK_INDEX[tier.name] = i; });

function getRankDifficulty(rankName) {
  const idx = RANK_INDEX[rankName] || 0;
  // Smooth sub-tier scaling: 0.025 per sub-tier
  const subTierBonus = (idx % 4) * 0.025;
  // Major rank group bonus: 0.1 per full tier (Bronze→Silver, Silver→Gold, etc.)
  const majorRankBonus = Math.floor(idx / 4) * 0.1;
  
  const challengeMultiplier = 1.0 + subTierBonus + majorRankBonus;
  // Reward multiplier compensates but doesn't fully match (higher rank = harder for less relative reward)
  const rewardMultiplier = 1.0 + (subTierBonus * 0.5) + (majorRankBonus * 0.6);
  
  return { challengeMultiplier, rewardMultiplier };
}

// Daily challenges
const DAILY_CHALLENGE_TEMPLATES = [
  { key: 'pushups_50', text: 'Complete {target} pushups today', type: 'pushups', baseTarget: 50, baseXP: 150 },
  { key: 'pushups_100', text: 'Complete {target} pushups today', type: 'pushups', baseTarget: 100, baseXP: 300 },
  { key: 'plank_60', text: 'Hold plank for {target} seconds total', type: 'planks', baseTarget: 60, baseXP: 120 },
  { key: 'plank_120', text: 'Hold plank for {target} seconds total', type: 'planks', baseTarget: 120, baseXP: 200 },
  { key: 'squats_30', text: 'Complete {target} squats today', type: 'squats', baseTarget: 30, baseXP: 100 },
  { key: 'squats_75', text: 'Complete {target} squats today', type: 'squats', baseTarget: 75, baseXP: 200 },
  { key: 'stretches_20', text: 'Do {target} posture stretches', type: 'chest_stretch', baseTarget: 20, baseXP: 80 },
  { key: 'wall_sit_90', text: 'Hold wall sit for {target} seconds', type: 'wall_sits', baseTarget: 90, baseXP: 150 },
  { key: 'any_3_workouts', text: 'Log {target} workouts today', type: 'any', baseTarget: 3, baseXP: 100 },
  { key: 'any_5_workouts', text: 'Log {target} workouts today (work-break grind!)', type: 'any', baseTarget: 5, baseXP: 200 },
  { key: 'total_reps_100', text: 'Complete {target} total reps today', type: 'total', baseTarget: 100, baseXP: 150 },
  { key: 'total_reps_200', text: 'Complete {target} total reps today', type: 'total', baseTarget: 200, baseXP: 300 }
];

function generateDailyChallenges() {
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT COUNT(*) as count FROM daily_challenges WHERE challenge_date = ?').get(today);
  
  if (existing.count > 0) return;

  const stats = db.prepare('SELECT current_rank FROM user_stats WHERE id = 1').get();
  const difficulty = getRankDifficulty(stats.current_rank);
  
  const shuffled = [...DAILY_CHALLENGE_TEMPLATES].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 3);
  
  const insert = db.prepare('INSERT INTO daily_challenges (challenge_key, challenge_text, target_value, progress, xp_reward, challenge_date) VALUES (?, ?, ?, 0, ?, ?)');
  
  selected.forEach(challenge => {
    const scaledTarget = Math.round(challenge.baseTarget * difficulty.challengeMultiplier);
    const scaledXP = Math.round(challenge.baseXP * difficulty.rewardMultiplier);
    const text = challenge.text.replace('{target}', scaledTarget);
    insert.run(challenge.key, text, scaledTarget, scaledXP, today);
  });
}

function updateDailyChallengeProgress(exerciseType, reps) {
  const today = new Date().toISOString().split('T')[0];
  const challenges = db.prepare('SELECT * FROM daily_challenges WHERE challenge_date = ? AND completed = 0').all(today);
  
  const completedChallenges = [];
  
  challenges.forEach(challenge => {
    let increment = 0;
    const template = DAILY_CHALLENGE_TEMPLATES.find(t => t.key === challenge.challenge_key);
    
    if (!template) return;
    
    if (template.type === exerciseType) {
      increment = reps;
    } else if (template.type === 'total') {
      increment = reps;
    } else if (template.type === 'any') {
      increment = 1;
    } else if (template.type === 'chest_stretch' && (exerciseType === 'chest_stretch' || exerciseType === 'neck_stretch' || exerciseType === 'cat_cow')) {
      // Stretches count any posture work
      increment = reps;
    }
    
    if (increment > 0) {
      const newProgress = challenge.progress + increment;
      const isComplete = newProgress >= challenge.target_value;
      
      db.prepare('UPDATE daily_challenges SET progress = ?, completed = ? WHERE id = ?').run(newProgress, isComplete ? 1 : 0, challenge.id);
      
      if (isComplete && !challenge.completed) {
        completedChallenges.push({
          text: challenge.challenge_text,
          xpReward: challenge.xp_reward
        });
      }
    }
  });
  
  return completedChallenges;
}

// Weekly goals
const WEEKLY_GOAL_TEMPLATES = [
  { key: 'beginner_pushups', text: 'Beginner: {target} pushups this week', type: 'pushups', baseTarget: 100, baseRP: 300 },
  { key: 'intermediate_pushups', text: 'Intermediate: {target} pushups this week', type: 'pushups', baseTarget: 300, baseRP: 600 },
  { key: 'beast_pushups', text: 'Beast Mode: {target} pushups this week', type: 'pushups', baseTarget: 500, baseRP: 1000 },
  { key: 'plank_300', text: 'Core Focus: {target} seconds of plank this week', type: 'planks', baseTarget: 300, baseRP: 400 },
  { key: 'squat_200', text: 'Leg Day: {target} squats this week', type: 'squats', baseTarget: 200, baseRP: 400 },
  { key: 'total_reps_500', text: 'Grinder: {target} total reps this week', type: 'total', baseTarget: 500, baseRP: 500 }
];

function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday as start
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

function generateWeeklyGoal() {
  const weekStart = getWeekStart();
  const existing = db.prepare('SELECT COUNT(*) as count FROM weekly_goals WHERE week_start = ?').get(weekStart);
  
  if (existing.count > 0) return;

  const stats = db.prepare('SELECT current_rank FROM user_stats WHERE id = 1').get();
  const difficulty = getRankDifficulty(stats.current_rank);
  
  const template = WEEKLY_GOAL_TEMPLATES[Math.floor(Math.random() * WEEKLY_GOAL_TEMPLATES.length)];
  const scaledTarget = Math.round(template.baseTarget * difficulty.challengeMultiplier);
  const scaledRP = Math.round(template.baseRP * difficulty.rewardMultiplier);
  
  db.prepare('INSERT INTO weekly_goals (goal_type, target_value, progress, week_start, completed) VALUES (?, ?, 0, ?, 0)').run(template.key, scaledTarget, weekStart);
}

function updateWeeklyGoalProgress(exerciseType, reps) {
  const weekStart = getWeekStart();
  const goal = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ? AND completed = 0').get(weekStart);
  
  if (!goal) return null;
  
  const template = WEEKLY_GOAL_TEMPLATES.find(t => t.key === goal.goal_type);
  if (!template) return null;
  
  const stats = db.prepare('SELECT current_rank FROM user_stats WHERE id = 1').get();
  const difficulty = getRankDifficulty(stats.current_rank);
  const scaledRP = Math.round(template.baseRP * difficulty.rewardMultiplier);
  
  let increment = 0;
  if (template.type === exerciseType || template.type === 'total') {
    increment = reps;
  }
  
  if (increment > 0) {
    const newProgress = goal.progress + increment;
    const isComplete = newProgress >= goal.target_value;
    
    db.prepare('UPDATE weekly_goals SET progress = ?, completed = ? WHERE id = ?').run(newProgress, isComplete ? 1 : 0, goal.id);
    
    if (isComplete) {
      return { completed: true, rp_bonus: scaledRP, text: goal.goal_type };
    }
  }
  
  return null;
}

// Program templates
const PROGRAM_TEMPLATES = {
  foundation_builder: {
    name: 'Foundation Builder',
    description: '4-week program for beginners. Build base strength and establish habits.',
    duration: 28,
    days: [
      { day: 1, exercise: 'pushups', target: 20 },
      { day: 2, exercise: 'squats', target: 30 },
      { day: 3, exercise: 'planks', target: 30 },
      { day: 4, exercise: 'cat_cow', target: 15 },
      { day: 5, exercise: 'pushups', target: 25 },
      { day: 6, exercise: 'chest_stretch', target: 30 },
      { day: 7, exercise: 'rest', target: 0 },
      { day: 8, exercise: 'pushups', target: 30 },
      { day: 9, exercise: 'squats', target: 40 },
      { day: 10, exercise: 'planks', target: 45 },
      { day: 11, exercise: 'cat_cow', target: 15 },
      { day: 12, exercise: 'pushups', target: 35 },
      { day: 13, exercise: 'wall_sits', target: 45 },
      { day: 14, exercise: 'rest', target: 0 },
      { day: 15, exercise: 'pushups', target: 40 },
      { day: 16, exercise: 'squats', target: 50 },
      { day: 17, exercise: 'planks', target: 60 },
      { day: 18, exercise: 'neck_stretch', target: 30 },
      { day: 19, exercise: 'pushups', target: 50 },
      { day: 20, exercise: 'chest_stretch', target: 45 },
      { day: 21, exercise: 'rest', target: 0 },
      { day: 22, exercise: 'pushups', target: 60 },
      { day: 23, exercise: 'squats', target: 60 },
      { day: 24, exercise: 'planks', target: 90 },
      { day: 25, exercise: 'cat_cow', target: 20 },
      { day: 26, exercise: 'wall_sits', target: 60 },
      { day: 27, exercise: 'pushups', target: 75 },
      { day: 28, exercise: 'rest', target: 0 }
    ]
  },
  posture_fix: {
    name: 'Posture Fix Protocol',
    description: '3-week intensive program targeting desk-related posture issues.',
    duration: 21,
    days: [
      { day: 1, exercise: 'chest_stretch', target: 60 },
      { day: 2, exercise: 'neck_stretch', target: 45 },
      { day: 3, exercise: 'cat_cow', target: 20 },
      { day: 4, exercise: 'cat_cow', target: 20 },
      { day: 5, exercise: 'chest_stretch', target: 90 },
      { day: 6, exercise: 'planks', target: 60 },
      { day: 7, exercise: 'rest', target: 0 },
      { day: 8, exercise: 'chest_stretch', target: 90 },
      { day: 9, exercise: 'neck_stretch', target: 60 },
      { day: 10, exercise: 'cat_cow', target: 30 },
      { day: 11, exercise: 'planks', target: 75 },
      { day: 12, exercise: 'cat_cow', target: 25 },
      { day: 13, exercise: 'wall_sits', target: 60 },
      { day: 14, exercise: 'rest', target: 0 },
      { day: 15, exercise: 'chest_stretch', target: 120 },
      { day: 16, exercise: 'planks', target: 90 },
      { day: 17, exercise: 'neck_stretch', target: 90 },
      { day: 18, exercise: 'cat_cow', target: 35 },
      { day: 19, exercise: 'cat_cow', target: 30 },
      { day: 20, exercise: 'planks', target: 120 },
      { day: 21, exercise: 'rest', target: 0 }
    ]
  },
  apex_athlete: {
    name: 'Apex Athlete',
    description: '4-week advanced program. High intensity for serious grinders.',
    duration: 28,
    days: [
      { day: 1, exercise: 'pushups', target: 100 },
      { day: 2, exercise: 'squats', target: 100 },
      { day: 3, exercise: 'planks', target: 120 },
      { day: 4, exercise: 'wall_sits', target: 90 },
      { day: 5, exercise: 'pushups', target: 120 },
      { day: 6, exercise: 'rest', target: 0 },
      { day: 7, exercise: 'rest', target: 0 },
      { day: 8, exercise: 'pushups', target: 150 },
      { day: 9, exercise: 'squats', target: 150 },
      { day: 10, exercise: 'planks', target: 180 },
      { day: 11, exercise: 'wall_sits', target: 120 },
      { day: 12, exercise: 'chest_stretch', target: 90 },
      { day: 13, exercise: 'rest', target: 0 },
      { day: 14, exercise: 'rest', target: 0 },
      { day: 15, exercise: 'pushups', target: 200 },
      { day: 16, exercise: 'squats', target: 200 },
      { day: 17, exercise: 'planks', target: 240 },
      { day: 18, exercise: 'wall_sits', target: 180 },
      { day: 19, exercise: 'pushups', target: 250 },
      { day: 20, exercise: 'rest', target: 0 },
      { day: 21, exercise: 'rest', target: 0 },
      { day: 22, exercise: 'pushups', target: 300 },
      { day: 23, exercise: 'squats', target: 300 },
      { day: 24, exercise: 'planks', target: 300 },
      { day: 25, exercise: 'wall_sits', target: 240 },
      { day: 26, exercise: 'cat_cow', target: 30 },
      { day: 27, exercise: 'pushups', target: 350 },
      { day: 28, exercise: 'rest', target: 0 }
    ]
  }
};

const PERK_TYPES = {
  xp_boost: { name: '2x XP Boost (24h)', icon: '⚡' },
  rest_day: { name: 'Rest Day Token', icon: '😴' },
  custom_preset: { name: 'Custom Quick-Log Preset Unlock', icon: '🎯' },
  rank_protection: { name: 'Rank Protection (lose no RP for 1 day)', icon: '🛡️' }
};

// Apex Pack rewards - now programs and perks
function openApexPack() {
  const roll = Math.random();
  let rarity;
  if (roll < 0.05) rarity = 'legendary';
  else if (roll < 0.20) rarity = 'epic';
  else if (roll < 0.50) rarity = 'rare';
  else rarity = 'common';
  
  // Rarity determines what you can get
  // Common: program OR perk
  // Rare: guaranteed program or good perk
  // Epic: 2 items, or 1 epic perk
  // Legendary: 3 items, or legendary program
  
  const items = [];
  
  if (rarity === 'legendary') {
    // Always gives a legendary program if not owned, otherwise 2 epic perks
    const legendaryProgram = 'apex_athlete';
    const owned = db.prepare('SELECT id FROM programs WHERE program_key = ?').get(legendaryProgram);
    if (!owned) {
      items.push({ type: 'program', key: legendaryProgram, rarity: 'legendary' });
    } else {
      items.push({ type: 'perk', key: 'xp_boost', rarity: 'epic' });
      items.push({ type: 'perk', key: 'rest_day', rarity: 'epic' });
    }
  } else if (rarity === 'epic') {
    // Program (if new) or 2 perks
    const programs = Object.keys(PROGRAM_TEMPLATES);
    const unownedPrograms = programs.filter(p => !db.prepare('SELECT id FROM programs WHERE program_key = ?').get(p));
    if (unownedPrograms.length > 0 && Math.random() < 0.5) {
      const prog = unownedPrograms[Math.floor(Math.random() * unownedPrograms.length)];
      items.push({ type: 'program', key: prog, rarity: 'epic' });
    } else {
      const perkKeys = Object.keys(PERK_TYPES);
      const perk = perkKeys[Math.floor(Math.random() * perkKeys.length)];
      items.push({ type: 'perk', key: perk, rarity: 'epic' });
    }
  } else if (rarity === 'rare') {
    // Likely a program if unowned, or common perk
    const programs = Object.keys(PROGRAM_TEMPLATES);
    const unownedPrograms = programs.filter(p => !db.prepare('SELECT id FROM programs WHERE program_key = ?').get(p));
    if (unownedPrograms.length > 0 && Math.random() < 0.7) {
      const prog = unownedPrograms[Math.floor(Math.random() * unownedPrograms.length)];
      items.push({ type: 'program', key: prog, rarity: 'rare' });
    } else {
      const perkKeys = Object.keys(PERK_TYPES);
      const perk = perkKeys[Math.floor(Math.random() * perkKeys.length)];
      items.push({ type: 'perk', key: perk, rarity: 'rare' });
    }
  } else {
    // Common - small perk
    const perkKeys = Object.keys(PERK_TYPES);
    const perk = perkKeys[Math.floor(Math.random() * perkKeys.length)];
    items.push({ type: 'perk', key: perk, rarity: 'common' });
  }
  
  // Save items to database
  const savedItems = [];
  items.forEach(item => {
    if (item.type === 'program') {
      const template = PROGRAM_TEMPLATES[item.key];
      const result = db.prepare('INSERT INTO programs (program_key, program_name, description, duration_days) VALUES (?, ?, ?, ?)').run(item.key, template.name, template.description, template.duration);
      const programId = result.lastInsertRowid;
      template.days.forEach(day => {
        db.prepare('INSERT INTO program_days (program_id, day_number, exercise_type, target_reps) VALUES (?, ?, ?, ?)').run(programId, day.day, day.exercise, day.target);
      });
      savedItems.push({ type: 'program', key: item.key, name: template.name, rarity: item.rarity });
    } else if (item.type === 'perk') {
      const perkInfo = PERK_TYPES[item.key];
      db.prepare('INSERT INTO perks (perk_key, perk_name, perk_type) VALUES (?, ?, ?)').run(item.key, perkInfo.name, item.key);
      savedItems.push({ type: 'perk', key: item.key, name: perkInfo.name, rarity: item.rarity, icon: perkInfo.icon });
    }
  });
  
  db.prepare('UPDATE user_stats SET packs_opened = packs_opened + 1 WHERE id = 1').run();
  
  return { rarity, items: savedItems };
}

function calculateXP(exerciseType, reps, selectedLegend, currentRank) {
  const baseXP = reps * 10;
  const legend = LEGENDS[selectedLegend];
  
  let multiplier = 1.0;
  let bonusApplied = false;
  
  if (legend) {
    if (legend.bonusTypes.includes(exerciseType)) {
      multiplier = legend.bonusMultiplier;
      bonusApplied = true;
    }
    
    if (legend.conditionalBonus && legend.conditionalBonus.type === exerciseType && reps >= legend.conditionalBonus.minReps) {
      multiplier = legend.conditionalBonus.multiplier;
      bonusApplied = true;
    }
  }
  
  // Apply rank-based reward multiplier (compensates for harder challenges)
  const rankDifficulty = getRankDifficulty(currentRank);
  multiplier *= rankDifficulty.rewardMultiplier;
  
  const finalXP = Math.round(baseXP * multiplier);
  // RP is 40% of XP for rank grind - makes rank feel more prestigious
  const finalRP = Math.round(finalXP * 0.4);
  
  return {
    xp: finalXP,
    rp: finalRP,
    bonusApplied,
    multiplier
  };
}

function calculateLevel(totalXP) {
  return Math.floor(totalXP / 500) + 1;
}

function checkAchievements(workout, stats) {
  const achievements = [];
  
  if (stats.total_xp > 0 && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('first_workout')) {
    achievements.push({ key: 'first_workout', name: 'First Steps' });
  }
  
  const totalPushups = db.prepare('SELECT SUM(reps) as total FROM workouts WHERE exercise_type = ?').get('pushups');
  if (totalPushups && totalPushups.total >= 100 && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('hundred_pushups')) {
    achievements.push({ key: 'hundred_pushups', name: 'Centurion' });
  }
  
  if (stats.current_streak >= 7 && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('week_streak')) {
    achievements.push({ key: 'week_streak', name: 'Week Warrior' });
  }
  
  if (stats.level >= 5 && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('level_5')) {
    achievements.push({ key: 'level_5', name: 'Dedicated' });
  }
  
  if (stats.level >= 10 && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('level_10')) {
    achievements.push({ key: 'level_10', name: 'Posture Master' });
  }
  
  if (stats.current_rank && stats.current_rank.includes('Gold') && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('reach_gold')) {
    achievements.push({ key: 'reach_gold', name: 'Golden Form' });
  }
  
  if (stats.current_rank && stats.current_rank.includes('Diamond') && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('reach_diamond')) {
    achievements.push({ key: 'reach_diamond', name: 'Diamond Discipline' });
  }
  
  if (stats.current_rank === 'Apex Predator' && !db.prepare('SELECT id FROM achievements WHERE achievement_key = ?').get('apex_predator')) {
    achievements.push({ key: 'apex_predator', name: 'Apex Predator' });
  }

  return achievements;
}

// === Shared helpers for full-refund workout deletion ===
// Compute the same increment a workout would have added to a daily challenge
function dailyChallengeIncrement(template, exerciseType, reps) {
  if (!template) return 0;
  if (template.type === exerciseType) return reps;
  if (template.type === 'total') return reps;
  if (template.type === 'any') return 1;
  if (template.type === 'chest_stretch' && (exerciseType === 'chest_stretch' || exerciseType === 'neck_stretch' || exerciseType === 'cat_cow')) {
    return reps;
  }
  return 0;
}

// Roll back daily challenge progress for a single workout (today only — we can't undo past days)
function rollbackDailyChallengeProgress(exerciseType, reps) {
  const today = new Date().toISOString().split('T')[0];
  const challenges = db.prepare('SELECT * FROM daily_challenges WHERE challenge_date = ?').all(today);
  for (const challenge of challenges) {
    const template = DAILY_CHALLENGE_TEMPLATES.find(t => t.key === challenge.challenge_key);
    const increment = dailyChallengeIncrement(template, exerciseType, reps);
    if (increment <= 0) continue;
    const newProgress = Math.max(0, challenge.progress - increment);
    const wasCompleted = challenge.completed === 1;
    // Un-complete if dropping below target after refund
    const isComplete = wasCompleted ? (newProgress >= challenge.target_value) : (newProgress >= challenge.target_value);
    db.prepare('UPDATE daily_challenges SET progress = ?, completed = ? WHERE id = ?').run(newProgress, isComplete ? 1 : 0, challenge.id);
  }
}

// Roll back weekly goal progress for the current week
function rollbackWeeklyGoalProgress(exerciseType, reps) {
  const weekStart = getWeekStart();
  const goal = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ?').get(weekStart);
  if (!goal) return;
  const template = WEEKLY_GOAL_TEMPLATES.find(t => t.key === goal.goal_type);
  if (!template) return;
  if (!(template.type === exerciseType || template.type === 'total')) return;
  const newProgress = Math.max(0, goal.progress - reps);
  const wasCompleted = goal.completed === 1;
  const isComplete = wasCompleted ? (newProgress >= goal.target_value) : (newProgress >= goal.target_value);
  db.prepare('UPDATE weekly_goals SET progress = ?, completed = ? WHERE id = ?').run(newProgress, isComplete ? 1 : 0, goal.id);
}

// Recompute current + longest streak from remaining workouts
function recomputeStreaks() {
  const dateRows = db.prepare("SELECT DISTINCT strftime('%Y-%m-%d', created_at) as d FROM workouts ORDER BY d DESC").all();
  if (dateRows.length === 0) {
    db.prepare('UPDATE user_stats SET current_streak = 0, longest_streak = MAX(longest_streak, 0), last_workout_date = NULL WHERE id = 1').run();
    return { current_streak: 0, longest_streak: 0, last_workout_date: null };
  }
  // Walk backwards from the most recent date, counting consecutive days
  let current = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let cursor = new Date(dateRows[0].d + 'T00:00:00');
  // If the most recent workout is older than yesterday, current streak is 0
  const daysSinceLast = Math.floor((today - cursor) / (1000 * 60 * 60 * 24));
  if (daysSinceLast > 1) {
    current = 0;
  } else {
    // Count consecutive days from cursor going back
    const dateSet = new Set(dateRows.map(r => r.d));
    while (dateSet.has(cursor.toISOString().split('T')[0])) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }
  const longestResult = db.prepare('SELECT longest_streak as prev FROM user_stats WHERE id = 1').get();
  const longest = Math.max(longestResult?.prev || 0, current);
  const lastDate = dateRows[0].d;
  db.prepare('UPDATE user_stats SET current_streak = ?, longest_streak = ?, last_workout_date = ? WHERE id = 1').run(current, longest, lastDate);
  return { current_streak: current, longest_streak: longest, last_workout_date: lastDate };
}

// Revoke achievements no longer satisfied by current stats
function recheckAchievements() {
  const stats = db.prepare('SELECT * FROM user_stats WHERE id = 1').get();
  // We need a minimal stats-shape for checkAchievements (just total_xp, current_streak, level, current_rank)
  const earned = db.prepare('SELECT achievement_key FROM achievements').all().map(r => r.achievement_key);
  if (earned.length === 0) return [];
  // Build a fake "workout" arg (not used for most checks; needed for first_workout which only checks total_xp > 0)
  const stillEarned = checkAchievements({}, stats);
  const stillKeys = new Set(stillEarned.map(a => a.key));
  const revoked = [];
  for (const key of earned) {
    if (!stillKeys.has(key)) {
      db.prepare('DELETE FROM achievements WHERE achievement_key = ?').run(key);
      revoked.push(key);
    }
  }
  return revoked;
}

// Quick-log presets
const QUICK_PRESETS = {
  pushups: [
    { label: '+5', value: 5 },
    { label: '+10', value: 10 },
    { label: '+15', value: 15 },
    { label: '+20', value: 20 },
    { label: '+25', value: 25 }
  ],
  planks: [
    { label: '+15s', value: 15 },
    { label: '+30s', value: 30 },
    { label: '+45s', value: 45 },
    { label: '+60s', value: 60 },
    { label: '+90s', value: 90 }
  ],
  chest_stretch: [
    { label: '+15s', value: 15 },
    { label: '+30s', value: 30 },
    { label: '+45s', value: 45 }
  ],
  neck_stretch: [
    { label: '+10s', value: 10 },
    { label: '+20s', value: 20 },
    { label: '+30s', value: 30 }
  ],
  cat_cow: [
    { label: '+5', value: 5 },
    { label: '+10', value: 10 },
    { label: '+15', value: 15 }
  ],
  squats: [
    { label: '+10', value: 10 },
    { label: '+20', value: 20 },
    { label: '+30', value: 30 },
    { label: '+50', value: 50 }
  ],
  wall_sits: [
    { label: '+15s', value: 15 },
    { label: '+30s', value: 30 },
    { label: '+45s', value: 45 },
    { label: '+60s', value: 60 },
    { label: '+90s', value: 90 }
  ]
};

// Apex situation triggers
const APEX_SITUATIONS = [
  { id: 'lost_match', text: 'Lost a match', exercise: 'pushups', amount: 10, emoji: '💀' },
  { id: 'squad_wiped', text: 'Got squad wiped', exercise: 'pushups', amount: 15, emoji: '☠️' },
  { id: 'knocked_not_finished', text: 'Knocked but didn\'t finish', exercise: 'pushups', amount: 5, emoji: '😤' },
  { id: 'hot_drop_death', text: 'Hot drop death', exercise: 'pushups', amount: 20, emoji: '🔥' },
  { id: 'low_hp_win', text: 'Won with <100 HP', exercise: 'squats', amount: 5, emoji: '🏆' },
  { id: 'clutch_1v3', text: 'Clutch 1v3', exercise: 'pushups', amount: 25, emoji: '⚡' },
  { id: 'ranked_loss', text: 'Lost RP in ranked', exercise: 'planks', amount: 30, emoji: '📉' },
  { id: 'champion_squad', text: 'Champion squad win', exercise: 'pushups', amount: 10, emoji: '👑' }
];

// Log workout endpoint
app.post('/api/workouts', (req, res) => {
  const { exerciseType, reps, notes, source = 'manual' } = req.body;
  
  if (!exerciseType || !reps || reps < 1) {
    return res.status(400).json({ error: 'Invalid workout data' });
  }
  
  if (!EXERCISES[exerciseType]) {
    return res.status(400).json({ error: 'Invalid exercise type' });
  }
  
  const exercise = EXERCISES[exerciseType];
  const stats = db.prepare('SELECT * FROM user_stats WHERE id = 1').get();
  const xpCalc = calculateXP(exerciseType, reps, stats.selected_legend, stats.current_rank);
  
  // Check for active XP boost perk
  const now = new Date().toISOString();
  const activeBoost = db.prepare('SELECT * FROM perks WHERE perk_type = ? AND used = 1 AND expires_at > ?').get('xp_boost', now);
  if (activeBoost) {
    xpCalc.xp *= 2;
    xpCalc.rp *= 2;
    xpCalc.bonusApplied = true;
    xpCalc.multiplier *= 2;
  }
  
  const xpEarned = xpCalc.xp;
  const rpEarned = xpCalc.rp;
  const today = new Date().toISOString().split('T')[0];
  
  db.prepare('INSERT INTO workouts (exercise_type, reps, unit, xp_earned, notes, source) VALUES (?, ?, ?, ?, ?, ?)').run(exerciseType, reps, exercise.unit, xpEarned, notes || '', source);
  
  let totalXpGained = xpEarned;
  let totalRpGained = rpEarned;
  
  const newTotalXP = stats.total_xp + totalXpGained;
  const newLevel = calculateLevel(newTotalXP);
  const newSeasonXP = stats.season_xp + totalRpGained;
  const newRank = getRank(newSeasonXP);
  
  let newStreak = stats.current_streak;
  if (!stats.last_workout_date) {
    newStreak = 1;
  } else {
    const lastDate = new Date(stats.last_workout_date);
    const todayDate = new Date(today);
    const daysDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === 0) {
      newStreak = stats.current_streak;
    } else if (daysDiff === 1) {
      newStreak = stats.current_streak + 1;
    } else {
      newStreak = 1;
    }
  }
  
  // Streak milestone bonus
  let streakBonus = null;
  const oldLongestStreak = stats.longest_streak;
  const newLongestStreak = Math.max(stats.longest_streak, newStreak);
  
  if (newStreak === 7 && oldLongestStreak < 7) {
    totalRpGained += 50;
    streakBonus = { text: '7-day streak!', rp: 50 };
  } else if (newStreak === 14 && oldLongestStreak < 14) {
    totalRpGained += 100;
    streakBonus = { text: '14-day streak!', rp: 100 };
  } else if (newStreak === 30 && oldLongestStreak < 30) {
    totalRpGained += 200;
    streakBonus = { text: '30-day streak!', rp: 200 };
  }
  
  db.prepare(`UPDATE user_stats SET 
    total_xp = ?, level = ?, current_streak = ?, longest_streak = ?, 
    last_workout_date = ?, season_xp = ?, current_rank = ? 
    WHERE id = 1`).run(newTotalXP, newLevel, newStreak, newLongestStreak, today, stats.season_xp + totalRpGained, newRank);
  
  const newStats = { total_xp: newTotalXP, level: newLevel, current_streak: newStreak, current_rank: newRank };
  const achievements = checkAchievements({ exerciseType, reps }, newStats);
  
  let achievementRpBonus = 0;
  achievements.forEach(ach => {
    db.prepare('INSERT INTO achievements (achievement_key, achievement_name) VALUES (?, ?)').run(ach.key, ach.name);
    achievementRpBonus += 50;
  });
  
  if (achievementRpBonus > 0) {
    totalRpGained += achievementRpBonus;
    db.prepare('UPDATE user_stats SET season_xp = season_xp + ? WHERE id = 1').run(achievementRpBonus);
  }
  
  const completedChallenges = updateDailyChallengeProgress(exerciseType, reps);
  
  completedChallenges.forEach(ch => {
    totalXpGained += ch.xpReward;
    totalRpGained += 50; // Bonus RP for completing challenges
  });
  
  if (completedChallenges.length > 0) {
    const finalTotalXP = newTotalXP + completedChallenges.reduce((sum, c) => sum + c.xpReward, 0);
    db.prepare('UPDATE user_stats SET total_xp = ?, level = ? WHERE id = 1').run(finalTotalXP, calculateLevel(finalTotalXP));
  }
  
  const weeklyResult = updateWeeklyGoalProgress(exerciseType, reps);
  if (weeklyResult && weeklyResult.completed) {
    totalRpGained += weeklyResult.rp_bonus;
    db.prepare('UPDATE user_stats SET season_xp = season_xp + ? WHERE id = 1').run(weeklyResult.rp_bonus);
  }
  
  let packDropped = null;
  if (newLevel > stats.level) {
    packDropped = openApexPack();
    totalRpGained += 25; // RP for leveling up
    db.prepare('UPDATE user_stats SET season_xp = season_xp + 25 WHERE id = 1').run();
  }  
  const rankChanged = newRank !== stats.current_rank;
  
  res.json({
    success: true,
    xpEarned,
    rpEarned: totalRpGained,
    bonusApplied: xpCalc.bonusApplied,
    multiplier: xpCalc.multiplier,
    totalXP: newTotalXP + completedChallenges.reduce((sum, c) => sum + c.xpReward, 0),
    level: newLevel,
    newLevel,
    leveledUp: newLevel > stats.level,
    currentStreak: newStreak,
    achievementsUnlocked: achievements,
    packDropped,
    rankChanged,
    oldRank: stats.current_rank,
    newRank,
    completedChallenges,
    weeklyGoalCompleted: weeklyResult,
    streakBonus
  });
});

app.delete('/api/workouts/:id', (req, res) => {
  const { id } = req.params;
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);

  if (!workout) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  // 1) Roll back daily challenge + weekly goal progress for this workout
  rollbackDailyChallengeProgress(workout.exercise_type, workout.reps);
  rollbackWeeklyGoalProgress(workout.exercise_type, workout.reps);

  // 2) Delete the workout row
  db.prepare('DELETE FROM workouts WHERE id = ?').run(id);

  // 3) Refund XP and base RP from user_stats
  const stats = db.prepare('SELECT * FROM user_stats WHERE id = 1').get();
  const rpRefund = Math.round(workout.xp_earned * 0.4);
  const newTotalXP = Math.max(0, stats.total_xp - workout.xp_earned);
  const newLevel = calculateLevel(newTotalXP);
  const newSeasonXP = Math.max(0, stats.season_xp - rpRefund);
  const newRank = getRank(newSeasonXP);

  db.prepare(`UPDATE user_stats SET total_xp = ?, level = ?, season_xp = ?, current_rank = ? WHERE id = 1`)
    .run(newTotalXP, newLevel, newSeasonXP, newRank);

  // 4) Recompute streak from remaining workouts
  recomputeStreaks();

  // 5) Revoke any achievement no longer met (best-effort — extra RP bonuses stay spent)
  const revoked = recheckAchievements();

  res.json({
    success: true,
    refunded: { xp: workout.xp_earned, rp: rpRefund },
    revokedAchievements: revoked
  });
});

app.get('/api/stats', (req, res) => {
  const stats = db.prepare('SELECT * FROM user_stats WHERE id = 1').get();
  const xpForNextLevel = stats.level * 500;
  const xpInCurrentLevel = stats.total_xp - ((stats.level - 1) * 500);
  const rankProgress = getRankProgress(stats.season_xp);
  
  res.json({
    ...stats,
    xpForNextLevel,
    xpInCurrentLevel,
    progressPercent: Math.round((xpInCurrentLevel / 500) * 100),
    rankProgress
  });
});

app.get('/api/workouts', (req, res) => {
  const limit = req.query.limit || 50;
  const workouts = db.prepare('SELECT * FROM workouts ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(workouts);
});

app.get('/api/today-summary', (req, res) => {
  // Per-exercise reps completed today (since midnight local server time)
  const today = new Date().toISOString().split('T')[0];
  const rows = db.prepare(`
    SELECT exercise_type, SUM(reps) as reps, COUNT(*) as count
    FROM workouts
    WHERE date(created_at) = ?
    GROUP BY exercise_type
  `).all(today);
  const result = {};
  rows.forEach(r => { result[r.exercise_type] = { reps: r.reps, count: r.count }; });
  res.json({ date: today, perExercise: result });
});

app.get('/api/achievements', (req, res) => {
  const achievements = db.prepare('SELECT * FROM achievements ORDER BY unlocked_at DESC').all();
  res.json(achievements);
});

// Live progress for locked achievements (e.g. "47/100 pushups for Centurion")
app.get('/api/achievements/progress', (req, res) => {
  const stats = db.prepare('SELECT * FROM user_stats WHERE id = 1').get() || {};
  const totalPushups = (db.prepare("SELECT COALESCE(SUM(reps), 0) as total FROM workouts WHERE exercise_type = 'pushups'").get() || {}).total || 0;
  const totalWorkouts = (db.prepare("SELECT COUNT(*) as c FROM workouts").get() || {}).c || 0;
  res.json({
    first_workout:     { current: Math.min(totalWorkouts, 1),  target: 1,   unit: 'workouts' },
    hundred_pushups:   { current: totalPushups,                target: 100, unit: 'pushups' },
    week_streak:       { current: Math.min(stats.current_streak || 0, 7), target: 7, unit: 'days' },
    level_5:           { current: Math.min(stats.level || 1, 5),         target: 5, unit: 'level' },
    level_10:          { current: Math.min(stats.level || 1, 10),        target: 10, unit: 'level' },
    reach_gold:        { current: (stats.current_rank || '').includes('Gold') ? 1 : 0,        target: 1, unit: 'rank' },
    reach_diamond:     { current: (stats.current_rank || '').includes('Diamond') ? 1 : 0,     target: 1, unit: 'rank' },
    apex_predator:     { current: stats.current_rank === 'Apex Predator' ? 1 : 0,             target: 1, unit: 'rank' },
  });
});

app.get('/api/exercises', (req, res) => {
  const exerciseData = {
    pushups: {
      type: 'pushups',
      name: 'Pushups',
      unit: 'reps',
      description: 'Classic pushups to strengthen chest, shoulders, and triceps. Keep your core tight and back straight for posture benefits.',
      category: 'strength',
      difficulty: 'beginner',
      youtubeId: 'IODxDxX7oi4',
      steps: [
        'Start in plank position with hands shoulder-width apart, arms straight',
        'Keep your body in a straight line from head to heels',
        'Lower your chest toward the floor by bending your elbows (45° from body)',
        'Go down until your chest nearly touches the floor',
        'Push back up to starting position, fully extending arms',
        'Keep core engaged throughout - no sagging hips or piked butt',
        'Breathe in on the way down, out on the way up'
      ]
    },
    planks: {
      type: 'planks',
      name: 'Plank',
      unit: 'seconds',
      description: 'Hold a plank position to build core strength. Essential for maintaining good posture throughout the day.',
      category: 'core',
      difficulty: 'beginner',
      youtubeId: 'ASdvN_XEl_c',
      steps: [
        'Start on your forearms and toes, elbows directly under shoulders',
        'Forearms parallel, hands can be clasped or flat on the floor',
        'Keep your body in a straight line from head to heels',
        'Engage your core - imagine pulling your belly button toward your spine',
        'Squeeze your glutes and quads to keep hips level',
        'Don\'t let hips sag down or pike up',
        'Keep neck neutral - look at the floor about 30cm ahead of your hands',
        'Hold for the target duration, breathing steadily'
      ]
    },
    chest_stretch: {
      type: 'chest_stretch',
      name: 'Chest Stretch',
      unit: 'seconds',
      description: 'Doorway stretch to open up tight chest muscles from sitting at a desk. Counteracts rounded shoulders.',
      category: 'mobility',
      difficulty: 'beginner',
      youtubeId: 'O8rJw_TmC1Y',
      steps: [
        'Stand in a doorway with arms at 90° on each side of the frame',
        'Step one foot forward through the doorway',
        'Lean forward gently until you feel a stretch across your chest',
        'Keep your core engaged and back straight',
        'Don\'t arch your lower back or let your head drop forward',
        'Hold the stretch, breathing deeply',
        'Step back and relax, then repeat'
      ]
    },
    neck_stretch: {
      type: 'neck_stretch',
      name: 'Neck Stretch',
      unit: 'seconds',
      description: 'Gentle neck stretch to relieve tension from looking at screens. Helps with forward head posture.',
      category: 'mobility',
      difficulty: 'beginner',
      youtubeId: 'FRNtLrMf-1A',
      steps: [
        'Sit or stand with good posture, shoulders relaxed',
        'Tilt your head to the right, bringing your ear toward your shoulder',
        'Use your right hand to gently pull your head further into the stretch',
        'Keep your left shoulder down - don\'t let it rise up',
        'Hold the stretch without bouncing',
        'Slowly release and repeat on the other side',
        'Keep breathing deeply throughout'
      ]
    },
    cat_cow: {
      type: 'cat_cow',
      name: 'Cat-Cow',
      unit: 'reps',
      description: 'Spinal mobility exercise to relieve back tension and improve posture. Great between long sitting sessions.',
      category: 'mobility',
      difficulty: 'beginner',
      youtubeId: 'LIVJZZyZ2qM',
      steps: [
        'Start on hands and knees in a tabletop position',
        'Wrists under shoulders, knees under hips',
        'Inhale: drop your belly, lift your chest and tailbone (Cow)',
        'Look up gently, don\'t crank your neck',
        'Exhale: round your spine, tuck chin to chest (Cat)',
        'Engage your core, press hands into the floor',
        'Move slowly between positions, syncing with breath'
      ]
    },
    squats: {
      type: 'squats',
      name: 'Squats',
      unit: 'reps',
      description: 'Bodyweight squats to strengthen legs and core. Keep your chest up to reinforce good posture.',
      category: 'strength',
      difficulty: 'beginner',
      youtubeId: 'aclHkVaku9U',
      steps: [
        'Stand with feet shoulder-width apart, toes slightly turned out',
        'Keep your chest up and core engaged',
        'Initiate the movement by pushing your hips back, not by bending knees first',
        'Lower down as if sitting in a chair, keeping knees tracking over toes',
        'Go down until thighs are parallel to the floor (or as low as comfortable)',
        'Keep your weight in your heels and midfoot, not your toes',
        'Drive through your heels to stand back up',
        'Squeeze your glutes at the top of the movement'
      ]
    },
    wall_sits: {
      type: 'wall_sits',
      name: 'Wall Sit',
      unit: 'seconds',
      description: 'Hold a wall sit position to build leg strength and endurance. Keep your back flat against the wall.',
      category: 'strength',
      difficulty: 'intermediate',
      youtubeId: 'w7qVVT_h_lI',
      steps: [
        'Stand with your back against a wall, feet about 60cm away from the wall',
        'Slide your back down the wall by bending your knees',
        'Lower until your thighs are parallel to the floor (knees at 90°)',
        'Keep your back flat against the wall the entire time',
        'Knees should be directly above your ankles, not past your toes',
        'Cross your arms over your chest or place hands on thighs',
        'Keep core engaged and breathe normally',
        'Hold for the target duration - aim to increase time progressively'
      ]
    }
  };
  res.json(exerciseData);
});

app.get('/api/legends', (req, res) => {
  res.json(LEGENDS);
});

app.post('/api/select-legend', (req, res) => {
  const { legend } = req.body;
  if (!LEGENDS[legend]) {
    return res.status(400).json({ error: 'Invalid legend' });
  }
  
  const stats = db.prepare('SELECT * FROM user_stats WHERE id = 1').get();
  const currentWeek = getWeekStart();
  
  // Check if user is trying to change legend mid-week
  if (stats.legend_week_start && stats.legend_week_start === currentWeek && stats.selected_legend !== legend) {
    return res.status(400).json({ 
      error: 'Legend locked for this week', 
      message: `You picked ${stats.selected_legend} this week. Wait until next Monday to change.`,
      currentLegend: stats.selected_legend
    });
  }
  
  // First time or new week - allow selection
  db.prepare('UPDATE user_stats SET selected_legend = ?, legend_week_start = ? WHERE id = 1').run(legend, currentWeek);
  
  res.json({ success: true, legend: LEGENDS[legend], weekStart: currentWeek });
});

app.get('/api/legend-status', (req, res) => {
  const stats = db.prepare('SELECT selected_legend, legend_week_start FROM user_stats WHERE id = 1').get();
  const currentWeek = getWeekStart();
  const canChange = !stats.legend_week_start || stats.legend_week_start !== currentWeek;
  const activeKey = stats.selected_legend || 'wraith';
  const active = LEGENDS[activeKey] || LEGENDS.wraith;

  res.json({
    selectedLegend: activeKey,
    legend: active,
    weekStart: stats.legend_week_start,
    currentWeek,
    canChange
  });
});

app.get('/api/daily-challenges', (req, res) => {
  generateDailyChallenges();
  const today = new Date().toISOString().split('T')[0];
  const challenges = db.prepare('SELECT * FROM daily_challenges WHERE challenge_date = ? ORDER BY id').all(today);
  res.json(challenges);
});

app.get('/api/weekly-goal', (req, res) => {
  generateWeeklyGoal();
  const weekStart = getWeekStart();
  const goal = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ? ORDER BY id DESC LIMIT 1').get(weekStart);
  
  if (!goal) return res.json(null);
  
  const template = WEEKLY_GOAL_TEMPLATES.find(t => t.key === goal.goal_type);
  res.json({ ...goal, text: template ? template.text : 'Weekly Goal', rp_bonus: template ? template.rp_bonus : 0 });
});

app.get('/api/quick-presets', (req, res) => {
  res.json(QUICK_PRESETS);
});

app.get('/api/apex-situations', (req, res) => {
  res.json(APEX_SITUATIONS);
});

app.get('/api/inventory', (req, res) => {
  const items = db.prepare('SELECT * FROM inventory ORDER BY acquired_at DESC').all();
  res.json(items);
});

app.get('/api/programs', (req, res) => {
  const programs = db.prepare('SELECT * FROM programs ORDER BY unlocked_at DESC').all();
  res.json(programs);
});

app.get('/api/program/:id', (req, res) => {
  const { id } = req.params;
  const program = db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  if (!program) return res.status(404).json({ error: 'Program not found' });
  const days = db.prepare('SELECT * FROM program_days WHERE program_id = ? ORDER BY day_number').all(id);
  res.json({ ...program, days });
});

app.post('/api/program/:id/start', (req, res) => {
  const { id } = req.params;
  // Deactivate other programs
  db.prepare('UPDATE programs SET active = 0').run();
  // Activate this one
  db.prepare('UPDATE programs SET active = 1, started_at = CURRENT_TIMESTAMP, current_day = 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/program/:id/advance', (req, res) => {
  const { id } = req.params;
  const program = db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  if (!program) return res.status(404).json({ error: 'Program not found' });
  
  const nextDay = program.current_day + 1;
  if (nextDay > program.duration_days) {
    db.prepare('UPDATE programs SET completed_at = CURRENT_TIMESTAMP, active = 0 WHERE id = ?').run(id);
    return res.json({ success: true, completed: true });
  }
  
  db.prepare('UPDATE programs SET current_day = ? WHERE id = ?').run(nextDay, id);
  res.json({ success: true, currentDay: nextDay });
});

app.get('/api/perks', (req, res) => {
  const perks = db.prepare('SELECT * FROM perks ORDER BY acquired_at DESC').all();
  res.json(perks);
});

app.post('/api/perk/:id/activate', (req, res) => {
  const { id } = req.params;
  const perk = db.prepare('SELECT * FROM perks WHERE id = ?').get(id);
  if (!perk) return res.status(404).json({ error: 'Perk not found' });
  if (perk.used) return res.status(400).json({ error: 'Perk already used' });
  
  const now = new Date();
  let expiresAt = null;
  
  if (perk.perk_type === 'xp_boost') {
    expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  
  db.prepare('UPDATE perks SET activated_at = CURRENT_TIMESTAMP, expires_at = ?, used = 1 WHERE id = ?').run(expiresAt, id);
  res.json({ success: true, perk });
});

app.get('/api/active-perks', (req, res) => {
  const now = new Date().toISOString();
  const perks = db.prepare('SELECT * FROM perks WHERE used = 1 AND (expires_at IS NULL OR expires_at > ?)').all(now);
  res.json(perks);
});

app.post('/api/equip-item', (req, res) => {
  const { itemId } = req.body;
  db.prepare('UPDATE inventory SET equipped = 0').run();
  db.prepare('UPDATE inventory SET equipped = 1 WHERE id = ?').run(itemId);
  res.json({ success: true });
});

app.post('/api/unequip-item', (req, res) => {
  const { itemId } = req.body;
  db.prepare('UPDATE inventory SET equipped = 0 WHERE id = ?').run(itemId);
  res.json({ success: true });
});

app.get('/api/showcase', (req, res) => {
  const equippedBadge = db.prepare('SELECT * FROM inventory WHERE item_type = ? AND equipped = 1').get('badge');
  const equippedTitle = db.prepare('SELECT * FROM inventory WHERE item_type = ? AND equipped = 1').get('title');
  const stats = db.prepare('SELECT * FROM user_stats WHERE id = 1').get();
  const totalItems = db.prepare('SELECT COUNT(*) as count FROM inventory').get().count;
  const legendaryCount = db.prepare('SELECT COUNT(*) as count FROM inventory WHERE item_rarity = ?').get('legendary').count;
  
  res.json({
    equippedBadge,
    equippedTitle,
    totalItems,
    legendaryCount,
    title: stats.selected_legend ? stats.selected_legend.charAt(0).toUpperCase() + stats.selected_legend.slice(1) : 'Wraith'
  });
});

app.get('/api/rank-tiers', (req, res) => {
  res.json(RANK_TIERS);
});

// Serve frontend
const FRONTEND_PATH = path.join(__dirname, 'frontend');
app.use(express.static(FRONTEND_PATH));
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Posture app running on port ${PORT}`);
});