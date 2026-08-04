(function () {
  "use strict";

  const REALMS = ["kaid", "evil", "good", "chaos"];

  // ---- Auth (same PBKDF2 check as the main app; kept self-contained since
  // this is a standalone tool, but reads/writes the SAME sessionStorage key
  // so a dev already logged into index.html stays logged in here too). ----
  let devSession = null;

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }
  function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function pbkdf2Hash(password, saltHex, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: hexToBytes(saltHex), iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return bytesToHex(new Uint8Array(derivedBits));
  }
  function findAccount(username) {
    return DEV_ACCOUNTS.find(a => a.username.toLowerCase() === username.toLowerCase());
  }
  async function attemptLogin(username, password) {
    const account = findAccount(username);
    if (!account) return null;
    const computed = await pbkdf2Hash(password, account.salt, account.iterations);
    return computed === account.hash ? account : null;
  }
  function loadDevSession() {
    try {
      const raw = sessionStorage.getItem("devSession");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (findAccount(parsed.username)) devSession = parsed;
      }
    } catch (e) { devSession = null; }
  }
  function saveDevSession() {
    if (devSession) sessionStorage.setItem("devSession", JSON.stringify(devSession));
    else sessionStorage.removeItem("devSession");
  }

  function showBuilder() {
    document.getElementById("login-gate").classList.add("hidden");
    document.getElementById("builder-app").classList.remove("hidden");
    initBuilder();
  }

  document.getElementById("rb-login-submit").addEventListener("click", async () => {
    const username = document.getElementById("rb-username").value.trim();
    const password = document.getElementById("rb-password").value;
    const errorEl = document.getElementById("rb-login-error");
    if (!username || !password) {
      errorEl.textContent = "Enter a username and password.";
      return;
    }
    const account = await attemptLogin(username, password);
    if (!account) {
      errorEl.textContent = "Invalid username or password.";
      return;
    }
    devSession = { username: account.username, role: account.role };
    saveDevSession();
    showBuilder();
  });
  document.getElementById("rb-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("rb-login-submit").click();
  });

  // ---- Builder ----
  let initialized = false;
  let map = null;
  let pieceLayerGroup = null;
  let currentRealm = "kaid";
  let overlaysByFile = {};
  let activeDrag = null;

  // ---- Split pieces (persisted locally, layered over the real manifest) ----
  // A split doesn't touch the real files -- it hides the original piece and
  // adds "virtual" pieces (in-memory PNGs stored as data URLs) in its place,
  // so the parts can be dragged around immediately in this session. Only a
  // real file on disk (via "Download Parts", handed off to get committed)
  // makes a split permanent/shared across browsers.
  function loadHiddenOriginals(realm) {
    try {
      return new Set(JSON.parse(localStorage.getItem("realmBuilderHidden_" + realm) || "[]"));
    } catch (e) {
      return new Set();
    }
  }
  function saveHiddenOriginals(realm, set) {
    localStorage.setItem("realmBuilderHidden_" + realm, JSON.stringify(Array.from(set)));
  }
  function loadVirtualPieces(realm) {
    try {
      return JSON.parse(localStorage.getItem("realmBuilderVirtual_" + realm) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveVirtualPieces(realm, obj) {
    try {
      localStorage.setItem("realmBuilderVirtual_" + realm, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false; // most likely quota exceeded -- data URLs are not small
    }
  }
  function effectivePieces(realm) {
    const hidden = loadHiddenOriginals(realm);
    const virtual = loadVirtualPieces(realm);
    const real = (REALM_PIECES[realm] || []).filter(p => !hidden.has(p.file));
    const virtualList = Object.entries(virtual).map(([file, v]) => ({ file, width: v.width, height: v.height, isVirtual: true }));
    return real.concat(virtualList);
  }

  function gridLayoutFor(realm) {
    const pieces = effectivePieces(realm);
    const cols = Math.ceil(Math.sqrt(pieces.length));
    // Size cells to the largest piece in this realm (+ padding) so nothing
    // overlaps in the starting scatter, no matter how big an individual
    // piece is -- pieces range up to ~1900x2800px.
    const maxW = pieces.reduce((m, p) => Math.max(m, p.width), 0);
    const maxH = pieces.reduce((m, p) => Math.max(m, p.height), 0);
    const cellW = maxW + 200, cellH = maxH + 200;
    const layout = {};
    pieces.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      layout[p.file] = { x: col * cellW, y: row * cellH };
    });
    return layout;
  }

  function loadLayoutFromStorage(realm) {
    try {
      const raw = localStorage.getItem("realmBuilderLayout_" + realm);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveLayoutToStorage(realm, layout) {
    localStorage.setItem("realmBuilderLayout_" + realm, JSON.stringify(layout));
  }

  // Bounds/positions are read from each piece's own L.imageOverlay (which
  // scales with zoom like the main site's map images do) rather than a
  // marker -- markers/divIcons in Leaflet are ALWAYS a fixed on-screen
  // size regardless of zoom (that's why badges/pins never grow or shrink),
  // which is exactly wrong for pieces meant to tile into one big map: they
  // need to shrink as you zoom out, like real map content, not stay at
  // native pixel size forever.
  function currentLayout() {
    const layout = {};
    Object.entries(overlaysByFile).forEach(([file, entry]) => {
      const nw = entry.overlay.getBounds().getNorthWest();
      layout[file] = { x: Math.round(nw.lng), y: Math.round(-nw.lat) };
    });
    return layout;
  }

  function boundsForPiece(pos, piece) {
    return L.latLngBounds(
      [-(pos.y + piece.height), pos.x],
      [-pos.y, pos.x + piece.width]
    );
  }

  function labelIcon(file) {
    return L.divIcon({
      className: "",
      html: `<div class="realm-piece-label">${escapeHtml(file.replace(/\.png$/i, ""))}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // One shared drag tracker for all pieces (rather than a listener per
  // piece) -- mousedown on a piece's image arms it, map-level mousemove
  // drags it, mouseup/mouseleave releases it.
  function attachDragHandlers(overlay, label, file) {
    const el = overlay.getElement();
    if (!el) return;
    el.classList.add("realm-piece-img");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (splitMode) {
        openSplitModal(currentRealm, file);
        return;
      }
      activeDrag = {
        overlay,
        label,
        startLatLng: map.mouseEventToLatLng(e),
        startBounds: overlay.getBounds()
      };
      map.dragging.disable();
      el.classList.add("dragging");
    });
  }

  function endActiveDrag() {
    if (!activeDrag) return;
    const el = activeDrag.overlay.getElement();
    if (el) el.classList.remove("dragging");
    activeDrag = null;
    map.dragging.enable();
  }

  // ---- Split-piece tool ----
  // Lets a dev cut a piece image apart without leaving the browser: freehand-
  // erase the lines connecting rooms that should be independent pieces, then
  // the tool finds each resulting disconnected blob of pixels. "Place in Map"
  // swaps the original for the resulting parts as live, draggable pieces
  // immediately (see placeSplitPartsLive) -- no file round-trip needed to
  // start rearranging. "Download Parts" is the separate path for making a
  // split permanent: those files still need to be dropped into
  // pieces/<realm>/ and added to realm-pieces.js / the seed layout by hand,
  // since a static site can't write back to its own repo.
  let splitMode = false;
  let splitState = null;

  function baseNameFor(file) {
    return file.replace(/\.png$/i, "");
  }

  function redrawSplitDisplay() {
    const s = splitState;
    s.displayCtx.clearRect(0, 0, s.displayCanvas.width, s.displayCanvas.height);
    s.displayCtx.drawImage(s.fullCanvas, 0, 0, s.displayCanvas.width, s.displayCanvas.height);
  }

  function undoSplitStroke() {
    if (!splitState || splitState.undoStack.length === 0) return;
    const prev = splitState.undoStack.pop();
    splitState.fullCtx.putImageData(prev.imageData, 0, 0);
    splitState.cutMask.set(prev.cutMask);
    redrawSplitDisplay();
  }

  function openSplitModal(realm, file) {
    const virtual = loadVirtualPieces(realm);
    const isVirtual = !!virtual[file];

    const img = new Image();
    img.onload = () => {
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const fullCanvas = document.createElement("canvas");
      fullCanvas.width = natW;
      fullCanvas.height = natH;
      const fullCtx = fullCanvas.getContext("2d");
      fullCtx.drawImage(img, 0, 0);

      // Show the modal (with results/final hidden) BEFORE sizing the canvas,
      // so #split-canvas-wrap's flex-allocated size reflects the real,
      // rendered space left after the header/instructions/controls --
      // guessing a size from raw window dimensions could end up taller than
      // what's actually visible, clipping the canvas top/bottom with no
      // indication you needed to scroll to reach them.
      document.getElementById("split-piece-name").textContent = `${baseNameFor(file)} (${realm})`;
      document.getElementById("split-editing-area").classList.remove("hidden");
      document.getElementById("split-final").classList.add("hidden");
      document.getElementById("split-results").classList.add("hidden");
      document.getElementById("split-groups-grid").innerHTML = "";
      document.getElementById("split-min-size").value = Math.max(150, Math.round(natW * natH * 0.0015));
      document.getElementById("split-modal").classList.remove("hidden");

      const wrap = document.getElementById("split-canvas-wrap");
      const maxW = Math.max(100, wrap.clientWidth - 4);
      const maxH = Math.max(100, wrap.clientHeight - 4);
      // baseScale is "fit" -- 100% on the zoom control. zoom is a multiplier
      // on top of that, so the canvas can grow past the wrap (which then
      // scrolls) for a closer look at fine detail.
      const baseScale = Math.min(1, maxW / natW, maxH / natH);

      const displayCanvas = document.getElementById("split-canvas");
      displayCanvas.width = Math.round(natW * baseScale);
      displayCanvas.height = Math.round(natH * baseScale);
      const displayCtx = displayCanvas.getContext("2d");

      splitState = {
        realm, file, img, fullCanvas, fullCtx, displayCanvas, displayCtx,
        baseScale, scale: baseScale, zoom: 1, natW, natH,
        drawing: false, undoStack: [],
        // Every pixel the brush has touched this editing session, tracked
        // separately from fullCanvas's own transparency -- this is the
        // "wall" splitAlongLine() cuts along, distinct from pixels that
        // were simply always background.
        cutMask: new Uint8Array(natW * natH),
        brushSize: parseInt(document.getElementById("split-brush-size").value, 10),
        groups: null, nextGroupId: 1, dragSourceGroupId: null
      };

      document.getElementById("split-zoom-level").textContent = "100%";
      redrawSplitDisplay();
    };
    img.src = isVirtual ? virtual[file].dataUrl : `pieces/${realm}/${encodeURIComponent(file)}`;
  }

  function applyZoom(newZoom) {
    const s = splitState;
    if (!s) return;
    const wrap = document.getElementById("split-canvas-wrap");

    // Keep whatever's currently centered in view still centered after the
    // zoom level changes, instead of jumping back to the top-left corner.
    const oldScale = s.scale;
    const centerX = (wrap.scrollLeft + wrap.clientWidth / 2) / oldScale;
    const centerY = (wrap.scrollTop + wrap.clientHeight / 2) / oldScale;

    s.zoom = Math.min(8, Math.max(1, newZoom));
    s.scale = s.baseScale * s.zoom;
    s.displayCanvas.width = Math.round(s.natW * s.scale);
    s.displayCanvas.height = Math.round(s.natH * s.scale);
    redrawSplitDisplay();

    wrap.scrollLeft = centerX * s.scale - wrap.clientWidth / 2;
    wrap.scrollTop = centerY * s.scale - wrap.clientHeight / 2;

    document.getElementById("split-zoom-level").textContent = Math.round(s.zoom * 100) + "%";
  }

  function closeSplitModal() {
    document.getElementById("split-modal").classList.add("hidden");
    splitState = null;
  }

  function splitCanvasPoint(e) {
    const s = splitState;
    const rect = s.displayCanvas.getBoundingClientRect();
    // Clamped to the image bounds so a drag that overshoots the edge (very
    // easy to do when you're deliberately aiming for the edge) still counts
    // as reaching it, instead of the stroke stopping just short.
    const x = (e.clientX - rect.left) / s.scale;
    const y = (e.clientY - rect.top) / s.scale;
    return [Math.min(Math.max(x, 0), s.natW - 1), Math.min(Math.max(y, 0), s.natH - 1)];
  }

  function eraseAt(x, y, radius) {
    const s = splitState;
    const ctx = s.fullCtx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const w = s.natW, h = s.natH, mask = s.cutMask;
    const cx = Math.round(x), cy = Math.round(y), r = Math.ceil(radius), r2 = radius * radius;
    const y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
    const x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
    for (let py = y0; py <= y1; py++) {
      const dy = py - cy;
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx;
        if (dx * dx + dy * dy <= r2) mask[py * w + px] = 1;
      }
    }
  }

  function eraseStroke(x0, y0, x1, y1, radius) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / Math.max(2, radius / 2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      eraseAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
    }
  }

  // Flood fill (iterative, 8-connected) over every non-transparent pixel to
  // find each disconnected blob left after the dev's cuts.
  function findComponents(imageData, w, h) {
    const data = imageData.data;
    const labels = new Int32Array(w * h);
    const stackX = new Int32Array(w * h);
    const stackY = new Int32Array(w * h);
    let nextLabel = 0;
    const components = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (labels[idx] !== 0 || data[idx * 4 + 3] < 10) continue;

        nextLabel++;
        let sp = 0;
        stackX[sp] = x; stackY[sp] = y; sp++;
        labels[idx] = nextLabel;
        let count = 0, minX = x, maxX = x, minY = y, maxY = y;

        while (sp > 0) {
          sp--;
          const cx = stackX[sp], cy = stackY[sp];
          count++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

          for (let ny = cy - 1; ny <= cy + 1; ny++) {
            if (ny < 0 || ny >= h) continue;
            for (let nx = cx - 1; nx <= cx + 1; nx++) {
              if (nx < 0 || nx >= w) continue;
              const nidx = ny * w + nx;
              if (labels[nidx] !== 0 || data[nidx * 4 + 3] < 10) continue;
              labels[nidx] = nextLabel;
              stackX[sp] = nx; stackY[sp] = ny; sp++;
            }
          }
        }
        components.push({ id: nextLabel, count, minX, maxX, minY, maxY });
      }
    }
    return { labels, components };
  }

  // A squat, wide blob sitting in the top slice of the image is almost
  // always the piece's title text, not a real room area.
  function detectTitleComponent(components, natH) {
    const topBand = natH * 0.15;
    let best = null;
    components.forEach(c => {
      const w = c.maxX - c.minX, h = c.maxY - c.minY;
      if (c.minY > topBand || h === 0 || w / h < 1.4) return;
      if (!best || c.count < best.count) best = c;
    });
    return best;
  }

  // A "group" is a fully self-contained piece: its own already-cropped RGBA
  // canvas plus the (x0,y0) offset of that canvas within the original full
  // image. Every source -- an auto-detected connected component, a manual
  // paint-and-add selection, or a merge of two other groups -- produces one
  // of these, so preview/merge/title/place/download all work identically
  // regardless of how the group was created, and none of them need to
  // re-derive anything from the original pixel data after creation (that
  // re-derivation, done once per group up front instead of repeatedly, is
  // also what keeps this from bogging down on pieces with lots of regions).
  function cropComponentToGroup(labels, component, natW, natH, margin) {
    const x0 = Math.max(0, component.minX - margin);
    const y0 = Math.max(0, component.minY - margin);
    const x1 = Math.min(natW, component.maxX + margin + 1);
    const y1 = Math.min(natH, component.maxY + margin + 1);
    const w = x1 - x0, h = y1 - y0;

    const s = splitState;
    const srcData = s.fullCtx.getImageData(x0, y0, w, h);
    const out = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gidx = (y0 + y) * natW + (x0 + x);
        if (labels[gidx] !== component.id) continue;
        const oidx = (y * w + x) * 4;
        out.data[oidx] = srcData.data[oidx];
        out.data[oidx + 1] = srcData.data[oidx + 1];
        out.data[oidx + 2] = srcData.data[oidx + 2];
        out.data[oidx + 3] = srcData.data[oidx + 3];
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").putImageData(out, 0, 0);
    return { canvas, x0, y0 };
  }

  function downloadCanvas(canvas, filename) {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  }

  // Hard cap on how many auto-detected regions get turned into cards. A low
  // "min region size" on a text-heavy piece can otherwise yield thousands of
  // individual letter/icon fragments, each needing its own cropped canvas +
  // thumbnail -- that's what was actually making Analyze look hung, not the
  // flood fill itself. Only the largest MAX_AUTO_GROUPS survive; raise "min
  // region size" to see smaller ones, or use Manual Select for a few odd
  // ones instead of relying on auto-detection at all.
  const MAX_AUTO_GROUPS = 120;

  function nextGroupId() {
    splitState.nextGroupId = (splitState.nextGroupId || 1);
    return splitState.nextGroupId++;
  }

  function runSplitAnalysis() {
    const s = splitState;
    const imageData = s.fullCtx.getImageData(0, 0, s.natW, s.natH);
    const { labels, components } = findComponents(imageData, s.natW, s.natH);
    const minSize = Math.max(1, parseInt(document.getElementById("split-min-size").value, 10) || 150);
    let kept = components.filter(c => c.count >= minSize).sort((a, b) => b.count - a.count);

    let truncated = false;
    if (kept.length > MAX_AUTO_GROUPS) {
      kept = kept.slice(0, MAX_AUTO_GROUPS);
      truncated = true;
    }

    const titleGuess = detectTitleComponent(kept, s.natH);
    const base = baseNameFor(s.file);

    if (!s.groups) s.groups = [];
    const startCount = s.groups.length;
    kept.forEach((c, i) => {
      const { canvas, x0, y0 } = cropComponentToGroup(labels, c, s.natW, s.natH, 30);
      const isTitleGuess = !!(titleGuess && c.id === titleGuess.id);
      s.groups.push({
        id: nextGroupId(),
        canvas, x0, y0,
        included: !isTitleGuess,
        isTitle: isTitleGuess,
        filename: `${base} (Part ${startCount + i + 1}).png`
      });
    });

    document.getElementById("split-final").classList.add("hidden");
    document.getElementById("split-editing-area").classList.remove("hidden");
    document.getElementById("split-results").classList.remove("hidden");
    renderGroupsGrid();

    if (truncated) {
      updateStatus(`Found more than ${MAX_AUTO_GROUPS} regions -- showing the ${MAX_AUTO_GROUPS} largest. Raise "min region size" to catch smaller ones, or add them with Manual Select.`);
    }
  }

  function renderGroupsGrid() {
    const s = splitState;
    const grid = document.getElementById("split-groups-grid");
    grid.innerHTML = "";

    s.groups.forEach(g => {
      const card = document.createElement("div");
      card.className = "split-group-card";
      card.draggable = true;
      card.dataset.groupId = g.id;
      card.innerHTML = `
        <canvas class="split-group-thumb"></canvas>
        <div class="split-group-meta">${g.canvas.width}&times;${g.canvas.height}px</div>
        <label><input type="checkbox" class="split-include" ${g.included ? "checked" : ""}> Include</label>
        <label><input type="radio" name="split-title" class="split-title-radio" ${g.isTitle ? "checked" : ""}> Title</label>
        <input type="text" class="split-filename" value="${escapeHtml(g.filename)}">
      `;
      grid.appendChild(card);

      const thumb = card.querySelector(".split-group-thumb");
      const maxDim = 130;
      const thumbScale = Math.min(1, maxDim / g.canvas.width, maxDim / g.canvas.height);
      thumb.width = Math.max(1, Math.round(g.canvas.width * thumbScale));
      thumb.height = Math.max(1, Math.round(g.canvas.height * thumbScale));
      thumb.getContext("2d").drawImage(g.canvas, 0, 0, thumb.width, thumb.height);

      card.querySelector(".split-include").addEventListener("change", (e) => { g.included = e.target.checked; });
      card.querySelector(".split-title-radio").addEventListener("change", () => {
        s.groups.forEach(other => { other.isTitle = (other.id === g.id); });
      });
      card.querySelector(".split-filename").addEventListener("input", (e) => { g.filename = e.target.value; });

      card.addEventListener("dragstart", () => { s.dragSourceGroupId = g.id; });
      card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drag-over"); });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag-over");
        if (s.dragSourceGroupId == null || s.dragSourceGroupId === g.id) return;
        mergeGroups(s.dragSourceGroupId, g.id);
      });
    });
  }

  // Merges source into target (e.g. drag a stray exit-label card onto the
  // room-cluster card it belongs with) -- target's own filename/include
  // choice wins, source's card disappears. Works for any mix of
  // auto-detected and manually-added groups since both are just a
  // canvas + offset.
  function mergeGroups(sourceId, targetId) {
    const s = splitState;
    const source = s.groups.find(g => g.id === sourceId);
    const target = s.groups.find(g => g.id === targetId);
    if (!source || !target) return;

    const x0 = Math.min(source.x0, target.x0);
    const y0 = Math.min(source.y0, target.y0);
    const x1 = Math.max(source.x0 + source.canvas.width, target.x0 + target.canvas.width);
    const y1 = Math.max(source.y0 + source.canvas.height, target.y0 + target.canvas.height);
    const merged = document.createElement("canvas");
    merged.width = x1 - x0;
    merged.height = y1 - y0;
    const ctx = merged.getContext("2d");
    ctx.drawImage(source.canvas, source.x0 - x0, source.y0 - y0);
    ctx.drawImage(target.canvas, target.x0 - x0, target.y0 - y0);

    target.canvas = merged;
    target.x0 = x0;
    target.y0 = y0;
    if (source.isTitle) target.isTitle = true;
    target.included = target.included || source.included;
    s.groups = s.groups.filter(g => g.id !== sourceId);
    renderGroupsGrid();
  }

  // ---- Split along line ----
  // Draw one freehand line all the way from one edge of the image to
  // another (the brush stroke, tracked in cutMask separately from the
  // image's own transparency), then Split Along Line divides the WHOLE
  // canvas -- background included, not just connected content -- into
  // exactly two pieces using that line as the boundary. This is a single
  // wall-respecting flood fill from a corner, not a scan for every
  // disconnected blob, so it's cheap regardless of how much text/detail is
  // on the piece.
  function splitAlongLine() {
    const s = splitState;
    if (!s) return;
    const w = s.natW, h = s.natH;
    const mask = s.cutMask;

    // Find an unblocked starting corner -- the line could pass close to one.
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    let start = null;
    for (const [cx, cy] of corners) {
      if (!mask[cy * w + cx]) { start = [cx, cy]; break; }
    }
    if (!start) {
      updateStatus("Can't find a starting point -- the line is too close to every corner.");
      return;
    }

    // 4-connected flood fill (not 8) so a single-pixel-thin diagonal wall
    // still blocks the fill instead of leaking through the gap between
    // diagonally-touching pixels.
    const sideA = new Uint8Array(w * h);
    const stackX = new Int32Array(w * h);
    const stackY = new Int32Array(w * h);
    let sp = 0;
    stackX[sp] = start[0]; stackY[sp] = start[1]; sp++;
    sideA[start[1] * w + start[0]] = 1;
    while (sp > 0) {
      sp--;
      const cx = stackX[sp], cy = stackY[sp];
      if (cy > 0) { const i = (cy - 1) * w + cx; if (!sideA[i] && !mask[i]) { sideA[i] = 1; stackX[sp] = cx; stackY[sp] = cy - 1; sp++; } }
      if (cy < h - 1) { const i = (cy + 1) * w + cx; if (!sideA[i] && !mask[i]) { sideA[i] = 1; stackX[sp] = cx; stackY[sp] = cy + 1; sp++; } }
      if (cx > 0) { const i = cy * w + cx - 1; if (!sideA[i] && !mask[i]) { sideA[i] = 1; stackX[sp] = cx - 1; stackY[sp] = cy; sp++; } }
      if (cx < w - 1) { const i = cy * w + cx + 1; if (!sideA[i] && !mask[i]) { sideA[i] = 1; stackX[sp] = cx + 1; stackY[sp] = cy; sp++; } }
    }

    const imageData = s.fullCtx.getImageData(0, 0, w, h);
    const data = imageData.data;

    function buildSide(inSide) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (mask[i] || inSide[i] !== 1) continue;
          if (data[i * 4 + 3] < 10) continue; // only real content counts for the crop box
          any = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      if (!any) return null;
      const margin = 20;
      const x0 = Math.max(0, minX - margin), y0 = Math.max(0, minY - margin);
      const x1 = Math.min(w, maxX + margin + 1), y1 = Math.min(h, maxY + margin + 1);
      const cw = x1 - x0, ch = y1 - y0;
      const out = new ImageData(cw, ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const gidx = (y0 + y) * w + (x0 + x);
          if (mask[gidx] || inSide[gidx] !== 1) continue;
          const oidx = (y * cw + x) * 4;
          out.data[oidx] = data[gidx * 4];
          out.data[oidx + 1] = data[gidx * 4 + 1];
          out.data[oidx + 2] = data[gidx * 4 + 2];
          out.data[oidx + 3] = data[gidx * 4 + 3];
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      canvas.getContext("2d").putImageData(out, 0, 0);
      return { canvas, x0, y0 };
    }

    const resultA = buildSide(sideA);
    // Side B is everything not on side A and not on the wall itself.
    const sideB = new Uint8Array(w * h);
    for (let i = 0; i < sideA.length; i++) sideB[i] = (!sideA[i] && !mask[i]) ? 1 : 0;
    const resultB = buildSide(sideB);

    if (!resultA || !resultB) {
      updateStatus("That line doesn't reach across the piece yet -- draw it all the way from one edge to another.");
      return;
    }

    if (!s.groups) s.groups = [];
    const base = baseNameFor(s.file);
    [resultA, resultB].forEach((r, i) => {
      s.groups.push({
        id: nextGroupId(),
        canvas: r.canvas, x0: r.x0, y0: r.y0,
        included: true,
        isTitle: false,
        filename: `${base} (Part ${s.groups.length + 1}).png`
      });
    });

    // The whole canvas has now been divided into the two pieces above --
    // nothing meaningful is left to keep cutting on this working copy.
    s.fullCtx.clearRect(0, 0, w, h);
    s.cutMask.fill(0);
    s.undoStack = [];
    redrawSplitDisplay();

    document.getElementById("split-final").classList.add("hidden");
    document.getElementById("split-editing-area").classList.remove("hidden");
    document.getElementById("split-results").classList.remove("hidden");
    renderGroupsGrid();
  }

  function finishSplitEditing() {
    const s = splitState;
    if (!s || !s.groups) return;
    const included = s.groups.filter(g => g.included);
    if (included.length === 0) {
      updateStatus("Select at least one piece to include before finishing.");
      return;
    }

    const listEl = document.getElementById("split-final-list");
    listEl.innerHTML = "";
    included.forEach(g => {
      const row = document.createElement("div");
      row.className = "split-final-row";
      row.innerHTML = `<span>${escapeHtml(g.filename || "(unnamed).png")}</span><span class="split-result-meta">${g.canvas.width}&times;${g.canvas.height}px</span>`;
      listEl.appendChild(row);
    });

    document.getElementById("split-editing-area").classList.add("hidden");
    document.getElementById("split-final").classList.remove("hidden");
  }

  function backToSplitEditing() {
    document.getElementById("split-final").classList.add("hidden");
    document.getElementById("split-editing-area").classList.remove("hidden");
  }

  // Draws the title group's own canvas onto a copy of g's canvas (never
  // mutates g.canvas itself, since it's the group's canonical image and may
  // still get merged, previewed, or exported again).
  function finalCanvasFor(g, titleCanvas, titleGroupId) {
    if (!titleCanvas || titleGroupId === g.id) return g.canvas;
    const out = document.createElement("canvas");
    out.width = g.canvas.width;
    out.height = g.canvas.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(g.canvas, 0, 0);
    ctx.drawImage(titleCanvas, 15, 8);
    return out;
  }

  function downloadSplitParts() {
    const s = splitState;
    if (!s || !s.groups) return;
    const titleGroup = s.groups.find(g => g.isTitle);
    const titleCanvas = titleGroup ? titleGroup.canvas : null;

    let delay = 0;
    s.groups.filter(g => g.included).forEach(g => {
      let filename = (g.filename || "").trim();
      if (!filename) return;
      if (!/\.png$/i.test(filename)) filename += ".png";

      const canvas = finalCanvasFor(g, titleCanvas, titleGroup && titleGroup.id);
      setTimeout(() => downloadCanvas(canvas, filename), delay);
      delay += 250;
    });
  }

  // Cuts the piece apart RIGHT NOW in this session: the original is hidden,
  // each kept group becomes its own draggable piece (in-memory data URL, no
  // real file needed) positioned exactly where its content already was, so
  // nothing jumps and you can start dragging groups apart immediately.
  function placeSplitPartsLive() {
    const s = splitState;
    if (!s || !s.groups) return;

    const origEntry = overlaysByFile[s.file];
    if (!origEntry) {
      updateStatus("Couldn't place split -- original piece isn't on the map anymore.");
      return;
    }
    const nw = origEntry.overlay.getBounds().getNorthWest();
    const origWorldX = Math.round(nw.lng);
    const origWorldY = Math.round(-nw.lat);

    const titleGroup = s.groups.find(g => g.isTitle);
    const titleCanvas = titleGroup ? titleGroup.canvas : null;

    const virtual = loadVirtualPieces(s.realm);
    const hidden = loadHiddenOriginals(s.realm);
    const layout = loadLayoutFromStorage(s.realm) || {};
    let placedCount = 0;

    s.groups.filter(g => g.included).forEach(g => {
      let filename = (g.filename || "").trim();
      if (!filename) return;
      if (!/\.png$/i.test(filename)) filename += ".png";

      const canvas = finalCanvasFor(g, titleCanvas, titleGroup && titleGroup.id);
      virtual[filename] = { width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL("image/png") };
      layout[filename] = { x: origWorldX + g.x0, y: origWorldY + g.y0 };
      placedCount++;
    });

    // Retire the original -- both as a real/previously-virtual piece and
    // from the saved layout, so it doesn't also keep rendering underneath.
    hidden.add(s.file);
    delete virtual[s.file];
    delete layout[s.file];

    saveHiddenOriginals(s.realm, hidden);
    const stored = saveVirtualPieces(s.realm, virtual);
    saveLayoutToStorage(s.realm, layout);

    closeSplitModal();
    renderRealm(s.realm, layout);

    if (!stored) {
      updateStatus(`Placed ${placedCount} parts, but local storage is full so they won't survive a reload -- use "Download Parts" to save them for real.`);
    } else {
      updateStatus(`Split into ${placedCount} parts -- drag them into place, then Save as usual.`);
    }
  }

  function renderRealm(realm, layoutOverride) {
    currentRealm = realm;
    pieceLayerGroup.clearLayers();
    overlaysByFile = {};
    endActiveDrag();

    const pieces = effectivePieces(realm);
    const virtual = loadVirtualPieces(realm);
    const saved = layoutOverride || loadLayoutFromStorage(realm) || REALM_SEED_LAYOUT[realm] || {};
    const grid = gridLayoutFor(realm);

    pieces.forEach(piece => {
      const pos = saved[piece.file] || grid[piece.file] || { x: 0, y: 0 };
      const bounds = boundsForPiece(pos, piece);

      const src = piece.isVirtual ? virtual[piece.file].dataUrl : `pieces/${realm}/${encodeURIComponent(piece.file)}`;
      const overlay = L.imageOverlay(src, bounds, { interactive: true });
      pieceLayerGroup.addLayer(overlay);

      const label = L.marker(bounds.getNorthWest(), { icon: labelIcon(piece.file), interactive: false });
      pieceLayerGroup.addLayer(label);

      attachDragHandlers(overlay, label, piece.file);
      overlaysByFile[piece.file] = { overlay, label };
    });

    if (pieceLayerGroup.getLayers().length > 0) {
      map.fitBounds(pieceLayerGroup.getBounds(), { padding: [80, 80], animate: false });
    }

    updateStatus(`${pieces.length} pieces loaded for ${realm}.`);
  }

  function updateStatus(msg) {
    document.getElementById("builder-status").textContent = msg;
  }

  function formatLayoutFileAllRealms() {
    const data = {};
    REALMS.forEach(r => {
      data[r] = r === currentRealm ? currentLayout() : (loadLayoutFromStorage(r) || {});
    });
    const lines = [];
    lines.push("const REALM_LAYOUTS = {");
    REALMS.forEach(r => {
      const entries = Object.entries(data[r]);
      lines.push(`  ${r}: [`);
      entries.forEach(([file, pos]) => {
        lines.push(`    { file: ${JSON.stringify(file)}, x: ${Math.round(pos.x)}, y: ${Math.round(pos.y)} },`);
      });
      lines.push("  ],");
    });
    lines.push("};");
    return lines.join("\n") + "\n";
  }

  function copyToClipboard(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => onDone && onDone(true),
        () => onDone && onDone(false)
      );
      return;
    }
    onDone && onDone(false);
  }

  function flashButton(btn, label) {
    const original = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  function initBuilder() {
    if (initialized) return;
    initialized = true;

    map = L.map("map", {
      crs: L.CRS.Simple,
      // Effectively unbounded in both directions -- these room-grid pieces
      // get arranged edge-to-edge into a full realm map, which can end up
      // far larger than any fixed zoom floor would comfortably show.
      minZoom: -20,
      maxZoom: 10,
      // zoomDelta controls how far each scroll-notch/+-click actually
      // moves (kept at a full level so reaching -20 takes ~17 steps, not
      // ~170); zoomSnap only rounds the final resting zoom for crisp
      // rendering, matching the main site's already-proven feel.
      zoomSnap: 0.25,
      zoomDelta: 1,
      attributionControl: false
    });
    map.setView([0, 0], -3);

    pieceLayerGroup = L.featureGroup().addTo(map);

    map.on("mousemove", (e) => {
      if (!activeDrag) return;
      const dx = e.latlng.lng - activeDrag.startLatLng.lng;
      const dy = e.latlng.lat - activeDrag.startLatLng.lat;
      const b = activeDrag.startBounds;
      const newBounds = L.latLngBounds(
        [b.getSouth() + dy, b.getWest() + dx],
        [b.getNorth() + dy, b.getEast() + dx]
      );
      activeDrag.overlay.setBounds(newBounds);
      activeDrag.label.setLatLng(newBounds.getNorthWest());
    });
    map.on("mouseup", endActiveDrag);
    map.getContainer().addEventListener("mouseleave", endActiveDrag);

    document.getElementById("realm-select").addEventListener("change", (e) => {
      renderRealm(e.target.value);
    });

    document.getElementById("save-btn").addEventListener("click", () => {
      saveLayoutToStorage(currentRealm, currentLayout());
      updateStatus(`Saved ${Object.keys(overlaysByFile).length} piece positions for ${currentRealm}.`);
    });

    document.getElementById("load-btn").addEventListener("click", () => {
      const saved = loadLayoutFromStorage(currentRealm);
      if (!saved) {
        updateStatus(`No saved layout for ${currentRealm} yet.`);
        return;
      }
      renderRealm(currentRealm, saved);
      updateStatus(`Loaded last save for ${currentRealm}.`);
    });

    document.getElementById("complete-btn").addEventListener("click", () => {
      const layout = currentLayout();
      saveLayoutToStorage(currentRealm, layout);
      localStorage.setItem("realmBuilderComplete_" + currentRealm, "1");
      updateStatus(`${currentRealm} marked complete and saved (${Object.keys(layout).length} pieces). Use "Copy Layout Data" to export.`);
    });

    document.getElementById("export-btn").addEventListener("click", (e) => {
      const text = formatLayoutFileAllRealms();
      copyToClipboard(text, (ok) => flashButton(e.target, ok ? "Copied!" : "Copy failed"));
    });

    document.getElementById("fit-all-btn").addEventListener("click", () => {
      if (pieceLayerGroup.getLayers().length > 0) {
        map.fitBounds(pieceLayerGroup.getBounds(), { padding: [80, 80], animate: false });
      }
    });

    document.getElementById("split-mode-btn").addEventListener("click", (e) => {
      splitMode = !splitMode;
      e.target.classList.toggle("active", splitMode);
    });

    document.getElementById("split-close-btn").addEventListener("click", closeSplitModal);

    (function initSplitCanvasEvents() {
      const canvas = document.getElementById("split-canvas");
      let last = null;
      canvas.addEventListener("mousedown", (e) => {
        if (!splitState) return;
        e.preventDefault();
        splitState.undoStack.push({
          imageData: splitState.fullCtx.getImageData(0, 0, splitState.natW, splitState.natH),
          cutMask: Uint8Array.from(splitState.cutMask)
        });
        splitState.drawing = true;
        last = splitCanvasPoint(e);
        eraseAt(last[0], last[1], splitState.brushSize);
        redrawSplitDisplay();
      });
      // On window, not canvas -- dragging toward an edge very easily carries
      // the cursor a little past the canvas element's own bounds, and a
      // canvas-scoped listener simply stops receiving events at that point,
      // cutting the stroke short right when you need it to reach the edge.
      window.addEventListener("mousemove", (e) => {
        if (!splitState || !splitState.drawing) return;
        const p = splitCanvasPoint(e);
        eraseStroke(last[0], last[1], p[0], p[1], splitState.brushSize);
        last = p;
        redrawSplitDisplay();
      });
      window.addEventListener("mouseup", () => {
        if (splitState) splitState.drawing = false;
      });
    })();

    document.getElementById("split-brush-size").addEventListener("input", (e) => {
      if (splitState) splitState.brushSize = parseInt(e.target.value, 10);
    });

    document.getElementById("split-undo-btn").addEventListener("click", undoSplitStroke);

    // Ctrl/Cmd+Z undoes the last stroke while the split modal is open --
    // but not while typing in one of its own text/number fields (a
    // filename box, the min-region-size field), where Z should just be a
    // letter and native undo should behave normally.
    document.addEventListener("keydown", (e) => {
      if (!splitState) return;
      if (document.getElementById("split-modal").classList.contains("hidden")) return;
      const key = e.key.toLowerCase();
      if (!(key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey)) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      undoSplitStroke();
    });

    document.getElementById("split-clear-btn").addEventListener("click", () => {
      if (!splitState) return;
      splitState.fullCtx.clearRect(0, 0, splitState.natW, splitState.natH);
      splitState.fullCtx.drawImage(splitState.img, 0, 0);
      splitState.cutMask.fill(0);
      splitState.undoStack = [];
      splitState.groups = null;
      document.getElementById("split-results").classList.add("hidden");
      document.getElementById("split-groups-grid").innerHTML = "";
      redrawSplitDisplay();
    });

    document.getElementById("split-line-btn").addEventListener("click", splitAlongLine);

    document.getElementById("split-zoom-in-btn").addEventListener("click", () => {
      if (splitState) applyZoom(splitState.zoom * 1.25);
    });
    document.getElementById("split-zoom-out-btn").addEventListener("click", () => {
      if (splitState) applyZoom(splitState.zoom / 1.25);
    });
    document.getElementById("split-zoom-fit-btn").addEventListener("click", () => {
      if (splitState) applyZoom(1);
    });

    document.getElementById("split-analyze-btn").addEventListener("click", (e) => {
      if (!splitState) return;
      const original = e.target.textContent;
      e.target.textContent = "Analyzing...";
      e.target.disabled = true;
      setTimeout(() => {
        runSplitAnalysis();
        e.target.textContent = original;
        e.target.disabled = false;
      }, 20);
    });

    document.getElementById("split-clear-title-btn").addEventListener("click", () => {
      if (!splitState || !splitState.groups) return;
      splitState.groups.forEach(g => { g.isTitle = false; });
      renderGroupsGrid();
    });

    document.getElementById("split-finish-btn").addEventListener("click", finishSplitEditing);
    document.getElementById("split-back-btn").addEventListener("click", backToSplitEditing);

    document.getElementById("split-place-btn").addEventListener("click", placeSplitPartsLive);
    document.getElementById("split-download-btn").addEventListener("click", downloadSplitParts);

    renderRealm(currentRealm);
  }

  loadDevSession();
  if (devSession) showBuilder();
})();
