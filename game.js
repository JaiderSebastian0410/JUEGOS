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
  const SCORE_PER_MILESTONE = 1600;
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
    { name: 'Morg', shape: 'circle', color: '#ff3366', size: 14, hp: 1, speed: 1.1, pts: 10 },
    { name: 'Stinger', shape: 'triangle', color: '#e67e22', size: 12, hp: 1, speed: 2.2, pts: 15 },
    { name: 'Titan', shape: 'square', color: '#9b59b6', size: 20, hp: 3, speed: 0.7, pts: 30 },
    { name: 'Vanguard', shape: 'pentagon', color: '#2ecc71', size: 16, hp: 2, speed: 1.2, pts: 25 },
    { name: 'Wasp', shape: 'hexagon', color: '#f1c40f', size: 14, hp: 2, speed: 1.6, pts: 20 },
    { name: 'Pulsar', shape: 'star', color: '#3498db', size: 18, hp: 4, speed: 1.0, pts: 40 },
    { name: 'Razor', shape: 'diamond', color: '#1abc9c', size: 10, hp: 2, speed: 2.6, pts: 35 },
    { name: 'Interceptor', shape: 'cross', color: '#ff007f', size: 16, hp: 5, speed: 1.3, pts: 50 },
    { name: 'Goliath', shape: 'octagon', color: '#ecf0f1', size: 24, hp: 8, speed: 0.6, pts: 80 },
    { name: 'Overlord', shape: 'ufo', color: '#f1c40f', size: 28, hp: 12, speed: 0.9, pts: 150 },
  ]);

  /* =========================================================
     UTILITIES
     ========================================================= */
  const random = (min, max) => Math.random() * (max - min) + min;
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const hypot = Math.hypot;
  const $ = (id) => document.getElementById(id);

  /* =========================================================
     AUDIO SYNTHESIZER
     ========================================================= */
  let audioCtx = null;
  let isSoundEnabled = true;
  let masterVolume = 1.0;

  window.updateVolume = function(val) {
    masterVolume = parseFloat(val);
  };

  window.initAudio = function() {
    if (!audioCtx && isSoundEnabled) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
  };

  window.toggleSound = function() {
    const check = $('sound-toggle');
    isSoundEnabled = check ? check.checked : true;
    if (isSoundEnabled) window.initAudio();
  };

  const SFX = {
    play(freqStart, freqEnd, type, duration, vol) {
      if (!isSoundEnabled || !audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(freqStart, now);
        if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);
        gain.gain.setValueAtTime(vol * masterVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        osc.start(now);
        osc.stop(now + duration);
      } catch(e) {}
    },
    shootManual() { this.play(600, 300, 'square', 0.1, 0.2); },
    shootAuto() { this.play(800, 500, 'sawtooth', 0.05, 0.1); },
    hit() { this.play(150, 50, 'sawtooth', 0.1, 0.3); },
    kill() { this.play(100, 20, 'square', 0.2, 0.4); },
    powerup() { this.play(400, 800, 'sine', 0.2, 0.3); setTimeout(() => this.play(800, 1200, 'sine', 0.3, 0.3), 100); },
    ultra() { this.play(800, 50, 'sawtooth', 1.5, 0.6); }
  };

  /* =========================================================
     LOCALSTORAGE MANAGER (Robust)
     ========================================================= */
  const Storage = {
    _defaults: Object.freeze({ score: 0, kills: 0, average: 0, time: 0, gamesPlayed: 0 }),

    load(mode = 'general') {
      try {
        const raw = localStorage.getItem(`${SAVE_KEY}_${mode}`);
        if (!raw) return { ...this._defaults };
        const data = JSON.parse(raw);
        return {
          score: Number(data.score) || 0,
          kills: Number(data.kills) || 0,
          average: Number(data.average) || 0,
          time: Number(data.time) || 0,
          gamesPlayed: Number(data.gamesPlayed) || 0,
        };
      } catch {
        return { ...this._defaults };
      }
    },

    save(mode, records) {
      localStorage.setItem(`${SAVE_KEY}_${mode}`, JSON.stringify(records));
    },

    getHistory() {
      try {
        const raw = localStorage.getItem(`${SAVE_KEY}_history`);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    },

    saveHistory(entry) {
      const history = this.getHistory();
      history.unshift(entry);
      if (history.length > 50) history.pop();
      localStorage.setItem(`${SAVE_KEY}_history`, JSON.stringify(history));
    },

    deleteHistoryItem(index) {
      const history = this.getHistory();
      if (index >= 0 && index < history.length) {
        history.splice(index, 1);
        localStorage.setItem(`${SAVE_KEY}_history`, JSON.stringify(history));
      }
    },

    clearHistory() { localStorage.removeItem(`${SAVE_KEY}_history`); },

    reset() {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(SAVE_KEY)) localStorage.removeItem(key);
      });
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
    skin: { type: 'classic', img: null },
    debuffs: { slow: 0, disable: 0, noscore: 0, powerlock: 0 }
  };

  const SKINS = {
    classic: new Image(),
    phantom: new Image(),
    golden: new Image()
  };
  
  // Background-cleaning helper for default assets
  function cleanWhiteBG(img, callback) {
    const c = document.createElement('canvas');
    c.width = img.width || 512; c.height = img.height || 512;
    const ctx2 = c.getContext('2d');
    ctx2.drawImage(img, 0, 0);
    const id = ctx2.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 245 && d[i+1] > 245 && d[i+2] > 245) d[i+3] = 0;
    }
    ctx2.putImageData(id, 0, 0);
    const ni = new Image(); ni.onload = callback; ni.src = c.toDataURL();
    return ni;
  }

  SKINS.classic.onload = () => { SKINS.classic = cleanWhiteBG(SKINS.classic, updatePreview); };
  SKINS.phantom.onload = () => { SKINS.phantom = cleanWhiteBG(SKINS.phantom, updatePreview); };
  SKINS.golden.onload = () => { SKINS.golden = cleanWhiteBG(SKINS.golden, updatePreview); };
  
  SKINS.classic.src = 'skin_classic.png';
  SKINS.phantom.src = 'skin_phantom.png';
  SKINS.golden.src = 'skin_golden.png';

  function updatePreview() { if(gameState === 'MENU') selectSkin(player.skin.type); }

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
  let isRecordBroken = false;
  let currentMilestoneTarget = 1600;
  let currentUnlockInterval = 700;

  let selectedDifficulty = 'progresivo';
  let isPractice = false;
  let diffMultiplier = 1.0;
  let floatingTexts = [];
  
  let shakeAmt = 0;
  let damageFlash = 0;

  const ULTRA_MAX = 100; // Requires 100 kills to charge
  let ultraEnergy = 0;
  let flashAlpha = 0;

  /* =========================================================
     INPUT HANDLING
     ========================================================= */
  const keys = {};
  let joystickOrigin = null;
  let joystickCurrent = null;
  let isMobile = false;
  let isFiring = false;

  window.selectSkin = function(type) {
    player.skin.type = type;
    if (SKINS[type]) player.skin.img = SKINS[type];
    else player.skin.img = null;

    const names = { 
      'classic': 'Elite Steel', 'phantom': 'Phantom Stealth', 'golden': 'Golden Elite',
      'retro_triangle': 'Retro Delta', 'retro_ufo': 'Retro Interceptor'
    };
    const status = document.getElementById('skin-status');
    if (status) status.innerText = 'Skin: ' + (names[type] || 'Personalizada');
    
    drawPreview();
    if (window.initAudio) window.initAudio();
    SFX.hit();
  };

  function drawPreview() {
    const pCanvas = $('skin-preview');
    if (!pCanvas) return;
    const pCtx = pCanvas.getContext('2d');
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    
    pCtx.save();
    pCtx.translate(pCanvas.width / 2, pCanvas.height / 2);
    
    // Use the same drawing logic as the player but localized
    const tempPlayer = { ...player, x:0, y:0, angle: -Math.PI/2 };
    drawPlayer(pCtx, tempPlayer);
    
    pCtx.restore();
  }

  window.uploadSkin = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = function() {
        // Automatic Background Removal (Simple White/Balance threshold)
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Assume corners are background
        const rbg = [data[0], data[1], data[2]]; 
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2];
          // If pixel is close to white or close to the first pixel color (simple chroma key)
          const diff = Math.abs(r-255) + Math.abs(g-255) + Math.abs(b-255);
          const cornerDiff = Math.abs(r-rbg[0]) + Math.abs(g-rbg[1]) + Math.abs(b-rbg[2]);
          if (diff < 60 || cornerDiff < 30) data[i+3] = 0; 
        }
        ctx.putImageData(imageData, 0, 0);
        
        const finalImg = new Image();
        finalImg.onload = () => {
          player.skin.type = 'custom';
          player.skin.img = finalImg;
          document.getElementById('skin-status').innerText = 'Skin: Personalizada (IMG)';
          drawPreview();
        };
        finalImg.src = canvas.toDataURL();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    if (window.initAudio) window.initAudio();
    SFX.powerup();
  };

  document.addEventListener('keydown', (e) => { 
    keys[e.key] = true; 
    if ((e.key === 'q' || e.key === 'Q' || e.key === 'Shift') && ultraEnergy >= ULTRA_MAX) {
      triggerUltra();
    }
  });
  document.addEventListener('keyup', (e) => { keys[e.key] = false; });

  function triggerUltra() {
    if (gameState !== 'PLAYING' || ultraEnergy < ULTRA_MAX || player.debuffs.disable > 0) return;
    
    ultraEnergy = 0;
    flashAlpha = 1.0;
    player.powers.shield = Math.max(player.powers.shield, 180); // 3 seconds invulnerability
    
    for (const e of enemies) {
      const ultraPts = Math.ceil((e.pts + 5) * diffMultiplier * 2.0);
      addScore(ultraPts);
      kills++;
      killsMilestone++;
      createParticles(e.x, e.y, e.color, 30);
      createFloatingText(e.x, e.y, `+${ultraPts}`, '#ff007f');
    }
    enemies = [];
    SFX.ultra();
    showAnnouncement("⚡ ¡FLASH NOVA! ⚡");
  }

  // Touch — virtual joystick
  window.addEventListener('touchstart', (e) => {
    isMobile = true;
    $('mobile-controls').style.display = 'flex';
    if (gameState !== 'PLAYING') return;
    if (e.target.closest('#mobile-controls')) return;
    
    joystickOrigin = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    joystickCurrent = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (gameState !== 'PLAYING' || !joystickOrigin) return;
    e.preventDefault();
    if (e.touches.length > 0) {
      joystickCurrent = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: false });

  window.addEventListener('touchend', (e) => { 
    if (e.touches.length === 0) {
      joystickOrigin = null; 
      joystickCurrent = null;
    } else if (joystickOrigin) {
      joystickOrigin = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      joystickCurrent = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  });

  // Fire button
  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); isFiring = true; }, { passive: false });
  fireBtn.addEventListener('touchend', () => { isFiring = false; });

  // Ultra button
  const ultraBtn = $('ultra-btn');
  if (ultraBtn) {
    ultraBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); triggerUltra(); }, { passive: false });
  }

  /* =========================================================
     PARALLAX GALAXY & STARS
     ========================================================= */
  const starLayers = [
    { count: 150, speed: 0.1, sizeRange: [0.5, 1.5], stars: [] },
    { count: 100, speed: 0.3, sizeRange: [1, 2], stars: [] },
    { count: 50, speed: 0.7, sizeRange: [1.5, 3], stars: [] }
  ];

  starLayers.forEach((layer, idx) => {
    for (let i = 0; i < layer.count; i++) {
        const isPlanet = idx === 0 && Math.random() < 0.05; // 5% of furthest stars are planets
      layer.stars.push({
        x: Math.random() * WORLD.WIDTH,
        y: Math.random() * WORLD.HEIGHT,
        size: isPlanet ? Math.random() * 20 + 10 : Math.random() * (layer.sizeRange[1] - layer.sizeRange[0]) + layer.sizeRange[0],
        alpha: Math.random() * 0.5 + 0.2,
        isPlanet,
        color: isPlanet ? `hsl(${Math.random()*360}, 40%, 60%)` : '#ffffff'
      });
    }
  });

  function drawParallaxBackground() {
    starLayers.forEach(layer => {
      ctx.save();
      for (const s of layer.stars) {
        const dx = (s.x - camera.x * (1 - layer.speed));
        const dy = (s.y - camera.y * (1 - layer.speed));
        
        let px = dx % WORLD.WIDTH; if (px < 0) px += WORLD.WIDTH;
        let py = dy % WORLD.HEIGHT; if (py < 0) py += WORLD.HEIGHT;

        if (px < camera.width && py < camera.height) {
          if (s.isPlanet) {
            // Draw a subtle planet with atmosphere
            const pGrad = ctx.createRadialGradient(px, py, 1, px, py, s.size);
            pGrad.addColorStop(0, s.color);
            pGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = pGrad;
            ctx.beginPath(); ctx.arc(px, py, s.size, 0, Math.PI * 2); ctx.fill();
            // Subtle ring or crescent
            ctx.strokeStyle = `rgba(255,255,255,${s.alpha*0.3})`;
            ctx.beginPath(); ctx.arc(px, py, s.size, -0.5, 2.5); ctx.stroke();
          } else {
            ctx.fillStyle = `rgba(255,255,255, ${s.alpha})`;
            ctx.beginPath(); ctx.arc(px, py, s.size, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.restore();
    });
  }

  /* =========================================================
     PARTICLES
     ========================================================= */
  function createParticles(x, y, color, amount) {
    // Optimization limit particle spam
    if (isMobile) amount = Math.floor(amount / 3) || 1;
    if (particles.length > 80) particles.splice(0, particles.length - 80); // Cap active particles

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
    ctx.save();
    if (isMobile) {
      ctx.shadowBlur = 0; 
    } else {
      ctx.shadowBlur = 0; // Prevent heavy shadow lag on particles anyway
    }
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
    ctx.restore();
  }

  /* =========================================================
     FLOATING TEXTS
     ========================================================= */
  function createFloatingText(x, y, text, color) {
    floatingTexts.push({ x, y, text, color, life: 1.0, dy: -1 });
  }

  function updateAndDrawFloatingTexts() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px Orbitron';
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y += ft.dy;
      ft.life -= 0.02;
      if (ft.life <= 0) { floatingTexts.splice(i, 1); continue; }
      
      ctx.globalAlpha = ft.life;
      ctx.fillStyle = ft.color;
      if (!isMobile) {
        ctx.shadowBlur = 8;
        ctx.shadowColor = ft.color;
      }
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.restore();
  }

  /* =========================================================
     SHOOTING
     ========================================================= */
  function shoot(speed, color, source) {
    bullets.push({
      x: player.x,
      y: player.y,
      dx: Math.cos(player.angle) * Math.abs(speed),
      dy: Math.sin(player.angle) * Math.abs(speed),
      color,
      source
    });
  }

  function handleShooting() {
    if (player.debuffs.disable > 0) return; // Prevent shooting if disabled

    // Manual cannon
    if ((keys[' '] || isFiring) && player.powers.manual > 0) {
      if (player.debuffs.powerlock > 0) {
        // Restricted
      } else {
        player.powers.manual--;
        if (frame % 8 === 0) { shoot(16, '#e67e22', 'manual'); SFX.shootManual(); }
      }
    }
    // Auto laser
    if (player.powers.auto > 0) {
      if (player.debuffs.powerlock > 0) {
        // Power is active but locked (no firing)
      } else {
        player.autoShootDelay++;
        if (player.autoShootDelay > 6) {
          shoot(14, '#f7ca18', 'auto'); SFX.shootAuto();
          player.autoShootDelay = 0;
        }
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

    // Virtual Joystick logic
    if (joystickOrigin && joystickCurrent) {
      const dx = joystickCurrent.x - joystickOrigin.x;
      const dy = joystickCurrent.y - joystickOrigin.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist > 5) { // Deadzone
        const maxRadius = 40; // Pixels until max speed
        const speedMultiplier = Math.min(dist / maxRadius, 1);
        const actualSpeed = moveSpeed * speedMultiplier;
        
        moveX += (dx / dist) * actualSpeed;
        moveY += (dy / dist) * actualSpeed;
      }
    }

    player.x += moveX;
    player.y += moveY;
    
    // Smooth angle interpolation
    if (Math.hypot(moveX, moveY) > 0.1) {
      const targetAngle = Math.atan2(moveY, moveX);
      const angleDiff = targetAngle - player.angle;
      
      // Normalize angle difference to [-PI, PI]
      let normalizedDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
      
      // Rotation speed: faster for drastic changes, smooth for continuous
      const lerpFactor = Math.abs(normalizedDiff) > 1.5 ? 1.0 : 0.15;
      player.angle += normalizedDiff * lerpFactor;
    }

    // Apply Slowness Debuff
    if (player.debuffs.slow > 0) {
      player.x -= moveX * 0.5; // Reverse half the movement
      player.y -= moveY * 0.5;
      player.debuffs.slow--;
    }
    if (player.debuffs.disable > 0) player.debuffs.disable--;

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

    // Unlock new enemies
    if (score >= unlockedEnemies * currentUnlockInterval && unlockedEnemies < ENEMY_TYPES.length) {
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

    // Original speed scaling. Ensure baseSpeed never exceeds player base speed (6)
    const baseSpeed = Math.min(selectedType.speed + score * 0.0001, PLAYER_BASE_SPEED);
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(camera.width, camera.height) * 0.6;
    const spawnX = clamp(player.x + Math.cos(angle) * dist, 100, WORLD.WIDTH - 100);
    const spawnY = clamp(player.y + Math.sin(angle) * dist, 100, WORLD.HEIGHT - 100);

    const baseEnemy = {
      x: spawnX, y: spawnY,
      size: selectedType.size, speed: baseSpeed,
      type: selectedType.shape, color: selectedType.color,
      hp: selectedType.hp, maxHp: selectedType.hp,
      name: selectedType.name, pts: selectedType.pts,
      spellTimer: 0
    };
    enemies.push(baseEnemy);
  }

  /* =========================================================
     ENEMY UPDATE & COLLISIONS
     ========================================================= */
  function updateEnemies() {
    const alive = [];
    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const distSq = dx * dx + dy * dy;

      if (distSq > 1) {
        const d = Math.sqrt(distSq);
        e.x += (dx / d) * e.speed;
        e.y += (dy / d) * e.speed;
      }

      // Enemy AI: Spells vs Bullets
      e.spellTimer++;
      if (e.name === 'Overlord') { // The "UFO" / Final Enemy
        if (e.spellTimer > 240) { // Slower fire (every 4 seconds)
          bullets.push({
            x: e.x, y: e.y,
            dx: -(dx / dist) * 3, dy: -(dy / dist) * 3,
            color: '#ff3366', // Red bullet (hurts life)
            source: 'enemy_bullet'
          });
          e.spellTimer = 0;
        }
      } else if (e.name === 'Pulsar' || e.name === 'Void' || e.name === 'Phantom') { 
        if (e.spellTimer > 200) { 
          bullets.push({
            x: e.x, y: e.y,
            dx: -(dx / dist) * 4, dy: -(dy / dist) * 4,
            color: '#a349a4', // Purple spell
            source: 'enemy_spell'
          });
          e.spellTimer = 0;
        }
      }

      let dead = false;

      // Bullet collision
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        
        // Enemy projectiles vs player
        if (b.source.startsWith('enemy_')) {
          const pdx = player.x - b.x;
          const pdy = player.y - b.y;
          if (Math.hypot(pdx, pdy) < player.size) {
            bullets.splice(i, 1);
            if (player.powers.shield <= 0) {
              if (b.source === 'enemy_bullet') {
                if (!isPractice) player.vida--;
                createParticles(player.x, player.y, '#ff3366', 20);
                shakeAmt = 15; damageFlash = 0.5;
                SFX.play(100, 20, 'sawtooth', 0.2, 0.5);
              } else {
                // Enemy projectile hits: just standard slow/disable
                const roll = Math.random();
                const type = roll < 0.5 ? 'slow' : 'disable';
                player.debuffs[type] = 180;
                showAnnouncement(type === 'slow' ? '⚠ NAVE LENTA' : '⚠ SISTEMAS BLOQUEADOS');
                SFX.hit();
              }
            }
            continue;
          }
        }

        // Player bullets vs enemies
        if (b.source === 'manual' || b.source === 'auto') {
          if (Math.abs(b.x - e.x) < e.size && Math.abs(b.y - e.y) < e.size) {
            bullets.splice(i, 1);
            e.hp--;
            createParticles(b.x, b.y, '#ffffff', 4);
            if (e.hp <= 0) {
              dead = true;
              let multiplier = (b.source === 'manual') ? 1.5 : 1.0;
              multiplier *= diffMultiplier;
              const pts = Math.ceil((e.pts + 5) * multiplier);
              addScore(pts);
              kills++;
              killsMilestone++;
              if (ultraEnergy < ULTRA_MAX) ultraEnergy = Math.min(ULTRA_MAX, ultraEnergy + 1);
              createParticles(e.x, e.y, e.color, 20);
              createFloatingText(e.x, e.y, `+${pts}`, '#f1c40f');
              SFX.kill();
              break;
            } else {
              SFX.hit();
            }
          }
        }
      }

      // Player collision directly with enemy body
      const pdx = player.x - e.x;
      const pdy = player.y - e.y;
      const distSqBody = pdx * pdx + pdy * pdy;
      const collisionThreshold = (player.size + e.size) * 0.7;
      
      if (!dead && distSqBody < collisionThreshold * collisionThreshold) {
        if (player.powers.shield <= 0) {
          if (!isPractice) player.vida--;
          damageFlash = 1.0;
          shakeAmt = 20; 
          createParticles(player.x, player.y, '#ff3366', 30);
          SFX.play(100, 20, 'sawtooth', 0.2, 0.5);
        } else {
          const shieldPts = Math.ceil(e.pts * diffMultiplier * 0.5);
          addScore(shieldPts);
          kills++;
          killsMilestone++;
          if (ultraEnergy < ULTRA_MAX) ultraEnergy = Math.min(ULTRA_MAX, ultraEnergy + 1);
          createFloatingText(e.x, e.y, `+${shieldPts}`, '#3498db');
          SFX.kill();
        }
        dead = true;
        createParticles(e.x, e.y, e.color, 15);
      }

      if (!dead) alive.push(e);
    }
    enemies = alive;
  }

  function addScore(pts) {
    if (player.debuffs.noscore > 0) return;
    score += pts;
    scoreMilestone += pts;
  }

  function spawnCollectibles() {
    if (frame % 420 === 0) {
      const p = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
      powerUps.push({
        x: random(camera.x + 50, camera.x + camera.width - 50),
        y: random(camera.y + 50, camera.y + camera.height - 150),
        type: p.type, color: p.color, time: 600,
      });
    }

    // Debuff "Trampas" en el mapa (Red Icons)
    let trapChance = 1200; 
    if (selectedDifficulty === 'hardcore') trapChance = 400;
    else if (selectedDifficulty === 'dificil') trapChance = 700;

    if (frame % trapChance === 0) {
      const types = ['slow', 'disable', 'noscore', 'powerlock'];
      const t = types[Math.floor(Math.random() * types.length)];
      powerUps.push({
        x: random(camera.x + 50, camera.x + camera.width - 50),
        y: random(camera.y + 50, camera.y + camera.height - 150),
        type: t, color: '#ff3366', time: 500, isTrap: true
      });
    }

    // Heart spawn probability
    let heartMod = (selectedDifficulty === 'hardcore') ? 4500 : 2200;
    if (frame > 0 && frame % heartMod === 0) {
      hearts.push({
        x: random(camera.x + 50, camera.x + camera.width - 50),
        y: random(camera.y + 50, camera.y + camera.height - 150),
        time: 300,
      });
    }
  }

  function updateCollectibles() {
    const magnetRadius = 250;
    const magnetForce = 4.5;

    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      p.time--;

      // Magnet effect (only for beneficial powers, not traps)
      const dx = player.x - p.x;
      const dy = player.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < magnetRadius && !p.isTrap) {
        p.x += (dx / dist) * magnetForce;
        p.y += (dy / dist) * magnetForce;
        if (frame % 3 === 0) createParticles(p.x, p.y, p.color, 1);
      }

      if (dist < player.size + (p.isTrap ? 25 : 15)) {
        if (p.isTrap) {
          player.debuffs[p.type] = 300;
          const msgs = { slow:'⚠ LENTITUD', disable:'⚠ BLOQUEO', noscore:'⚠ NO SCORE', powerlock:'⚠ PODER LOCK' };
          showAnnouncement(msgs[p.type]);
          createParticles(p.x, p.y, '#ff3366', 30);
          SFX.hit();
        } else {
          player.powers[p.type] += POWER_DURATION;
          createParticles(p.x, p.y, p.color, 30);
          SFX.powerup();
        }
        powerUps.splice(i, 1);
        continue;
      }
      if (p.time <= 0) powerUps.splice(i, 1);
    }

    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.time--;

      // Magnet effect
      const dx = player.x - h.x;
      const dy = player.y - h.y;
      const dist = Math.hypot(dx, dy);
      if (dist < magnetRadius) {
        h.x += (dx / dist) * magnetForce;
        h.y += (dy / dist) * magnetForce;
        if (frame % 3 === 0) createParticles(h.x, h.y, '#ff007f', 1);
      }

      if (dist < player.size + 15) {
        if (!isPractice) player.vida++;
        createParticles(h.x, h.y, '#ff007f', 40);
        createFloatingText(h.x, h.y, "❤ +1 VIDA", "#ff007f");
        SFX.powerup();
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
      if (!isPractice) player.vida++;
      createParticles(player.x, player.y, '#ff007f', 40);
      createFloatingText(player.x, player.y, "❤ EXTRA!", "#ff007f");
      SFX.powerup();
    }
    if (scoreMilestone >= currentMilestoneTarget) {
      scoreMilestone -= currentMilestoneTarget;
      if (gameState !== 'PLAYING') return; 
      gameState = 'CHOOSING';
      
      // Customize LevelUp Menu for Hardcore
      const menu = $('levelup-menu');
      if (selectedDifficulty === 'hardcore') {
        menu.querySelector('h1').innerText = '⚡ SOBRECARGA HARDCORE ⚡';
        menu.querySelector('p').innerText = 'Has alcanzado los 4200 puntos. ¡Sistemas al límite!';
        // Replace Life button text
        const btns = menu.querySelectorAll('.btn');
        btns[btns.length-1].innerText = '⚡ CARGAR ULTRA';
        btns[btns.length-1].setAttribute('onclick', "choosePremiumPower('ultra')");
      } else {
        menu.querySelector('h1').innerText = '¡PUNTUACIÓN DESTACADA!';
        menu.querySelector('p').innerText = 'Has alcanzado los 1600 puntos. Elige una mejora:';
        const btns = menu.querySelectorAll('.btn');
        btns[btns.length-1].innerText = '❤ +1 Vida';
        btns[btns.length-1].setAttribute('onclick', "choosePremiumPower('life')");
      }
      
      menu.classList.add('active');
    }
    
    // Record broken animation
    const records = Storage.load(selectedDifficulty);
    if (score > records.score && !isRecordBroken && records.score > 0) {
      isRecordBroken = true;
      showAnnouncement("🏆 ¡NUEVO RÉCORD ESTABLECIDO! 🏆");
      SFX.powerup();
      shakeAmt = 15;
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
  function drawPlayer(targetCtx = ctx, pObj = player) {
    targetCtx.save();
    targetCtx.translate(pObj.x, pObj.y);
    
    // Elite Steel (Classic) naturally faces RIGHT, others face UP (like Retro/Phantom/Golden)
    let finalAngle = pObj.angle + Math.PI / 2; 
    if (pObj.skin.type === 'classic') finalAngle = pObj.angle;
    
    targetCtx.rotate(finalAngle);

    // Image Skins (Classic, Phantom, Golden, Custom)
    if (pObj.skin.img) {
      const s = pObj.size * 2.2; 
      targetCtx.drawImage(pObj.skin.img, -s/2, -s/2, s, s);
      
      if (pObj.powers.auto > 0 || pObj.powers.manual > 0) {
        targetCtx.globalCompositeOperation = 'lighter';
        targetCtx.globalAlpha = 0.3;
        targetCtx.drawImage(pObj.skin.img, -s/2, -s/2, s, s);
        targetCtx.globalCompositeOperation = 'source-over';
        targetCtx.globalAlpha = 1.0;
      }
      
      targetCtx.restore();
      if (pObj.powers.shield > 0) {
        targetCtx.save(); targetCtx.translate(pObj.x, pObj.y);
        targetCtx.beginPath(); targetCtx.arc(0, 0, pObj.size + 15, 0, Math.PI * 2);
        targetCtx.strokeStyle = 'rgba(52, 152, 219, 0.8)'; targetCtx.lineWidth = 3; targetCtx.stroke();
        targetCtx.restore();
      }
      return;
    }

    let pColor = '#00ffff';
    if (pObj.skin.type === 'phantom') pColor = '#9b59b6';
    else if (pObj.skin.type === 'golden') pColor = '#f1c40f';
    else if (pObj.skin.type === 'retro_triangle') pColor = '#2ecc71';
    else if (pObj.skin.type === 'retro_ufo') pColor = '#e74c3c';
    
    if (pObj.powers.auto > 0) pColor = '#f7ca18';
    else if (pObj.powers.manual > 0) pColor = '#e67e22';

    // Engine Trails (Visual Feedback)
    if (gameState === 'PLAYING' && targetCtx === ctx) {
      if (frame % 3 === 0) {
        createParticles(pObj.x - Math.cos(pObj.angle)*15, pObj.y - Math.sin(pObj.angle)*15, pColor, 2);
      }
    }

    targetCtx.fillStyle = '#101015';
    targetCtx.strokeStyle = pColor;
    targetCtx.lineWidth = 2.5;
    
    // Performance: Avoid shadowBlur if it's not essential or on mobile
    const useGlow = !isMobile && targetCtx === ctx;
    if (useGlow) {
      targetCtx.shadowBlur = 15;
      targetCtx.shadowColor = pColor;
    }

    targetCtx.beginPath();
    if (pObj.skin.type === 'retro_ufo') {
      targetCtx.ellipse(0, 0, pObj.size, pObj.size/2, 0, 0, Math.PI * 2);
      targetCtx.moveTo(-pObj.size/2, -pObj.size/4);
      targetCtx.arc(0, -pObj.size/4, pObj.size/2, Math.PI, 0);
    } else {
      targetCtx.moveTo(0, -pObj.size);
      targetCtx.lineTo(pObj.size * 0.8, pObj.size);
      targetCtx.lineTo(0, pObj.size - 6);
      targetCtx.lineTo(-pObj.size * 0.8, pObj.size);
    }
    targetCtx.closePath();
    targetCtx.fill();
    targetCtx.stroke();
    if (useGlow) targetCtx.shadowBlur = 0;

    // Phantom wing trails
    if (pObj.skin.type === 'phantom') {
      targetCtx.strokeStyle = 'rgba(155, 89, 182, 0.4)';
      targetCtx.beginPath();
      targetCtx.moveTo(-pObj.size, 10); targetCtx.lineTo(-pObj.size * 1.5, 25);
      targetCtx.moveTo(pObj.size, 10); targetCtx.lineTo(pObj.size * 1.5, 25);
      targetCtx.stroke();
    }

    // Shield aura
    if (pObj.powers.shield > 0) {
      targetCtx.beginPath();
      targetCtx.arc(0, 0, pObj.size + 15, 0, Math.PI * 2);
      targetCtx.strokeStyle = 'rgba(52, 152, 219, 0.8)';
      if (!isMobile) {
        targetCtx.shadowColor = '#3498db';
        targetCtx.shadowBlur = 20;
      }
      targetCtx.lineWidth = 3;
      targetCtx.stroke();
    }
    
    // Debuff visual icons
    const debuffsActive = [];
    if (pObj.debuffs.slow > 0) debuffsActive.push('🐢');
    if (pObj.debuffs.disable > 0) debuffsActive.push('🚫');
    if (pObj.debuffs.noscore > 0) debuffsActive.push('📉');
    if (pObj.debuffs.powerlock > 0) debuffsActive.push('🔒');

    if (debuffsActive.length > 0) {
      targetCtx.save();
      targetCtx.rotate(-finalAngle); // Keep emojis horizontal
      targetCtx.font = '16px serif';
      targetCtx.textAlign = 'center';
      targetCtx.fillText(debuffsActive.join(' '), 0, -pObj.size - 25);
      targetCtx.restore();
      
      targetCtx.beginPath();
      targetCtx.arc(0, 0, pObj.size + 10, 0, Math.PI * 2);
      targetCtx.strokeStyle = 'rgba(163, 73, 164, 0.6)';
      targetCtx.setLineDash([5, 5]);
      targetCtx.stroke();
      targetCtx.setLineDash([]);
    }

    targetCtx.restore();
  }

  /* =========================================================
     DRAWING — DETAILED ENEMY SHIPS
     ========================================================= */
  function drawEnemyShape(type, s, color) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';

    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, s);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0.2)');

    switch (type) {
      case 'circle': // Morg: Orb Cruiser
        ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill(); ctx.stroke();
        // Tech wings
        ctx.beginPath();
        ctx.moveTo(-s, 0); ctx.lineTo(-s-12, -8); ctx.lineTo(-s-12, 8); ctx.closePath();
        ctx.moveTo(s, 0); ctx.lineTo(s+12, -8); ctx.lineTo(s+12, 8); ctx.closePath();
        ctx.fillStyle = color; ctx.fill(); ctx.stroke();
        // Inner detail
        ctx.beginPath(); ctx.arc(0, 0, s*0.5, 0, Math.PI*2); ctx.stroke();
        break;
        
      case 'triangle': // Stinger: Advanced Interceptor
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.8);
        ctx.lineTo(s, s); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s, s);
        ctx.closePath();
        ctx.fillStyle = grad; ctx.fill(); ctx.stroke();
        // Winglets
        ctx.beginPath();
        ctx.moveTo(-s, s); ctx.lineTo(-s-10, s+5); ctx.lineTo(-s+5, s-5); ctx.stroke();
        ctx.moveTo(s, s); ctx.lineTo(s+10, s+5); ctx.lineTo(s-5, s-5); ctx.stroke();
        break;

      case 'square': // Titan: Armored Behemoth
        ctx.beginPath(); ctx.rect(-s, -s, s * 2, s * 1.6);
        ctx.fillStyle = grad; ctx.fill(); ctx.stroke();
        // Heavy plating
        for(let i=-1; i<=1; i+=2) {
           ctx.beginPath(); ctx.rect(i*s*0.7 - s*0.15, -s*1.2, s*0.3, s*2.4);
           ctx.stroke();
        }
        break;

      case 'ufo': // Overlord: Elite Command Ship
        ctx.beginPath(); ctx.ellipse(0, 0, s * 1.6, s * 0.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill(); ctx.stroke();
        // Command dome
        ctx.beginPath(); ctx.arc(0, -s*0.3, s*0.7, Math.PI, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill(); ctx.stroke();
        // Engine vents
        for(let i=-2; i<=2; i++) {
           ctx.beginPath(); ctx.rect(i*s*0.4 - 2, s*0.5, 4, 6);
           ctx.fillStyle = color; ctx.fill();
        }
        break;
        
      default: // High-tech combat drone for everything else
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.4);
        ctx.lineTo(s * 0.8, 0);
        ctx.lineTo(0, s * 1.4);
        ctx.lineTo(-s * 0.8, 0);
        ctx.closePath();
        ctx.fillStyle = grad; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s*0.4, 0); ctx.lineTo(s*0.4, 0); ctx.stroke();
        break;
    }
  }

  /* =========================================================
     DRAWING — ENTITIES
     ========================================================= */
  function drawEntities() {
    // Bullets
    if (!isMobile) ctx.shadowBlur = 10;
    else ctx.shadowBlur = 0;

    for (const b of bullets) {
      if (b.x < camera.x - 20 || b.x > camera.x + camera.width + 20 || b.y < camera.y - 20 || b.y > camera.y + camera.height + 20) continue;
      
      // Multi-pass glow effect (Digital feel)
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(b.x - 4, b.y - 4, 8, 8);
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    }

    // Enemies
    for (const e of enemies) {
      if (e.x < camera.x - 100 || e.x > camera.x + camera.width + 100 || e.y < camera.y - 100 || e.y > camera.y + camera.height + 100) continue;
      
      ctx.save();
      ctx.translate(e.x, e.y);
      if (!isMobile) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = e.color;
      }
      ctx.strokeStyle = e.color;
      
      // Elegant and compact look
      ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.rotate(frame * 0.04 * (e.speed > 2.0 ? 2 : 1));

      // Draw outer shape (Passing the color now to fix crash!)
      drawEnemyShape(e.type, e.size, e.color);
      ctx.fill();
      ctx.stroke();

      // Draw inner glowing core
      if (!isMobile) {
        ctx.beginPath();
        drawEnemyShape(e.type, e.size * 0.4, '#ffffff');
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
      }
      
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
    if (!isMobile) {
      ctx.shadowBlur = 20;
      ctx.shadowColor = p.color;
    }
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
  const cachedUI = { vida: -1, kills: -1, score: -1, time: -1, power: '', ultra: -1 };
  function updateUI() {
    const curVida = isPractice ? '∞' : player.vida;
    if (cachedUI.vida !== curVida) {
      $('vida').innerText = curVida;
      cachedUI.vida = curVida;
    }
    if (cachedUI.kills !== kills) {
      $('kills').innerText = kills;
      cachedUI.kills = kills;
    }
    if (cachedUI.score !== score) {
      $('score').innerText = score;
      cachedUI.score = score;
    }
    if (cachedUI.time !== time) {
      $('time').innerText = time;
      cachedUI.time = time;
    }

    let txt = '';
    if (player.powers.auto > 0) txt += `<span style="color:#f7ca18; margin-right:8px;">[Auto ${Math.ceil(player.powers.auto / 60)}s]</span>`;
    if (player.powers.manual > 0) txt += `<span style="color:#e67e22; margin-right:8px;">[Manual ${Math.ceil(player.powers.manual / 60)}s]</span>`;
    if (player.powers.speed > 0) txt += `<span style="color:#2ecc71; margin-right:8px;">[Vel ${Math.ceil(player.powers.speed / 60)}s]</span>`;
    if (player.powers.shield > 0) txt += `<span style="color:#3498db; margin-right:8px;">[Escudo ${Math.ceil(player.powers.shield / 60)}s]</span>`;
    if (player.debuffs.slow > 0) txt += `<span style="color:#a349a4; margin-right:8px;">[🐢 LENTA]</span>`;
    if (player.debuffs.disable > 0) txt += `<span style="color:#ff3366; margin-right:8px;">[🚫 BLOQUEO]</span>`;
    if (player.debuffs.noscore > 0) txt += `<span style="color:#e74c3c; margin-right:8px;">[📉 SIN PUNTOS]</span>`;
    if (player.debuffs.powerlock > 0) txt += `<span style="color:#9b59b6; margin-right:8px;">[🔒 PODER LOCK]</span>`;
    
    if (cachedUI.power !== txt) {
      $('power').innerHTML = txt || 'Ninguno';
      cachedUI.power = txt;
    }

    const uPct = Math.floor((ultraEnergy / ULTRA_MAX) * 100);
    if (cachedUI.ultra !== uPct) {
      const uBar = $('ultra-bar');
      const uBtn = $('ultra-btn');
      if (uBar) {
        uBar.style.width = `${uPct}%`;
        if (ultraEnergy >= ULTRA_MAX) {
          uBar.classList.add('ready');
          if (uBtn) { uBtn.classList.remove('ultra-btn-disabled'); uBtn.classList.add('ultra-btn-ready'); }
        } else {
          uBar.classList.remove('ready');
          if (uBtn) { uBtn.classList.add('ultra-btn-disabled'); uBtn.classList.remove('ultra-btn-ready'); }
        }
      }
      cachedUI.ultra = uPct;
    }
  }

  let animationId = null;

  /* =========================================================
     MAIN LOOP
     ========================================================= */
  function gameLoop() {
    if (gameState !== 'PLAYING') {
      animationId = null;
      return;
    }

    ctx.fillStyle = 'rgba(5, 5, 16, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();

    // Apply Shake
    if (shakeAmt > 0) {
      ctx.translate((Math.random()-0.5)*shakeAmt, (Math.random()-0.5)*shakeAmt);
      shakeAmt *= 0.9;
    }

    // Background (Parallax)
    drawParallaxBackground();

    ctx.translate(-camera.x, -camera.y);

    // World border
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
    ctx.lineWidth = 10;
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
    updateAndDrawFloatingTexts();

    ctx.restore();

    // Damage Flash
    if (damageFlash > 0) {
      ctx.fillStyle = `rgba(255, 0, 50, ${damageFlash * 0.4})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      damageFlash -= 0.05;
    }

    // Flash Nova Effect
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      flashAlpha -= 0.03;
    }

    // Frame counter
    frame++;
    if (frame % 60 === 0) {
      time++;
      addScore(8);
      if (selectedDifficulty === 'progresivo') {
        if (spawnRate > 60) spawnRate -= 0.5;
      } else {
        if (spawnRate > 50) spawnRate -= 0.2; // Slow gradual progression for static diffs
      }
    }

    updateUI();

    for (const d in player.debuffs) if (player.debuffs[d] > 0) player.debuffs[d]--;

    if (player.vida <= 0) {
      endGame();
    } else {
      animationId = requestAnimationFrame(gameLoop);
    }
  }

  /* =========================================================
     MENU LOGIC
     ========================================================= */
  window.setupDifficulty = function(diff) {
    selectedDifficulty = diff;
    isPractice = (diff === 'practica');
    isRecordBroken = false;
    currentMilestoneTarget = 1600;
    currentUnlockInterval = 700;
    unlockedEnemies = 1;
    spawnRate = 120;

    switch(diff) {
      case 'practica': diffMultiplier = 0.2; spawnRate = 140; player.vida = 999; break;
      case 'facil': diffMultiplier = 0.5; spawnRate = 150; player.vida = 5; break;
      case 'medio': diffMultiplier = 1.0; spawnRate = 100; player.vida = 5; break;
      case 'dificil': diffMultiplier = 1.5; spawnRate = 80; player.vida = 4; break;
      case 'hardcore': 
        diffMultiplier = 2.5; 
        spawnRate = 60; 
        player.vida = 1; 
        currentMilestoneTarget = 4200; 
        currentUnlockInterval = 1200; 
        unlockedEnemies = 3; 
        break;
      case 'progresivo': diffMultiplier = 1.0; spawnRate = 120; player.vida = 5; break;
    }
  };

  window.startGame = function(diff) {
    if (window.initAudio) window.initAudio();
    setupDifficulty(diff);
    startCountdown(3); 
    setTimeout(drawPreview, 100);
  };

  window.pauseGame = function(state) {
    if (gameState === 'GAMEOVER') return;
    if (state) {
      gameState = 'CHOOSING'; // Reusing Choosing state to pause loop
      if (animationId) cancelAnimationFrame(animationId);
      animationId = null;
      $('pause-menu').classList.add('active');
    } else {
      $('pause-menu').classList.remove('active');
      gameState = 'PLAYING';
      if (!animationId) animationId = requestAnimationFrame(gameLoop);
    }
  };

  window.exitGame = function() {
    location.reload(); // Simple exit
  };

  window.toggleSoundFromPause = function(cb) {
    const mainToggle = $('sound-toggle');
    if (mainToggle) mainToggle.checked = cb.checked;
    window.toggleSound();
  };

  window.openSettings = function() {
    $('start-menu').classList.remove('active');
    $('settings-menu').classList.add('active');
  };

  window.closeSettings = function() {
    $('settings-menu').classList.remove('active');
    $('start-menu').classList.add('active');
  };

  let countdownInterval = null;
  function startCountdown(seconds = 3) {
    if (animationId) cancelAnimationFrame(animationId);
    if (countdownInterval) clearInterval(countdownInterval);
    animationId = null;

    // Reset Difficulty params (Important for Retry)
    setupDifficulty(selectedDifficulty);
    score = 0; scoreMilestone = 0;
    kills = 0; killsMilestone = 0;
    time = 0; frame = 0;
    ultraEnergy = 0;
    bullets = []; enemies = []; powerUps = []; hearts = [];
    player.powers = { auto: 0, manual: 0, speed: 0, shield: 0 };
    player.debuffs = { slow: 0, disable: 0, noscore: 0, powerlock: 0 };
    player.x = WORLD.WIDTH / 2;
    player.y = WORLD.HEIGHT / 2;

    $('start-menu').classList.remove('active');
    $('settings-menu').classList.remove('active');
    $('pause-menu').classList.remove('active');
    $('levelup-menu').classList.remove('active');
    $('tutorial-menu-overlay').classList.remove('active');
    $('game-over-menu').classList.remove('active');
    
    $('pause-btn').style.display = 'block';
    $('end-practice-btn').style.display = isPractice ? 'block' : 'none';

    const countEl = $('countdown');
    countEl.style.display = 'block';
    let count = seconds;
    countEl.innerText = count;

    countdownInterval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        countEl.style.display = 'none';
        gameState = 'PLAYING';
        if (!animationId) animationId = requestAnimationFrame(gameLoop);
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
  window.choosePremiumPower = function(type) {
    if (gameState !== 'CHOOSING') return; // BUG FIX: already chosen
    
    if (type === 'life') {
      player.vida++;
    } else if (type === 'ultra') {
      ultraEnergy = ULTRA_MAX;
      triggerUltra();
    } else {
      player.powers[type] += PREMIUM_DURATION;
    }
    createParticles(player.x, player.y, '#ffffff', 50);
    $('levelup-menu').classList.remove('active');
    SFX.powerup();
    gameState = 'PLAYING';
    requestAnimationFrame(gameLoop);
  };

  /* =========================================================
     GAME OVER & RESTART
     ========================================================= */
  function endGame() {
    gameState = 'GAMEOVER';
    $('game-over-menu').classList.add('active');
    $('pause-btn').style.display = 'none';
    
    const records = Storage.load(selectedDifficulty);
    records.gamesPlayed++;
    const currentAvg = kills > 0 ? parseFloat((score / kills).toFixed(1)) : 0;
    
    // Validation for new record: only if it's strictly better than the past
    const isNewScore = score > records.score;
    const isNewKills = kills > records.kills;
    const isNewAvg = currentAvg > records.average;
    const isNewTime = time > records.time;
    
    const anyNewRecord = isNewScore || isNewKills || isNewAvg || isNewTime;

    const results = [
      { key: 'score', current: score, best: records.score, label: 'Score', isNew: isNewScore },
      { key: 'kills', current: kills, best: records.kills, label: 'Kills', isNew: isNewKills },
      { key: 'average', current: currentAvg, best: records.average, label: 'Promedio', isNew: isNewAvg },
      { key: 'time', current: time, best: records.time, label: 'Tiempo (s)', isNew: isNewTime },
    ];

    // Update records in storage if they are better
    if (isNewScore) records.score = score;
    if (isNewKills) records.kills = kills;
    if (isNewAvg) records.average = currentAvg;
    if (isNewTime) records.time = time;

    Storage.save(selectedDifficulty, records);
    
    // Save to History
    Storage.saveHistory({
      date: new Date().toLocaleTimeString(),
      mode: selectedDifficulty.toUpperCase(),
      score, kills, time
    });

    $('game-over-title').innerText = anyNewRecord ? '🏆 ¡NUEVO RÉCORD! 🏆' : 'MISIÓN FALLIDA';
    $('game-over-title').style.color = anyNewRecord ? '#f1c40f' : '#ff3366';
    $('final-stats').innerText = `Dificultad: ${selectedDifficulty.toUpperCase()} | Sobreviviste ${time}s`;

    // Reset Retry Button UI Just in case
    const retryBtn = $('retry-btn');
    if (retryBtn) { retryBtn.innerText = 'Reintentar'; retryBtn.style.background = ''; }

    const body = $('records-body');
    body.innerHTML = '';
    results.forEach(res => {
      const row = document.createElement('tr');
      const displayBest = res.isNew ? res.current : res.best;
      row.innerHTML = `<td>${res.label}</td><td>${res.current}</td><td class="${res.isNew ? 'highlight-record' : ''}">${displayBest}</td>`;
      body.appendChild(row);
    });
  }

  window.retryGame = function() {
    const retryBtn = $('retry-btn');
    
    if (countdownInterval) {
      // CANCEL LOGIC
      clearInterval(countdownInterval);
      countdownInterval = null;
      $('countdown').style.display = 'none';
      if (retryBtn) {
        retryBtn.innerText = 'Reintentar';
        retryBtn.style.background = '';
      }
    } else {
      // START RETRY LOGIC
      if (retryBtn) {
        retryBtn.innerText = 'Cancelar';
        retryBtn.style.background = '#ff3366';
      }
      startCountdown(5);
    }
  };

  window.endPractice = function() {
    if (!isPractice) return;
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    $('pause-menu').classList.remove('active'); // Close Pause Menu first
    player.vida = 0; 
    endGame(); 
  };

  /* =========================================================
     HISTORY UI
     ========================================================= */
  window.openHistory = function() {
    const body = $('history-body');
    body.innerHTML = '';
    const history = Storage.getHistory();
    history.forEach((h, index) => {
      const row = document.createElement('tr');
      row.className = 'history-row';
      row.innerHTML = `
        <td>${h.date}</td>
        <td>${h.mode}</td>
        <td>${h.score}</td>
        <td>${h.kills}</td>
        <td>${h.time}s</td>
        <td><button class="delete-btn" onclick="deleteHistoryItem(${index})">🗑️</button></td>
      `;
      body.appendChild(row);
    });
    $('history-menu').classList.add('active');
  };

  window.deleteHistoryItem = function(index) {
    if (confirm('¿Eliminar este registro?')) {
      Storage.deleteHistoryItem(index);
      window.openHistory();
    }
  };

  window.closeHistory = function() { $('history-menu').classList.remove('active'); };
  window.clearHistory = function() { Storage.clearHistory(); window.openHistory(); };

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
  window.installApp = installApp;
  window.hideInstallBanner = hideInstallBanner;

})();
