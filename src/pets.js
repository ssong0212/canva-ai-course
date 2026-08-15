/*
 * pets.js — pixel-art pet sprites drawn procedurally on a 32x32 grid.
 * Shared by the content script (the pet on the page) and the popup (preview).
 * No image assets: every frame is painted with 1x1 "pixel" rectangles.
 */
(function (global) {
  'use strict';

  var GRID = 32; // sprite grid, in pixel-art units
  var FLOOR = 29; // the y where the feet rest inside the grid

  var PETS = {
    cat: {
      id: 'cat', name: 'Cat', emoji: '🐱', kind: 'quad',
      ear: 'pointy', tail: 'long', pattern: 'stripes',
      c: { body: '#f4a259', dark: '#d9803a', light: '#ffe2c4', line: '#3b2b28', nose: '#ff98ad' }
    },
    dog: {
      id: 'dog', name: 'Dog', emoji: '🐶', kind: 'quad',
      ear: 'floppy', tail: 'stub', pattern: 'patch', snout: true,
      c: { body: '#c98b57', dark: '#a86e3f', light: '#f6e2c6', line: '#3b2b28', nose: '#4b3a35' }
    },
    bunny: {
      id: 'bunny', name: 'Bunny', emoji: '🐰', kind: 'quad',
      ear: 'long', tail: 'puff', pattern: 'none',
      c: { body: '#ece7ec', dark: '#cdc4cd', light: '#ffffff', line: '#4a3f47', nose: '#ff9aad' }
    },
    chick: {
      id: 'chick', name: 'Chick', emoji: '🐥', kind: 'bird',
      c: { body: '#ffd85e', dark: '#f2b93c', light: '#fff3c9', line: '#4a3a1e', nose: '#ff9d3d' }
    }
  };

  var ORDER = ['cat', 'dog', 'bunny', 'chick'];

  function wave(t, speed, amp) {
    return Math.round(Math.sin(t * speed) * amp);
  }

  /* ---------------------------------------------------------------- poses */

  function poseFor(action, t, o) {
    var p = {
      mode: 'stand', // stand | sit | lie | dangle
      legSpeed: 0,
      bob: 0,
      tail: 0,
      lean: 0,
      eyes: 'open', // open | blink | smile | wide | closed
      mouth: 'closed',
      hearts: false,
      zzz: false
    };

    switch (action) {
      case 'walk':
        p.legSpeed = 8;
        p.bob = Math.sin(t * 16) > 0 ? -1 : 0;
        p.tail = wave(t, 5, 2);
        break;
      case 'run':
        p.legSpeed = 16;
        p.bob = Math.sin(t * 32) > 0 ? -1 : 0;
        p.tail = 2;
        p.lean = 1;
        p.mouth = 'open';
        break;
      case 'sit':
        p.mode = 'sit';
        p.bob = wave(t, 1.6, 1) > 0 ? -1 : 0;
        p.tail = wave(t, 2.4, 2);
        break;
      case 'sleep':
        p.mode = 'lie';
        p.eyes = 'closed';
        p.zzz = true;
        p.bob = wave(t, 1.1, 1) > 0 ? -1 : 0;
        break;
      case 'happy':
        p.eyes = 'smile';
        p.mouth = 'open';
        p.hearts = true;
        p.bob = -Math.abs(Math.round(Math.sin(t * 9) * 2));
        p.tail = wave(t, 12, 2);
        break;
      case 'drag':
      case 'fall':
        p.mode = 'dangle';
        p.eyes = 'wide';
        p.mouth = 'open';
        p.tail = wave(t, 6, 2);
        break;
      default: // idle
        p.bob = wave(t, 1.8, 1) > 0 ? -1 : 0;
        p.tail = wave(t, 2.2, 2);
        break;
    }

    if (o && o.blink && (p.eyes === 'open' || p.eyes === 'wide')) p.eyes = 'blink';
    return p;
  }

  /* ------------------------------------------------------------- painting */

  function painter(ctx) {
    function P(x, y, w, h, col) {
      if (w <= 0 || h <= 0) return;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    }

    // Rounded 1px-outlined rectangle, built row by row (never erases pixels).
    function blob(x, y, w, h, fill, line) {
      if (w < 4 || h < 4) { P(x, y, w, h, line); P(x, y, w, h, fill); return; }
      P(x + 1, y, w - 2, 1, line);
      P(x, y + 1, w, h - 2, line);
      P(x + 1, y + h - 1, w - 2, 1, line);
      P(x + 2, y + 1, w - 4, 1, fill);
      P(x + 1, y + 2, w - 2, h - 4, fill);
      P(x + 2, y + h - 2, w - 4, 1, fill);
    }

    // Square-topped outlined rectangle: used for limbs tucked under a body.
    function limb(x, y, w, h, fill, line) {
      P(x, y, w, h - 1, line);
      P(x + 1, y, w - 2, h - 2, fill);
      P(x + 1, y + h - 1, w - 2, 1, line);
      P(x + 2, y + h - 2, w - 4, 1, fill);
    }

    return { P: P, blob: blob, limb: limb };
  }

  /* ------------------------------------------------------------ overlays */

  function drawHearts(ctx, t) {
    var g = painter(ctx);
    var beats = [0, 0.45, 0.9];
    for (var i = 0; i < beats.length; i++) {
      var life = ((t + beats[i]) % 1.35) / 1.35;
      if (life > 0.95) continue;
      var x = 3 + i * 4 + Math.round(Math.sin((t + beats[i]) * 6) * 1);
      var y = Math.round(11 - life * 10);
      var col = i === 1 ? '#ff5c86' : '#ff8fab';
      g.P(x, y + 1, 2, 1, col);
      g.P(x + 3, y + 1, 2, 1, col);
      g.P(x, y + 2, 5, 1, col);
      g.P(x + 1, y + 3, 3, 1, col);
      g.P(x + 2, y + 4, 1, 1, col);
    }
  }

  function drawZzz(ctx, t) {
    var g = painter(ctx);
    for (var i = 0; i < 3; i++) {
      var life = ((t * 0.5 + i * 0.33) % 1);
      if (life > 0.9) continue;
      var x = 20 + i * 3 + Math.round(Math.sin(life * 6) * 1);
      var y = Math.round(12 - life * 11);
      var s = i === 2 ? 4 : 3;
      var col = '#8ea6c9';
      g.P(x, y, s, 1, col);
      for (var k = 0; k < s - 2; k++) g.P(x + s - 2 - k, y + 1 + k, 1, 1, col);
      g.P(x, y + s - 1, s, 1, col);
    }
  }

  /* ------------------------------------------------------------ the face */

  function drawEye(g, c, x, y, kind, small) {
    var w = small ? 2 : 3;
    switch (kind) {
      case 'blink':
        g.P(x, y + 1, w + 1, 1, c.line);
        break;
      case 'closed':
        g.P(x, y + 1, w + 1, 1, c.line);
        g.P(x + 1, y + 2, w - 1, 1, c.line);
        break;
      case 'smile':
        g.P(x, y + 2, 1, 1, c.line);
        g.P(x + 1, y + 1, w - 1, 1, c.line);
        g.P(x + w, y + 2, 1, 1, c.line);
        break;
      case 'wide':
        g.P(x, y - 1, w + 1, w + 2, c.line);
        g.P(x + 1, y, 1, 1, '#ffffff');
        break;
      default:
        g.P(x, y, w, small ? 2 : 3, c.line);
        g.P(x, y, 1, 1, '#ffffff');
        break;
    }
  }

  /* --------------------------------------------------------- quadrupeds */

  function drawQuad(ctx, pet, pose, t) {
    var c = pet.c;
    var g = painter(ctx);
    var bob = pose.bob;

    if (pose.mode === 'lie') return drawQuadLying(ctx, pet, pose, t);

    var sit = pose.mode === 'sit';
    var dangle = pose.mode === 'dangle';

    var bodyX = 4, bodyW = 19;
    var bodyY = (sit ? 15 : 13) + bob;
    var bodyH = sit ? 10 : 11;
    if (sit) { bodyX = 5; bodyW = 15; }

    var headW = 14, headH = 13;
    var headX = sit ? 14 : 16;
    var headY = (sit ? 7 : 6) + bob - pose.lean;

    /* ---- tail (behind everything) */
    var tailY = bodyY + 2 + pose.tail;
    if (pet.tail === 'long') {
      g.P(1, tailY - 4, 3, 8, c.line);
      g.P(2, tailY - 3, 2, 6, c.body);
      g.P(2, tailY - 3, 2, 2, c.light);
      g.P(3, tailY + 3, 3, 3, c.line);
      g.P(3, tailY + 4, 2, 1, c.body);
    } else if (pet.tail === 'stub') {
      g.P(1, tailY, 4, 5, c.line);
      g.P(2, tailY + 1, 3, 3, c.body);
    } else if (pet.tail === 'puff') {
      g.blob(0, tailY, 6, 6, c.light, c.line);
    }

    /* ---- back legs */
    var swing = pose.legSpeed ? Math.round(Math.sin(t * pose.legSpeed) * 2) : 0;
    var swing2 = pose.legSpeed ? Math.round(Math.sin(t * pose.legSpeed + Math.PI) * 2) : 0;
    var legTop = bodyY + bodyH - 2;
    var legH = FLOOR - legTop + 1;

    if (dangle) {
      g.limb(6, legTop, 5, legH - 1, c.dark, c.line);
      g.limb(11, legTop + 1, 5, legH - 2, c.dark, c.line);
    } else if (sit) {
      // folded haunch
      g.blob(4, bodyY + 4, 9, 9, c.dark, c.line);
      g.P(6, FLOOR - 2, 7, 3, c.line);
      g.P(7, FLOOR - 1, 5, 2, c.light);
    } else {
      g.limb(6 + swing, legTop, 5, legH, c.dark, c.line);
    }

    /* ---- body */
    if (!dangle) g.blob(bodyX, bodyY, bodyW, bodyH, c.body, c.line);
    else g.blob(bodyX + 2, bodyY, bodyW - 3, bodyH, c.body, c.line);

    // belly / chest highlight
    if (!sit) g.P(bodyX + 3, bodyY + bodyH - 4, bodyW - 8, 3, c.light);
    else g.P(bodyX + 3, bodyY + 3, 6, 6, c.light);

    if (pet.pattern === 'stripes') {
      g.P(bodyX + 5, bodyY + 1, 2, 4, c.dark);
      g.P(bodyX + 9, bodyY + 1, 2, 5, c.dark);
      g.P(bodyX + 13, bodyY + 1, 2, 4, c.dark);
    } else if (pet.pattern === 'patch') {
      g.blob(bodyX + 8, bodyY + 1, 8, 7, c.light, c.dark);
    }

    /* ---- front legs */
    if (dangle) {
      g.limb(bodyX + bodyW - 8, legTop + 1, 5, legH - 2, c.body, c.line);
      g.limb(bodyX + bodyW - 4, legTop, 5, legH - 1, c.body, c.line);
    } else if (sit) {
      g.limb(bodyX + bodyW - 6, bodyY + 5, 5, FLOOR - bodyY - 4, c.body, c.line);
      g.P(bodyX + bodyW - 6, FLOOR - 1, 6, 2, c.line);
      g.P(bodyX + bodyW - 5, FLOOR, 4, 1, c.light);
    } else {
      g.limb(bodyX + bodyW - 7 + swing2, legTop, 5, legH, c.body, c.line);
    }

    /* ---- ears (behind the head) */
    if (pet.ear === 'pointy') {
      pointyEar(g, c, headX, headY + 2, 6, 7, -1);
      pointyEar(g, c, headX + 8, headY + 1, 6, 7, 1);
    } else if (pet.ear === 'long') {
      var flop = pose.legSpeed ? Math.round(Math.sin(t * pose.legSpeed * 0.5) * 1) : 0;
      longEar(g, c, headX + 2, Math.max(0, headY - 5) + flop, headY + 5);
      longEar(g, c, headX + 8, Math.max(0, headY - 4) - flop, headY + 4);
    }

    /* ---- head */
    g.blob(headX, headY, headW, headH, c.body, c.line);

    if (pet.ear === 'floppy') {
      g.blob(headX - 3, headY + 2, 6, 9 + (pose.legSpeed ? Math.abs(swing) : 0), c.dark, c.line);
    }

    // muzzle
    var muzX = headX + headW - 8;
    var muzY = headY + 6;
    if (pet.snout) {
      g.blob(muzX + 1, muzY, 9, 6, c.light, c.line);
      g.P(muzX + 8, muzY + 1, 3, 3, c.nose);
    } else {
      g.P(muzX + 2, muzY + 1, 6, 4, c.light);
      g.P(muzX + 6, muzY + 1, 2, 2, c.nose);
      g.P(muzX + 5, muzY + 3, 1, 1, c.line);
      if (pose.mouth === 'open') {
        g.P(muzX + 4, muzY + 4, 3, 2, c.line);
        g.P(muzX + 5, muzY + 5, 2, 1, '#ff7a95');
      } else {
        g.P(muzX + 3, muzY + 4, 2, 1, c.line);
        g.P(muzX + 6, muzY + 4, 2, 1, c.line);
      }
    }

    // whiskers, kept just off the muzzle so they read as strokes
    if (pet.id === 'cat') {
      g.P(muzX + 8, muzY, 3, 1, c.line);
      g.P(muzX + 8, muzY + 3, 3, 1, c.line);
    }

    // eyes: the near one, plus a smaller hint of the far one
    drawEye(g, c, headX + headW - 6, headY + 4, pose.eyes);
    drawEye(g, c, headX + 4, headY + 5, pose.eyes, true);
  }

  // Triangle ear. (x, yBase) is the bottom-left of the base; `dir` picks the
  // side the tip leans toward.
  function pointyEar(g, c, x, yBase, w, h, dir) {
    var i, rw, rx;
    for (i = 0; i < h; i++) {
      rw = Math.max(1, w - Math.round((i * w) / h));
      rx = dir > 0 ? x + (w - rw) : x;
      g.P(rx, yBase - i, rw, 1, c.line);
      if (rw > 2 && i < h - 1) {
        g.P(rx + 1, yBase - i, rw - 2, 1, i < 2 ? c.nose : c.body);
      }
    }
  }

  function longEar(g, c, x, top, bottom) {
    var h = bottom - top;
    if (h < 4) return;
    g.blob(x, top, 5, h, c.light, c.line);
    g.P(x + 2, top + 2, 1, h - 4, c.nose);
  }

  function drawQuadLying(ctx, pet, pose, t) {
    var c = pet.c;
    var g = painter(ctx);
    var bob = pose.bob;
    var bodyY = 20 + bob;

    // tail curled around
    if (pet.tail === 'long') {
      g.P(1, bodyY + 4, 9, 3, c.line);
      g.P(2, bodyY + 5, 8, 1, c.body);
    } else if (pet.tail === 'puff') {
      g.blob(1, bodyY + 2, 6, 6, c.light, c.line);
    }

    g.blob(3, bodyY, 21, 9, c.body, c.line);
    g.P(6, bodyY + 5, 13, 3, c.light);
    if (pet.pattern === 'stripes') {
      g.P(8, bodyY + 1, 2, 4, c.dark);
      g.P(12, bodyY + 1, 2, 4, c.dark);
    }

    var headX = 17, headY = bodyY - 9;
    if (pet.ear === 'pointy') {
      pointyEar(g, c, headX, headY + 2, 6, 7, -1);
      pointyEar(g, c, headX + 8, headY + 1, 6, 7, 1);
    } else if (pet.ear === 'long') {
      longEar(g, c, headX + 2, Math.max(0, headY - 4), headY + 5);
      longEar(g, c, headX + 8, Math.max(0, headY - 3), headY + 4);
    }
    g.blob(headX, headY, 14, 12, c.body, c.line);
    if (pet.ear === 'floppy') g.blob(headX - 3, headY + 2, 6, 8, c.dark, c.line);

    var muzX = headX + 6, muzY = headY + 6;
    g.P(muzX + 2, muzY + 1, 6, 4, c.light);
    g.P(muzX + 6, muzY + 1, 2, 2, c.nose);
    drawEye(g, c, headX + 8, headY + 4, 'closed');
    drawEye(g, c, headX + 4, headY + 5, 'closed', true);
  }

  /* -------------------------------------------------------------- birds */

  function drawBird(ctx, pet, pose, t) {
    var c = pet.c;
    var g = painter(ctx);
    var bob = pose.bob;
    var lie = pose.mode === 'lie';
    var sit = pose.mode === 'sit' || lie;
    var dangle = pose.mode === 'dangle';

    var bodyX = 5, bodyW = 18, bodyH = 14;
    var bodyY = (lie ? 15 : sit ? 14 : 13) + bob;
    var headX = 12, headW = 13, headH = 12;
    var headY = bodyY - 9 - (lie ? 0 : 0);

    /* legs */
    var swing = pose.legSpeed ? Math.round(Math.sin(t * pose.legSpeed) * 2) : 0;
    var swing2 = pose.legSpeed ? Math.round(Math.sin(t * pose.legSpeed + Math.PI) * 2) : 0;
    var legTop = bodyY + bodyH - 2;
    if (!sit) {
      var legH = FLOOR - legTop - 1;
      if (dangle) {
        g.P(11, legTop, 2, legH, c.nose);
        g.P(16, legTop, 2, legH - 1, c.nose);
        g.P(9, legTop + legH, 5, 2, c.nose);
        g.P(14, legTop + legH - 1, 5, 2, c.nose);
      } else {
        g.P(11 + swing, legTop, 2, legH, c.nose);
        g.P(17 + swing2, legTop, 2, legH, c.nose);
        g.P(9 + swing, FLOOR - 1, 5, 2, c.nose);
        g.P(15 + swing2, FLOOR - 1, 5, 2, c.nose);
      }
    }

    /* tail feathers */
    g.blob(0, bodyY + 1, 7, 7, c.dark, c.line);

    /* body */
    g.blob(bodyX, bodyY, bodyW, bodyH, c.body, c.line);
    g.P(bodyX + 4, bodyY + bodyH - 7, bodyW - 9, 5, c.light);

    /* wing */
    var flap = pose.legSpeed ? Math.round(Math.sin(t * pose.legSpeed) * 2) : 0;
    g.blob(bodyX + 2, bodyY + 4 + flap, 8, 6, c.dark, c.line);

    /* head tuft (behind the head) */
    g.P(headX + 4, headY - 4, 2, 5, c.dark);
    g.P(headX + 6, headY - 5, 2, 6, c.dark);
    g.P(headX + 8, headY - 3, 2, 4, c.dark);

    /* head */
    g.blob(headX, headY, headW, headH, c.body, c.line);

    /* beak */
    var beakY = headY + 6;
    g.P(headX + headW - 2, beakY, 5, 1, c.line);
    g.P(headX + headW - 2, beakY + 1, 5, 2, c.nose);
    g.P(headX + headW - 1, beakY + 3, 4, 1, c.line);
    if (pose.mouth === 'open') {
      g.P(headX + headW - 1, beakY + 3, 4, 3, c.line);
      g.P(headX + headW, beakY + 4, 3, 1, '#ff7a95');
    }

    /* cheeks + eyes */
    g.P(headX + headW - 5, beakY + 1, 3, 2, '#ffb3c1');
    drawEye(g, c, headX + headW - 6, headY + 3, pose.eyes);
    drawEye(g, c, headX + 3, headY + 4, pose.eyes, true);
  }

  /* ------------------------------------------------------------ exports */

  function draw(ctx, petId, opts) {
    var pet = PETS[petId] || PETS.cat;
    var o = opts || {};
    var t = o.t || 0;
    var pose = poseFor(o.action || 'idle', t, o);

    ctx.save();
    if (o.facing === -1) {
      ctx.translate(GRID, 0);
      ctx.scale(-1, 1);
    }
    if (pet.kind === 'bird') drawBird(ctx, pet, pose, t);
    else drawQuad(ctx, pet, pose, t);
    ctx.restore();

    if (pose.hearts) drawHearts(ctx, t);
    if (pose.zzz) drawZzz(ctx, t);
  }

  // Sizes the canvas for the device pixel ratio and paints one frame.
  function render(canvas, petId, opts) {
    var o = opts || {};
    var size = o.size || 64;
    var dpr = o.dpr || (global.devicePixelRatio || 1);
    var scale = Math.max(1, Math.round((size * dpr) / GRID));
    var px = GRID * scale;

    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, px, px);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw(ctx, petId, o);
    return canvas;
  }

  global.PetSprites = {
    GRID: GRID,
    FLOOR: FLOOR,
    PETS: PETS,
    ORDER: ORDER,
    list: function () {
      return ORDER.map(function (id) {
        return { id: id, name: PETS[id].name, emoji: PETS[id].emoji };
      });
    },
    draw: draw,
    render: render
  };
})(typeof window !== 'undefined' ? window : globalThis);
