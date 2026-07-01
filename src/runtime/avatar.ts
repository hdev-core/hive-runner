// Loads a Hive account's profile picture and masks it into a circular avatar on a coin
// Graphics. Falls back silently to the coin's fill color if the image fails to load.
// images.hive.blog avatars lack CORS headers (WebGL needs them), so we route through the
// CORS-enabled wsrv.nl image proxy. Textures are cached by URL by Assets.

import { Assets, Graphics, Sprite } from "pixi.js";

export function attachAvatar(gfx: Graphics, account: string, r: number) {
  if (!account) return;
  const url = `https://wsrv.nl/?url=images.hive.blog/u/${account}/avatar&w=96&h=96&output=png`;
  Assets.load({ src: url, loadParser: "loadTextures" })
    .then((tex) => {
      if (!tex || gfx.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.width = r * 2;
      sprite.height = r * 2;
      const mask = new Graphics().circle(0, 0, r).fill(0xffffff);
      const ring = new Graphics().circle(0, 0, r).stroke({ width: 3, color: 0x5a9bff, alpha: 0.95 });
      gfx.addChild(sprite, mask, ring);
      sprite.mask = mask;
    })
    .catch(() => { /* keep the solid-color fallback */ });
}
