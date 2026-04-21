# Assets for Page 3: Face Tracking + Expressions

The current implementation of this demo loads a static VRM model:

## 3D Model
- `character.vrm` — VRM model with a standard humanoid skeleton

Important:
- This page currently uses `FaceLandmarker` only to measure load and show debug output.
- It does not yet apply tracking blendshapes to the 3D model.
- If you later want to connect real expressions, it would make sense to migrate to a GLB with ARKit morph targets.
