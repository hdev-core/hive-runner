# Playforge — Stage 1 Prototype

A thin, runnable prototype of the **AI-built, activity-powered game platform** (see [../project-concept.md](../project-concept.md)). This validates the two make-or-break bets *before* any LLM or blockchain is wired in:

1. **The spec→runtime model works** — a declarative game-spec drives a fixed engine (no code generation, no `eval`).
2. **Activity hooks feel good** — real-world activity (mock here) visibly changes the game.

This build implements **one archetype (`catcher`)**, the **"Fruit Rush"** spec from [../game-spec-schema.md](../game-spec-schema.md) §9, and the two activity hooks (`energy → bonus lives`, `steps → fruit spawn rate`) against a **mock activity** provider with a live slider.

## Run

```bash
cd c:/mo/coding/playforge
npm install
npm run dev
```

Open the printed local URL. Move the basket with the **pointer** (drag) or **← →** keys. Catch fruit, dodge rocks.

Use the **Mock steps** slider + **Apply & restart** to see activity change the game:
- more steps → more **energy** → more **bonus starting lives**
- more steps → higher **fruit spawn-rate multiplier** (more fruit on screen)

## How it maps to the design

| Concept | Where |
|---|---|
| Game-spec (declarative, no code) | `src/specs/fruitRush.ts`, types in `src/types/spec.ts` |
| Fixed archetype engine (the safety model) | `src/runtime/CatcherEngine.ts` |
| Activity hooks applied pre-session | `src/runtime/hooks.ts` |
| Mock Actifit activity (→ replace with real on-chain read) | `src/activity/mockActivity.ts` |
| Pixi runs its own loop; DOM is only the shell | `src/main.ts` (`app.ticker`, panel) |

## What's intentionally NOT here (later stages)
LLM generation, schema validator + sanity checks, the other 4 archetypes, real Actifit/Hive integration, ownership/economy, asset kit (uses colored shapes). See `stage1-spec.md` and `game-spec-schema.md`.

## Next steps
1. Play it; tune the catcher until the loop *feels* fun.
2. Add the JSON-Schema validator + sanity checks (`game-spec-schema.md` §7–8).
3. Implement a 2nd archetype (`reaction`) to prove the spec generalizes.
4. Wire the LLM generation pipeline (prompt = archetype catalog + schema + the two worked examples as few-shot).
