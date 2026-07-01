// Shared runtime state shape reported by every archetype engine.
export interface EngineState {
  score: number;
  lives: number;
  level: number;
  target: number;   // catches (catcher) or seconds (dodger/runner)
  caught: number;   // catcher progress; 0 for time-based games
  elapsed: number;
  over: boolean;
}
