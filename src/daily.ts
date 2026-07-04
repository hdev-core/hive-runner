// Daily streaks + quests — client-side retention layer (localStorage, no backend).
//
// • Streak: consecutive UTC days you play a run. Keeps counting if you played yesterday,
//   resets if you miss a day. Streak grants bonus lives (retention → better runs).
// • Quests: 3 objectives per day, chosen deterministically from the UTC date (everyone gets
//   the same set, stable across reloads). Completing them grants bonus lives.
//
// Rewards are in-game boosts (not payouts) — a low-risk, self-contained loop. On-chain
// verification of streaks/quests (from signed score ops) is a future upgrade.

const KEY = "hiverunner_daily";
const MAX_STREAK_BONUS = 3; // extra lives cap from streak
const MAX_QUEST_BONUS = 3;  // extra lives cap from completed quests

export interface RunStats {
  score: number;
  level: number;
  surviveSec: number;
  postCoins: number;
}

interface QuestDef {
  id: string;
  label: (t: number) => string;
  target: number;
  mode: "best" | "sum";               // best-in-a-run vs cumulative-today
  measure: (s: RunStats) => number;
}

// pool of possible daily quests
const POOL: QuestDef[] = [
  { id: "score250", label: (t) => `Score ${t} in one run`, target: 250, mode: "best", measure: (s) => s.score },
  { id: "score500", label: (t) => `Score ${t} in one run`, target: 500, mode: "best", measure: (s) => s.score },
  { id: "level3", label: (t) => `Reach level ${t}`, target: 3, mode: "best", measure: (s) => s.level },
  { id: "survive40", label: (t) => `Survive ${t}s in one run`, target: 40, mode: "best", measure: (s) => s.surviveSec },
  { id: "postcoins3", label: (t) => `Collect ${t} post-coins`, target: 3, mode: "sum", measure: (s) => s.postCoins },
  { id: "runs3", label: (t) => `Play ${t} runs`, target: 3, mode: "sum", measure: () => 1 },
  { id: "total800", label: (t) => `Score ${t} total today`, target: 800, mode: "sum", measure: (s) => s.score },
];

export interface QuestView { id: string; label: string; progress: number; target: number; done: boolean; }

interface DailyState {
  date: string;                 // UTC day this state is for
  streak: number;
  lastPlayed: string;           // UTC day of the last counted play ("" if never)
  playedToday: boolean;
  questIds: string[];
  progress: Record<string, number>;
  done: Record<string, boolean>;
}

function todayUTC(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return todayUTC(d);
}

// deterministic hash of a string → uint32 (so the daily quest set is stable for everyone)
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// pick 3 distinct quests for the given UTC day, deterministically
function pickQuests(date: string): string[] {
  const picks: string[] = [];
  let seed = hash(date);
  const pool = POOL.map((q) => q.id);
  while (picks.length < 3 && pool.length) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const idx = seed % pool.length;
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

function fresh(date: string, streak: number, lastPlayed: string): DailyState {
  return { date, streak, lastPlayed, playedToday: false, questIds: pickQuests(date), progress: {}, done: {} };
}

function load(): DailyState {
  const today = todayUTC();
  let st: DailyState | null = null;
  try { st = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { st = null; }
  if (!st || st.date !== today) {
    // roll over to a new day: keep streak if we played yesterday, else it will reset on next play
    const streak = st ? st.streak : 0;
    const lastPlayed = st ? st.lastPlayed : "";
    st = fresh(today, streak, lastPlayed);
    save(st);
  }
  return st;
}
function save(st: DailyState) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }

/** Call when a run starts. Updates the streak for the first play of the day. Returns the streak. */
export function markPlayed(): { streak: number; increased: boolean } {
  const st = load();
  if (st.playedToday) return { streak: st.streak, increased: false };
  const today = todayUTC();
  let increased = false;
  if (st.lastPlayed === yesterdayUTC()) { st.streak += 1; increased = true; }
  else if (st.lastPlayed !== today) { st.streak = 1; increased = true; }
  st.lastPlayed = today;
  st.playedToday = true;
  save(st);
  return { streak: st.streak, increased };
}

/** Call at the end of a run. Advances quest progress; returns the labels of newly-completed quests. */
export function recordRun(stats: RunStats): string[] {
  const st = load();
  const newlyDone: string[] = [];
  for (const id of st.questIds) {
    if (st.done[id]) continue;
    const q = POOL.find((p) => p.id === id)!;
    const v = q.measure(stats);
    st.progress[id] = q.mode === "best" ? Math.max(st.progress[id] ?? 0, v) : (st.progress[id] ?? 0) + v;
    if (st.progress[id] >= q.target) { st.done[id] = true; newlyDone.push(q.label(q.target)); }
  }
  save(st);
  return newlyDone;
}

export function getStreak(): number { return load().streak; }

export function getQuests(): QuestView[] {
  const st = load();
  return st.questIds.map((id) => {
    const q = POOL.find((p) => p.id === id)!;
    return { id, label: q.label(q.target), progress: Math.min(st.progress[id] ?? 0, q.target), target: q.target, done: !!st.done[id] };
  });
}

/** Bonus starting lives from the current streak + quests completed today. */
export function getDailyBonusLives(): number {
  const st = load();
  const streakBonus = Math.min(MAX_STREAK_BONUS, Math.floor(st.streak / 2));
  const questBonus = Math.min(MAX_QUEST_BONUS, Object.values(st.done).filter(Boolean).length);
  return streakBonus + questBonus;
}
