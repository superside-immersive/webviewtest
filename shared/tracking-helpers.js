(function () {
  const POSE_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 7],
    [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10],
    [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [27, 29], [29, 31],
    [24, 26], [26, 28], [28, 30], [30, 32]
  ];

  const FACE_GROUPS = [
    [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    [33, 160, 158, 133, 153, 144],
    [362, 385, 387, 263, 373, 380],
    [70, 63, 105, 66, 107],
    [336, 296, 334, 293, 300],
    [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
    [168, 6, 197, 195, 5, 4, 1, 19, 94, 2]
  ];

  function syncOverlayCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return { ctx, dpr };
  }

  function getProjector(video, canvas, mirrored) {
    const sourceWidth = video.videoWidth || 1;
    const sourceHeight = video.videoHeight || 1;
    const sourceAspect = sourceWidth / sourceHeight;
    const targetWidth = canvas.width;
    const targetHeight = canvas.height;
    const targetAspect = targetWidth / targetHeight;

    let drawWidth = targetWidth;
    let drawHeight = targetHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (sourceAspect > targetAspect) {
      drawHeight = targetHeight;
      drawWidth = drawHeight * sourceAspect;
      offsetX = (targetWidth - drawWidth) * 0.5;
    } else {
      drawWidth = targetWidth;
      drawHeight = drawWidth / sourceAspect;
      offsetY = (targetHeight - drawHeight) * 0.5;
    }

    return (point) => {
      const x = offsetX + point.x * drawWidth;
      const projectedX = mirrored ? targetWidth - x : x;
      const projectedY = offsetY + point.y * drawHeight;
      return { x: projectedX, y: projectedY };
    };
  }

  function drawPoint(ctx, point, radius, fillStyle) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function drawPolyline(ctx, indices, landmarks, project, strokeStyle, lineWidth, closePath) {
    if (!indices.length) return;

    ctx.beginPath();
    let started = false;

    for (const index of indices) {
      const landmark = landmarks[index];
      if (!landmark) continue;
      const point = project(landmark);
      if (!started) {
        ctx.moveTo(point.x, point.y);
        started = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }

    if (started && closePath) ctx.closePath();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function drawPose(canvas, video, landmarks, options) {
    const settings = options || {};
    const mirrored = settings.mirrored !== false;
    const { ctx, dpr } = syncOverlayCanvas(canvas);

    if (!landmarks || !landmarks.length || !video.videoWidth) return;

    const project = getProjector(video, canvas, mirrored);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [fromIndex, toIndex] of POSE_CONNECTIONS) {
      const from = landmarks[fromIndex];
      const to = landmarks[toIndex];
      if (!from || !to) continue;
      if ((from.visibility ?? 1) < 0.35 || (to.visibility ?? 1) < 0.35) continue;

      const a = project(from);
      const b = project(to);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(64, 224, 208, 0.95)';
      ctx.lineWidth = 2.5 * dpr;
      ctx.stroke();
    }

    landmarks.forEach((landmark, index) => {
      if (!landmark) return;
      if ((landmark.visibility ?? 1) < 0.35) return;
      const point = project(landmark);
      const isCore = index === 0 || index === 11 || index === 12 || index === 23 || index === 24;
      drawPoint(ctx, point, (isCore ? 4.5 : 3) * dpr, isCore ? '#ffe066' : '#ffffff');
    });
  }

  function drawFace(canvas, video, landmarks, options) {
    const settings = options || {};
    const mirrored = settings.mirrored !== false;
    const { ctx, dpr } = syncOverlayCanvas(canvas);

    if (!landmarks || !landmarks.length || !video.videoWidth) return;

    const project = getProjector(video, canvas, mirrored);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    FACE_GROUPS.forEach((group, index) => {
      const color = index === 0 ? 'rgba(0, 255, 163, 0.9)' : 'rgba(255, 255, 255, 0.7)';
      drawPolyline(ctx, group, landmarks, project, color, 1.6 * dpr, index !== FACE_GROUPS.length - 1);
    });

    landmarks.forEach((landmark, index) => {
      const point = project(landmark);
      const isAnchor = index === 1 || index === 33 || index === 263 || index === 61 || index === 291;
      drawPoint(ctx, point, (isAnchor ? 2.4 : 1.3) * dpr, isAnchor ? '#ffe066' : 'rgba(255,255,255,0.9)');
    });
  }

  function drawCameraGuide(canvas, label) {
    const { ctx, dpr } = syncOverlayCanvas(canvas);
    const padding = 22 * dpr;
    const corner = 36 * dpr;
    const width = canvas.width;
    const height = canvas.height;

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2 * dpr;

    ctx.beginPath();
    ctx.moveTo(padding, padding + corner);
    ctx.lineTo(padding, padding);
    ctx.lineTo(padding + corner, padding);

    ctx.moveTo(width - padding - corner, padding);
    ctx.lineTo(width - padding, padding);
    ctx.lineTo(width - padding, padding + corner);

    ctx.moveTo(width - padding, height - padding - corner);
    ctx.lineTo(width - padding, height - padding);
    ctx.lineTo(width - padding - corner, height - padding);

    ctx.moveTo(padding + corner, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(padding, height - padding - corner);
    ctx.stroke();

    if (label) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(16 * dpr, height - 52 * dpr, 220 * dpr, 28 * dpr);
      ctx.fillStyle = '#ffffff';
      ctx.font = `${14 * dpr}px ui-monospace, monospace`;
      ctx.fillText(label, 26 * dpr, height - 33 * dpr);
    }
  }

  window.TrackingHelpers = {
    syncOverlayCanvas,
    drawPose,
    drawFace,
    drawCameraGuide
  };
})();