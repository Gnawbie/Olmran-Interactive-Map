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
  let markersByFile = {};

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

  function currentLayout() {
    const layout = {};
    Object.entries(markersByFile).forEach(([file, marker]) => {
      const latlng = marker.getLatLng();
      layout[file] = { x: Math.round(latlng.lng), y: Math.round(-latlng.lat) };
    });
    return layout;
  }

  function pieceIcon(file, piece) {
    return L.divIcon({
      className: "",
      html: `<div class="realm-piece">` +
        `<div class="realm-piece-label">${escapeHtml(file.replace(/\.png$/i, ""))}</div>` +
        `<img src="pieces/${currentRealm}/${encodeURIComponent(file)}" width="${piece.width}" height="${piece.height}">` +
        `</div>`,
      iconSize: [piece.width, piece.height],
      iconAnchor: [0, 0]
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderRealm(realm, layoutOverride) {
    currentRealm = realm;
    pieceLayerGroup.clearLayers();
    markersByFile = {};

    const pieces = REALM_PIECES[realm] || [];
    const saved = layoutOverride || loadLayoutFromStorage(realm) || {};
    const grid = gridLayoutFor(realm);

    pieces.forEach(piece => {
      const pos = saved[piece.file] || grid[piece.file] || { x: 0, y: 0 };
      const marker = L.marker([-pos.y, pos.x], {
        icon: pieceIcon(piece.file, piece),
        draggable: true
      });
      pieceLayerGroup.addLayer(marker);
      markersByFile[piece.file] = marker;
    });

    if (pieceLayerGroup.getLayers().length > 0) {
      map.fitBounds(pieceLayerGroup.getBounds(), { padding: [80, 80] });
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
      zoomSnap: 0.1,
      wheelPxPerZoomLevel: 90,
      attributionControl: false
    });
    map.setView([0, 0], -3);

    pieceLayerGroup = L.featureGroup().addTo(map);

    document.getElementById("realm-select").addEventListener("change", (e) => {
      renderRealm(e.target.value);
    });

    document.getElementById("save-btn").addEventListener("click", () => {
      saveLayoutToStorage(currentRealm, currentLayout());
      updateStatus(`Saved ${Object.keys(markersByFile).length} piece positions for ${currentRealm}.`);
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
        map.fitBounds(pieceLayerGroup.getBounds(), { padding: [80, 80] });
      }
    });

    renderRealm(currentRealm);
  }

  loadDevSession();
  if (devSession) showBuilder();
})();
