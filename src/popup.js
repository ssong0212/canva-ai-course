/* popup.js — settings UI with a live preview of the selected pet. */
(function () {
  'use strict';

  var DEFAULTS = { enabled: true, pet: 'cat', size: 72, speed: 1, follow: true };
  var cfg = Object.assign({}, DEFAULTS);

  var $ = function (id) { return document.getElementById(id); };
  var preview = $('preview');
  var petsBox = $('pets');

  /* -------------------------------------------------------- pet picker */

  var buttons = {};
  PetSprites.list().forEach(function (p) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.title = p.name;

    var cv = document.createElement('canvas');
    PetSprites.render(cv, p.id, { size: 34, dpr: 2, action: 'idle', t: 0.3, facing: 1 });
    btn.appendChild(cv);

    var name = document.createElement('span');
    name.textContent = p.name;
    btn.appendChild(name);

    btn.addEventListener('click', function () {
      save({ pet: p.id });
    });

    buttons[p.id] = btn;
    petsBox.appendChild(btn);
  });

  /* ----------------------------------------------------------- preview */

  // A short scripted loop so the preview shows off a few behaviours.
  var SCRIPT = [
    { action: 'idle', for: 1.6 },
    { action: 'walk', for: 2.4 },
    { action: 'happy', for: 1.6 },
    { action: 'sit', for: 2.2 },
    { action: 'run', for: 1.8 },
    { action: 'sleep', for: 3.2 }
  ];

  var step = 0, stepT = 0, last = 0, blinkIn = 2, blinkFor = 0, facing = 1;

  function tick(ts) {
    requestAnimationFrame(tick);
    if (!last) last = ts;
    var dt = Math.min((ts - last) / 1000, 0.1);
    last = ts;

    stepT += dt;
    blinkIn -= dt;
    blinkFor -= dt;
    if (blinkIn <= 0) { blinkFor = 0.12; blinkIn = 2 + Math.random() * 4; }
    if (stepT > SCRIPT[step].for) {
      stepT = 0;
      step = (step + 1) % SCRIPT.length;
      if (SCRIPT[step].action === 'walk' || SCRIPT[step].action === 'run') {
        facing = Math.random() < 0.5 ? -1 : 1;
      }
    }

    PetSprites.render(preview, cfg.pet, {
      size: 96,
      dpr: 2,
      action: SCRIPT[step].action,
      t: stepT,
      facing: facing,
      blink: blinkFor > 0
    });
  }
  requestAnimationFrame(tick);

  /* ---------------------------------------------------------- controls */

  function paint() {
    $('enabled').checked = !!cfg.enabled;
    $('follow').checked = !!cfg.follow;
    $('size').value = cfg.size;
    $('speed').value = cfg.speed;
    $('sizeVal').textContent = cfg.size + 'px';
    $('speedVal').textContent = Number(cfg.speed).toFixed(1) + 'x';
    Object.keys(buttons).forEach(function (id) {
      buttons[id].setAttribute('aria-pressed', String(id === cfg.pet));
    });
    document.body.style.opacity = cfg.enabled ? '1' : '.72';
  }

  function save(patch) {
    cfg = Object.assign({}, cfg, patch);
    paint();
    chrome.storage.sync.set(patch);
  }

  $('enabled').addEventListener('change', function (e) { save({ enabled: e.target.checked }); });
  $('follow').addEventListener('change', function (e) { save({ follow: e.target.checked }); });
  $('size').addEventListener('input', function (e) { save({ size: Number(e.target.value) }); });
  $('speed').addEventListener('input', function (e) { save({ speed: Number(e.target.value) }); });

  chrome.storage.sync.get(DEFAULTS, function (stored) {
    cfg = Object.assign({}, DEFAULTS, stored || {});
    paint();
  });
})();
