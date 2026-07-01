// RaceStrip — a clear DOM race showing YOU vs the "ghosts" of Hive accounts you follow.
// Each ghost advances at a pace from their real Hive activity; you advance by score.
// Uses <img> avatars (DOM images need no CORS, unlike WebGL). Ghosts are avatar-only
// (names shown via the overtake toast) so the strip stays legible.

import type { Ghost } from "../hive/HiveSocial.ts";

interface Racer {
  name: string;
  pace: number;      // pts/sec (0 for the player — position comes from score)
  isPlayer: boolean;
  chip: HTMLElement;
  passed: boolean;
}

export class RaceStrip {
  private caption: HTMLElement;
  private track: HTMLElement;
  private racers: Racer[] = [];
  private target: number;
  private onPass?: (name: string) => void;
  private onFinish?: () => void;
  private playerFinished = false;

  constructor(private root: HTMLElement, target = 300) {
    this.target = target;
    this.root.innerHTML = "";
    this.root.style.display = "none";
    this.caption = document.createElement("div");
    this.caption.className = "race-caption";
    this.track = document.createElement("div");
    this.track.className = "race-track";
    this.root.append(this.caption, this.track);
  }

  setGhosts(ghosts: Ghost[], onPass?: (name: string) => void, onFinish?: () => void) {
    this.onPass = onPass;
    this.onFinish = onFinish;
    this.playerFinished = false;
    this.track.innerHTML = "";
    this.racers = [];
    if (!ghosts.length) { this.root.style.display = "none"; return; }
    this.root.style.display = "block";
    this.caption.textContent = "🏁 Racing your Hive friends — pass them!";
    this.addRacer("you", 0, true);
    ghosts.forEach((g) => this.addRacer(g.name, g.pace, false));
    this.layout(0, 0);
  }

  private addRacer(name: string, pace: number, isPlayer: boolean) {
    const chip = document.createElement("div");
    chip.className = "racer" + (isPlayer ? " you" : "");
    const img = document.createElement("img");
    img.src = `https://images.hive.blog/u/${isPlayer ? "null" : name}/avatar`;
    img.alt = name; img.title = isPlayer ? "you" : "@" + name;
    chip.appendChild(img);
    if (isPlayer) {
      const tag = document.createElement("span");
      tag.textContent = "YOU";
      chip.appendChild(tag);
    }
    this.track.appendChild(chip);
    this.racers.push({ name, pace, isPlayer, chip, passed: false });
  }

  setPlayerAvatar(account: string) {
    const you = this.racers.find((r) => r.isPlayer);
    const img = you?.chip.querySelector("img");
    if (img) img.src = `https://images.hive.blog/u/${account}/avatar`;
  }

  update(score: number, elapsedMs: number) {
    if (!this.racers.length) return;
    const playerProg = Math.min(1, score / this.target);
    if (!this.playerFinished && playerProg >= 1) { this.playerFinished = true; this.onFinish?.(); }
    for (const r of this.racers) {
      if (r.isPlayer) continue;
      const ghostProg = Math.min(1, (r.pace * (elapsedMs / 1000)) / this.target);
      if (!r.passed && playerProg > ghostProg && playerProg > 0.02) {
        r.passed = true;
        this.onPass?.(r.name);
      }
    }
    this.layout(score, elapsedMs);
  }

  private layout(score: number, elapsedMs: number) {
    this.racers.forEach((r, i) => {
      const prog = r.isPlayer
        ? Math.min(1, score / this.target)
        : Math.min(1, (r.pace * (elapsedMs / 1000)) / this.target);
      r.chip.style.left = `calc(${(prog * 100).toFixed(1)}% - 16px)`;
      // two vertical lanes so bunched avatars don't fully overlap (player always front)
      r.chip.style.top = r.isPlayer ? "3px" : `${3 + (i % 2) * 20}px`;
      r.chip.style.zIndex = r.isPlayer ? "5" : "1";
    });
  }

  reset() {
    for (const r of this.racers) r.passed = false;
    this.playerFinished = false;
    this.layout(0, 0);
  }
}
