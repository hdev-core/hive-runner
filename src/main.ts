import { Application } from "pixi.js";
import type { GameSpec } from "./types/spec.ts";
import { fruitRush } from "./specs/fruitRush.ts";
import { meteorDodge } from "./specs/meteorDodge.ts";
import { runnerDash } from "./specs/runnerDash.ts";
import { makeActivity } from "./activity/mockActivity.ts";
import { applyHooks } from "./runtime/hooks.ts";
import { createEngine, type ArchetypeEngine } from "./runtime/createEngine.ts";
import type { EngineState } from "./runtime/FallingEngine.ts";
import { HiveFeed } from "./hive/HiveFeed.ts";

const $ = (id: string) => document.getElementById(id)!;

const SPECS: Record<string, GameSpec> = { fruitRush, meteorDodge, runnerDash };
let currentSpec: GameSpec = runnerDash; // flagship game opens by default

// --- DOM refs ---------------------------------------------------------------
const host = $("stage-host");
const manaSlider = $("mana-slider") as HTMLInputElement;
const opsSlider = $("ops-slider") as HTMLInputElement;
const stepsSlider = $("steps-slider") as HTMLInputElement;
const gameSelect = $("game-select") as HTMLSelectElement;
const vBlock = $("v-block");
const vOps = $("v-ops");

// live, read-only Hive block feed — drives the block ticker, pulse, and on-chain event spawns
const hiveFeed = new HiveFeed();
hiveFeed.onBlock = (info) => {
  vBlock.textContent = `#${info.num}`;
  vOps.textContent = `@${info.witness || "?"} · ${info.opCount} ops · ${info.transfers} xfer · ${info.posts} posts${info.topTransfer ? ` · top ${Math.round(info.topTransfer.amount)} ${info.topTransfer.symbol}` : ""}`;
};
hiveFeed.start();
const vBaseline = $("v-baseline");
const vActivity = $("v-activity");
const vBonusFeed = $("v-bonus");
const vEnergy = $("v-energy");
const vBonusLives = $("v-bonuslives");
const vBasket = $("v-basket");
const vScoreMult = $("v-scoremult");

// surface any fatal error on-screen instead of a blank canvas
function showFatal(msg: string) {
  host.innerHTML = `<div style="color:#ff9a9a;background:#1a1420;border:1px solid #402;border-radius:12px;padding:18px 20px;max-width:440px;font-size:13px;line-height:1.5">⚠️ ${msg}</div>`;
}
window.addEventListener("unhandledrejection", (e) => showFatal("Startup error: " + ((e.reason && e.reason.message) || e.reason)));
window.addEventListener("error", (e) => showFatal("Startup error: " + e.message));

// --- Pixi app + game lifecycle ---------------------------------------------
const app = new Application();
let engine: ArchetypeEngine | null = null;

// NOTE: no top-level await — that deadlocks Pixi's async init in the Vite prod bundle
// (works in dev, hangs in build). Boot is a fire-and-forget async function instead.
async function boot() {
  try {
    host.textContent = "starting renderer…";
    await app.init({
      width: currentSpec.world.width,
      height: currentSpec.world.height,
      background: parseBg(currentSpec.world.palette?.[2]) ?? 0x101018,
      antialias: true,
      preference: "webgl", // WebGL is universally stable; WebGPU can fail to init on some GPUs
    });
  } catch (err) {
    showFatal("Renderer failed to start: " + ((err as Error)?.message ?? String(err)));
    return;
  }
  host.textContent = "";
  host.appendChild(app.canvas);
  app.canvas.style.width = "min(480px, 92vw)";
  app.canvas.style.height = "auto";

  app.ticker.add((t) => engine?.update(t.deltaMS)); // Pixi's own RAF loop

  $("apply-btn").addEventListener("click", () => start());
  $("restart-btn").addEventListener("click", () => start());
  gameSelect.addEventListener("change", () => {
    currentSpec = SPECS[gameSelect.value] ?? fruitRush;
    start();
  });

  start();
}

function start() {
  // tear down previous run
  engine?.destroy();
  app.stage.removeChildren();

  $("game-title").textContent = currentSpec.meta.title;
  $("archetype-label").textContent = currentSpec.meta.archetype;
  app.renderer.background.color = parseBg(currentSpec.world.palette?.[2]) ?? 0x101018;

  const activity = makeActivity({
    ops24h: Number(opsSlider.value),
    manaPct: Number(manaSlider.value),
    steps: Number(stepsSlider.value),
  });
  const applied = applyHooks(currentSpec, activity);

  // update the live debug panel
  const b = activity.breakdown;
  vBaseline.textContent = `+${b.baseline}`;
  vActivity.textContent = `+${b.activity}`;
  vBonusFeed.textContent = `+${b.bonus}`;
  vEnergy.textContent = `${activity.energy}  ·  vitality ${(activity.vitality * 100).toFixed(0)}%`;
  vBonusLives.textContent = `+${applied.bonusLives}`;
  vBasket.textContent = `×${applied.basketWidthFactor}`;
  vScoreMult.textContent = `×${applied.scoreMultiplier}`;

  engine = createEngine(app, applied.effectiveSpec, applied.bonusLives, applied.scoreMultiplier, onState, hiveFeed);
  engine.mount();
}

function onState(_s: EngineState) {
  // hook for future: push score/lives to DOM, telemetry, etc.
}

void boot();

function parseBg(s?: string): number | null {
  if (!s) return null;
  const n = parseInt(s.replace("#", ""), 16);
  return Number.isNaN(n) ? null : n;
}
