(function () {
  function createLine(text, fontSize, fontWeight) {
    const line = document.createElement('div');
    line.textContent = text;
    line.style.fontSize = fontSize;
    line.style.fontWeight = fontWeight;
    return line;
  }

  window.createStatsOverlay = function createStatsOverlay() {
    const root = document.createElement('div');
    root.style.width = '80px';
    root.style.padding = '6px 8px';
    root.style.background = 'rgba(0, 0, 0, 0.82)';
    root.style.color = '#0f0';
    root.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    root.style.lineHeight = '1.2';
    root.style.borderBottomRightRadius = '6px';
    root.style.pointerEvents = 'none';

    const labelEl = createLine('FPS', '10px', '700');
    const fpsEl = createLine('--', '18px', '700');
    const msEl = createLine('-- ms', '10px', '400');
    root.append(labelEl, fpsEl, msEl);

    let sampleStart = performance.now();
    let frameCount = 0;
    let beginTime = sampleStart;

    const overlay = {
      dom: root,
      showPanel() {},
      begin() {
        beginTime = performance.now();
      },
      end() {
        const endTime = performance.now();
        const frameMs = endTime - beginTime;
        frameCount += 1;

        if (endTime >= sampleStart + 500) {
          const fps = (frameCount * 1000) / (endTime - sampleStart);
          fpsEl.textContent = String(Math.max(0, Math.round(fps)));
          msEl.textContent = `${frameMs.toFixed(1)} ms`;
          sampleStart = endTime;
          frameCount = 0;
        }

        return endTime;
      },
      update() {
        overlay.begin();
        return overlay.end();
      }
    };

    return overlay;
  };
})();