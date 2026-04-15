# Assets para Página 3: Face Tracking + Expressions

La implementación actual de esta demo carga un modelo VRM estático:

## Modelo 3D
- `character.vrm` — Modelo VRM con esqueleto humanoid estándar

Importante:
- Esta página hoy usa `FaceLandmarker` solo para medir carga y mostrar debug.
- Todavía no aplica blendshapes del tracking al modelo 3D.
- Si más adelante querés conectar expresiones reales, ahí sí conviene migrar a un GLB con morph targets ARKit.
