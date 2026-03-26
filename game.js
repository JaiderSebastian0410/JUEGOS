/* =========================================================
   Space Defender Pro — Game Engine
   Clean, modular, IIFE-wrapped game logic
   ========================================================= */

(function () {
  'use strict';

  /* =========================================================
     CONSTANTS & CONFIG
     ========================================================= */
  const WORLD = Object.freeze({ WIDTH: 4000, HEIGHT: 4000 });
  const SAVE_KEY = 'space_defender_records_v2';
  const STAR_COUNT = 300;
  const POWER_DURATION = 480;       // frames (~8 seconds at 60fps)
  const PREMIUM_DURATION = 1500;    // frames (~25 seconds)
  const KILLS_PER_LIFE = 70;
  const SCORE_PER_MILESTONE = 1000;
  const ENEMY_UNLOCK_INTERVAL = 700;

  const PLAYER_BASE_SPEED = 6;
  const PLAYER_BOOST_SPEED = 10;

  const POWER_TYPES = Object.freeze([
    { type: 'auto', color: '#f7ca18' },
    { type: 'manual', color: '#e67e22' },
    { type: 'speed', color: '#2ecc71' },
    { type: 'shield', color: '#3498db' },
  ]);

  const ENEMY_TYPES = Object.freeze([
    { name: 'Morg', shape: 'circle', color: '#ff3366', size: 14, hp: 1, speed: 1.5, pts: 10 },
    { name: 'Stinger', shape: 'triangle', color: '#e67e22', size: 12, hp: 2, speed: 3.0, pts: 15 },
    { name: 'Titan', shape: 'square', color: '#9b59b6', size: 20, hp: 5, speed: 1.0, pts: 30 },
    { name: 'Vanguard', shape: 'pentagon', color: '#2ecc71', size: 16, hp: 3, speed: 1.8, pts: 25 },
    { name: 'Wasp', shape: 'hexagon', color: '#f1c40f', size: 14, hp: 3, speed: 2.4, pts: 20 },
    { name: 'Pulsar', shape: 'star', color: '#3498db', size: 18, hp: 6, speed: 1.5, pts: 40 },
    { name: 'Razor', shape: 'diamond', color: '#1abc9c', size: 10, hp: 3, speed: 3.5, pts: 35 },
    { name: 'Interceptor', shape: 'cross', color: '#ff007f', size: 16, hp: 7, speed: 2.0, pts: 50 },
    { name: 'Goliath', shape: 'octagon', color: '#ecf0f1', size: 24, hp: 12, speed: 1.2, pts: 80 },
    { name: 'Overlord', shape: 'ufo', color: '#f1c40f', size: 28, hp: 20, speed: 1.4, pts: 150 },
  ]);

  /* =========================================================
     UTILITIES
     ========================================================= */
  const random = (min, max) => Math.random() * (max - min) + min;
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const hypot = Math.hypot;
  const $ = (id) => document.getElementById(id);

  /* =========================================================
     LOCALSTORAGE MANAGER (Robust)
     ========================================================= */
  const Storage = {
    _defaults: Object.freeze({ score: 0, kills: 0, average: 0, gamesPlayed: 0 }),

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return { ...this._defaults };
        const data = JSON.parse(raw);
        // Validate shape
        return {
          score: Number(data.score) || 0,
          kills: Number(data.kills) || 0,
          average: Number(data.average) || 0,
          gamesPlayed: Number(data.gamesPlayed) || 0,
        };
      } catch {
        console.warn('[Storage] Failed to load, returning defaults');
        return { ...this._defaults };
      }
    },

    save(records) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(records));
      } catch (err) {
        console.warn('[Storage] Failed to save:', err.message);
      }
    },

    reset() {
      try { localStorage.removeItem(SAVE_KEY); } catch { /* noop */ }
    },
  };

  /* =========================================================
     CANVAS & CAMERA
     ========================================================= */
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  const camera = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.width = canvas.width;
    camera.height = canvas.height;
  }
  window.addEventListener('resize', resize);
  resize();

  /* =========================================================
     GAME STATE
     ========================================================= */
  let gameState = 'MENU'; // MENU | PLAYING | CHOOSING | GAMEOVER

  const player = {
    x: WORLD.WIDTH / 2,
    y: WORLD.HEIGHT / 2,
    size: 24,
    vida: 5,
    autoShootDelay: 0,
    angle: -Math.PI / 2,
    powers: { auto: 0, manual: 0, speed: 0, shield: 0 },
  };

  let bullets = [];
  let enemies = [];
  let powerUps = [];
  let hearts = [];
  let particles = [];
  const stars = [];

  let frame = 0;
  let score = 0;
  let time = 0;
  let kills = 0;
  let spawnRate = 100;
  let killsMilestone = 0;
  let scoreMilestone = 0;
  let unlockedEnemies = 1;

  /* =========================================================
     INPUT HANDLING
     ========================================================= */
  const keys = {};
  let touchStart = null;
  let isMobile = false;
  let isFiring = false;

  document.addEventListener('keydown', (e) => { keys[e.key] = true; });
  document.addEventListener('keyup', (e) => { keys[e.key] = false; });

  // Touch — movement
  window.addEventListener('touchstart', (e) => {
    isMobile = true;
    $('mobile-controls').style.display = 'flex';
    if (gameState !== 'PLAYING') return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!touchStart || gameState !== 'PLAYING') return;
    e.preventDefault();
    const dx = e.touches[0].clientX - touchStart.x;
    const dy = e.touches[0].clientY - touchStart.y;
    player.x += dx * 1.5;
    player.y += dy * 1.5;
    if (hypot(dx, dy) > 1) player.angle = Math.atan2(dy, dx);
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });

  window.addEventListener('touchend', () => { touchStart = null; });

  // Fire button
  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); isFiring = true; }, { passive: false });
  fireBtn.addEventListener('touchend', () => { isFiring = false; });

  /* =========================================================
     STARS (Background)
     ========================================================= */
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * WORLD.WIDTH,
      y: Math.random() * WORLD.HEIGHT,
      size: Math.random() * 2 + 1,
      alpha: Math.random(),
    });
  }

  /* =========================================================
     PARTICLES
     ========================================================= */
  function createParticles(x, y, color, amount) {
    for (let i = 0; i < amount; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 1,
        color,
        size: Math.random() * 4 + 2,
      });
    }
  }

  function updateAndDrawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      p.size *= 0.95;

      if (p.life <= 0) { particles.splice(i, 1); continue; }

      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  /* =========================================================
     SHOOTING
     ========================================================= */
  function shoot(speed, color) {
    bullets.push({
      x: player.x,
      y: player.y,
      dx: Math.cos(player.angle) * Math.abs(speed),
      dy: Math.sin(player.angle) * Math.abs(speed),
      color,
    });
  }

  function handleShooting() {
    // Manual cannon
    if ((keys[' '] || isFiring) && player.powers.manual > 0) {
      player.powers.manual--;
      if (frame % 8 === 0) shoot(16, '#e67e22');
    }
    // Auto laser
    if (player.powers.auto > 0) {
      player.autoShootDelay++;
      if (player.autoShootDelay > 6) {
        shoot(14, '#f7ca18');
        player.autoShootDelay = 0;
      }
    }
  }

  /* =========================================================
     PLAYER MOVEMENT
     ========================================================= */
  function movePlayer() {
    let moveX = 0;
    let moveY = 0;
    const moveSpeed = player.powers.speed > 0 ? PLAYER_BOOST_SPEED : PLAYER_BASE_SPEED;

    if (keys['w'] || keys['W'] || keys['ArrowUp']) moveY -= moveSpeed;
    if (keys['s'] || keys['S'] || keys['ArrowDown']) moveY += moveSpeed;
    if (keys['a'] || keys['A'] || keys['ArrowLeft']) moveX -= moveSpeed;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) moveX += moveSpeed;

    player.x += moveX;
    player.y += moveY;
    if (hypot(moveX, moveY) > 0.1) player.angle = Math.atan2(moveY, moveX);

    player.x = clamp(player.x, player.size, WORLD.WIDTH - player.size);
    player.y = clamp(player.y, player.size, WORLD.HEIGHT - player.size);

    // Camera follow
    camera.x = clamp(player.x - camera.width / 2, 0, WORLD.WIDTH - camera.width);
    camera.y = clamp(player.y - camera.height / 2, 0, WORLD.HEIGHT - camera.height);

    // Decrement power timers (except manual which is ammo-based)
    for (const p in player.powers) {
      if (p !== 'manual' && player.powers[p] > 0) player.powers[p]--;
    }
  }

  /* =========================================================
     ENEMY SPAWNING
     ========================================================= */
  function spawnEnemies() {
    if (frame % Math.floor(spawnRate) !== 0) return;

    // Unlock new enemies every ENEMY_UNLOCK_INTERVAL points
    if (score >= unlockedEnemies * ENEMY_UNLOCK_INTERVAL && unlockedEnemies < ENEMY_TYPES.length) {
      unlockedEnemies++;
      showAnnouncement('NUEVA AMENAZA: ' + ENEMY_TYPES[unlockedEnemies - 1].name.toUpperCase());
    }

    // Weighted spawning: harder enemies are rarer
    const pool = ENEMY_TYPES.slice(0, unlockedEnemies);
    const weights = pool.map((_, i) => Math.pow(0.65, i));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const roll = Math.random() * totalWeight;

    let selectedType = ENEMY_TYPES[0];
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (roll < cumulative) { selectedType = ENEMY_TYPES[i]; break; }
    }

    const baseSpeed = selectedType.speed + score * 0.00025; // Accelerate speed significantly faster
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(camera.width, camera.height) * 0.6;
    const spawnX = clamp(player.x + Math.cos(angle) * dist, 100, WORLD.WIDTH - 100);
    const spawnY = clamp(player.y + Math.sin(angle) * dist, 100, WORLD.HEIGHT - 100);

    enemies.push({
      x: spawnX, y: spawnY,
      size: selectedType.size, speed: baseSpeed,
      type: selectedType.shape, color: selectedType.color,
      hp: selectedType.hp, maxHp: selectedType.hp,
      name: selectedType.name, pts: selectedType.pts,
    });
  }

  /* =========================================================
     ENEMY UPDATE & COLLISIONS
     ========================================================= */
  function updateEnemies() {
    const alive = [];

    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 1) {
        e.x += (dx / dist) * e.speed;
        e.y += (dy / dist) * e.speed;
      }

      let dead = false;

      // Bullet collision
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (Math.abs(b.x - e.x) < e.size && Math.abs(b.y - e.y) < e.size) {
          bullets.splice(i, 1);
          e.hp--;
          createParticles(b.x, b.y, '#ffffff', 4);
          if (e.hp <= 0) {
            dead = true;
            addScore(e.pts + 5);
            kills++;
            killsMilestone++;
            createParticles(e.x, e.y, e.color, 20);
            break;
          }
        }
      }

      // Player collision
      if (!dead && dist < (player.size + e.size) * 0.7) {
        if (player.powers.shield <= 0) {
          player.vida--;
          createParticles(player.x, player.y, '#00ffff', 30);
        } else {
          addScore(4);
          kills++;
          killsMilestone++;
        }
        dead = true;
        createParticles(e.x, e.y, e.color, 15);
      }

      if (!dead) alive.push(e);
    }

    enemies = alive;
  }

  function addScore(pts) {
    score += pts;
    scoreMilestone += pts;
  }

  /* =========================================================
     COLLECTIBLES
     ========================================================= */
  function spawnCollectibles() {
    if (frame > 0 && frame % 420 === 0) {
      const p = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
      powerUps.push({
        x: random(camera.x + 50, camera.x + camera.width - 50),
        y: random(camera.y + 50, camera.y + camera.height - 150),
        type: p.type, color: p.color, time: 600,
      });
    }
    if (frame > 0 && frame % 2200 === 0) {
      hearts.push({
        x: random(camera.x + 50, camera.x + camera.width - 50),
        y: random(camera.y + 50, camera.y + camera.height - 150),
        time: 300,
      });
    }
  }

  function updateCollectibles() {
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      p.time--;
      if (hypot(player.x - p.x, player.y - p.y) < player.size + 15) {
        player.powers[p.type] += POWER_DURATION;
        createParticles(p.x, p.y, p.color, 30);
        powerUps.splice(i, 1);
        continue;
      }
      if (p.time <= 0) powerUps.splice(i, 1);
    }

    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.time--;
      if (hypot(player.x - h.x, player.y - h.y) < player.size + 15) {
        player.vida++;
        createParticles(h.x, h.y, '#ff007f', 15);
        hearts.splice(i, 1);
        continue;
      }
      if (h.time <= 0) hearts.splice(i, 1);
    }
  }

  /* =========================================================
     MILESTONES
     ========================================================= */
  function checkMilestones() {
    if (killsMilestone >= KILLS_PER_LIFE) {
      killsMilestone -= KILLS_PER_LIFE;
      player.vida++;
      createParticles(player.x, player.y, '#ff007f', 40);
    }
    if (scoreMilestone >= SCORE_PER_MILESTONE) {
      scoreMilestone -= SCORE_PER_MILESTONE;
      gameState = 'CHOOSING';
      $('levelup-menu').classList.add('active');
    }
  }

  /* =========================================================
     ANNOUNCEMENTS
     ========================================================= */
  function showAnnouncement(text) {
    const ann = $('announcement');
    if (!ann) return;
    ann.innerText = text;
    ann.classList.remove('active');
    void ann.offsetWidth; // force reflow
    ann.classList.add('active');
  }

  /* =========================================================
     DRAWING — PLAYER
     ========================================================= */
  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle + Math.PI / 2);

    let pColor = '#00ffff';
    if (player.powers.auto > 0) pColor = '#f7ca18';
    else if (player.powers.manual > 0) pColor = '#e67e22';

    ctx.shadowBlur = 20;
    ctx.shadowColor = pColor;
    ctx.fillStyle = '#101015';
    ctx.strokeStyle = pColor;
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(0, -player.size);
    ctx.lineTo(player.size * 0.8, player.size);
    ctx.lineTo(0, player.size - 6);
    ctx.lineTo(-player.size * 0.8, player.size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Shield aura
    if (player.powers.shield > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, player.size + 15, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(52, 152, 219, 0.8)';
      ctx.shadowColor = '#3498db';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.restore();
  }

  /* =========================================================
     DRAWING — ENEMY SHAPES
     ========================================================= */
  function drawEnemyShape(type, s) {
    ctx.beginPath();
    switch (type) {
      case 'circle':
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        break;
      case 'triangle':
        ctx.moveTo(0, -s); ctx.lineTo(s, s); ctx.lineTo(-s, s); ctx.closePath();
        break;
      case 'square':
        ctx.rect(-s, -s, s * 2, s * 2);
        break;
      case 'pentagon':
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
        ctx.closePath();
        break;
      case 'hexagon':
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
        ctx.closePath();
        break;
      case 'star':
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const r = i % 2 === 0 ? s : s / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath();
        break;
      case 'diamond':
        ctx.moveTo(0, -s * 1.2); ctx.lineTo(s, 0); ctx.lineTo(0, s * 1.2); ctx.lineTo(-s, 0); ctx.closePath();
        break;
      case 'cross':
        ctx.rect(-s / 4, -s, s / 2, s * 2); ctx.rect(-s, -s / 4, s * 2, s / 2);
        break;
      case 'octagon':
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
        ctx.closePath();
        break;
      case 'ufo':
        ctx.ellipse(0, 0, s, s / 2, 0, 0, Math.PI * 2);
        ctx.moveTo(-s / 2, -s / 4);
        ctx.arc(0, -s / 4, s / 2, Math.PI, 0);
        break;
    }
  }

  /* =========================================================
     DRAWING — ENTITIES
     ========================================================= */
  function drawEntities() {
    // Bullets
    ctx.shadowBlur = 10;
    for (const b of bullets) {
      ctx.shadowColor = b.color;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    }

    // Enemies
    for (const e of enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowBlur = 15;
      ctx.shadowColor = e.color;
      ctx.strokeStyle = e.color;
      
      // Elegant and compact look: thin wireframe with semi-transparent core
      ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.rotate(frame * 0.04 * (e.speed > 2.0 ? 2 : 1));

      // Draw outer shape
      drawEnemyShape(e.type, e.size);
      ctx.fill();
      ctx.stroke();

      // Draw inner glowing core
      ctx.beginPath();
      drawEnemyShape(e.type, e.size * 0.4);
      ctx.fillStyle = e.color;
      ctx.shadowBlur = 20;
      ctx.fill();
      
      ctx.restore();

      // HP bar
      if (e.hp < e.maxHp) {
        const s = e.size;
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(e.x - s, e.y + s + 8, s * 2, 4);
        ctx.fillStyle = e.color;
        ctx.fillRect(e.x - s, e.y + s + 8, (s * 2) * (e.hp / e.maxHp), 4);
      }
    }
  }

  /* =========================================================
     DRAWING — POWER-UP ICONS
     ========================================================= */
  function drawPowerIcon(p, pulse) {
    const size = 10 + pulse * 0.5;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowBlur = 20;
    ctx.shadowColor = p.color;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3;

    switch (p.type) {
      case 'auto':
        for (let i = -8; i <= 8; i += 8) { ctx.beginPath(); ctx.moveTo(i, -size); ctx.lineTo(i, size); ctx.stroke(); }
        break;
      case 'manual':
        ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -size - 6); ctx.lineTo(0, size + 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-size - 6, 0); ctx.lineTo(size + 6, 0); ctx.stroke();
        break;
      case 'speed':
        ctx.beginPath(); ctx.moveTo(-size, 2); ctx.lineTo(0, -size); ctx.lineTo(size, 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-size, size); ctx.lineTo(0, 0); ctx.lineTo(size, size); ctx.stroke();
        break;
      case 'shield':
        ctx.beginPath();
        ctx.moveTo(0, -size - 2); ctx.lineTo(size, -size * 0.5); ctx.lineTo(size, size * 0.5);
        ctx.lineTo(0, size + 2); ctx.lineTo(-size, size * 0.5); ctx.lineTo(-size, -size * 0.5);
        ctx.closePath(); ctx.stroke();
        break;
    }
    ctx.restore();
  }

  function drawCollectibles() {
    const pulse = Math.abs(Math.sin(frame * 0.05)) * 6;
    powerUps.forEach((p) => drawPowerIcon(p, pulse));

    hearts.forEach((h) => {
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ff007f';
      ctx.fillStyle = '#ff007f';
      const size = 10 + pulse * 0.5;
      ctx.beginPath();
      ctx.arc(-size / 2, -size / 2, size, Math.PI, 0, false);
      ctx.arc(size / 2, -size / 2, size, Math.PI, 0, false);
      ctx.lineTo(0, size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  /* =========================================================
     HUD UPDATE
     ========================================================= */
  function updateUI() {
    $('vida').innerText = player.vida;
    $('kills').innerText = kills;
    $('score').innerText = score;
    $('time').innerText = time;

    let txt = '';
    if (player.powers.auto > 0) txt += `<span style="color:#f7ca18; margin-right:8px;">[Auto ${Math.ceil(player.powers.auto / 60)}s]</span>`;
    if (player.powers.manual > 0) txt += `<span style="color:#e67e22; margin-right:8px;">[Manual ${Math.ceil(player.powers.manual / 60)}s]</span>`;
    if (player.powers.speed > 0) txt += `<span style="color:#2ecc71; margin-right:8px;">[Vel ${Math.ceil(player.powers.speed / 60)}s]</span>`;
    if (player.powers.shield > 0) txt += `<span style="color:#3498db; margin-right:8px;">[Escudo ${Math.ceil(player.powers.shield / 60)}s]</span>`;
    $('power').innerHTML = txt || 'Ninguno';
  }

  /* =========================================================
     MAIN LOOP
     ========================================================= */
  function gameLoop() {
    if (gameState !== 'PLAYING') return;

    ctx.fillStyle = 'rgba(5, 5, 16, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Stars
    for (const s of stars) {
      if (s.x > camera.x && s.x < camera.x + camera.width && s.y > camera.y && s.y < camera.y + camera.height) {
        ctx.fillStyle = `rgba(255,255,255, ${s.alpha})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
    }

    // World border
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);

    // Update
    movePlayer();
    handleShooting();

    for (const b of bullets) { b.x += b.dx; b.y += b.dy; }
    bullets = bullets.filter((b) => b.x > 0 && b.x < WORLD.WIDTH && b.y > 0 && b.y < WORLD.HEIGHT);

    spawnEnemies();
    updateEnemies();
    spawnCollectibles();
    updateCollectibles();
    checkMilestones();

    // Draw
    drawEntities();
    drawCollectibles();
    drawPlayer();
    updateAndDrawParticles();

    ctx.restore();

    // Frame counter
    frame++;
    if (frame % 60 === 0) {
      time++;
      addScore(8);
      if (spawnRate > 40) spawnRate -= 0.8; // Decreases directly to 40, meaning MUCH faster spawn rates over time
    }

    updateUI();

    if (player.vida <= 0) {
      endGame();
    } else {
      requestAnimationFrame(gameLoop);
    }
  }

  /* =========================================================
     MENU LOGIC
     ========================================================= */
  function startCountdown() {
    $('start-menu').classList.remove('active');
    $('tutorial-menu-overlay').classList.remove('active');
    const countEl = $('countdown');
    countEl.style.display = 'block';
    let count = 3;
    countEl.innerText = count;

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        countEl.style.display = 'none';
        gameState = 'PLAYING';
        requestAnimationFrame(gameLoop);
      } else {
        countEl.innerText = count;
      }
    }, 1000);
  }

  function openTutorial() {
    $('tutorial-menu-overlay').classList.add('active');
    switchTab(0);
  }

  function closeTutorial() {
    $('tutorial-menu-overlay').classList.remove('active');
    $('start-menu').classList.add('active');
  }

  function switchTab(n) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === n));
    document.querySelectorAll('.tab-content').forEach((c, i) => c.classList.toggle('active', i === n));
  }

  /* =========================================================
     PREMIUM POWER CHOICE
     ========================================================= */
  function choosePremiumPower(type) {
    if (type === 'life') {
      player.vida++;
    } else {
      player.powers[type] += PREMIUM_DURATION;
    }
    createParticles(player.x, player.y, '#ffffff', 50);
    $('levelup-menu').classList.remove('active');
    gameState = 'PLAYING';
    requestAnimationFrame(gameLoop);
  }

  /* =========================================================
     GAME OVER
     ========================================================= */
  function endGame() {
    gameState = 'GAMEOVER';
    const records = Storage.load();
    records.gamesPlayed++;
    const currentAvg = kills > 0 ? parseFloat((score / kills).toFixed(1)) : 0;
    let newRecord = false;

    const results = {
      score: { current: score, best: records.score, label: 'Mejor Score' },
      kills: { current: kills, best: records.kills, label: 'Mejor Kills' },
      average: { current: currentAvg, best: records.average, label: 'Mejor Promedio' },
    };

    if (score > records.score) { records.score = score; newRecord = true; }
    if (kills > records.kills) { records.kills = kills; newRecord = true; }
    if (currentAvg > records.average) { records.average = currentAvg; newRecord = true; }

    Storage.save(records);

    $('game-over-title').innerText = newRecord ? '🏆 ¡NUEVO RÉCORD! 🏆' : 'MISIÓN FALLIDA';
    $('game-over-title').style.color = newRecord ? '#f1c40f' : '#ff3366';
    $('final-stats').innerText = `Sobreviviste ${time}s`;

    const body = $('records-body');
    body.innerHTML = '';
    for (const key in results) {
      const row = document.createElement('tr');
      const isNew = results[key].current >= results[key].best && results[key].current > 0;
      row.innerHTML = `<td>${results[key].label}</td><td>${results[key].current}</td><td class="${isNew ? 'highlight-record' : ''}">${results[key].best}</td>`;
      body.appendChild(row);
    }

    $('game-over-menu').classList.add('active');
  }

  /* =========================================================
     PWA INSTALL PROMPT
     ========================================================= */
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  function showInstallBanner() {
    const banner = $('install-banner');
    if (!banner) return;
    setTimeout(() => banner.classList.add('visible'), 1500);
  }

  function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((result) => {
      if (result.outcome === 'accepted') {
        console.log('[PWA] App installed');
      }
      deferredPrompt = null;
      hideInstallBanner();
    });
  }

  function hideInstallBanner() {
    const banner = $('install-banner');
    if (banner) banner.classList.remove('visible');
  }

  /* =========================================================
     SERVICE WORKER REGISTRATION
     ========================================================= */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('[SW] Registered, scope:', reg.scope))
        .catch((err) => console.warn('[SW] Registration failed:', err));
    });
  }

  /* =========================================================
     EXPOSE GLOBALS (for HTML onclick handlers)
     ========================================================= */
  window.startCountdown = startCountdown;
  window.openTutorial = openTutorial;
  window.closeTutorial = closeTutorial;
  window.switchTab = switchTab;
  window.choosePremiumPower = choosePremiumPower;
  window.installApp = installApp;
  window.hideInstallBanner = hideInstallBanner;

})();
