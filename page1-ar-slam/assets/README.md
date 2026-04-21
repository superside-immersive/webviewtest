# Assets for Page 1: AR SLAM

Place the following files here:

## 3D Model
- `character.vrm` — Character VRM model (for example: `finalsnoo.vrm` from the `slam` repo)

## Animations (FBX format, Mixamo rig)
- `idle.fbx` — Looping idle animation
- `jump.fbx` — Jump animation (one-shot)

## Sounds (MP3 or WAV format)
- `sound1.mp3` — Sound for button 1
- `sound2.mp3` — Sound for button 2
- `sound3.mp3` — Sound for button 3

## 8th Wall Engine
You also need to copy the `xr-standalone/` folder from the `superside-immersive/slam` repo
to `page1-ar-slam/xr-standalone/`

## Local Preview
If you do not copy `xr-standalone/`, the page now falls back to a local 3D preview without SLAM.
For real AR on mobile, you still need `xr-standalone/` and must open the page over `https://`.
