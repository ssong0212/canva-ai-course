/*
 * content.js — the pet that lives on the page.
 * Walks along the bottom of the viewport, naps, chases the cursor,
 * and can be picked up and thrown around.
 */
(function () {
  'use strict';

  if (window.top !== window) return; // top frame only
  var S = window.PetSprites;
  if (!S) return;

  var DEFAULTS = { enabled: true, pet: 'cat', size: 72, speed: 1, follow: true };
  var cfg = Object.assign({}, DEFAULTS);

  var host = null, shadow = null, canvas = null;
  var raf = 0, lastTs = 0, acc = 0;
  var FRAME = 1 / 30;

  var pet = {
    x: 60, y: 0, vx: 0, vy: 0,
    facing: 1,
    action: 'idle', hold: 1.2,
    t: 0,
    blinkIn: 2 + Math.random() * 4, blinkFor: 0,
    dragging: false, grabDX: 0, grabDY: 0,
    dragT: 0, dragDist: 0,
    squashT: 0,
    airborne: false
  };

  var cursor = { x: -9999, y: -9999, seen: false };
  var chasing = false;

  /* ------------------------------------------------------------ helpers */

  function footPad() { return (cfg.size * 2) / S.GRID; }
  // The sprite has two empty rows under its feet, so shift down by that much
  // (less a couple of pixels, so it does not sit flush against the edge).
  function floorTop() { return window.innerHeight - cfg.size + footPad() - 2; }
  function maxX() { return Math.max(0, window.innerWidth - cfg.size); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function setAction(name, hold) {
    pet.action = name;
    pet.hold = hold;
    pet.t = 0;
  }

  /* -------------------------------------------------------------- setup */

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'pixel-pet-host';
    host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;' +
      'z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = [
      '.pet{position:fixed;left:0;top:0;pointer-events:auto;cursor:grab;',
      'image-rendering:pixelated;image-rendering:crisp-edges;',
      'user-select:none;-webkit-user-drag:none;touch-action:none;',
      'transform-origin:50% 100%;will-change:transform;',
      'filter:drop-shadow(0 3px 2px rgba(0,0,0,.2));}',
      '.pet.grabbing{cursor:grabbing;}'
    ].join('');
    shadow.appendChild(style);

    canvas = document.createElement('canvas');
    canvas.className = 'pet';
    canvas.title = 'Click to pet · drag to move';
    shadow.appendChild(canvas);

    (document.documentElement || document.body).appendChild(host);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    applySize();
    onFullscreenChange();
    pet.x = Math.min(pet.x, maxX());
    pet.y = floorTop();
  }

  function unmount() {
    if (!host) return;
    host.remove();
    host = null;
    shadow = null;
    canvas = null;
  }

  function applySize() {
    if (!canvas) return;
    canvas.style.width = cfg.size + 'px';
    canvas.style.height = cfg.size + 'px';
  }

  /* ---------------------------------------------------------- behaviour */

  function nextIdleAction() {
    var r = Math.random();
    if (r < 0.36) {
      var toCenter = pet.x + cfg.size / 2 < window.innerWidth / 2 ? 1 : -1;
      pet.facing = Math.random() < 0.7 ? toCenter : -toCenter;
      setAction('walk', rand(1.5, 4.5));
    } else if (r < 0.58) {
      setAction('idle', rand(1, 3));
    } else if (r < 0.84) {
      setAction('sit', rand(2.5, 6));
    } else {
      setAction('sleep', rand(6, 14));
    }
  }

  function update(dt) {
    pet.t += dt;
    pet.hold -= dt;

    // blinking
    pet.blinkFor -= dt;
    pet.blinkIn -= dt;
    if (pet.blinkIn <= 0) {
      pet.blinkFor = 0.12;
      pet.blinkIn = rand(2, 6);
    }
    if (pet.squashT > 0) pet.squashT -= dt;

    if (pet.dragging) {
      pet.dragT += dt;
      return;
    }

    // gravity / falling
    if (pet.y < floorTop() - 0.5 || pet.vy < 0) {
      pet.airborne = true;
      pet.vy += 1800 * dt;
      pet.y += pet.vy * dt;
      pet.x += pet.vx * dt;
      if (pet.x < 0) { pet.x = 0; pet.vx = Math.abs(pet.vx) * 0.5; }
      if (pet.x > maxX()) { pet.x = maxX(); pet.vx = -Math.abs(pet.vx) * 0.5; }
      if (pet.action !== 'fall') setAction('fall', 0);
      if (pet.y >= floorTop()) {
        pet.y = floorTop();
        pet.vy = 0;
        pet.vx = 0;
        pet.airborne = false;
        pet.squashT = 0.18;
        setAction('idle', rand(0.6, 1.4));
      }
      return;
    }

    pet.y = floorTop();
    pet.airborne = false;

    // chase the cursor
    if (cfg.follow && cursor.seen && pet.action !== 'happy') {
      var cx = pet.x + cfg.size / 2;
      var cy = pet.y + cfg.size / 2;
      var dx = cursor.x - cx;
      var dy = cursor.y - cy;
      var dist = Math.hypot(dx, dy);
      var reach = chasing ? 340 : 240;
      if (dist < reach) {
        chasing = true;
        if (Math.abs(dx) < cfg.size * 0.45) {
          setAction('happy', 1.3);
          chasing = false;
        } else {
          pet.facing = dx > 0 ? 1 : -1;
          if (pet.action !== 'run') setAction('run', 99);
          pet.x += pet.facing * 130 * (cfg.size / 72) * cfg.speed * dt;
        }
      } else if (chasing) {
        chasing = false;
        setAction('idle', rand(0.5, 1.5));
      }
    } else if (chasing) {
      chasing = false;
      setAction('idle', 1);
    }

    if (chasing) {
      pet.x = Math.max(0, Math.min(maxX(), pet.x));
      return;
    }

    // wander
    if (pet.action === 'walk') {
      pet.x += pet.facing * 38 * (cfg.size / 72) * cfg.speed * dt;
      if (pet.x <= 0) { pet.x = 0; pet.facing = 1; }
      if (pet.x >= maxX()) { pet.x = maxX(); pet.facing = -1; }
    }

    if (pet.hold <= 0) {
      if (pet.action === 'happy' || pet.action === 'fall') setAction('idle', rand(0.8, 2));
      else nextIdleAction();
    }

    pet.x = Math.max(0, Math.min(maxX(), pet.x));
  }

  function render() {
    if (!canvas) return;
    var blink = pet.blinkFor > 0;
    S.render(canvas, cfg.pet, {
      size: cfg.size,
      action: pet.action,
      t: pet.t,
      facing: pet.facing,
      blink: blink
    });

    var squash = '';
    if (pet.squashT > 0) {
      var k = pet.squashT / 0.18;
      squash = ' scale(' + (1 + 0.22 * k).toFixed(3) + ',' + (1 - 0.22 * k).toFixed(3) + ')';
    } else if (pet.dragging) {
      squash = ' rotate(' + (pet.facing > 0 ? -4 : 4) + 'deg)';
    }
    canvas.style.transform = 'translate3d(' + Math.round(pet.x) + 'px,' +
      Math.round(pet.y) + 'px,0)' + squash;
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    var dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    acc += dt;
    if (acc < FRAME) return;
    var step = acc;
    acc = 0;
    update(step);
    render();
  }

  function start() {
    mount();
    if (!raf) {
      lastTs = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    unmount();
  }

  /* ------------------------------------------------------- interaction */

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    pet.dragging = true;
    pet.dragT = 0;
    pet.dragDist = 0;
    pet.grabDX = e.clientX - pet.x;
    pet.grabDY = e.clientY - pet.y;
    pet.vx = 0;
    pet.vy = 0;
    setAction('drag', 99);
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    window.addEventListener('pointermove', onDragMove, true);
    window.addEventListener('pointerup', onDragEnd, true);
    window.addEventListener('pointercancel', onDragEnd, true);
  }

  function onDragMove(e) {
    if (!pet.dragging) return;
    var nx = e.clientX - pet.grabDX;
    var ny = e.clientY - pet.grabDY;
    pet.dragDist += Math.abs(nx - pet.x) + Math.abs(ny - pet.y);
    // remember velocity so a flick actually throws the pet
    pet.vx = (nx - pet.x) * 12;
    pet.vy = (ny - pet.y) * 12;
    pet.x = Math.max(-cfg.size / 3, Math.min(maxX() + cfg.size / 3, nx));
    pet.y = Math.min(floorTop(), ny);
    pet.facing = pet.vx >= 0 ? 1 : -1;
    render();
  }

  function onDragEnd() {
    if (!pet.dragging) return;
    pet.dragging = false;
    canvas.classList.remove('grabbing');
    window.removeEventListener('pointermove', onDragMove, true);
    window.removeEventListener('pointerup', onDragEnd, true);
    window.removeEventListener('pointercancel', onDragEnd, true);

    pet.x = Math.max(0, Math.min(maxX(), pet.x));
    pet.vx = Math.max(-900, Math.min(900, pet.vx));
    pet.vy = Math.max(-900, Math.min(900, pet.vy));

    if (pet.dragDist < 6 && pet.dragT < 0.45) {
      // a tap, not a drag: that is a head pat
      pet.vx = 0;
      pet.vy = 0;
      pet.y = floorTop();
      setAction('happy', 1.4);
      return;
    }
    setAction('fall', 0);
  }

  function onDoubleClick(e) {
    e.preventDefault();
    pet.vy = -560;
    pet.vx = pet.facing * 90;
    setAction('fall', 0);
  }

  function onMouseMove(e) {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    cursor.seen = true;
  }

  function onResize() {
    if (!canvas) return;
    pet.x = Math.max(0, Math.min(maxX(), pet.x));
    if (!pet.airborne && !pet.dragging) pet.y = floorTop();
  }

  /* ----------------------------------------------------------- settings */

  function apply(next) {
    var wasEnabled = cfg.enabled;
    cfg = Object.assign({}, DEFAULTS, next || {});
    cfg.size = Math.max(32, Math.min(160, Number(cfg.size) || DEFAULTS.size));
    cfg.speed = Math.max(0.3, Math.min(2.5, Number(cfg.speed) || DEFAULTS.speed));

    if (!cfg.enabled) {
      stop();
      return;
    }
    if (!wasEnabled || !host) start();
    applySize();
    pet.x = Math.max(0, Math.min(maxX(), pet.x));
    if (!pet.airborne && !pet.dragging) pet.y = floorTop();
    render();
  }

  function onFullscreenChange() {
    if (!canvas) return;
    // stay out of the way of fullscreen video, slides, games...
    canvas.style.display = document.fullscreenElement ? 'none' : '';
  }

  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    } else if (cfg.enabled && host) {
      lastTs = 0;
      raf = requestAnimationFrame(loop);
    }
  });

  chrome.storage.sync.get(DEFAULTS, function (stored) {
    if (chrome.runtime.lastError) stored = DEFAULTS;
    apply(stored);
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync') return;
    var next = Object.assign({}, cfg);
    Object.keys(changes).forEach(function (k) { next[k] = changes[k].newValue; });
    apply(next);
  });
})();
