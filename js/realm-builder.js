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

  function gridLayoutFor(realm) {
    const pieces = REALM_PIECES[realm] || [];
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
  function attachDragHandlers(overlay, label) {
    const el = overlay.getElement();
    if (!el) return;
    el.classList.add("realm-piece-img");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
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

  function renderRealm(realm, layoutOverride) {
    currentRealm = realm;
    pieceLayerGroup.clearLayers();
    overlaysByFile = {};
    endActiveDrag();

    const pieces = REALM_PIECES[realm] || [];
    const saved = layoutOverride || loadLayoutFromStorage(realm) || {};
    const grid = gridLayoutFor(realm);

    pieces.forEach(piece => {
      const pos = saved[piece.file] || grid[piece.file] || { x: 0, y: 0 };
      const bounds = boundsForPiece(pos, piece);

      const overlay = L.imageOverlay(`pieces/${realm}/${encodeURIComponent(piece.file)}`, bounds, { interactive: true });
      pieceLayerGroup.addLayer(overlay);

      const label = L.marker(bounds.getNorthWest(), { icon: labelIcon(piece.file), interactive: false });
      pieceLayerGroup.addLayer(label);

      attachDragHandlers(overlay, label);
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

    renderRealm(currentRealm);
  }

  loadDevSession();
  if (devSession) showBuilder();
})();
