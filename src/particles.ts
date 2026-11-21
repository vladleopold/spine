type Particle = {
  baseX: number;
  y: number;
  radius: number;
  depth: number;
  speedY: number;
  speedX: number;
  wave: number;
  waveSpeed: number;
  wavePhase: number;
  alpha: number;
  color: string;
  star: boolean;
  sparklePhase: number;
  sparkleSpeed: number;
};

type ParticleMode = "quiet" | "rich";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function particleColorForIndex(index: number) {
  const slot = index % 10;
  if (slot === 0) return "255,255,255";
  if (slot === 2 || slot === 5 || slot === 8) return "92,194,255";
  return "255,106,40";
}

export function startParticleField(canvas: HTMLCanvasElement, mode: ParticleMode = "rich") {
  const rawContext = canvas.getContext("2d", { alpha: true });
  if (!rawContext) return () => {};
  const context: CanvasRenderingContext2D = rawContext;
  const isRich = mode === "rich";

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const particles: Particle[] = [];
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let animationFrame = 0;
  let running = !document.hidden;
  let lastTime = performance.now();

  function resetParticle(particle: Particle, randomizeY = false) {
    const depth = 0.35 + Math.random() * 1.25;
    particle.baseX = Math.random() * width;
    particle.y = randomizeY ? Math.random() * height : height + 18 + Math.random() * 90;
    particle.radius = (0.65 + Math.random() * 1.9) * depth * (isRich ? 2 : 1);
    particle.depth = depth;
    particle.speedY = (0.09 + Math.random() * 0.28) * depth;
    particle.speedX = (Math.random() - 0.5) * 0.055 * depth;
    particle.wave = (10 + Math.random() * 36) * depth;
    particle.waveSpeed = 0.00022 + Math.random() * 0.00042;
    particle.wavePhase = Math.random() * Math.PI * 2;
    particle.alpha = clamp(
      (isRich ? 0.22 : 0.12) + Math.random() * (isRich ? 0.46 : 0.24) * depth,
      isRich ? 0.18 : 0.08,
      isRich ? 0.82 : 0.42,
    );
    particle.color ||= particleColorForIndex(particles.length);
    particle.star ||= isRich && particles.length % 33 === 0;
    particle.sparklePhase ||= Math.random() * Math.PI * 2;
    particle.sparkleSpeed ||= 0.0007 + Math.random() * 0.0011;
  }

  function targetParticleCount() {
    const viewportCount = Math.round((width * height) / 22000);
    const baseCount = clamp(viewportCount, 22, 78);
    const count = isRich ? Math.round((baseCount * 4) / 3) : Math.max(8, Math.round((baseCount * 0.48) / 3));
    return saveData ? Math.min(isRich ? 32 : 10, count) : count;
  }

  function resize() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    width = Math.ceil(window.visualViewport?.width || window.innerWidth || 1);
    height = Math.ceil(window.visualViewport?.height || window.innerHeight || 1);
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const targetCount = targetParticleCount();
    canvas.dataset.particleCount = String(targetCount);
    while (particles.length < targetCount) {
      const particle = {} as Particle;
      particle.color = particleColorForIndex(particles.length);
      resetParticle(particle, true);
      particles.push(particle);
    }
    particles.length = targetCount;
  }

  function drawParticle(particle: Particle, time: number) {
    const x = particle.baseX + Math.sin(time * particle.waveSpeed + particle.wavePhase) * particle.wave;
    const alpha = particle.alpha * (0.74 + Math.sin(time * 0.001 + particle.wavePhase) * 0.18);
    const haloRadius = particle.radius * (particle.depth > 1.05 ? 3.2 : 2.15);
    const sparkle = particle.star ? Math.max(0, Math.sin(time * particle.sparkleSpeed + particle.sparklePhase) - 0.94) / 0.06 : 0;

    context.fillStyle = `rgba(${particle.color}, ${alpha * (isRich ? 0.25 : 0.14)})`;
    context.beginPath();
    context.arc(x, particle.y, haloRadius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = `rgba(${particle.color}, ${alpha})`;
    context.beginPath();
    context.arc(x, particle.y, particle.radius, 0, Math.PI * 2);
    context.fill();

    if (sparkle > 0) {
      const spike = particle.radius * (3.2 + sparkle * 4.8);
      context.save();
      context.translate(x, particle.y);
      context.rotate(time * 0.00035 + particle.wavePhase);
      context.strokeStyle = `rgba(255,255,255, ${0.18 + sparkle * 0.72})`;
      context.lineWidth = Math.max(1, particle.radius * 0.34);
      context.beginPath();
      context.moveTo(-spike, 0);
      context.lineTo(spike, 0);
      context.moveTo(0, -spike);
      context.lineTo(0, spike);
      context.stroke();
      context.restore();
    }
  }

  function draw(time: number) {
    if (!running) return;
    const delta = Math.min(2.2, Math.max(0.35, (time - lastTime) / 16.67));
    lastTime = time;

    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";

    for (const particle of particles) {
      if (!reducedMotion) {
        particle.baseX += particle.speedX * delta;
        particle.y -= particle.speedY * delta;
      }
      if (particle.y < -28 || particle.baseX < -80 || particle.baseX > width + 80) resetParticle(particle);
      drawParticle(particle, time);
    }

    context.globalCompositeOperation = "source-over";
    if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    animationFrame = window.requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    window.cancelAnimationFrame(animationFrame);
  }

  function handleVisibilityChange() {
    if (document.hidden) stop();
    else start();
  }

  resize();
  if (running) animationFrame = window.requestAnimationFrame(draw);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    stop();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    context.clearRect(0, 0, width, height);
  };
}
