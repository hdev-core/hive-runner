// RaceStrip — a DOM overlay showing YOU racing the "ghosts" of Hive accounts you follow.
// Each ghost advances at a pace derived from their real Hive activity; you advance by score.
// First to the target wins. Uses <img> avatars (DOM images need no CORS, unlike WebGL).

import type { Ghost } from "../hive/HiveSocial.ts";

interface Racer {
  name: string;
  pace: number;      // pts/sec (0 for the player — position comes from score)
  isPlayer: boolean;
  chip: HTMLElement;
  passed: boolean;   // player has overtaken this ghost
}

export class RaceStrip {
  private track: HTMLElement;
  private racers: Racer[] = [];
  private target: number;
  private onPass?: (name: string) => void;

  constructor(private root: HTMLElement, target = 300) {
    this.target = target;
    this.root.innerHTML = "";
    this.root.style.display = "none";
    const track = document.createElement("div");
    track.className = "race-track";
    this.root.appendChild(track);
    this.track = track;
  }

  setGhosts(ghosts: Ghost[], onPass?: (name: string) => void) {
    this.onPass = onPass;
    this.track.innerHTML = "";
    this.racers = [];
    if (!ghosts.length) { this.root.style.display = "none"; return; }
    this.root.style.display = "block";
    this.addRacer("you", 0, true);
    for (const g of ghosts) this.addRacer(g.name, g.pace, false);
    this.layout(0, 0);
  }

  private addRacer(name: string, pace: number, isPlayer: boolean) {
    const chip = document.createElement("div");
    chip.className = "racer" + (isPlayer ? " you" : "");
    const img = document.createElement("img");
    img.src = isPlayer
      ? "https://images.hive.blog/u/null/avatar" // generic; overridden if logged in
      : `https://images.hive.blog/u/${name}/avatar`;
    img.alt = name;
    const tag = document.createElement("span");
    tag.textContent = isPlayer ? "you" : name;
    chip.append(img, tag);
    this.track.appendChild(chip);
    this.racers.push({ name, pace, isPlayer, chip, passed: false });
  }

  /** Set the player's avatar once we know who they are. */
  setPlayerAvatar(account: string) {
    const you = this.racers.find((r) => r.isPlayer);
    if (you) {
      const img = you.chip.querySelector("img");
      if (img) img.src = `https://images.hive.blog/u/${account}/avatar`;
      const tag = you.chip.querySelector("span");
      if (tag) tag.textContent = account;
    }
  }

  update(score: number, elapsedMs: number) {
    if (!this.racers.length) return;
    const playerProg = Math.min(1, score / this.target);
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
    for (const r of this.racers) {
      const prog = r.isPlayer
        ? Math.min(1, score / this.target)
        : Math.min(1, (r.pace * (elapsedMs / 1000)) / this.target);
      r.chip.style.left = `calc(${(prog * 100).toFixed(1)}% - 14px)`;
    }
  }

  reset() {
    for (const r of this.racers) { r.passed = false; }
    this.layout(0, 0);
  }
}
