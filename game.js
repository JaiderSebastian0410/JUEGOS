/* =========================================================
   Space Defender Pro — Game Engine
   Clean, modular, IIFE-wrapped game logic
   ========================================================= */

(function () {
  'use strict';

  /* =========================================================
     CONSTANTS & CONFIG
     ========================================================= */
  const WORLD = Object.freeze({ WIDTH: 6000, HEIGHT: 6000 });
  const SAVE_KEY = 'space_defender_records_v2';
  const STAR_COUNT = 300;
  const POWER_DURATION = 480;       // frames (~8 seconds at 60fps)
  const PREMIUM_DURATION = 1500;    // frames (~25 seconds)
  let killsPerLife = 70;
  const SCORE_PER_MILESTONE = 1600;
  const ENEMY_UNLOCK_INTERVAL = 700;

  const PLAYER_BASE_SPEED = 6.2;
  const PLAYER_BOOST_SPEED = 10.0;

  const POWER_TYPES = Object.freeze([
    { type: 'auto', color: '#f7ca18' },
    { type: 'manual', color: '#e67e22' },
    { type: 'speed', color: '#2ecc71' },
    { type: 'shield', color: '#3498db' },
  ]);

  const ENEMY_TYPES = Object.freeze([
    { name: 'Morg', shape: 'circle', color: '#ff3366', size: 14, hp: 1, speed: 1.7, pts: 10 },
    { name: 'Stinger', shape: 'triangle', color: '#e67e22', size: 12, hp: 1, speed: 3.3, pts: 15 },
    { name: 'Titan', shape: 'square', color: '#9b59b6', size: 20, hp: 3, speed: 1.1, pts: 30 },
    { name: 'Vanguard', shape: 'pentagon', color: '#2ecc71', size: 16, hp: 2, speed: 1.8, pts: 25 },
    { name: 'Wasp', shape: 'hexagon', color: '#f1c40f', size: 14, hp: 2, speed: 2.4, pts: 20 },
    { name: 'Pulsar', shape: 'star', color: '#3498db', size: 18, hp: 4, speed: 1.5, pts: 40 },
    { name: 'Razor', shape: 'diamond', color: '#1abc9c', size: 10, hp: 2, speed: 3.9, pts: 35 },
    { name: 'Interceptor', shape: 'cross', color: '#ff007f', size: 16, hp: 5, speed: 2.0, pts: 50 },
    { name: 'Goliath', shape: 'octagon', color: '#ecf0f1', size: 24, hp: 8, speed: 0.95, pts: 80 },
    { name: 'Overlord', shape: 'ufo', color: '#f1c40f', size: 28, hp: 12, speed: 1.4, pts: 150 },
  ]);

  /* =========================================================
     UTILITIES
     ========================================================= */
  const random = (min, max) => Math.random() * (max - min) + min;
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const hypot = Math.hypot;
  const $ = (id) => document.getElementById(id);

  /* =========================================================
     ENEMY OBJECT POOL
     ========================================================= */
  const EnemyPool = {
    _pool: [],
    get() {
      return this._pool.length > 0 ? this._pool.pop() : {};
    },
    release(e) {
      if (this._pool.length < 150) this._pool.push(e);
    }
  };

  /* =========================================================
     SPATIAL GRID (Collision Optimization)
     ========================================================= */
  const GRID_CELL = 200;
  const spatialGrid = {};
  function buildSpatialGrid(list) {
    for (const k in spatialGrid) delete spatialGrid[k];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const cx = (e.x / GRID_CELL) | 0;
      const cy = (e.y / GRID_CELL) | 0;
      const key = cx + ',' + cy;
      if (!spatialGrid[key]) spatialGrid[key] = [];
      spatialGrid[key].push(e);
    }
  }
  function getNearbyEnemies(x, y, radius) {
    const result = [];
    const minCX = ((x - radius) / GRID_CELL) | 0;
    const maxCX = ((x + radius) / GRID_CELL) | 0;
    const minCY = ((y - radius) / GRID_CELL) | 0;
    const maxCY = ((y + radius) / GRID_CELL) | 0;
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const cell = spatialGrid[cx + ',' + cy];
        if (cell) for (let i = 0; i < cell.length; i++) result.push(cell[i]);
      }
    }
    return result;
  }

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
  let diffMultiplierSpeed = 1.0;
  let spawnWeightFactor = 0.65;
  let floatingTexts = [];
  
  let shakeAmt = 0;
  let damageFlash = 0;

  const ULTRA_MAX = 100; // Requires 100 kills to charge
  let ultraEnergy = 0;
  let flashAlpha = 0;
  let enemyIdCounter = 0;  // Unique ID for each enemy (used in multiplayer sync)

  /* =========================================================
     INPUT HANDLING
     ========================================================= */
  const keys = {};
  const keyHoldTimers = {};
  const KEY_HOLD_THRESHOLD = 1;
  let joystickOrigin = null;
  let joystickCurrent = null;
  let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  let isFiring = false;
  let mouseX = 0, mouseY = 0;
  let isMouseDown = false;
  let moveGrace = 0;

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
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const c = cv.getContext('2d');
        c.drawImage(img, 0, 0);
        const id = c.getImageData(0, 0, cv.width, cv.height);
        const d = id.data;
        const w = cv.width, h = cv.height;
        // Sample background from all 4 corners (average)
        const corners = [
          [0,0], [w-1,0], [0,h-1], [w-1,h-1]
        ];
        let bgR=0, bgG=0, bgB=0;
        for (const [cx,cy] of corners) {
          const idx = (cy*w+cx)*4;
          bgR += d[idx]; bgG += d[idx+1]; bgB += d[idx+2];
        }
        bgR = Math.round(bgR/4); bgG = Math.round(bgG/4); bgB = Math.round(bgB/4);
        // Remove pixels similar to background OR close to white
        const threshold = 80;
        for (let i = 0; i < d.length; i += 4) {
          const dr = Math.abs(d[i]-bgR), dg = Math.abs(d[i+1]-bgG), db = Math.abs(d[i+2]-bgB);
          const cornerDist = dr + dg + db;
          const whiteDist = Math.abs(d[i]-255) + Math.abs(d[i+1]-255) + Math.abs(d[i+2]-255);
          const blackDist = d[i] + d[i+1] + d[i+2];
          if (cornerDist < threshold || whiteDist < 60 || blackDist < 30) {
            d[i+3] = 0;
          }
        }
        c.putImageData(id, 0, 0);
        const finalImg = new Image();
        finalImg.onload = () => {
          player.skin.type = 'custom';
          player.skin.img = finalImg;
          document.getElementById('skin-status').innerText = 'Skin: Personalizada (IMG)';
          drawPreview();
        };
        finalImg.src = cv.toDataURL();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    if (window.initAudio) window.initAudio();
    SFX.powerup();
  };

  document.addEventListener('keydown', (e) => { 
    keys[e.key] = true;
    if (!keyHoldTimers[e.key]) keyHoldTimers[e.key] = 0;
    if ((e.key === 'q' || e.key === 'Q' || e.key === 'Shift') && ultraEnergy >= ULTRA_MAX) {
      triggerUltra();
    }
  });
  document.addEventListener('keyup', (e) => { keys[e.key] = false; keyHoldTimers[e.key] = 0; });
  // Mouse: ONLY active while button is held down
  canvas.addEventListener('mousemove', (e) => {
    if (isMobile || gameState !== 'PLAYING' || !isMouseDown) return;
    mouseX = e.clientX + camera.x;
    mouseY = e.clientY + camera.y;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (isMobile || gameState !== 'PLAYING' || e.button !== 0) return; // Only Left Click
    isMouseDown = true;
    mouseX = e.clientX + camera.x;
    mouseY = e.clientY + camera.y;
  });
  // Use string events on global window so drag-out doesn't get stuck
  window.addEventListener('mouseup', () => { isMouseDown = false; });
  window.addEventListener('mouseleave', () => { isMouseDown = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function triggerUltra() {
    if (gameState !== 'PLAYING' || ultraEnergy < ULTRA_MAX || player.debuffs.disable > 0) return;
    
    ultraEnergy = 0;
    flashAlpha = 1.0;
    player.powers.shield = Math.max(player.powers.shield, 180); // 3 seconds invulnerability
    
    // Collect killed enemy IDs for MP sync
    const killedEids = [];
    for (const e of enemies) {
      const ultraPts = Math.ceil((e.pts + 5) * diffMultiplier * 2.0);
      addScore(ultraPts);
      kills++;
      killsMilestone++;
      createParticles(e.x, e.y, e.color, 30);
      createFloatingText(e.x, e.y, `+${ultraPts}`, '#ff007f');
      if (e.eid) killedEids.push(e.eid);
    }
    for (let i = 0; i < enemies.length; i++) EnemyPool.release(enemies[i]);
    enemies = [];
    SFX.ultra();
    showAnnouncement("⚡ ¡FLASH NOVA! ⚡");
    
    // In MP, broadcast the ultra to all players so they clear the same enemies
    if (MP.isMultiplayer) {
      MP.send({ type: 'ultra_flash', killedEids, playerName: MP.playerName || 'Piloto' });
    }
  }

  // Touch — INVISIBLE joystick (gesture-based, no fixed UI)
  window.addEventListener('touchstart', (e) => {
    isMobile = true;
    if (gameState !== 'PLAYING') return;
    
    document.getElementById('mobile-controls').style.display = 'flex';
    
    // Si toca un botón, no activar joystick con este dedo
    if (e.target.closest('.touch-btn') || e.target.closest('#pause-btn')) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (!joystickOrigin) {
        joystickOrigin = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
        joystickCurrent = { x: touch.clientX, y: touch.clientY };
        break;
      }
    }
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (joystickOrigin) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === joystickOrigin.id);
      if (touch) {
        joystickCurrent = { x: touch.clientX, y: touch.clientY };
        e.preventDefault();
      }
    }
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    if (joystickOrigin) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === joystickOrigin.id);
      if (touch) {
        joystickOrigin = null; 
        joystickCurrent = null;
      }
    }
  });

  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isFiring = true; }, { passive: false });
  fireBtn.addEventListener('touchend', () => { isFiring = false; });

  // Ultra button
  const ultraBtn = $('ultra-btn');
  if (ultraBtn) {
    ultraBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); triggerUltra(); }, { passive: false });
  }
  /* =========================================================
     PROCEDURAL EPIC GALAXY BACKGROUND + ANIMATIONS
     ========================================================= */
  const imgNebula1 = new Image(); imgNebula1.src = 'nebula_1.png';
  const imgNebula2 = new Image(); imgNebula2.src = 'nebula_2.png';

  const ParallaxSpace = {
    starsL1: [], starsL2: [], starsL3: [],
    nebulae: [], planets: [], galaxies: [],
    planetSprites: [], galaxySprites: [], nebulaSprites: [],
    init() {
      // 1. Array of real HD Nebula Images (Assets)
      const nebulaImages = [imgNebula1, imgNebula2];
      
      // 2. High-Detail Procedural Nebulae (Mariposas/Estructuras realistas sin líneas)
      this.nebulaSprites = [];
      const nebPalettes = [
        {outer:[192,56,43], mid:[231,76,60], inner:[26,188,156], accent:[41,128,185]}, // Cassiopeia (Red, Cyan)
        {outer:[142,68,173], mid:[155,89,182], inner:[241,196,15], accent:[230,126,34]}, // Star-forming (Purple, Gold)
        {outer:[39,174,96], mid:[46,204,113], inner:[22,160,133], accent:[26,188,156]},  // Eagle (Green)
        {outer:[232,67,147], mid:[253,121,168], inner:[116,185,255], accent:[9,132,227]},// Orion (Pink, Blue)
        {outer:[225,112,85], mid:[250,177,160], inner:[0,206,201], accent:[9,132,227]},  // Crab (Orange, Teal)
        {outer:[214,48,49], mid:[255,118,117], inner:[108,92,231], accent:[162,155,254]}, // Veil (Red, Indigo)
        {outer:[0,184,148], mid:[85,239,196], inner:[253,203,110], accent:[243,156,18]}, // Ring (Teal, Amber)
        {outer:[183,21,64], mid:[235,47,6], inner:[229,80,57], accent:[248,194,145]}     // Rosette (Crimson)
      ];
      for (const pal of nebPalettes) {
        const sz = 800;
        const c = document.createElement('canvas'); c.width=sz; c.height=sz;
        const x = c.getContext('2d');
        const cx = sz/2, cy = sz/2;
        const [or,og,ob] = pal.outer, [mr,mg,mb] = pal.mid;
        const [ir,ig,ib] = pal.inner, [ar,ag,ab] = pal.accent;
        
        // Forma de mariposa / arcos de gas
        x.globalCompositeOperation = 'screen';
        
        for(let wisp=0; wisp<9; wisp++) {
           x.save(); x.translate(cx, cy); x.rotate(random(0, Math.PI*2));
           x.scale(1, random(0.15, 0.45)); // Alargas para crear la línea/arco
           
           const col = (wisp%3===0) ? pal.outer : ((wisp%3===1) ? pal.mid : pal.accent);
           const rx = sz * random(0.3, 0.48);
           const grad = x.createRadialGradient(0,0,0,0,0,rx);
           grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.45)`);
           grad.addColorStop(0.4, `rgba(${col[0]},${col[1]},${col[2]},0.15)`);
           grad.addColorStop(1, 'rgba(0,0,0,0)');
           
           const offset = rx * random(0.1, 0.6);
           x.fillStyle = grad;
           x.beginPath(); x.arc(offset, 0, rx, 0, Math.PI*2); x.fill();
           x.beginPath(); x.arc(-offset, 0, rx, 0, Math.PI*2); x.fill(); // Simetría opuesta
           
           // Nube extra asimétrica
           if(Math.random() < 0.5) {
               x.beginPath(); x.arc(0, rx*0.5, rx*0.8, 0, Math.PI*2); x.fill();
           }
           x.restore();
        }
        
        // Brillo central y knots 
        const cg = x.createRadialGradient(cx, cy, 0, cx, cy, sz*0.25);
        cg.addColorStop(0, `rgba(${ir},${ig},${ib}, 0.85)`);
        cg.addColorStop(0.3, `rgba(${mr},${mg},${mb}, 0.4)`);
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = cg; x.beginPath(); x.arc(cx, cy, sz*0.25, 0, Math.PI*2); x.fill();
        
        // Embedded stars
        x.globalCompositeOperation = 'source-over';
        for(let s=0; s<35; s++) {
          x.fillStyle=`rgba(255,255,255,${random(0.5,1.0)})`;
          x.beginPath(); x.arc(cx+random(-sz*0.35,sz*0.35),cy+random(-sz*0.35,sz*0.35),random(1,2.5),0,Math.PI*2); x.fill();
        }
        this.nebulaSprites.push(c);
      }

      // 3. Realistic Galaxy Sprites
      this.galaxySprites = [];
      const galConfigs = [
        {hCore: 40,  hArm: 210, arms: 2, tight: 0.18, tilt: 0.7,  thickness: 25, colorVar: 30}, // Blue spiral
        {hCore: 25,  hArm: 340, arms: 4, tight: 0.25, tilt: 0.6,  thickness: 30, colorVar: 20}, // Pink/Purple spiral
        {hCore: 55,  hArm: 25,  arms: 2, tight: 0.15, tilt: 0.4,  thickness: 20, colorVar: 15}, // Classic Golden
        {hCore: 190, hArm: 180, arms: 3, tight: 0.22, tilt: 0.8,  thickness: 30, colorVar: 40}, // Cyan/Teal
        {hCore: 35,  hArm: 280, arms: 2, tight: 0.12, tilt: 0.5,  thickness: 15, colorVar: 50}, // Violet/Orange
        {hCore: 10,  hArm: 350, arms: 5, tight: 0.30, tilt: 0.75, thickness: 35, colorVar: 10}, // Reddish
        {hCore: 50,  hArm: 140, arms: 2, tight: 0.20, tilt: 0.65, thickness: 25, colorVar: 30}, // Greenish
        {hCore: 45,  hArm: 220, arms: 3, tight: 0.18, tilt: 0.85, thickness: 20, colorVar: 20}, // Deep Blue
        {hCore: 0,   hArm: 15,  arms: 2, tight: 0.10, tilt: 0.3,  thickness: 15, colorVar: 10}, // Flat disk
        {hCore: 220, hArm: 200, arms: 4, tight: 0.28, tilt: 0.9,  thickness: 40, colorVar: 50}  // Wild irregular
      ];
      for (const gc of galConfigs) {
        const sz=700, c=document.createElement('canvas'); c.width=sz; c.height=sz;
        const x=c.getContext('2d');
        const cx=sz/2, cy=sz/2;
        
        x.translate(cx, cy); 
        x.rotate(random(0,Math.PI*2));
        x.scale(1, gc.tilt); 
        
        const bgGlow = x.createRadialGradient(0,0,0,0,0,sz*0.45);
        bgGlow.addColorStop(0, `hsla(${gc.hCore}, 80%, 40%, 0.4)`);
        bgGlow.addColorStop(0.2, `hsla(${gc.hArm}, 60%, 20%, 0.15)`);
        bgGlow.addColorStop(0.6, `hsla(${gc.hArm}, 50%, 10%, 0.05)`);
        bgGlow.addColorStop(1, `hsla(${gc.hArm}, 50%, 10%, 0)`);
        x.fillStyle = bgGlow;
        x.beginPath(); x.arc(0,0,sz*0.48,0,Math.PI*2); x.fill();

        const armParticles = 3000, dustParticles = 600, nebulaHII = 40;
        const maxAngle = Math.PI * 4; 
        for (let arm=0; arm<gc.arms; arm++) {
          const angleOffset = (Math.PI*2 / gc.arms) * arm;
          
          for(let i=0; i<dustParticles; i++) {
             const t = Math.pow(Math.random(), 1.2); 
             const angle = t * maxAngle;
             const r = 15 * Math.exp(gc.tight * angle);
             if (r > sz*0.42) continue;
             const scatter = gc.thickness * (r / (sz*0.2)) * (Math.random() - 0.5);
             const px = Math.cos(angle + angleOffset) * r + Math.cos(angle + angleOffset + Math.PI/2) * scatter;
             const py = Math.sin(angle + angleOffset) * r + Math.sin(angle + angleOffset + Math.PI/2) * scatter;
             const distRatio = r / (sz*0.42);
             x.fillStyle = `rgba(0, 0, 0, ${0.15 * (1-distRatio)})`;
             x.beginPath(); x.arc(px,py, random(10, 25), 0, Math.PI*2); x.fill();
          }

          for(let i=0; i<nebulaHII; i++) {
             const t = Math.pow(Math.random(), 1.5);
             const angle = t * maxAngle;
             const r = 15 * Math.exp(gc.tight * angle);
             if (r > sz*0.42) continue;
             const scatter = gc.thickness * 0.8 * (r / (sz*0.2)) * (Math.random() - 0.5);
             const px = Math.cos(angle + angleOffset) * r + Math.cos(angle + angleOffset + Math.PI/2) * scatter;
             const py = Math.sin(angle + angleOffset) * r + Math.sin(angle + angleOffset + Math.PI/2) * scatter;
             const hue = gc.hArm + random(-gc.colorVar, gc.colorVar);
             const grad = x.createRadialGradient(px,py,0,px,py,random(15, 35));
             grad.addColorStop(0, `hsla(${hue}, 100%, 70%, 0.35)`);
             grad.addColorStop(0.5, `hsla(${hue}, 80%, 40%, 0.15)`);
             grad.addColorStop(1, `hsla(${hue}, 80%, 40%, 0)`);
             x.fillStyle = grad;
             x.beginPath(); x.arc(px,py,35,0,Math.PI*2); x.fill();
          }

          for(let i=0; i<armParticles; i++) {
            const t = Math.pow(Math.random(), 1.5); 
            const angle = t * maxAngle;
            const r = 15 * Math.exp(gc.tight * angle);
            if (r > sz*0.42) continue;
            const scatterAmount = gc.thickness * (r / (sz*0.2));
            const gaussScatter = scatterAmount * (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
            const px = Math.cos(angle + angleOffset) * r + Math.cos(angle + angleOffset + Math.PI/2) * gaussScatter;
            const py = Math.sin(angle + angleOffset) * r + Math.sin(angle + angleOffset + Math.PI/2) * gaussScatter;
            const distRatio = r / (sz*0.42);
            const hue = distRatio < 0.2 ? gc.hCore + random(-10,10) : gc.hArm + random(-gc.colorVar, gc.colorVar);
            const lit = distRatio < 0.2 ? random(80,100) : random(60,95);
            const alpha = (1 - distRatio * 0.5) * random(0.5, 1);
            x.fillStyle = `hsla(${hue}, 90%, ${lit}%, ${alpha})`;
            x.beginPath(); x.arc(px,py,random(0.5, 2.5),0,Math.PI*2); x.fill();
          }
        }
        
        const coreSize = 50;
        const coreGlow = x.createRadialGradient(0,0,0,0,0,coreSize);
        coreGlow.addColorStop(0, '#ffffff');
        coreGlow.addColorStop(0.1, '#fff5e6');
        coreGlow.addColorStop(0.3, `hsla(${gc.hCore}, 100%, 80%, 0.8)`);
        coreGlow.addColorStop(0.6, `hsla(${gc.hCore}, 80%, 50%, 0.3)`);
        coreGlow.addColorStop(1, `hsla(${gc.hCore}, 80%, 50%, 0)`);
        x.fillStyle = coreGlow;
        x.beginPath(); x.arc(0,0,coreSize,0,Math.PI*2); x.fill();

        this.galaxySprites.push(c);
      }

      // 4. Detailed Planet Sprites
      this.planetSprites = [];
      const pc = [
        {c:'#34db8b',a:'#051e0f'},{c:'#e74c3c',a:'#1a0402'},
        {c:'#9b59b6',a:'#140727'},{c:'#3498db',a:'#05121e'},
        {c:'#f39c12',a:'#1c1000'},{c:'#1abc9c',a:'#001111'},{c:'#e84393',a:'#1a0410'}
      ];
      for (const clr of pc) {
        const variants = [0, 1]; // 0: Standard, 1: Rings
        for(const v of variants) {
          const cv = document.createElement('canvas'); cv.width = v ? 320 : 200; cv.height = v ? 320 : 200;
          const ctx_p = cv.getContext('2d');
          const cx = cv.width/2, cy = cv.height/2;
          
          if(v === 1) { // RINGS
            ctx_p.save(); ctx_p.translate(cx, cy); ctx_p.rotate(Math.PI/6);
            ctx_p.beginPath(); ctx_p.ellipse(0,0, 140, 25, 0, 0, Math.PI*2);
            ctx_p.strokeStyle = 'rgba(255,255,255,0.15)'; ctx_p.lineWidth = 10; ctx_p.stroke();
            ctx_p.beginPath(); ctx_p.ellipse(0,0, 120, 15, 0, 0, Math.PI*2);
            ctx_p.strokeStyle = `hsla(${random(0,360)}, 60%, 70%, 0.3)`; ctx_p.lineWidth = 4; ctx_p.stroke();
            ctx_p.restore();
          }

          // Planet Body with Texture
          const g = ctx_p.createRadialGradient(cx-30, cy-30, 0, cx, cy, 80);
          g.addColorStop(0, clr.c); g.addColorStop(0.8, clr.a); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx_p.fillStyle = g; ctx_p.beginPath(); ctx_p.arc(cx, cy, 80, 0, Math.PI*2); ctx_p.fill();
          
          // Texture: Bands and Craters
          ctx_p.save(); ctx_p.beginPath(); ctx_p.arc(cx, cy, 80, 0, Math.PI*2); ctx_p.clip();
          ctx_p.globalAlpha = 0.15; ctx_p.fillStyle='#000';
          if(Math.random() < 0.5) { // Bands
            for(let i=0; i<6; i++) ctx_p.fillRect(cx-80, cy-80 + i*30 + random(0,10), 160, random(5, 15));
          } else { // Craters
            for(let i=0; i<15; i++) { ctx_p.beginPath(); ctx_p.arc(random(cx-70, cx+70), random(cy-70, cy+70), random(4, 20), 0, Math.PI*2); ctx_p.fill(); }
          }
          // Highlight Rim
          ctx_p.globalAlpha = 0.3; ctx_p.strokeStyle = '#fff'; ctx_p.lineWidth = 3;
          ctx_p.beginPath(); ctx_p.arc(cx, cy, 78, 0, Math.PI*2); ctx_p.stroke();
          ctx_p.restore();
          this.planetSprites.push(cv);
        }
      }

      // 5. Populate Universe
      this.starsL1 = []; this.starsL2 = []; this.starsL3 = [];
      this.nebulae = []; this.planets = []; this.galaxies = [];
      
      const W = WORLD.WIDTH, H = WORLD.HEIGHT;
      const PAD = 2000;

      // ULTRA HIGH STAR DENSITY
      for(let i=0; i<30000; i++) this.starsL1.push({x: random(-PAD, W+PAD), y: random(-PAD, H+PAD), s: random(0.2, 0.8), a: random(0.1, 0.4), p: random(0.05, 0.12)});
      for(let i=15000; i<30000; i++) this.starsL2.push({x: random(-PAD, W+PAD), y: random(-PAD, H+PAD), s: random(0.8, 1.5), a: random(0.3, 0.7), p: random(0.15, 0.25)});
      for(let i=0; i<2000; i++) this.starsL3.push({x: random(-PAD, W+PAD), y: random(-PAD, H+PAD), s: random(1.5, 4), hue: [200, 210, 340, 180, 60, 40, 280][Math.floor(random(0,7))], p: random(0.3, 0.5)});
      
      // Galaxias Frente (p=0.88-0.92) - Menos cantidad, mayor escala
      for(let i=0; i<8; i++) {
        this.galaxies.push({
          x: random(0, W), y: random(0, H),
          scale: random(0.25, 0.45),
          angle: random(0, Math.PI*2),
          alpha: random(0.5, 0.8),
          spriteIdx: Math.floor(random(0, this.galaxySprites.length)), 
          p: random(0.88, 0.92)
        });
      }
      // Galaxias Lejanas (p=0.96-0.99) - Mayor cantidad, escala muy reducida
      for(let i=0; i<35; i++) {
        this.galaxies.push({
          x: random(0, W), y: random(0, H),
          scale: random(0.08, 0.20),
          angle: random(0, Math.PI*2),
          alpha: random(0.3, 0.6),
          spriteIdx: Math.floor(random(0, this.galaxySprites.length)), 
          p: random(0.96, 0.99)
        });
      }

      // Procedural Nebulae — Pequeñas, distribuidas, fijas al universo lejano
      for(let i=0; i<30; i++) {
        this.nebulae.push({
          x: random(-500, W+500), y: random(-500, H+500),
          scale: random(0.15, 0.30), 
          angle: random(0, Math.PI*2),
          alpha: random(0.15, 0.40),
          spriteIdx: Math.floor(random(0, this.nebulaSprites.length)),
          isAsset: false, p: random(0.92, 0.96) 
        });
      }
      
      // HD Asset Nebulae (Images) — Lejanas y fijas al universo, visibles
      // El parallax entre 0.96 y 0.99 asegura que se muevan poquísimo con respecto al fondo de pantalla
      for(let i=0; i<8; i++) {
        this.nebulae.push({
           x: random(-1000, W+1000), y: random(-1000, H+1000),
           scale: random(0.4, 0.95), // Escala suficiente para que se vean, pero no tapen todo
           angle: random(0, Math.PI*2),
           alpha: random(0.2, 0.40), 
           assetIdx: Math.floor(random(0, 2)),
           isAsset: true, p: random(0.96, 0.99) 
        });
      }
      
      // Planets (Moderate sizes and better distribution)
      for(let i=0; i<500; i++) {
        let isRing = Math.random() < 0.20;
        let colorIdx = Math.floor(random(0, pc.length));
        this.planets.push({
          x: random(-PAD, W+PAD), y: random(-PAD, H+PAD), scale: random(0.1, 0.3), 
          sprite: (colorIdx * 2) + (isRing ? 1 : 0), 
          p: random(0.88, 0.97) 
        });
      }
    },

    draw() {
      ctx.fillStyle = '#030105'; // Deeper black space
      ctx.fillRect(camera.x, camera.y, camera.width, camera.height);
      const cL = camera.x, cR = camera.x + camera.width, cT = camera.y, cB = camera.y + camera.height;

      // 0. Asset Nebulae (DEEP Space Layer)
      // Use screen to completely eliminate black background squares from JPG/PNG
      ctx.globalCompositeOperation = 'screen';
      const assetNebs = [imgNebula1, imgNebula2];
      for(let n of this.nebulae) {
         if(!n.isAsset) continue;
         let spr = assetNebs[n.assetIdx];
         if(!spr || !spr.complete || spr.naturalWidth === 0) continue;
         let base = 500;
         let w = base * n.scale, h = base * n.scale;
         let dx = n.x + camera.x * (1 - n.p); let dy = n.y + camera.y * (1 - n.p);
         if (dx > cL - w && dx < cR + w && dy > cT - h && dy < cB + h) {
            ctx.save(); ctx.globalAlpha = n.alpha; ctx.translate(dx, dy); ctx.rotate(n.angle);
            ctx.drawImage(spr, -w/2, -h/2, w, h); ctx.restore();
         }
      }

      // 1. Procedural Nebulae (Mid-Layer)
      // Screen makes gradient overlaps smooth without harsh edges
      ctx.globalCompositeOperation = 'screen';
      for(let n of this.nebulae) {
         if(n.isAsset) continue;
         let spr = this.nebulaSprites[n.spriteIdx];
         if(!spr) continue;
         let base = 600; // Match procedural canvas size
         let w = base * n.scale, h = base * n.scale;
         let dx = n.x + camera.x * (1 - n.p); let dy = n.y + camera.y * (1 - n.p);
         if (dx > cL - w && dx < cR + w && dy > cT - h && dy < cB + h) {
            ctx.save(); ctx.globalAlpha = n.alpha; ctx.translate(dx, dy); ctx.rotate(n.angle);
            ctx.drawImage(spr, -w/2, -h/2, w, h); ctx.restore();
         }
      }

      // Switch to source-over for galaxies so their custom stars and dark dust render correctly
      ctx.globalCompositeOperation = 'source-over';

      // 2. Galaxies (700px base sprites now shrunk via scale)
      for(let g of this.galaxies) {
         let spr = this.galaxySprites[g.spriteIdx];
         if(!spr) continue;
         let w = 700 * g.scale, h = 700 * g.scale;
         let dx = g.x + camera.x * (1 - g.p); let dy = g.y + camera.y * (1 - g.p);
         if (dx > cL - w && dx < cR + w && dy > cT - h && dy < cB + h) {
            ctx.save(); ctx.globalAlpha = g.alpha; ctx.translate(dx, dy); ctx.rotate(g.angle);
            ctx.drawImage(spr, -w/2, -h/2, w, h); ctx.restore();
         }
      }

      // 3. Stars L1 (Deep)
      ctx.fillStyle = '#ffffff';
      for(let s of this.starsL1) {
         let dx = s.x + camera.x * (1 - s.p); let dy = s.y + camera.y * (1 - s.p);
         if (dx > cL && dx < cR && dy > cT && dy < cB) { ctx.globalAlpha = s.a; ctx.fillRect(dx, dy, s.s, s.s); }
      }

      // 4. Planets
      for(let p of this.planets) {
         let spr = this.planetSprites[p.sprite];
         let w = spr.width * p.scale, h = spr.height * p.scale;
         let dx = p.x + camera.x * (1 - p.p); let dy = p.y + camera.y * (1 - p.p);
         if (dx > cL - w && dx < cR + w && dy > cT - h && dy < cB + h) {
             ctx.globalAlpha = 1.0; ctx.drawImage(spr, dx - w/2, dy - h/2, w, h);
         }
      }

      // 5. Stars L2 (Mid)
      for(let s of this.starsL2) {
         let dx = s.x + camera.x * (1 - s.p); let dy = s.y + camera.y * (1 - s.p);
         if (dx > cL && dx < cR && dy > cT && dy < cB) { ctx.globalAlpha = s.a; ctx.fillRect(dx, dy, s.s, s.s); }
      }

      // 6. Huge Flickering Stars (L3)
      ctx.globalCompositeOperation = 'lighter'; 
      for(let s of this.starsL3) {
         let dx = s.x + camera.x * (1 - s.p); let dy = s.y + camera.y * (1 - s.p);
         let b = s.s * 3.5; // Radio de luz disminuido enormemente para estrellas más "sólidas"
         if (dx > cL - b && dx < cR + b && dy > cT - b && dy < cB + b) {
            let flick = 0.7 + Math.sin(frame*0.06 + s.x)*0.3;
            ctx.globalAlpha = 0.6 * flick;
            let g = ctx.createRadialGradient(dx, dy, 0, dx, dy, b);
            g.addColorStop(0, `hsla(${s.hue}, 80%, 90%, 0.85)`); 
            g.addColorStop(0.3, `hsla(${s.hue}, 80%, 75%, 0.3)`);
            g.addColorStop(1, `hsla(${s.hue}, 80%, 75%, 0)`);
            ctx.fillStyle = g; ctx.fillRect(dx-b, dy-b, b*2, b*2);
            ctx.globalAlpha = 1.0; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(dx, dy, s.s*0.6, 0, Math.PI*2); ctx.fill();
         }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
    }
  };

  const animatedStars = []; // Kept for comets/shooting stars overlay

  function initBackground() {
    ParallaxSpace.init();

    // Comets overlay (moves independently of camera)
    const cometCount = isMobile ? 3 : 7;
    for(let i=0; i<cometCount; i++) {
      animatedStars.push({
        x: Math.random() * WORLD.WIDTH, 
        y: Math.random() * WORLD.HEIGHT, 
        speed: Math.random() * 4 + 3, 
        angle: Math.random() * Math.PI * 2, // ALL DIRECTIONS
        length: Math.random() * 120 + 60, 
        alpha: Math.random() * 0.6 + 0.3, 
        thickness: Math.random() * 2 + 1.5, 
        type: 'comet'
      });
    }
  }
  initBackground();

  function drawAnimatedBackground() {
    ParallaxSpace.draw();
    
    // Parallax interactive overlay (Comets)
    for (let i = 0; i < animatedStars.length; i++) {
      const s = animatedStars[i];
      if (s.type === 'comet') {
        s.x += Math.cos(s.angle) * s.speed;
        s.y += Math.sin(s.angle) * s.speed;
        // Loop anywhere
        if (s.x > WORLD.WIDTH + 300) s.x = -300;
        if (s.x < -300) s.x = WORLD.WIDTH + 300;
        if (s.y > WORLD.HEIGHT + 300) s.y = -300;
        if (s.y < -300) s.y = WORLD.HEIGHT + 300;
        const cx = s.x - camera.x * 0.3, cy = s.y - camera.y * 0.3;
        if (cx > -s.length-20 && cx < camera.width+s.length+20 && cy > -s.length-20 && cy < camera.height+s.length+20) {
          const wx = camera.x+cx, wy = camera.y+cy;
          if (isMobile) {
            ctx.globalAlpha = s.alpha * 0.7;
            ctx.strokeStyle = '#ffcc80';
            ctx.lineWidth = s.thickness;
            ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx-Math.cos(s.angle)*s.length*0.5, wy-Math.sin(s.angle)*s.length*0.5); ctx.stroke();
          } else {
            ctx.globalAlpha = s.alpha;
            ctx.strokeStyle = '#ffcc80';
            ctx.lineWidth = s.thickness;
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx-Math.cos(s.angle)*s.length, wy-Math.sin(s.angle)*s.length); ctx.stroke();
            ctx.fillStyle = '#ffeedd';
            ctx.beginPath(); ctx.arc(wx, wy, s.thickness*1.5, 0, Math.PI*2); ctx.fill();
          }
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }

  /* =========================================================
     PARTICLES
     ========================================================= */
  function createParticles(x, y, color, amount) {
    // Optimization limit particle spam
    if (isMobile) amount = Math.min(Math.floor(amount / 3), 2) || 1;
    const maxP = isMobile ? 30 : 60;
    if (particles.length > maxP) particles.length = maxP;

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

      if (p.life <= 0) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }

      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      const ps = p.size;
      ctx.fillRect(p.x - ps, p.y - ps, ps * 2, ps * 2);
    }
    ctx.restore();
  }

  /* =========================================================
     FLOATING TEXTS
     ========================================================= */
  function createFloatingText(x, y, text, color) {
    const maxFT = isMobile ? 8 : 25;
    if (floatingTexts.length >= maxFT) return;
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
      if (ft.life <= 0) {
        floatingTexts[i] = floatingTexts[floatingTexts.length - 1];
        floatingTexts.pop();
        continue; 
      }
      
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
    const dx = Math.cos(player.angle) * Math.abs(speed);
    const dy = Math.sin(player.angle) * Math.abs(speed);
    bullets.push({ x: player.x, y: player.y, dx, dy, color, source });
    // Broadcast to multiplayer allies
    if (MP.isMultiplayer) MP.sendShoot(player.x, player.y, dx, dy, color, source);
  }

  function handleShooting() {
    if (player.debuffs.disable > 0) return;

    // Manual cannon (Space OR mobile fire) - Mouse click now only rotates
    if ((keys[' '] || isFiring) && player.powers.manual > 0) {
      if (player.debuffs.powerlock <= 0) {
        player.powers.manual--;
        if (frame % 8 === 0) { shoot(16, '#e67e22', 'manual'); SFX.shootManual(); }
      }
    }
    // Auto laser
    if (player.powers.auto > 0 && player.debuffs.powerlock <= 0) {
      player.autoShootDelay++;
      if (player.autoShootDelay > 6) {
        shoot(14, '#f7ca18', 'auto'); SFX.shootAuto();
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

    // Keyboard movement with hold threshold
    const movKeys = [
      ['w','W','ArrowUp', 0, -1], ['s','S','ArrowDown', 0, 1],
      ['a','A','ArrowLeft', -1, 0], ['d','D','ArrowRight', 1, 0]
    ];
    let kbDirX = 0, kbDirY = 0;
    let movingThisFrame = false;
    for (const [k1, k2, k3, dx, dy] of movKeys) {
      if (keys[k1] || keys[k2] || keys[k3]) {
        const hk = k1;
        keyHoldTimers[hk] = (keyHoldTimers[hk] || 0) + 1;
        kbDirX += dx; kbDirY += dy;
        if (keyHoldTimers[hk] >= KEY_HOLD_THRESHOLD || moveGrace > 0 || isMobile) {
          moveX += dx * moveSpeed;
          moveY += dy * moveSpeed;
          movingThisFrame = true;
        }
      }
    }
    
    if (movingThisFrame) {
      moveGrace = 20;
    } else if (moveGrace > 0) {
      moveGrace--;
    }

    // Virtual Joystick (mobile)
    if (joystickOrigin && joystickCurrent) {
      const dx = joystickCurrent.x - joystickOrigin.x;
      const dy = joystickCurrent.y - joystickOrigin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 5) {
        const speedMul = Math.min(dist / 40, 1);
        moveX += (dx / dist) * moveSpeed * speedMul;
        moveY += (dy / dist) * moveSpeed * speedMul;
        kbDirX += dx / dist; kbDirY += dy / dist;
      }
    }

    player.x += moveX;
    player.y += moveY;

    // Rotation: mouse while held → aim at cursor; keyboard → aim at movement direction
    let targetAngle = player.angle;
    if (isMouseDown && !isMobile) {
      targetAngle = Math.atan2(mouseY - player.y, mouseX - player.x);
    } else if (Math.abs(kbDirX) > 0.01 || Math.abs(kbDirY) > 0.01) {
      targetAngle = Math.atan2(kbDirY, kbDirX);
    }

    // Smooth rotation — stable lerp toward target angle, same for PC and mobile
    let angleDiff = targetAngle - player.angle;
    angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    if (isMobile) {
      player.angle += angleDiff * 0.75;
    } else {
      const maxTurn = 0.22;
      let turn = angleDiff * 0.35;
      if (turn > maxTurn) turn = maxTurn;
      if (turn < -maxTurn) turn = -maxTurn;
      player.angle += turn;
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
    // In multiplayer mode, only the host spawns enemies. Clients receive enemies via network.
    if (MP.isMultiplayer && !MP.isHost) return;

    if (frame % Math.floor(spawnRate) !== 0) return;

    // Unlock new enemies
    if (score >= unlockedEnemies * currentUnlockInterval && unlockedEnemies < ENEMY_TYPES.length) {
      unlockedEnemies++;
      showAnnouncement('NUEVA AMENAZA: ' + ENEMY_TYPES[unlockedEnemies - 1].name.toUpperCase());
      // In MP, broadcast unlock to clients
      if (MP.isMultiplayer && MP.isHost) {
        MP.send({ type: 'enemy_unlock', unlockedEnemies, enemyName: ENEMY_TYPES[unlockedEnemies - 1].name });
      }
    }

    // PERFORMANCE: Limit total enemies on screen to prevent lag
    const maxEnemies = isMobile ? 20 : 50;
    if (enemies.length >= maxEnemies) return;

    // Weighted spawning: harder enemies are rarer but difficulty increases their frequency
    const pool = ENEMY_TYPES.slice(0, unlockedEnemies);
    const weights = pool.map((_, i) => Math.pow(spawnWeightFactor, i));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const roll = Math.random() * totalWeight;

    let selectedType = ENEMY_TYPES[0];
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (roll < cumulative) { selectedType = ENEMY_TYPES[i]; break; }
    }

    // Original speed scaling adjusted by difficulty multiplier. Ensure baseSpeed never exceeds player base speed (3.5)
    const baseSpeed = Math.min((selectedType.speed + score * 0.0001) * diffMultiplierSpeed, PLAYER_BASE_SPEED * 0.95);
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(camera.width, camera.height) * 0.7; // Spawn slightly further out to avoid popping
    // In MP mode, spawn enemies around the center of all players, not just the host
    let spawnCenterX = player.x, spawnCenterY = player.y;
    if (MP.isMultiplayer && MP.isHost) {
      let totalX = player.x, totalY = player.y, count = 1;
      for (const [, rp] of MP.remotePlayers) {
        if (rp.vida > 0) { totalX += rp.targetX; totalY += rp.targetY; count++; }
      }
      spawnCenterX = totalX / count;
      spawnCenterY = totalY / count;
    }
    const spawnX = clamp(spawnCenterX + Math.cos(angle) * dist, 100, WORLD.WIDTH - 100);
    const spawnY = clamp(spawnCenterY + Math.sin(angle) * dist, 100, WORLD.HEIGHT - 100);

    enemyIdCounter++;
    const baseEnemy = EnemyPool.get();
    baseEnemy.eid = enemyIdCounter; // Unique enemy ID for multiplayer sync
    baseEnemy.x = spawnX; baseEnemy.y = spawnY;
    baseEnemy.size = selectedType.size; baseEnemy.speed = baseSpeed;
    baseEnemy.type = selectedType.shape; baseEnemy.color = selectedType.color;
    baseEnemy.hp = selectedType.hp; baseEnemy.maxHp = selectedType.hp;
    baseEnemy.name = selectedType.name; baseEnemy.pts = selectedType.pts;
    baseEnemy.spellTimer = 0;
    baseEnemy.angle = Math.atan2(player.y - spawnY, player.x - spawnX);
    enemies.push(baseEnemy);

    // In MP, broadcast enemy spawn to all clients
    if (MP.isMultiplayer && MP.isHost) {
      MP.send({
        type: 'enemy_spawn',
        eid: baseEnemy.eid,
        x: baseEnemy.x, y: baseEnemy.y,
        speed: baseEnemy.speed,
        shape: baseEnemy.type, color: baseEnemy.color,
        hp: baseEnemy.hp, maxHp: baseEnemy.maxHp,
        name: baseEnemy.name, pts: baseEnemy.pts,
        angle: baseEnemy.angle, size: baseEnemy.size,
      });
    }
  }

  /* =========================================================
     ENEMY UPDATE & COLLISIONS
     ========================================================= */
  function updateEnemies() {
    // ── MULTIPLAYER CLIENT ───────────────────────────────────────────────────
    // Enemies are authoritative on the host; clients only do local collision
    // detection for responsive feedback, but never move or despawn enemies.
    if (MP.isMultiplayer && !MP.isHost) {
      const now = performance.now();
      // Auto-remove enemies that host stopped syncing (fixes "frozen dead enemies")
      for (let i = enemies.length - 1; i >= 0; i--) {
        if (now - (enemies[i]._lastSyncTime || now) > 1500) {
          if (typeof EnemyPool !== 'undefined') EnemyPool.release(enemies[i]);
          enemies.splice(i, 1);
        }
      }
      
      // Initialise per-player hit-cooldown (invincibility frames) to prevent
      // damage being re-applied every frame while overlapping an enemy body.
      if (player._hitCooldown === undefined) player._hitCooldown = 0;
      if (player._hitCooldown > 0) player._hitCooldown--;

      buildSpatialGrid(enemies);

      for (const e of enemies) {
        // ── Own bullets → enemy (send hit to host for authoritative damage) ──
        for (let i = bullets.length - 1; i >= 0; i--) {
          const b = bullets[i];

          if (b.source === 'manual' || b.source === 'auto') {
            if (Math.abs(b.x - e.x) < e.size && Math.abs(b.y - e.y) < e.size) {
              MP.send({ type: 'enemy_hit', eid: e.eid, hp: e.hp - 1, hx: b.x, hy: b.y });
              createParticles(b.x, b.y, '#ffffff', 4);
              SFX.hit();
              bullets.splice(i, 1);
              break;
            }
            continue; // skip shield/enemy-bullet logic for player bullets
          }

          // ── Enemy projectiles → local player ─────────────────────────────
          if (b.source && b.source.startsWith('enemy_')) {
            if (Math.hypot(player.x - b.x, player.y - b.y) < player.size) {
              bullets.splice(i, 1);
              if (player.powers.shield <= 0 && player._hitCooldown <= 0) {
                if (b.source === 'enemy_bullet') {
                  if (!isPractice) player.vida--;
                  player._hitCooldown = 90;
                  damageFlash = 0.5; shakeAmt = 15;
                  createParticles(player.x, player.y, '#ff3366', 20);
                  SFX.play(100, 20, 'sawtooth', 0.2, 0.5);
                  MP.send({ type: 'player_hit', id: MP.playerId, vida: player.vida });
                } else {
                  const debuffType = Math.random() < 0.5 ? 'slow' : 'disable';
                  player.debuffs[debuffType] = 300;
                  showAnnouncement(debuffType === 'slow' ? '⚠ NAVE LENTA' : '⚠ SISTEMAS BLOQUEADOS');
                  SFX.hit();
                }
              }
            }
          }
        }

        // ── Enemy body → local player (with invincibility frames) ─────────
        if (player._hitCooldown <= 0 && player.powers.shield <= 0) {
          const bodyDist = Math.hypot(player.x - e.x, player.y - e.y);
          if (bodyDist < (player.size + e.size) * 0.7) {
            if (!isPractice) player.vida--;
            player._hitCooldown = 90; // ~1.5 s invincibility
            damageFlash = 1.0; shakeAmt = 20;
            createParticles(player.x, player.y, '#ff3366', 30);
            SFX.play(100, 20, 'sawtooth', 0.2, 0.5);
            MP.send({ type: 'player_hit', id: MP.playerId, vida: player.vida });
          }
        }
      }
      return;
    }
    buildSpatialGrid(enemies);
    const alive = [];
    const maxDistSq = 2500 * 2500; // Cull enemies too far away to prevent ghost accumulation lag

    for (const e of enemies) {
      // In MP mode, find the nearest player (local or remote) to chase
      let targetX = player.x, targetY = player.y;
      if (MP.isMultiplayer) {
        let bestDist = (player.x - e.x) * (player.x - e.x) + (player.y - e.y) * (player.y - e.y);
        for (const [, rp] of MP.remotePlayers) {
          if (rp.vida <= 0) continue;
          const rdx = rp.targetX - e.x, rdy = rp.targetY - e.y;
          const rd = rdx * rdx + rdy * rdy;
          if (rd < bestDist) { bestDist = rd; targetX = rp.targetX; targetY = rp.targetY; }
        }
      }

      const dx = targetX - e.x;
      const dy = targetY - e.y;
      const distSq = dx * dx + dy * dy;

      // Distance culling - in MP check if far from ALL players
      if (MP.isMultiplayer) {
        let closeToAny = false;
        const localDsq = (player.x - e.x) * (player.x - e.x) + (player.y - e.y) * (player.y - e.y);
        if (localDsq < maxDistSq) closeToAny = true;
        if (!closeToAny) {
          for (const [, rp] of MP.remotePlayers) {
            if (rp.vida <= 0) continue;
            const rdx = rp.targetX - e.x, rdy = rp.targetY - e.y;
            if (rdx * rdx + rdy * rdy < maxDistSq) { closeToAny = true; break; }
          }
        }
        if (!closeToAny) {
          // In MP, broadcast enemy removal
          if (MP.isHost) MP.send({ type: 'enemy_remove', eid: e.eid });
          EnemyPool.release(e);
          continue;
        }
      } else {
        if (distSq > maxDistSq) {
          EnemyPool.release(e);
          continue;
        }
      }

      const d = Math.sqrt(distSq);
      if (d > 1) {
        e.x += (dx / d) * e.speed;
        e.y += (dy / d) * e.speed;
        // Smooth visual rotation toward target
        const targetAngle = Math.atan2(dy, dx);
        if (e.angle === undefined) e.angle = targetAngle;
        let aDiff = targetAngle - e.angle;
        aDiff = ((aDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (aDiff < -Math.PI) aDiff += Math.PI * 2;
        e.angle += aDiff * 0.12;
      }

      // Avoidance (Separation)
      const cx = (e.x / GRID_CELL) | 0;
      const cy = (e.y / GRID_CELL) | 0;
      const key = cx + ',' + cy;
      const neighbors = spatialGrid[key];
      if (neighbors) {
        for (const other of neighbors) {
          if (other === e) continue;
          const odx = e.x - other.x;
          const ody = e.y - other.y;
          const odSquare = odx * odx + ody * ody;
          const minDist = e.size + other.size;
          if (odSquare < minDist * minDist && odSquare > 0.01) {
             const dn = Math.sqrt(odSquare);
             const force = (minDist - dn) * 0.5;
             e.x += (odx / dn) * force;
             e.y += (ody / dn) * force;
          }
        }
      }

      // Enemy AI: Superpowers for Elite Enemies
      e.spellTimer++;

      // For AI targeting, use direction to nearest player
      if (e.name === 'Interceptor' && e.spellTimer > 250 && d > 1) {
        bullets.push({ 
          x: e.x, y: e.y, 
          dx: (dx/d)*2.2, dy: (dy/d)*2.2,
          color: '#ff007f', 
          source: 'enemy_bullet' 
        });
        e.spellTimer = 0;
      } else if (e.name === 'Goliath' && e.spellTimer > 360) {
        let healedAny = false;
        for (const other of enemies) {
          if (other !== e && other.hp < other.maxHp) {
            other.hp = other.maxHp;
            healedAny = true;
            createParticles(other.x, other.y, '#2ecc71', 10);
          }
        }
        if (healedAny) {
           createFloatingText(e.x, e.y, "💚 REPARACIÓN GRUPAL", "#2ecc71");
           SFX.play(400, 200, 'sine', 0.5, 0.2);
        }
        e.spellTimer = 0;
      } else if (e.name === 'Overlord' && e.spellTimer > 200 && d > 1) {
        bullets.push({ x: e.x, y: e.y, dx: -(dx/d)*3, dy: -(dy/d)*3, color: '#f1c40f', source: 'enemy_bullet' });
        e.spellTimer = 0;
      } else if (e.name === 'Pulsar' && e.spellTimer > 200 && d > 1) {
        bullets.push({ x: e.x, y: e.y, dx: -(dx/d)*4, dy: -(dy/d)*4, color: '#a349a4', source: 'enemy_spell' });
        e.spellTimer = 0;
      }

      let dead = false;

      // Bullet collision (local player's bullets + enemy bullets vs local player)
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
                // In MP, broadcast that this player took damage
                if (MP.isMultiplayer) {
                  MP.send({ type: 'player_hit', id: MP.playerId, vida: player.vida });
                }
              } else {
                const roll = Math.random();
                const type = roll < 0.5 ? 'slow' : 'disable';
                player.debuffs[type] = 300;
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
            
            // Overlord Shield Check: Invulnerable during 4s of 10s cycle
            if (e.name === 'Overlord') {
              const cycle = frame % 600;
              if (cycle < 240) {
                createParticles(b.x, b.y, '#00ffff', 5);
                bullets.splice(i, 1);
                SFX.hit();
                continue; 
              }
            }

            bullets.splice(i, 1);
            e.hp--;
            createParticles(b.x, b.y, '#ffffff', 4);

            // In MP, broadcast this hit to all players
            if (MP.isMultiplayer) {
              MP.send({ type: 'enemy_hit', eid: e.eid, hp: e.hp, hx: b.x, hy: b.y });
            }

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
              // In MP, broadcast kill to all players
              if (MP.isMultiplayer) {
                MP.send({ type: 'enemy_killed_sync', eid: e.eid, x: e.x, y: e.y, color: e.color, pts, killerName: MP.playerName || 'Piloto' });
              }
              break;
            } else {
              SFX.hit();
            }
          }
        }
      }

      // In MP mode: also check remote bullets vs enemies (cooperative damage)
      if (MP.isMultiplayer && !dead) {
        for (let i = MP.remoteBullets.length - 1; i >= 0; i--) {
          const rb = MP.remoteBullets[i];
          if (rb.source && rb.source.startsWith('enemy_')) continue; // Skip enemy bullets
          if (Math.abs(rb.x - e.x) < e.size && Math.abs(rb.y - e.y) < e.size) {
            // Overlord shield check
            if (e.name === 'Overlord' && (frame % 600) < 240) {
              createParticles(rb.x, rb.y, '#00ffff', 5);
              MP.remoteBullets.splice(i, 1);
              continue;
            }
            MP.remoteBullets.splice(i, 1);
            e.hp--;
            createParticles(rb.x, rb.y, '#ffffff', 4);
            if (e.hp <= 0) {
              dead = true;
              const pts = Math.ceil((e.pts + 5) * diffMultiplier);
              // Remote player gets the points in their client; we just show effects
              createParticles(e.x, e.y, e.color, 20);
              createFloatingText(e.x, e.y, `+${pts}`, '#2ecc71');
              SFX.kill();
              break;
            } else {
              SFX.hit();
            }
          }
        }
      }

      // Player collision directly with enemy body
      const pdx2 = player.x - e.x;
      const pdy2 = player.y - e.y;
      const distSqBody = pdx2 * pdx2 + pdy2 * pdy2;
      const collisionThreshold = (player.size + e.size) * 0.7;
      
      if (!dead && distSqBody < collisionThreshold * collisionThreshold) {
        if (player.powers.shield <= 0) {
          
          let canDamagePlayer = true;
          if (e.name === 'Overlord' && (frame % 600) < 240) {
             // Shield active, damages player but Overlord survives
          }

          if (!isPractice) player.vida--;
          damageFlash = 1.0;
          shakeAmt = 20; 
          createParticles(player.x, player.y, '#ff3366', 30);
          SFX.play(100, 20, 'sawtooth', 0.2, 0.5);
          
          if (e.name === 'Overlord' && (frame % 600) < 240) {
             dead = false;
          } else {
             dead = true;
          }

          // In MP, broadcast player hit and enemy death
          if (MP.isMultiplayer) {
            MP.send({ type: 'player_hit', id: MP.playerId, vida: player.vida });
            if (dead) MP.send({ type: 'enemy_killed_sync', eid: e.eid, x: e.x, y: e.y, color: e.color, pts: 0, killerName: MP.playerName || 'Piloto' });
          }
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
        if (MP.isMultiplayer && dead) {
          MP.send({ type: 'enemy_killed_sync', eid: e.eid, x: e.x, y: e.y, color: e.color, pts: 0, killerName: MP.playerName || 'Piloto' });
        }
      }

      if (!dead) { alive.push(e); } else { EnemyPool.release(e); }
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
    const magnetRadius = 120;
    const magnetForce = 3.0;

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
    if (killsMilestone >= killsPerLife) {
      killsMilestone -= killsPerLife;
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
      const targetDisplay = Math.floor(currentMilestoneTarget);
      if (selectedDifficulty === 'hardcore') {
        menu.querySelector('h1').innerText = '⚡ SOBRECARGA HARDCORE ⚡';
        menu.querySelector('p').innerText = `Has alcanzado los ${targetDisplay} puntos. ¡Sistemas al límite!`;
        // Replace Life button text
        const btns = menu.querySelectorAll('.power-btn');
        if (btns && btns.length > 0) {
            btns[btns.length-1].innerHTML = '<h3>⚡ CARGAR ULTRA</h3><p>Carga y dispara un Flash Nova.</p>';
            btns[btns.length-1].setAttribute('onclick', "choosePremiumPower('ultra')");
        }
      } else {
        menu.querySelector('h1').innerText = '¡PUNTUACIÓN DESTACADA!';
        menu.querySelector('p').innerText = `Has alcanzado los ${targetDisplay} puntos. Elige una mejora:`;
        const btns = menu.querySelectorAll('.power-btn');
        if (btns && btns.length > 0) {
            btns[btns.length-1].innerHTML = '<h3>❤ +1 Vida Extra</h3><p>Restaura integridad crítica.</p>';
            btns[btns.length-1].setAttribute('onclick', "choosePremiumPower('life')");
        }
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
      const trailFreq = isMobile ? 8 : 3;
      if (frame % trailFreq === 0) {
        createParticles(pObj.x - Math.cos(pObj.angle)*15, pObj.y - Math.sin(pObj.angle)*15, pColor, isMobile ? 1 : 2);
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
    
    // Debuff visual icons - Enhanced with distinct symbols and pulsing
    const debuffsActive = [];
    if (pObj.debuffs.slow > 0) debuffsActive.push({icon:'🐢', label:'LENTA', color:'#a349a4'});
    if (pObj.debuffs.disable > 0) debuffsActive.push({icon:'🚫', label:'BLOQ', color:'#ff3366'});
    if (pObj.debuffs.noscore > 0) debuffsActive.push({icon:'💀', label:'0 PTS', color:'#e74c3c'});
    if (pObj.debuffs.powerlock > 0) debuffsActive.push({icon:'🔒', label:'LOCK', color:'#9b59b6'});

    if (debuffsActive.length > 0) {
      targetCtx.save();
      targetCtx.rotate(-finalAngle);
      // Pulsing warning ring
      const pulseR = 1 + Math.sin(frame * 0.15) * 0.3;
      targetCtx.beginPath();
      targetCtx.arc(0, 0, (pObj.size + 18) * pulseR, 0, Math.PI * 2);
      targetCtx.strokeStyle = debuffsActive[0].color;
      targetCtx.lineWidth = 3;
      targetCtx.globalAlpha = 0.6 + Math.sin(frame * 0.1) * 0.3;
      targetCtx.setLineDash([8, 4]);
      targetCtx.stroke();
      targetCtx.setLineDash([]);
      targetCtx.globalAlpha = 1;
      // Large icon + label
      targetCtx.font = 'bold 20px serif';
      targetCtx.textAlign = 'center';
      const iconStr = debuffsActive.map(d => d.icon).join(' ');
      targetCtx.fillText(iconStr, 0, -pObj.size - 28);
      targetCtx.font = 'bold 10px Orbitron';
      targetCtx.fillStyle = debuffsActive[0].color;
      targetCtx.fillText(debuffsActive.map(d => d.label).join(' '), 0, -pObj.size - 14);
      targetCtx.restore();
    }

    targetCtx.restore();
  }

  /* =========================================================
     DRAWING — REALISTIC VECTOR ENEMY SHIPS
     ========================================================= */
  function drawEnemyShape(type, s, color) {
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    // Helpers
    const hull = (path, c) => {
      if (isMobile) {
        ctx.fillStyle = '#1a1a2e';
        ctx.strokeStyle = color;
        ctx.fill(path);
        ctx.stroke(path);
      } else {
        const g = ctx.createLinearGradient(0, -s, 0, s);
        g.addColorStop(0, c || color);
        g.addColorStop(0.5, '#1a1a2e');
        g.addColorStop(1, c || color);
        ctx.fillStyle = g;
        ctx.strokeStyle = color;
        ctx.fill(path);
        ctx.stroke(path);
      }
    };
    const engine = (x, y, w, h) => {
      if (isMobile) {
        ctx.fillStyle = '#4488ff';
        ctx.fillRect(x, y, w, h);
      } else {
        const eg = ctx.createLinearGradient(x, y, x, y + h);
        eg.addColorStop(0, '#4488ff');
        eg.addColorStop(0.5, '#88ccff');
        eg.addColorStop(1, 'rgba(100,180,255,0)');
        ctx.fillStyle = eg;
        ctx.fillRect(x, y, w, h);
      }
    };
    const cockpit = (x, y, r) => {
      if (isMobile) {
        ctx.fillStyle = '#224466';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      } else {
        const cg = ctx.createRadialGradient(x, y - r*0.3, 0, x, y, r);
        cg.addColorStop(0, '#aaddff');
        cg.addColorStop(1, '#224466');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      }
    };

    switch (type) {
      case 'circle': { // Morg — Scout drone
        const p = new Path2D();
        p.moveTo(0, -s*1.2);
        p.lineTo(s*0.5, -s*0.4); p.lineTo(s*1.1, 0); p.lineTo(s*0.5, s*0.6);
        p.lineTo(0, s*0.8);
        p.lineTo(-s*0.5, s*0.6); p.lineTo(-s*1.1, 0); p.lineTo(-s*0.5, -s*0.4);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.3, s*0.25);
        engine(-s*0.2, s*0.6, s*0.15, s*0.6);
        engine(s*0.05, s*0.6, s*0.15, s*0.6);
        break;
      }
      case 'triangle': { // Stinger — Fast interceptor
        const p = new Path2D();
        p.moveTo(0, -s*1.8);
        p.lineTo(s*0.4, -s*0.6); p.lineTo(s*1.3, s*0.2); p.lineTo(s*0.5, s*0.8);
        p.lineTo(0, s*0.5);
        p.lineTo(-s*0.5, s*0.8); p.lineTo(-s*1.3, s*0.2); p.lineTo(-s*0.4, -s*0.6);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.6, s*0.2);
        // Detail lines
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.2); ctx.lineTo(-s*1, s*0.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s*0.3, -s*0.2); ctx.lineTo(s*1, s*0.2); ctx.stroke();
        engine(-s*0.6, s*0.7, s*0.12, s*0.8);
        engine(-s*0.1, s*0.4, s*0.2, s*0.7);
        engine(s*0.5, s*0.7, s*0.12, s*0.8);
        break;
      }
      case 'square': { // Titan — Heavy battlecruiser
        const p = new Path2D();
        p.moveTo(0, -s*1.2);
        p.lineTo(s*0.6, -s*0.8); p.lineTo(s*1.0, -s*0.2); p.lineTo(s*1.0, s*0.6);
        p.lineTo(s*0.6, s*1.0); p.lineTo(-s*0.6, s*1.0); p.lineTo(-s*1.0, s*0.6);
        p.lineTo(-s*1.0, -s*0.2); p.lineTo(-s*0.6, -s*0.8);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.5, s*0.22);
        // Armor seams
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.moveTo(-s*0.4, -s*0.8); ctx.lineTo(-s*0.4, s*0.9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s*0.4, -s*0.8); ctx.lineTo(s*0.4, s*0.9); ctx.stroke();
        // Turrets
        ctx.fillStyle = '#888';
        ctx.fillRect(-s*0.12, -s*1.0, s*0.24, s*0.4);
        engine(-s*0.5, s*0.9, s*0.25, s*0.7);
        engine(s*0.25, s*0.9, s*0.25, s*0.7);
        break;
      }
      case 'pentagon': { // Vanguard — Escort fighter
        const p = new Path2D();
        p.moveTo(0, -s*1.5);
        p.lineTo(s*0.6, -s*0.3); p.lineTo(s*0.9, s*0.4);
        p.lineTo(s*0.3, s*0.9); p.lineTo(-s*0.3, s*0.9);
        p.lineTo(-s*0.9, s*0.4); p.lineTo(-s*0.6, -s*0.3);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.4, s*0.2);
        engine(-s*0.15, s*0.8, s*0.12, s*0.5);
        engine(s*0.05, s*0.8, s*0.12, s*0.5);
        break;
      }
      case 'hexagon': { // Wasp — Agile striker
        const p = new Path2D();
        p.moveTo(0, -s*1.6);
        p.lineTo(s*0.35, -s*0.7); p.lineTo(s*1.2, -s*0.1);
        p.lineTo(s*0.35, s*0.5); p.lineTo(0, s*0.7);
        p.lineTo(-s*0.35, s*0.5); p.lineTo(-s*1.2, -s*0.1);
        p.lineTo(-s*0.35, -s*0.7);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.5, s*0.18);
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(-s*1.2, -s*0.1); ctx.lineTo(-s*1.5, -s*0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s*1.2, -s*0.1); ctx.lineTo(s*1.5, -s*0.5); ctx.stroke();
        engine(-s*0.15, s*0.6, s*0.1, s*0.6);
        engine(s*0.05, s*0.6, s*0.1, s*0.6);
        break;
      }
      case 'star': { // Pulsar — Energy warship
        const p = new Path2D();
        p.moveTo(0, -s*1.4);
        p.lineTo(s*0.5, -s*0.5); p.lineTo(s*1.4, 0);
        p.lineTo(s*0.5, s*0.5); p.lineTo(0, s*1.0);
        p.lineTo(-s*0.5, s*0.5); p.lineTo(-s*1.4, 0);
        p.lineTo(-s*0.5, -s*0.5);
        p.closePath();
        hull(p);
        // Energy core
        const coreG = ctx.createRadialGradient(0, 0, 0, 0, 0, s*0.4);
        coreG.addColorStop(0, '#ffffff');
        coreG.addColorStop(0.5, color);
        coreG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = coreG;
        ctx.beginPath(); ctx.arc(0, 0, s*0.4, 0, Math.PI*2); ctx.fill();
        engine(-s*0.2, s*0.9, s*0.15, s*0.6);
        engine(s*0.05, s*0.9, s*0.15, s*0.6);
        break;
      }
      case 'diamond': { // Razor — Needle fighter
        const p = new Path2D();
        p.moveTo(0, -s*2.0);
        p.lineTo(s*0.35, -s*0.4); p.lineTo(s*0.6, s*0.2);
        p.lineTo(s*0.25, s*0.8); p.lineTo(0, s*0.6);
        p.lineTo(-s*0.25, s*0.8); p.lineTo(-s*0.6, s*0.2);
        p.lineTo(-s*0.35, -s*0.4);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.7, s*0.15);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.moveTo(0, -s*1.8); ctx.lineTo(0, s*0.5); ctx.stroke();
        engine(-s*0.05, s*0.7, s*0.1, s*0.8);
        break;
      }
      case 'cross': { // Interceptor — X-wing assault
        const p = new Path2D();
        p.moveTo(0, -s*1.5);
        p.lineTo(s*0.3, -s*0.5); p.lineTo(s*1.3, -s*0.4);
        p.lineTo(s*1.3, s*0.1); p.lineTo(s*0.3, s*0.3);
        p.lineTo(0, s*0.8);
        p.lineTo(-s*0.3, s*0.3); p.lineTo(-s*1.3, s*0.1);
        p.lineTo(-s*1.3, -s*0.4); p.lineTo(-s*0.3, -s*0.5);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.4, s*0.2);
        // Wing weapons
        ctx.fillStyle = '#ff4466';
        ctx.fillRect(-s*1.2, -s*0.5, s*0.08, s*0.6);
        ctx.fillRect(s*1.1, -s*0.5, s*0.08, s*0.6);
        engine(-s*0.8, s*0.05, s*0.1, s*0.5);
        engine(-s*0.1, s*0.7, s*0.08, s*0.5);
        engine(s*0.02, s*0.7, s*0.08, s*0.5);
        engine(s*0.7, s*0.05, s*0.1, s*0.5);
        break;
      }
      case 'octagon': { // Goliath — Heavy carrier
        const p = new Path2D();
        p.moveTo(-s*0.4, -s*1.3); p.lineTo(s*0.4, -s*1.3);
        p.lineTo(s*1.0, -s*0.6); p.lineTo(s*1.0, s*0.6);
        p.lineTo(s*0.4, s*1.1); p.lineTo(-s*0.4, s*1.1);
        p.lineTo(-s*1.0, s*0.6); p.lineTo(-s*1.0, -s*0.6);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.6, s*0.25);
        // Hull details
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.rect(-s*0.7, -s*0.4, s*1.4, s*0.6); ctx.stroke();
        // Antenna
        ctx.strokeStyle = '#aaa';
        ctx.beginPath(); ctx.moveTo(0, -s*1.3); ctx.lineTo(0, -s*1.7); ctx.stroke();
        engine(-s*0.5, s*1.0, s*0.2, s*0.8);
        engine(-s*0.1, s*1.0, s*0.2, s*0.7);
        engine(s*0.3, s*1.0, s*0.2, s*0.8);
        break;
      }
      case 'ufo': { // Overlord — Command mothership
        const p = new Path2D();
        p.moveTo(0, -s*1.0);
        p.lineTo(s*0.8, -s*0.6); p.lineTo(s*1.8, -s*0.1);
        p.lineTo(s*1.8, s*0.3); p.lineTo(s*0.8, s*0.7);
        p.lineTo(0, s*0.9);
        p.lineTo(-s*0.8, s*0.7); p.lineTo(-s*1.8, s*0.3);
        p.lineTo(-s*1.8, -s*0.1); p.lineTo(-s*0.8, -s*0.6);
        p.closePath();
        hull(p);
        // Command bridge
        const bg = ctx.createRadialGradient(0, -s*0.3, 0, 0, -s*0.3, s*0.4);
        bg.addColorStop(0, '#ffdd44');
        bg.addColorStop(1, '#664400');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.ellipse(0, -s*0.3, s*0.4, s*0.25, 0, 0, Math.PI*2); ctx.fill();
        // Windows
        ctx.fillStyle = '#88ccff';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.arc(i*s*0.35, -s*0.1, s*0.06, 0, Math.PI*2); ctx.fill();
        }
        // Weapon rails
        ctx.fillStyle = '#cc3333';
        ctx.fillRect(-s*1.7, -s*0.2, s*0.08, s*0.5);
        ctx.fillRect(s*1.6, -s*0.2, s*0.08, s*0.5);
        engine(-s*0.6, s*0.8, s*0.2, s*0.8);
        engine(-s*0.1, s*0.8, s*0.2, s*0.6);
        engine(s*0.4, s*0.8, s*0.2, s*0.8);
        break;
      }
      default: {
        const p = new Path2D();
        p.moveTo(0, -s*1.3); p.lineTo(s*0.7, 0); p.lineTo(0, s*1.0); p.lineTo(-s*0.7, 0);
        p.closePath();
        hull(p);
        cockpit(0, -s*0.3, s*0.2);
        engine(-s*0.05, s*0.9, s*0.1, s*0.5);
        break;
      }
    }
  }

  /* =========================================================
     DRAWING — ENTITIES
     ========================================================= */
  function drawEntities() {
    // Bullets — no shadowBlur for performance
    ctx.shadowBlur = 0;
    for (const b of bullets) {
      if (b.x < camera.x - 20 || b.x > camera.x + camera.width + 20 || b.y < camera.y - 20 || b.y > camera.y + camera.height + 20) continue;
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

      // Smooth directional rotation — nose faces movement direction
      const faceAngle = (e.angle || 0) + Math.PI / 2;
      ctx.rotate(faceAngle);

      ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
      ctx.lineWidth = 1.5;

      drawEnemyShape(e.type, e.size, e.color);

      // Name label (skip on mobile for performance — text render is expensive)
      if (!isMobile) {
        ctx.rotate(-faceAngle); // counter-rotate so text stays horizontal
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 0.5;
        ctx.font = '8px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText(e.name, 0, -e.size - 8);
      }
      // Overlord Shield Visual
      if (e.name === 'Overlord') {
        const cycle = frame % 600;
        if (cycle < 240) {
          ctx.beginPath();
          ctx.arc(0, 0, e.size + 15, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
          ctx.lineWidth = 4;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
          // Pulsing glow
          ctx.globalAlpha = 0.3 + Math.sin(frame * 0.2) * 0.2;
          ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
          ctx.fill();
          ctx.globalAlpha = 1;
        }
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
  const cachedUI = { vida: -1, kills: -1, score: -1, time: -1, power: '', ultra: -1, coords: '' };
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

    // Coordinates display — only visible while PLAYING (hidden on pause/menu)
    const coordEl = $('player-coords');
    if (coordEl) {
      if (gameState === 'PLAYING') {
        const cx = Math.round(player.x);
        const cy = Math.round(player.y);
        const coordStr = `X:${cx}  Y:${cy}`;
        if (cachedUI.coords !== coordStr) {
          coordEl.innerText = coordStr;
          cachedUI.coords = coordStr;
        }
        coordEl.style.display = 'block';
      } else {
        coordEl.style.display = 'none';
      }
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

    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (isMobile) ctx.shadowBlur = 0;
    
    ctx.save();

    // Apply Shake
    if (shakeAmt > 0) {
      ctx.translate((Math.random()-0.5)*shakeAmt, (Math.random()-0.5)*shakeAmt);
      shakeAmt *= 0.9;
    }

    ctx.translate(-camera.x, -camera.y);

    drawAnimatedBackground();

    // World border
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);

    // Update
    movePlayer();
    handleShooting();

    // Bullets: update & in-place cull (no array allocation)
    let bLen = bullets.length;
    for (let bi = bLen - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      b.x += b.dx; b.y += b.dy;
      if (b.x < 0 || b.x > WORLD.WIDTH || b.y < 0 || b.y > WORLD.HEIGHT) {
        bullets[bi] = bullets[--bLen];
      }
    }
    bullets.length = bLen;

    spawnEnemies();
    updateEnemies();
    spawnCollectibles();
    updateCollectibles();
    checkMilestones();

    // FIX: Interpolate enemy positions BEFORE drawing (clients see smooth positions)
    if (MP.isMultiplayer && !MP.isHost) {
      for (const e of enemies) {
        if (e._targetX !== undefined) {
          const dx = e._targetX - e.x, dy = e._targetY - e.y;
          const dSq = dx * dx + dy * dy;
          if (dSq > 160000) {
            e.x = e._targetX; e.y = e._targetY;
          } else if (dSq > 0.25) {
            const d = Math.sqrt(dSq);
            const step = Math.min(e.speed * 1.5, d);
            e.x += (dx / d) * step;
            e.y += (dy / d) * step;
          }
        }
        if (e._targetAngle !== undefined) {
          let aDiff = e._targetAngle - (e.angle || 0);
          aDiff = ((aDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
          if (aDiff < -Math.PI) aDiff += Math.PI * 2;
          e.angle = (e.angle || 0) + aDiff * 0.25;
        }
      }
    }

    // Draw
    drawEntities();
    drawCollectibles();
    drawPlayer();
    // Multiplayer: draw allies and their bullets (world-space)
    MP.updateAndDrawRemote();
    updateAndDrawParticles();
    updateAndDrawFloatingTexts();

    ctx.restore();

    // Draw off-screen ally arrows in screen-space (after world ctx.restore)
    MP.drawOffScreenArrows();

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

    // Multiplayer: send local state to server
    if (MP.isMultiplayer) {
      MP.sendState();
      // Host broadcasts enemy positions every 2 frames (~33ms) for smoother interp
      if (MP.isHost && frame % 2 === 0) {
        MP.sendEnemySync();
      }
    }

    for (const d in player.debuffs) if (player.debuffs[d] > 0) player.debuffs[d]--;

    if (player.vida <= 0) {
      if (MP.isMultiplayer) { MP.sendDeath(); MP.sendGameOver(); }
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
    diffMultiplierSpeed = 1.0;
    killsPerLife = 70; // Reset default

    switch(diff) {
      case 'practica': 
        diffMultiplier = 0.2; diffMultiplierSpeed = 1.0; spawnWeightFactor = 0.4; 
        spawnRate = 180; player.vida = 999; killsPerLife = 70; break;
      case 'facil': 
        diffMultiplier = 0.5; diffMultiplierSpeed = 0.8; spawnWeightFactor = 0.55; 
        spawnRate = 150; player.vida = 5; killsPerLife = 70; break;
      case 'medio': 
        diffMultiplier = 1.0; diffMultiplierSpeed = 1.2; spawnWeightFactor = 0.7; 
        spawnRate = 100; player.vida = 5; killsPerLife = 90; break;
      case 'dificil': 
        diffMultiplier = 1.5; diffMultiplierSpeed = 1.4; spawnWeightFactor = 0.85; 
        spawnRate = 70; player.vida = 4; killsPerLife = 110; break;
      case 'hardcore': 
        diffMultiplier = 2.5; 
        diffMultiplierSpeed = 1.8;
        spawnWeightFactor = 0.95;
        spawnRate = 45; 
        player.vida = 1; 
        currentMilestoneTarget = 4200; 
        currentUnlockInterval = 1200; 
        unlockedEnemies = 3; 
        killsPerLife = 120;
        break;
      case 'progresivo': 
        diffMultiplier = 1.0; diffMultiplierSpeed = 1.1; spawnWeightFactor = 0.72; 
        spawnRate = 120; player.vida = 5; killsPerLife = 90; break;
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
      
      // Update Pause Stats
      if ($('pause-score')) $('pause-score').innerText = score;
      if ($('pause-kills')) $('pause-kills').innerText = kills;
      if ($('pause-time')) $('pause-time').innerText = time;
      if ($('pause-vida')) $('pause-vida').innerText = isPractice ? '∞' : player.vida;
      
      // Sync Volume UI
      const vSlider = $('pause-volume-slider');
      const vLabel = $('pause-vol-label');
      if (vSlider) vSlider.value = masterVolume;
      if (vLabel) vLabel.innerText = Math.round(masterVolume * 100) + '%';
      
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

  function openSettings() {
    document.querySelectorAll('.overlay').forEach(m => m.classList.remove('active'));
    $('settings-menu').classList.add('active');
  }

  function closeSettings() {
    $('settings-menu').classList.remove('active');
    $('start-menu').classList.add('active');
  }
  
  function openMultiplayer() {
    $('start-menu').classList.remove('active');
    $('multiplayer-menu').classList.add('active');
  }
  
  function closeMultiplayer() {
    $('multiplayer-menu').classList.remove('active');
    $('start-menu').classList.add('active');
  }

  window.openSettings = openSettings;
  window.closeSettings = closeSettings;
  window.openMultiplayer = openMultiplayer;
  window.closeMultiplayer = closeMultiplayer;

  let countdownRAF = null;
  let countdownInterval = null; // kept for cancel compatibility
  function startCountdown(seconds = 3) {
    if (animationId) cancelAnimationFrame(animationId);
    if (countdownRAF) cancelAnimationFrame(countdownRAF);
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    animationId = null;

    // Reset Difficulty params (Important for Retry)
    setupDifficulty(selectedDifficulty);
    score = 0; scoreMilestone = 0;
    kills = 0; killsMilestone = 0;
    time = 0; frame = 0;
    ultraEnergy = 0;
    // Release pooled enemies
    for (let i = 0; i < enemies.length; i++) EnemyPool.release(enemies[i]);
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
    $('multiplayer-menu').classList.remove('active');
    
    $('pause-btn').style.display = 'block';
    $('end-practice-btn').style.display = isPractice ? 'block' : 'none';
    if ($('mp-end-game-btn')) $('mp-end-game-btn').style.display = MP.isMultiplayer ? 'block' : 'none';

    const countEl = $('countdown');
    countEl.style.display = 'block';
    let count = seconds;
    countEl.innerText = count;
    countEl.classList.remove('countdown-anim');
    void countEl.offsetWidth; // Reflow
    countEl.classList.add('countdown-anim');
    let lastTick = performance.now();

    function countdownStep(now) {
      if (now - lastTick >= 1000) {
        lastTick = now;
        count--;
        if (count <= 0) {
          countdownRAF = null;
          countEl.style.display = 'none';
          gameState = 'PLAYING';
          if (!animationId) animationId = requestAnimationFrame(gameLoop);
          return;
        }
        countEl.innerText = count;
        countEl.classList.remove('countdown-anim');
        void countEl.offsetWidth; // Reflow
        countEl.classList.add('countdown-anim');
      }
      countdownRAF = requestAnimationFrame(countdownStep);
    }
    countdownRAF = requestAnimationFrame(countdownStep);
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
    if (gameState !== 'CHOOSING') return; // CRITICAL BUG FIX: prevent multiple clicks
    
    // Resume IMMEDIATELY to block further inputs
    gameState = 'PLAYING';
    $('levelup-menu').classList.remove('active');

    if (type === 'life') {
      player.vida++;
    } else if (type === 'ultra') {
      ultraEnergy = ULTRA_MAX;
      triggerUltra();
    } else {
      player.powers[type] += PREMIUM_DURATION;
    }
    
    createParticles(player.x, player.y, '#ffffff', 50);
    SFX.powerup();
    
    if (!animationId) animationId = requestAnimationFrame(gameLoop);
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
    
    if (countdownRAF) {
      // CANCEL LOGIC
      cancelAnimationFrame(countdownRAF);
      countdownRAF = null;
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
    
    // Show banner immediately, no timeouts
    const banner = $('install-banner');
    if (banner) banner.classList.add('visible');

    // Inject manual button in Pause Menu just in case banner is dismissed
    const pm = document.querySelector('#pause-menu div');
    if (pm && !$('pause-install-btn')) {
      const pb = document.createElement('button');
      pb.id = 'pause-install-btn';
      pb.className = 'btn';
      pb.style.background = '#2ecc71';
      pb.style.color = '#fff';
      pb.style.marginBottom = '10px';
      pb.innerHTML = '📲 Instalar Juego Offline';
      pb.onclick = installApp;
      // Insert after the first button "Reanudar"
      if (pm.children[1]) {
        pm.insertBefore(pb, pm.children[1]);
      } else {
        pm.appendChild(pb);
      }
    }
  });

  function installApp() {
    if (!deferredPrompt) {
      alert("El juego ya está instalado o tu navegador no es compatible.");
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((result) => {
      if (result.outcome === 'accepted') {
        console.log('[PWA] App installed');
        const pb = $('pause-install-btn');
        if (pb) pb.style.display = 'none';
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
     MULTIPLAYER MODULE
     ========================================================= */
  const MP = {
    peer: null,
    clientMQTT: null,
    activeProtocol: null, // 'mqtt' | 'peerjs'
    clientConns: new Map(), // For Host: id -> conn (PeerJS) or 'mqtt'
    isHost: false,
    connected: false,
    roomId: null,
    playerId: null,
    hostId: null,
    roomPlatform: null,
    players: new Map(),
    isMultiplayer: false,
    playerName: 'Piloto',
    remotePlayers: new Map(), 
    remoteBullets: [],        
    lastStateSend: 0,
    lastEnemySync: 0,
    STATE_INTERVAL: 33,           // ~30 position updates/sec
    ENEMY_SYNC_INTERVAL: 50,      // ms between host enemy syncs

    generateId() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let id = '';
      for(let i=0; i<6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
      return id;
    },

    disconnect() {
      if (this.peer) { this.peer.destroy(); this.peer = null; }
      if (this.clientMQTT) { this.clientMQTT.end(); this.clientMQTT = null; }
      this.activeProtocol = null;
      this.isHost = false;
      this.hostConn = null;
      this.clientConns.clear();
      this.connected = false;
      this.isMultiplayer = false;
      this.roomId = null;
      this.playerId = null;
      this.hostId = null;
      this.players.clear();
      this.remotePlayers.clear();
      this.remoteBullets = [];
    },

    send(msg) {
      if (!this.connected) return;
      msg._sender = this.playerId; 
      
      if (this.isHost) {
        let sendMQTT = false;
        for (const conn of this.clientConns.values()) {
          if (conn === 'mqtt') sendMQTT = true;
          else if (conn && conn.open) conn.send(msg); // PeerJS
        }
        if (sendMQTT && this.clientMQTT) {
           this.clientMQTT.publish(`sdpro/${this.roomId}/clients`, JSON.stringify(msg));
        }
      } else {
        if (this.activeProtocol === 'mqtt' && this.clientMQTT) {
           this.clientMQTT.publish(`sdpro/${this.roomId}/host`, JSON.stringify(msg));
        } else if (this.activeProtocol === 'peerjs' && this.hostConn && this.hostConn.open) {
           this.hostConn.send(msg);
        }
      }
    },

    relay(msg, excludeId) {
      if (!this.isHost || !this.connected) return;
      let sendMQTT = false;
      for (const [id, conn] of this.clientConns.entries()) {
        if (id !== excludeId) {
          if (conn === 'mqtt') sendMQTT = true;
          else if (conn && conn.open) conn.send(msg);
        }
      }
      if (sendMQTT && this.clientMQTT) {
         msg._exclude = excludeId; 
         this.clientMQTT.publish(`sdpro/${this.roomId}/clients`, JSON.stringify(msg));
      }
    },

    getPlayerList() {
      return Array.from(this.players.values());
    },

    createRoom() {
      const nameEl = document.getElementById('mp-player-name');
      const name = (nameEl ? nameEl.value.trim() : '') || 'Piloto';
      
      this.disconnect();
      this.playerName = name;
      this.roomId = this.generateId();
      this.isHost = true;
      this.playerId = 'host-' + this.roomId;
      this.hostId = this.playerId;
      this.roomPlatform = isMobile ? 'mobile' : 'pc';
      
      this.players.set(this.playerId, { id: this.playerId, name: name, isHost: true });
      this._roomReadyFired = false;     // FIX: prevent duplicate room_created
      this._peerIdToGameId = new Map(); // FIX: PeerJS ID -> game playerId

      const fireRoomCreated = () => {
        if (this._roomReadyFired) return;
        this._roomReadyFired = true;
        this.connected = true;
        this.onMessage({ type: 'room_created', roomId: this.roomId, roomPlatform: this.roomPlatform, playerId: this.playerId, players: this.getPlayerList() });
      };

      if (typeof mqtt !== 'undefined') {
        try {
          this.clientMQTT = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
          this.clientMQTT.on('connect', () => {
            this.clientMQTT.subscribe(`sdpro/${this.roomId}/host`);
            fireRoomCreated();
          });
          this.clientMQTT.on('message', (topic, payload) => this.handleIncomingMessage(payload.toString(), 'mqtt'));
          this.clientMQTT.on('error', () => {});
        } catch(e) {}
      }

      if (typeof Peer !== 'undefined') {
        try {
          this.peer = new Peer('sdpro-' + this.roomId, {
            host: '0.peerjs.com', port: 443, secure: true, debug: 0,
            config: { iceServers: [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},{urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}] }
          });
          this.peer.on('open', () => { fireRoomCreated(); });
          this.peer.on('error', () => {});
          this.peer.on('connection', (conn) => {
            conn.on('open', () => {});
            conn.on('data', (msg) => this.handleIncomingMessage(msg, conn));
            // FIX: use _peerIdToGameId to resolve game playerId on disconnect
            conn.on('close', () => {
              const gid = this._peerIdToGameId ? this._peerIdToGameId.get(conn.peer) : null;
              if (gid) this.handleClientDisconnect(gid);
            });
          });
        } catch(e) {}
      }
      
      setTimeout(() => {
         if (!this.connected) { this.showError('No se pudo conectar a los servidores.'); this.disconnect(); }
      }, 5000);
    },

    joinRoom() {
      const nameEl = document.getElementById('mp-player-name');
      const codeEl = document.getElementById('mp-room-code-input');
      const name = (nameEl ? nameEl.value.trim() : '') || 'Piloto';
      const code = (codeEl ? codeEl.value.trim().toUpperCase() : '');
      
      if (!code || code.length < 4) { this.showError('Código inválido.'); return; }
      
      this.disconnect();
      this.playerName = name;
      this.roomId = code;
      this.isHost = false;
      this.playerId = 'client-' + this.generateId();

      if (typeof mqtt !== 'undefined') {
        try {
          this.clientMQTT = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
             will: { topic: `sdpro/${this.roomId}/host`, payload: JSON.stringify({type:'player_left_abrupt',_sender:this.playerId}), qos:0, retain:false }
          });
          this.clientMQTT.on('connect', () => {
            this.clientMQTT.subscribe(`sdpro/${this.roomId}/clients`);
            this.clientMQTT.publish(`sdpro/${this.roomId}/host`, JSON.stringify({ type: 'join', name: name, platform: isMobile ? 'mobile' : 'pc', _sender: this.playerId }));
          });
          this.clientMQTT.on('message', (t, p) => this.handleIncomingMessage(p.toString(), 'mqtt'));
        } catch(e) {}
      }

      if (typeof Peer !== 'undefined') {
        try {
          this.peer = new Peer({
            host: '0.peerjs.com', port: 443, secure: true, debug: 1,
            config: { iceServers: [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:"turn:openrelay.metered.ca:80",username:"openrelayproject",credential:"openrelayproject"},{urls:"turn:openrelay.metered.ca:443?transport=tcp",username:"openrelayproject",credential:"openrelayproject"}] }
          });
          this.peer.on('open', () => {
            this.hostConn = this.peer.connect('sdpro-' + code);
            this.hostConn.on('open', () => {
               this.hostConn.send({ type: 'join', name: name, platform: isMobile ? 'mobile' : 'pc', _sender: this.playerId });
            });
            this.hostConn.on('data', (msg) => this.handleIncomingMessage(msg, 'peerjs'));
            this.hostConn.on('close', () => {
               if (this.activeProtocol === 'peerjs') {
                  this.onMessage({ type: 'error', message: 'El anfitrión ha cerrado la sala.' });
                  this.disconnect();
               }
            });
          });
        } catch(e) {}
      }

      setTimeout(() => {
        if (!this.activeProtocol) {
          this.showError('Sala no encontrada o anfitrión desconectado.');
          this.disconnect();
        }
      }, 7000);
    },

    handleIncomingMessage(rawMsg, source) {
      let msg = rawMsg;
      if (typeof rawMsg === 'string') {
        try { msg = JSON.parse(rawMsg); } catch(e) { return; }
      }

      if (this.isHost) {
        const sender = msg._sender || msg.id;
        if (msg.type === 'join') {
           // Verifica si hay diferencia de plataformas (PC vs Móvil) y si el cliente no ha forzado la entrada.
           if (msg.platform && msg.platform !== this.roomPlatform && !msg.force) {
               const warningMsg = { type: 'platform_warning', roomPlatform: this.roomPlatform, targetId: sender, protocol: source === 'mqtt' ? 'mqtt' : 'peerjs' };
               if (source === 'mqtt' && this.clientMQTT) {
                 this.clientMQTT.publish(`sdpro/${this.roomId}/clients`, JSON.stringify(warningMsg));
               } else if (source && source.open) {
                 source.send(warningMsg);
               }
               return; // Detiene el proceso de unión hasta que el cliente confirme.
           }
           if (!this.players.has(sender)) {
             this.clientConns.set(sender, source); // source is 'mqtt' or conn object
             this.players.set(sender, { id: sender, name: msg.name, isHost: false });
             // FIX: store PeerJS peer ID -> game playerId for disconnect cleanup
             if (source !== 'mqtt' && source && source.peer && this._peerIdToGameId) {
               this._peerIdToGameId.set(source.peer, sender);
             }
             
             const diffEl = document.getElementById('mp-difficulty');
             const joinedConfirm = {
               type: 'room_joined', roomId: this.roomId, hostId: this.hostId,
               players: this.getPlayerList(), difficulty: diffEl ? diffEl.value : 'medio',
               targetId: sender, protocol: source === 'mqtt' ? 'mqtt' : 'peerjs'
             };
             
             if (source === 'mqtt' && this.clientMQTT) {
               this.clientMQTT.publish(`sdpro/${this.roomId}/clients`, JSON.stringify(joinedConfirm));
             } else if (source && source.open) {
               source.send(joinedConfirm);
             }

             const notifyMsg = { type: 'player_joined', newPlayer: { id: sender, name: msg.name }, players: this.getPlayerList() };
             this.relay(notifyMsg, sender);
             this.onMessage(notifyMsg);
           }
        } else if (msg.type === 'player_left_abrupt') {
           this.handleClientDisconnect(sender);
        } else {
           if (msg.type === 'player_quit_game') {
              if (this.remotePlayers.has(sender)) this.remotePlayers.get(sender).vida = 0;
           } else {
              this.relay(msg, sender);
              this.onMessage(msg);
           }
        }
      } else {
        if (msg._exclude === this.playerId) return; 

        if (msg.type === 'platform_warning' && msg.targetId === this.playerId) {
            const wRoom = document.getElementById('warning-room-platform');
            const wMy = document.getElementById('warning-my-platform');
            const wMenu = document.getElementById('platform-warning-menu');
            if (wRoom) wRoom.innerText = msg.roomPlatform === 'pc' ? 'PC' : 'Móvil';
            if (wMy) wMy.innerText = isMobile ? 'Móvil' : 'PC';
            if (wMenu) wMenu.classList.add('active');
            this.activeProtocol = msg.protocol;
            return;
        }

        if (msg.type === 'room_joined' && msg.targetId === this.playerId) {
           if (!this.activeProtocol) {
              this.activeProtocol = msg.protocol;
              this.connected = true;
              msg.playerId = this.playerId; 
              this.onMessage(msg);
              
              if (this.activeProtocol === 'mqtt' && this.peer) { this.peer.destroy(); this.peer = null; }
              if (this.activeProtocol === 'peerjs' && this.clientMQTT) { this.clientMQTT.end(); this.clientMQTT = null; }
           }
        } else if (this.activeProtocol) {
           this.onMessage(msg);
        }
      }
    },

    handleClientDisconnect(id) {
       if (this.players.has(id)) {
         const p = this.players.get(id);
         this.players.delete(id);
         this.clientConns.delete(id);
         const leftMsg = { type: 'player_left', id: id, name: p.name, players: this.getPlayerList() };
         this.relay(leftMsg, id);
         this.onMessage(leftMsg);
       }
    },

    setDifficulty(diff) {
      if (!this.isHost) return;
      const msg = { type: 'difficulty_changed', difficulty: diff };
      this.send(msg);
    },

    requestStartGame() {
      if (!this.isHost) return;
      const diffEl = document.getElementById('mp-difficulty');
      const msg = {
        type: 'game_start',
        difficulty: diffEl ? diffEl.value : 'medio',
        players: this.getPlayerList()
      };
      this.send(msg);
      this.onMessage(msg); // host processes its own start
    },

    copyRoomId() {
      if (!this.roomId) return;
      navigator.clipboard.writeText(this.roomId).then(() => {
        const el = document.getElementById('mp-waiting-msg');
        if (el) {
          const old = el.innerText;
          el.innerText = '¡Código copiado al portapapeles!';
          setTimeout(() => el.innerText = old, 3000);
        }
      }).catch(() => {
        alert("Código de sala: " + this.roomId);
      });
    },

    sendState() {
      const now = performance.now();
      if (now - this.lastStateSend < this.STATE_INTERVAL) return;
      this.lastStateSend = now;
      this.send({
        type: 'player_state',
        id: this.playerId,
        x: player.x, y: player.y,
        angle: player.angle,
        skin: player.skin.type,
        powers: {
          auto: player.powers.auto > 0 ? 1 : 0,
          manual: player.powers.manual > 0 ? 1 : 0,
        },
        shield: player.powers.shield > 0 ? 1 : 0,
        vida: typeof isPractice !== 'undefined' && isPractice ? 99 : player.vida,
      });
    },

    sendShoot(bx, by, bdx, bdy, color, source) {
      this.send({ type: 'player_shoot', id: this.playerId, x: bx, y: by, dx: bdx, dy: bdy, color, source });
    },

    // Host-only: broadcast compact enemy positions for sync
    sendEnemySync() {
      if (!this.isHost || !this.isMultiplayer) return;
      const now = performance.now();
      if (now - this.lastEnemySync < this.ENEMY_SYNC_INTERVAL) return;
      this.lastEnemySync = now;
      // Send in batches of 15 to avoid oversized messages
      const batchSize = 15;
      for (let start = 0; start < enemies.length; start += batchSize) {
        const batch = [];
        const end = Math.min(start + batchSize, enemies.length);
        for (let i = start; i < end; i++) {
          const e = enemies[i];
          batch.push({
            eid: e.eid, x: Math.round(e.x), y: Math.round(e.y),
            hp: e.hp, angle: +(e.angle || 0).toFixed(2),
            type: e.type, color: e.color, size: e.size, speed: e.speed, maxHp: e.maxHp
          });
        }
        if (batch.length > 0) {
          this.send({ type: 'enemy_sync', batch });
        }
      }
    },

    sendDeath() {
      const nameEl = document.getElementById('mp-player-name');
      this.send({ type: 'player_died', id: this.playerId, name: nameEl ? nameEl.value.trim() : 'Piloto' });
    },

    sendGameOver() {
      this.send({ type: 'game_over', score: typeof score !== 'undefined' ? score : 0, kills: typeof kills !== 'undefined' ? kills : 0, time: typeof time !== 'undefined' ? time : 0 });
    },

    showError(msg) {
      const el = document.getElementById('mp-error');
      if (el) { el.innerText = msg; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
    },

    updateAndDrawRemote() {
      if (!this.isMultiplayer) return;

      // ── Remote players (world-space) ─────────────────────────────────────
      for (const [id, rp] of this.remotePlayers.entries()) {
        if (rp.vida <= 0) continue;

        // Smoother interpolation for jittery mobile connections (0.15 vs 0.35)
        rp.x += (rp.targetX - rp.x) * 0.15;
        rp.y += (rp.targetY - rp.y) * 0.15;
        rp.angle += (rp.targetAngle - rp.angle) * 0.15;

        // Only render when visible on screen
        const onScreen = (
          rp.x >= camera.x - 60 && rp.x <= camera.x + camera.width + 60 &&
          rp.y >= camera.y - 60 && rp.y <= camera.y + camera.height + 60
        );
        if (!onScreen) continue;

        // ── Draw ally ship using their actual selected skin ────────────────
        const skinImg = SKINS[rp.skin];
        const hasImg = skinImg && (skinImg instanceof HTMLImageElement || skinImg instanceof HTMLCanvasElement) && skinImg.width > 0;

        ctx.save();
        ctx.translate(rp.x, rp.y);

        if (hasImg) {
          // Match drawPlayer() angle convention: classic faces right, others face up
          const finalAngle = rp.skin === 'classic'
            ? rp.angle
            : rp.angle + Math.PI / 2;
          ctx.rotate(finalAngle);
          const s = 24 * 2.2;
          ctx.drawImage(skinImg, -s / 2, -s / 2, s, s);
        } else {
          // Vector fallback — friendly-coloured arrow
          ctx.rotate(rp.angle + Math.PI / 2);
          const sz = 24;
          ctx.beginPath();
          ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.8, sz); ctx.lineTo(0, sz - 6); ctx.lineTo(-sz * 0.8, sz);
          ctx.closePath();
          ctx.fillStyle = '#101015';
          ctx.strokeStyle = '#00ffcc';
          ctx.lineWidth = 2.5;
          if (!isMobile) { ctx.shadowBlur = 12; ctx.shadowColor = '#00ffcc'; }
          ctx.fill(); ctx.stroke();
          if (!isMobile) ctx.shadowBlur = 0;
        }
        ctx.restore();

        // Shield ring
        if (rp.shield) {
          ctx.save(); ctx.translate(rp.x, rp.y);
          ctx.beginPath(); ctx.arc(0, 0, 39, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(52,152,219,0.8)'; ctx.lineWidth = 3; ctx.stroke();
          ctx.restore();
        }

        // Name label
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 11px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(rp.name, rp.x, rp.y - 38);

        // HP bar (use actual vida range 0-5 if transmitted properly, fallback 0-100)
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(rp.x - 20, rp.y - 32, 40, 4);
        ctx.fillStyle = '#00ff88';
        ctx.fillRect(rp.x - 20, rp.y - 32, 40 * Math.max(0, Math.min(1, rp.vida / 5)), 4);
      }

      // ── Remote player bullets ─────────────────────────────────────────────
      for (let i = this.remoteBullets.length - 1; i >= 0; i--) {
        const b = this.remoteBullets[i];
        b.x += b.dx; b.y += b.dy; b.life += 1;

        // Skip off-screen bullets
        if (b.x < camera.x - 20 || b.x > camera.x + camera.width + 20 ||
            b.y < camera.y - 20 || b.y > camera.y + camera.height + 20) {
          if (b.life > 60) this.remoteBullets.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.dy, b.dx));
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(-6, -4, 12, 8);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-4, -2, 8, 4);
        ctx.restore();

        if (b.life > 100) this.remoteBullets.splice(i, 1);
      }
    },

    // Called AFTER ctx.restore() (screen-space) to draw edge arrows for off-screen allies
    drawOffScreenArrows() {
      if (!this.isMultiplayer) return;
      const MARGIN = 40; // distance from screen edge
      const ARROW_SIZE = 14;

      for (const [id, rp] of this.remotePlayers.entries()) {
        if (rp.vida <= 0) continue;

        // Check if off-screen
        const onScreen = (
          rp.x >= camera.x - 50 && rp.x <= camera.x + camera.width + 50 &&
          rp.y >= camera.y - 50 && rp.y <= camera.y + camera.height + 50
        );
        if (onScreen) continue;

        // Angle from screen center toward ally
        const screenCX = camera.width / 2;
        const screenCY = camera.height / 2;
        // Convert ally world pos to screen pos
        const sx = rp.x - camera.x;
        const sy = rp.y - camera.y;
        const angle = Math.atan2(sy - screenCY, sx - screenCX);

        // Clamp arrow position to screen edge
        const halfW = camera.width / 2 - MARGIN;
        const halfH = camera.height / 2 - MARGIN;
        const tanA = Math.tan(angle);
        let ax, ay;
        if (Math.abs(Math.cos(angle)) * halfH > Math.abs(Math.sin(angle)) * halfW) {
          // Hits left/right edge
          ax = Math.sign(Math.cos(angle)) * halfW;
          ay = ax * tanA;
        } else {
          // Hits top/bottom edge
          ay = Math.sign(Math.sin(angle)) * halfH;
          ax = ay / tanA;
        }
        ax += screenCX; ay += screenCY;

        // Draw arrow
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(ARROW_SIZE, 0);
        ctx.lineTo(-ARROW_SIZE * 0.6, -ARROW_SIZE * 0.6);
        ctx.lineTo(-ARROW_SIZE * 0.3, 0);
        ctx.lineTo(-ARROW_SIZE * 0.6, ARROW_SIZE * 0.6);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,255,200,0.85)';
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 1.5;
        if (!isMobile) { ctx.shadowBlur = 10; ctx.shadowColor = '#00ffcc'; }
        ctx.fill(); ctx.stroke();
        if (!isMobile) ctx.shadowBlur = 0;

        // Name label near arrow
        ctx.rotate(-angle);
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'center';
        ctx.fillText(rp.name, 0, -ARROW_SIZE - 4);
        ctx.restore();
      }
    },

    updateLobbyUI(players, isHostView) {
      const pList = document.getElementById('mp-player-list');
      if (!pList) return;
      pList.innerHTML = '';
      players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'mp-player-item';
        div.innerText = (p.isHost ? '👑 ' : '🚀 ') + p.name;
        if (p.id === this.playerId) div.innerText += ' (Tú)';
        pList.appendChild(div);
      });
      const stBtn = document.getElementById('mp-start-btn');
      const diffSel = document.getElementById('mp-diff-select');
      if (stBtn) stBtn.style.display = isHostView ? 'inline-block' : 'none';
      if (diffSel) diffSel.style.display = isHostView ? 'block' : 'none';
    },

    onMessage(msg) {
      switch(msg.type) {
        case 'room_created':
          this.roomId = msg.roomId;
          this.playerId = msg.playerId;
          this.hostId = msg.playerId;
          this.updateLobbyUI(msg.players, true);
          if (document.getElementById('mp-create-join')) document.getElementById('mp-create-join').style.display = 'none';
          if (document.getElementById('mp-lobby')) document.getElementById('mp-lobby').style.display = 'flex';
          if (document.getElementById('mp-room-id-display')) document.getElementById('mp-room-id-display').innerText = msg.roomId;
          if (document.getElementById('mp-start-btn')) document.getElementById('mp-start-btn').style.display = 'inline-block';
          if (document.getElementById('mp-diff-select')) document.getElementById('mp-diff-select').style.display = 'block';
          break;

        case 'room_joined':
          this.roomId = msg.roomId;
          this.playerId = msg.playerId;
          this.hostId = msg.hostId;
          this.updateLobbyUI(msg.players, msg.playerId === msg.hostId);
          if (document.getElementById('mp-create-join')) document.getElementById('mp-create-join').style.display = 'none';
          if (document.getElementById('mp-lobby')) document.getElementById('mp-lobby').style.display = 'flex';
          if (document.getElementById('mp-room-id-display')) document.getElementById('mp-room-id-display').innerText = msg.roomId;
          if (document.getElementById('mp-start-btn')) document.getElementById('mp-start-btn').style.display = msg.playerId === msg.hostId ? 'inline-block' : 'none';
          if (document.getElementById('mp-diff-select')) document.getElementById('mp-diff-select').style.display = msg.playerId === msg.hostId ? 'block' : 'none';
          if (msg.difficulty && document.getElementById('mp-difficulty')) document.getElementById('mp-difficulty').value = msg.difficulty;
          break;

        case 'player_joined':
          this.updateLobbyUI(msg.players, this.playerId === this.hostId);
          if(typeof showAnnouncement !== 'undefined') showAnnouncement('🛸 ' + msg.newPlayer.name + ' se unió');
          break;

        case 'player_left':
          this.remotePlayers.delete(msg.id);
          this.updateLobbyUI(msg.players, this.playerId === this.hostId);
          if(typeof showAnnouncement !== 'undefined') showAnnouncement('🚀 ' + msg.name + ' salió');
          break;

        case 'difficulty_changed':
          if (document.getElementById('mp-difficulty')) document.getElementById('mp-difficulty').value = msg.difficulty;
          break;

        case 'game_start':
          this.isMultiplayer = true;
          this.remotePlayers.clear();
          for (const p of msg.players) {
            if (p.id !== this.playerId) {
              this.remotePlayers.set(p.id, {
                x: -1000, y: -1000, angle: 0,
                targetX: -1000, targetY: -1000, targetAngle: 0,
                skin: 'classic',
                vida: 100, powers: { auto: 0, manual: 0 }, shield: 0,
                lastUpdate: performance.now(),
                name: p.name
              });
            }
          }
          if (document.getElementById('mp-lobby')) document.getElementById('mp-lobby').classList.remove('active');
          if (document.getElementById('multiplayer-menu')) document.getElementById('multiplayer-menu').classList.remove('active');
          if (typeof window.setupDifficulty !== 'undefined') window.setupDifficulty(msg.difficulty);
          if (typeof window.startCountdown !== 'undefined') window.startCountdown(3);
          break;

        case 'return_to_lobby':
          MP.isMultiplayer = true; 
          if(typeof gameState !== 'undefined') gameState = 'START_SCREEN';
          if (typeof animationId !== 'undefined' && animationId) cancelAnimationFrame(animationId);
          if(typeof animationId !== 'undefined') animationId = null;
          if (typeof window.countdownInterval !== 'undefined' && window.countdownInterval) { clearInterval(window.countdownInterval); window.countdownInterval = null; }
          if (document.getElementById('pause-menu')) document.getElementById('pause-menu').classList.remove('active');
          if (document.getElementById('game-over')) document.getElementById('game-over').style.display = 'none';
          if (document.getElementById('start-menu')) document.getElementById('start-menu').classList.remove('active');
          if (document.getElementById('mp-create-join')) document.getElementById('mp-create-join').style.display = 'none';
          if (document.getElementById('mp-lobby')) document.getElementById('mp-lobby').style.display = 'flex';
          if (document.getElementById('multiplayer-menu')) document.getElementById('multiplayer-menu').classList.add('active');
          if (document.getElementById('pause-btn')) document.getElementById('pause-btn').style.display = 'none';
          if (document.getElementById('countdown')) document.getElementById('countdown').style.display = 'none';
          if (typeof enemies !== 'undefined') {
            for (let i = 0; i < enemies.length; i++) if(typeof EnemyPool !== 'undefined') EnemyPool.release(enemies[i]);
            bullets = []; enemies = []; powerUps = []; hearts = [];
          }
          if (typeof ctx !== 'undefined' && typeof canvas !== 'undefined') ctx.clearRect(0, 0, canvas.width, canvas.height);
          break;

        case 'player_quit_game':
          if (this.isHost && this.remotePlayers.has(msg.id)) {
            this.remotePlayers.get(msg.id).vida = 0; 
          }
          break;

        case 'player_state': {
          if (msg.id === this.playerId) break;
          let rp = this.remotePlayers.get(msg.id);
          if (!rp) break;
          // FIX: don't snap — only teleport on first packet or very large gap
          const _dx = msg.x - rp.x, _dy = msg.y - rp.y;
          if (!rp._posInited || (_dx*_dx + _dy*_dy) > 250000) {
            rp.x = msg.x; rp.y = msg.y; rp.angle = msg.angle;
            rp._posInited = true;
          }
          rp.targetX = msg.x; rp.targetY = msg.y; rp.targetAngle = msg.angle;
          rp.skin = msg.skin;
          rp.powers = msg.powers;
          rp.shield = msg.shield;
          rp.vida = msg.vida;
          rp.lastUpdate = performance.now();
          break;
        }

        case 'player_shoot':
          if (msg.id === this.playerId) break;
          // FIX: SFX.shoot() does not exist
          if (typeof SFX !== 'undefined') {
            if (msg.source === 'manual') SFX.shootManual(); else SFX.shootAuto();
          }
          this.remoteBullets.push({
            x: msg.x, y: msg.y,
            dx: msg.dx, dy: msg.dy,
            color: msg.color,
            source: msg.source,
            life: 0
          });
          break;

        case 'player_died':
          if (msg.id === this.playerId) break;
          if(typeof showAnnouncement !== 'undefined') showAnnouncement('💥 ' + msg.name + ' ha sido destruido');
          break;

        case 'game_over':
          if (this.isHost) break; 
          if(typeof gameState !== 'undefined') gameState = 'GAMEOVER';
          if(typeof score !== 'undefined') score = msg.score;
          if(typeof kills !== 'undefined') kills = msg.kills;
          if(typeof time !== 'undefined') time = msg.time;
          if(typeof endGame !== 'undefined') endGame();
          break;

        case 'error':
          this.showError(msg.message);
          break;

        case 'enemy_spawn':
          if (this.isHost) break; // Host already spawned it
          const newEnemy = EnemyPool.get();
          newEnemy.eid = msg.eid;
          newEnemy.x = msg.x; newEnemy.y = msg.y;
          newEnemy.speed = msg.speed;
          newEnemy.type = msg.shape; newEnemy.color = msg.color;
          newEnemy.hp = msg.hp; newEnemy.maxHp = msg.maxHp;
          newEnemy.name = msg.name; newEnemy.pts = msg.pts;
          newEnemy.angle = msg.angle; newEnemy.size = msg.size;
          newEnemy.spellTimer = 0;
          enemies.push(newEnemy);
          break;

        case 'enemy_sync':
          if (this.isHost) break; // Host sends this
          if (!msg.batch) break;
          for (const b of msg.batch) {
            let e = enemies.find(e => e.eid === b.eid);
            if (!e) {
               // Recover lost enemy if spawn packet was dropped
               if (typeof EnemyPool !== 'undefined') {
                 e = EnemyPool.get();
                 e.eid = b.eid; e.x = b.x; e.y = b.y;
                 e.type = b.type || 'circle'; e.color = b.color || '#ff0044';
                 e.size = b.size || 15; e.speed = b.speed || 1.5;
                 e.hp = b.hp; e.maxHp = b.maxHp || b.hp;
                 e.spellTimer = 0; e.angle = b.angle || 0;
                 enemies.push(e);
               } else { continue; }
            }
            e._lastSyncTime = performance.now();
            // Smooth interpolation: store target, animate toward it each frame
            e._targetX = b.x; e._targetY = b.y;
            e.hp = b.hp;
            if (b.angle !== undefined) e._targetAngle = b.angle;
            // Initialize current pos if first sync
            if (e._syncInit === undefined) {
              e.x = b.x; e.y = b.y;
              e.angle = b.angle || 0;
              e._syncInit = true;
            }
          }
          break;

        case 'enemy_hit':
          if (this.isHost) {
            // HOST: a client hit an enemy — apply damage authoritatively
            const hitE = enemies.find(e => e.eid === msg.eid);
            if (hitE) {
              hitE.hp = msg.hp; // client already decremented hp by 1
              if (typeof createParticles !== 'undefined') createParticles(msg.hx, msg.hy, '#ffffff', 4);
              if (typeof SFX !== 'undefined') SFX.hit();
              if (hitE.hp <= 0) {
                // Broadcast kill to all players
                const pts = Math.ceil((hitE.pts + 5) * diffMultiplier);
                if (typeof addScore !== 'undefined') addScore(pts);
                kills++; killsMilestone++;
                if (ultraEnergy < ULTRA_MAX) ultraEnergy = Math.min(ULTRA_MAX, ultraEnergy + 1);
                if (typeof createParticles !== 'undefined') createParticles(hitE.x, hitE.y, hitE.color, 20);
                if (typeof createFloatingText !== 'undefined') createFloatingText(hitE.x, hitE.y, `+${pts}`, '#2ecc71');
                if (typeof SFX !== 'undefined') SFX.kill();
                this.send({ type: 'enemy_killed_sync', eid: hitE.eid, x: hitE.x, y: hitE.y, color: hitE.color, pts, killerName: msg._sender || 'Aliado' });
                // Remove from host enemy list
                const idx = enemies.indexOf(hitE);
                if (idx !== -1) { EnemyPool.release(hitE); enemies.splice(idx, 1); }
              } else {
                // Relay updated hp to other clients
                this.send({ type: 'enemy_hit', eid: hitE.eid, hp: hitE.hp, hx: msg.hx, hy: msg.hy });
              }
            }
            break;
          }
          // CLIENT: show hit visual from another player's bullet
          const hitE = enemies.find(e => e.eid === msg.eid);
          if (hitE) {
            hitE.hp = msg.hp;
            if (typeof createParticles !== 'undefined') createParticles(msg.hx, msg.hy, '#ffffff', 4);
            if (typeof SFX !== 'undefined') SFX.hit();
          }
          break;

        case 'enemy_killed_sync':
          if (this.isHost) break; // Host knows
          const killedE = enemies.find(e => e.eid === msg.eid);
          if (killedE) {
            killedE.hp = 0;
            if (typeof createParticles !== 'undefined') createParticles(msg.x, msg.y, msg.color, 20);
            if (msg.pts > 0 && typeof createFloatingText !== 'undefined') createFloatingText(msg.x, msg.y, `+${msg.pts}`, '#2ecc71');
            if (typeof SFX !== 'undefined') SFX.kill();
            // Client doesn't get the points locally unless they were the killer, but it's cooperative so we can add them
            if (typeof addScore !== 'undefined' && msg.pts > 0) {
               addScore(msg.pts);
               kills++;
               if (typeof ultraEnergy !== 'undefined' && ultraEnergy < ULTRA_MAX) ultraEnergy = Math.min(ULTRA_MAX, ultraEnergy + 1);
            }
            // Actually remove the dead enemy from the client's list so it doesn't linger
            const remIdx = enemies.indexOf(killedE);
            if (remIdx !== -1) {
              if (typeof EnemyPool !== 'undefined') EnemyPool.release(killedE);
              enemies.splice(remIdx, 1);
            }
          }
          break;

        case 'enemy_remove':
          if (this.isHost) break;
          const remIdx = enemies.findIndex(e => e.eid === msg.eid);
          if (remIdx !== -1) {
            if (typeof EnemyPool !== 'undefined') EnemyPool.release(enemies[remIdx]);
            enemies.splice(remIdx, 1);
          }
          break;

        case 'enemy_unlock':
          if (this.isHost) break;
          if (typeof unlockedEnemies !== 'undefined') unlockedEnemies = msg.unlockedEnemies;
          if (typeof showAnnouncement !== 'undefined') showAnnouncement('NUEVA AMENAZA: ' + msg.enemyName.toUpperCase());
          break;

        case 'ultra_flash':
          if (this.isHost) break;
          if (msg.killedEids && Array.isArray(msg.killedEids)) {
            for (let i = enemies.length - 1; i >= 0; i--) {
              const e = enemies[i];
              if (msg.killedEids.includes(e.eid)) {
                if (typeof createParticles !== 'undefined') createParticles(e.x, e.y, e.color, 30);
                if (typeof EnemyPool !== 'undefined') EnemyPool.release(e);
                enemies.splice(i, 1);
              }
            }
          } else {
             // Fallback: clear all
             for (let i = 0; i < enemies.length; i++) if (typeof EnemyPool !== 'undefined') EnemyPool.release(enemies[i]);
             enemies = [];
          }
          if (typeof SFX !== 'undefined') SFX.ultra();
          if (typeof showAnnouncement !== 'undefined') showAnnouncement("⚡ ¡FLASH NOVA COOPERATIVO! ⚡");
          break;

        case 'player_hit':
          // Optionally show effect on the remote player
          if (msg.id === this.playerId) break; // We already handled our own hit
          let rp_hit = this.remotePlayers.get(msg.id);
          if (rp_hit) {
             rp_hit.vida = msg.vida;
             if (typeof createParticles !== 'undefined') createParticles(rp_hit.x, rp_hit.y, '#ff3366', 15);
             if (typeof SFX !== 'undefined') SFX.play(100, 20, 'sawtooth', 0.2, 0.5);
          }
          break;
      }
    }
  };


  window.mpCreateRoom = function() { MP.createRoom(); };
  window.mpJoinRoom = function() { MP.joinRoom(); };

  window.mpSetDifficulty = function(sel) {
    MP.setDifficulty(sel.value);
  };

  window.mpStartGame = function() {
    MP.requestStartGame();
  };

  /* =========================================================
     EXPOSE GLOBALS (for HTML onclick handlers)
     ========================================================= */
  window.startCountdown = startCountdown;
  window.openTutorial = openTutorial;
  window.closeTutorial = closeTutorial;
  window.switchTab = switchTab;
  window.installApp = installApp;
  window.hideInstallBanner = hideInstallBanner;
  window.selectSkin = selectSkin;
  window.uploadSkin = uploadSkin;
  window.openSettings = openSettings;
  window.closeSettings = closeSettings;
  window.openMultiplayer = openMultiplayer;
  window.closeMultiplayer = closeMultiplayer;
  window.startGame = startGame;
  window.exitGame = exitGame;
  window.pauseGame = pauseGame;
  window.toggleSound = toggleSound;
  window.updateVolume = updateVolume;
  window.retryGame = () => startCountdown(3);
  
  window.openHistory = function() {
    const history = Storage.getHistory();
    const body = $('history-body');
    if (!body) return;
    body.innerHTML = '';
    history.forEach((h, i) => {
      const row = `<tr class="history-row">
        <td>${h.date || 'N/A'}</td>
        <td>${h.mode || 'N/A'}</td>
        <td>${h.score}</td>
        <td>${h.kills}</td>
        <td>${h.time}s</td>
        <td><button onclick="Storage.deleteHistoryItem(${i}); window.openHistory();" class="delete-btn">❌</button></td>
      </tr>`;
      body.innerHTML += row;
    });
    $('settings-menu').classList.remove('active');
    $('history-menu').classList.add('active');
  };
  window.clearHistory = function() { Storage.clearHistory(); window.openHistory(); };
  window.closeHistory = function() { $('history-menu').classList.remove('active'); $('settings-menu').classList.add('active'); };

  window.choosePremiumPower = function(type) {
    if (type === 'life') { player.vida++; createFloatingText(player.x, player.y, "❤ +1 VIDA", "#ff007f"); SFX.powerup(); }
    else if (type === 'ultra') { ultraEnergy = ULTRA_MAX; createFloatingText(player.x, player.y, "⚡ ULTRA LISTO", "#ff007f"); SFX.powerup(); }
    else { player.powers[type] += PREMIUM_DURATION; SFX.powerup(); }
    $('levelup-menu').classList.remove('active');
    gameState = 'PLAYING';
    if (!animationId) animationId = requestAnimationFrame(gameLoop);
  };

  window.mpCreateRoom = () => MP.createRoom();
  window.mpJoinRoom = () => MP.joinRoom();
  window.mpSetDifficulty = (el) => MP.setDifficulty(el.value);
  window.mpStartGame = () => MP.requestStartGame();
  window.mpCopyRoomId = () => MP.copyRoomId();
  // Leave room: disconnect and return to menu
  window.mpLeaveRoom = function() {
    MP.disconnect();
    if (typeof animationId !== 'undefined' && animationId) cancelAnimationFrame(animationId);
    animationId = null;
    document.querySelectorAll('.overlay').forEach(m => m.classList.remove('active'));
    $('start-menu').classList.add('active');
  };
  window.mpEndGame = function() {
    if (!MP.isMultiplayer) return;
    if (MP.isHost) {
      MP.send({ type: 'return_to_lobby' });
      MP.onMessage({ type: 'return_to_lobby' });
    } else {
      MP.send({ type: 'player_quit_game', id: MP.playerId });
      MP.onMessage({ type: 'return_to_lobby' });
    }
  };
  window.MP = MP;

  window.cancelPlatformJoin = function() {
    const m = document.getElementById('platform-warning-menu');
    if (m) m.classList.remove('active');
    MP.disconnect();
  };

  window.confirmPlatformJoin = function() {
    const m = document.getElementById('platform-warning-menu');
    if (m) m.classList.remove('active');
    const nameEl = document.getElementById('mp-player-name');
    const name = (nameEl ? nameEl.value.trim() : '') || 'Piloto';
    MP.send({ type: 'join', name: name, platform: isMobile ? 'mobile' : 'pc', force: true, _sender: MP.playerId });
  };

})();
