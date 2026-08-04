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

      const maxW = Math.min(window.innerWidth * 0.86, 900);
      const maxH = Math.min(window.innerHeight * 0.5, 620);
      const scale = Math.min(1, maxW / natW, maxH / natH);

      const displayCanvas = document.getElementById("split-canvas");
      displayCanvas.width = Math.round(natW * scale);
      displayCanvas.height = Math.round(natH * scale);
      const displayCtx = displayCanvas.getContext("2d");

      splitState = {
        realm, file, img, fullCanvas, fullCtx, displayCanvas, displayCtx, scale, natW, natH,
        drawing: false, undoStack: [],
        brushSize: parseInt(document.getElementById("split-brush-size").value, 10),
        labels: null, components: null
      };

      redrawSplitDisplay();
      document.getElementById("split-piece-name").textContent = `${baseNameFor(file)} (${realm})`;
      document.getElementById("split-results").classList.add("hidden");
      document.getElementById("split-results-list").innerHTML = "";
      // Default noise floor scales with image area -- a fixed pixel count
      // either floods text-heavy pieces with individual letter fragments or
      // discards real content on small pieces. Editable since it's a guess.
      document.getElementById("split-min-size").value = Math.max(150, Math.round(natW * natH * 0.0015));
      document.getElementById("split-modal").classList.remove("hidden");
    };
    img.src = isVirtual ? virtual[file].dataUrl : `pieces/${realm}/${encodeURIComponent(file)}`;
  }

  function closeSplitModal() {
    document.getElementById("split-modal").classList.add("hidden");
    splitState = null;
  }

  function splitCanvasPoint(e) {
    const rect = splitState.displayCanvas.getBoundingClientRect();
    return [(e.clientX - rect.left) / splitState.scale, (e.clientY - rect.top) / splitState.scale];
  }

  function eraseAt(x, y, radius) {
    const ctx = splitState.fullCtx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

  function cropComponent(c, margin) {
    const s = splitState;
    const x0 = Math.max(0, c.minX - margin);
    const y0 = Math.max(0, c.minY - margin);
    const x1 = Math.min(s.natW, c.maxX + margin + 1);
    const y1 = Math.min(s.natH, c.maxY + margin + 1);
    const w = x1 - x0, h = y1 - y0;

    const srcData = s.fullCtx.getImageData(x0, y0, w, h);
    const out = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gidx = (y0 + y) * s.natW + (x0 + x);
        if (s.labels[gidx] !== c.id) continue;
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
    return canvas;
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

  function runSplitAnalysis() {
    const s = splitState;
    const imageData = s.fullCtx.getImageData(0, 0, s.natW, s.natH);
    const { labels, components } = findComponents(imageData, s.natW, s.natH);
    const minSize = Math.max(1, parseInt(document.getElementById("split-min-size").value, 10) || 150);
    const kept = components.filter(c => c.count >= minSize).sort((a, b) => b.count - a.count);
    s.labels = labels;
    s.components = kept;

    const titleGuess = detectTitleComponent(kept, s.natH);
    const base = baseNameFor(s.file);

    const listEl = document.getElementById("split-results-list");
    listEl.innerHTML = "";
    kept.forEach((c, i) => {
      const w = c.maxX - c.minX + 1, h = c.maxY - c.minY + 1;
      const isTitleGuess = titleGuess && c.id === titleGuess.id;
      const row = document.createElement("div");
      row.className = "split-result-row";
      row.innerHTML = `
        <label><input type="checkbox" class="split-include" data-id="${c.id}" ${isTitleGuess ? "" : "checked"}> Part</label>
        <label><input type="radio" name="split-title" class="split-title-radio" data-id="${c.id}" ${isTitleGuess ? "checked" : ""}> Title</label>
        <span class="split-result-meta">${w}&times;${h}px, ${c.count.toLocaleString()}px</span>
        <input type="text" class="split-filename" value="${escapeHtml(`${base} (Part ${i + 1}).png`)}">
      `;
      listEl.appendChild(row);
    });
    const noTitleRow = document.createElement("div");
    noTitleRow.className = "split-result-row";
    noTitleRow.innerHTML = `<label><input type="radio" name="split-title" class="split-title-radio" data-id="0" ${titleGuess ? "" : "checked"}> No title overlay on the other parts</label>`;
    listEl.appendChild(noTitleRow);

    document.getElementById("split-results").classList.remove("hidden");
  }

  function downloadSplitParts() {
    const s = splitState;
    if (!s || !s.components) return;
    const titleRadio = document.querySelector(".split-title-radio:checked");
    const titleId = titleRadio ? parseInt(titleRadio.dataset.id, 10) : 0;
    let titleCanvas = null;
    if (titleId) {
      const titleComp = s.components.find(c => c.id === titleId);
      if (titleComp) titleCanvas = cropComponent(titleComp, 6);
    }

    let delay = 0;
    document.querySelectorAll(".split-result-row").forEach(row => {
      const checkbox = row.querySelector(".split-include");
      if (!checkbox || !checkbox.checked) return;
      const id = parseInt(checkbox.dataset.id, 10);
      const comp = s.components.find(c => c.id === id);
      if (!comp) return;
      const filenameInput = row.querySelector(".split-filename");
      let filename = filenameInput.value.trim();
      if (!filename) return;
      if (!/\.png$/i.test(filename)) filename += ".png";

      const canvas = cropComponent(comp, 30);
      if (titleCanvas && titleId !== id) {
        canvas.getContext("2d").drawImage(titleCanvas, 15, 8);
      }
      setTimeout(() => downloadCanvas(canvas, filename), delay);
      delay += 250;
    });
  }

  // Cuts the piece apart RIGHT NOW in this session: the original is hidden,
  // each kept region becomes its own draggable piece (in-memory data URL,
  // no real file needed) positioned exactly where its content already was,
  // so nothing jumps and you can start dragging groups apart immediately.
  function placeSplitPartsLive() {
    const s = splitState;
    if (!s || !s.components) return;

    const origEntry = overlaysByFile[s.file];
    if (!origEntry) {
      updateStatus("Couldn't place split -- original piece isn't on the map anymore.");
      return;
    }
    const nw = origEntry.overlay.getBounds().getNorthWest();
    const origWorldX = Math.round(nw.lng);
    const origWorldY = Math.round(-nw.lat);

    const titleRadio = document.querySelector(".split-title-radio:checked");
    const titleId = titleRadio ? parseInt(titleRadio.dataset.id, 10) : 0;
    let titleCanvas = null;
    if (titleId) {
      const titleComp = s.components.find(c => c.id === titleId);
      if (titleComp) titleCanvas = cropComponent(titleComp, 6);
    }

    const virtual = loadVirtualPieces(s.realm);
    const hidden = loadHiddenOriginals(s.realm);
    const layout = loadLayoutFromStorage(s.realm) || {};
    const margin = 30;
    let placedCount = 0;

    document.querySelectorAll(".split-result-row").forEach(row => {
      const checkbox = row.querySelector(".split-include");
      if (!checkbox || !checkbox.checked) return;
      const id = parseInt(checkbox.dataset.id, 10);
      const comp = s.components.find(c => c.id === id);
      if (!comp) return;
      const filenameInput = row.querySelector(".split-filename");
      let filename = filenameInput.value.trim();
      if (!filename) return;
      if (!/\.png$/i.test(filename)) filename += ".png";

      const x0 = Math.max(0, comp.minX - margin);
      const y0 = Math.max(0, comp.minY - margin);
      const canvas = cropComponent(comp, margin);
      if (titleCanvas && titleId !== id) {
        canvas.getContext("2d").drawImage(titleCanvas, 15, 8);
      }

      virtual[filename] = { width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL("image/png") };
      layout[filename] = { x: origWorldX + x0, y: origWorldY + y0 };
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
        splitState.undoStack.push(splitState.fullCtx.getImageData(0, 0, splitState.natW, splitState.natH));
        splitState.drawing = true;
        last = splitCanvasPoint(e);
        eraseAt(last[0], last[1], splitState.brushSize);
        redrawSplitDisplay();
      });
      canvas.addEventListener("mousemove", (e) => {
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

    document.getElementById("split-undo-btn").addEventListener("click", () => {
      if (!splitState || splitState.undoStack.length === 0) return;
      splitState.fullCtx.putImageData(splitState.undoStack.pop(), 0, 0);
      redrawSplitDisplay();
    });

    document.getElementById("split-clear-btn").addEventListener("click", () => {
      if (!splitState) return;
      splitState.fullCtx.clearRect(0, 0, splitState.natW, splitState.natH);
      splitState.fullCtx.drawImage(splitState.img, 0, 0);
      splitState.undoStack = [];
      redrawSplitDisplay();
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

    document.getElementById("split-place-btn").addEventListener("click", placeSplitPartsLive);
    document.getElementById("split-download-btn").addEventListener("click", downloadSplitParts);

    renderRealm(currentRealm);
  }

  loadDevSession();
  if (devSession) showBuilder();
})();
