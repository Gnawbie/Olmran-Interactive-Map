(function () {
  "use strict";

  const layersById = Object.fromEntries(MAP_LAYERS.map(l => [l.id, l]));
  let currentLayerId = MAP_LAYERS[0].id;
  let imageOverlay = null;
  let markerLayerGroup = L.layerGroup();
  let amenityLayerGroup = L.layerGroup();
  let devPickerActive = false;
  const devPoints = [];
  const activeTypeFilters = new Set();
  let recenterTargetName = "";
  const modifiedZoneNames = new Set();

  const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -5,
    maxZoom: 3,
    zoomSnap: 0.25,
    attributionControl: false
  });

  // Leaflet's CRS.Simple projects increasing latitude as "up" on screen (like
  // true north), but our image's y coordinate increases downward (row 0 = top).
  // Negating y when converting to/from lat/lng makes north-up match image-down,
  // so row 0 renders at the top of the map instead of the bottom.
  function boundsForLayer(layer) {
    return [[-layer.height, 0], [0, layer.width]];
  }

  function xyToLatLng(x, y) {
    return L.latLng(-y, x);
  }

  function latLngToXY(latlng) {
    return { x: Math.round(latlng.lng), y: Math.round(-latlng.lat) };
  }

  function clampToLayerBounds(layerId, x, y) {
    const layer = layersById[layerId];
    if (!layer) return { x, y };
    return {
      x: Math.min(Math.max(0, x), layer.width),
      y: Math.min(Math.max(0, y), layer.height)
    };
  }

  function loadLayer(layerId, { preserveView } = {}) {
    const layer = layersById[layerId];
    if (!layer) return;
    currentLayerId = layerId;

    const bounds = boundsForLayer(layer);
    const prevCenter = preserveView ? map.getCenter() : null;
    const prevZoom = preserveView ? map.getZoom() : null;

    if (imageOverlay) map.removeLayer(imageOverlay);
    imageOverlay = L.imageOverlay(layer.image, bounds);
    imageOverlay.addTo(map);
    map.setMaxBounds([
      [bounds[0][0] - 500, bounds[0][1] - 500],
      [bounds[1][0] + 500, bounds[1][1] + 500]
    ]);

    if (preserveView && prevCenter) {
      map.setView(prevCenter, prevZoom);
    } else {
      map.fitBounds(bounds);
    }

    renderMarkers();
    renderAmenityBadges();
  }

  function markerIcon(type) {
    const label = (type || "?").charAt(0).toUpperCase();
    return L.divIcon({
      className: "",
      html: `<div class="marker-pin"><span>${label}</span></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 26],
      popupAnchor: [0, -24]
    });
  }

  function popupHtml(item) {
    return `<div class="map-popup">
      <span class="p-type">${item.type || "marker"}</span>
      <h3>${item.name}</h3>
      ${item.description ? `<p>${item.description}</p>` : ""}
    </div>`;
  }

  function allTypes() {
    return Array.from(new Set(MARKERS.map(m => m.type).filter(Boolean))).sort();
  }

  function renderFilterChips() {
    const wrap = document.getElementById("filter-wrap");
    wrap.innerHTML = "";
    allTypes().forEach(type => {
      const chip = document.createElement("div");
      chip.className = "filter-chip" + (activeTypeFilters.has(type) ? " active" : "");
      chip.textContent = type;
      chip.addEventListener("click", () => {
        if (activeTypeFilters.has(type)) activeTypeFilters.delete(type);
        else activeTypeFilters.add(type);
        renderFilterChips();
        renderMarkers();
      });
      wrap.appendChild(chip);
    });
  }

  function renderMarkers() {
    markerLayerGroup.clearLayers();
    MARKERS
      .filter(m => m.layer === currentLayerId)
      .filter(m => activeTypeFilters.size === 0 || activeTypeFilters.has(m.type))
      .forEach(m => {
        const marker = L.marker(xyToLatLng(m.x, m.y), { icon: markerIcon(m.type) });
        marker.bindPopup(popupHtml(m));
        markerLayerGroup.addLayer(marker);
      });
    markerLayerGroup.addTo(map);
  }

  // ---- Zone amenity badges ----
  function amenityDef(id) {
    return AMENITY_TYPES.find(a => a.id === id);
  }

  function amenityBadgeIcon(amenityIds) {
    const badges = amenityIds
      .map(id => amenityDef(id))
      .filter(Boolean)
      .map(def => `<span class="amenity-badge" style="background:${def.color}">${def.symbol}</span>`)
      .join("");
    return L.divIcon({
      className: "",
      html: `<div class="amenity-badge-row">${badges}</div>`,
      iconSize: [140, 24],
      iconAnchor: [70, 34]
    });
  }

  function amenityPointIcon(id) {
    const def = amenityDef(id);
    return L.divIcon({
      className: "",
      html: `<span class="amenity-badge" style="background:${def ? def.color : "#999"}">${def ? def.symbol : "?"}</span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 26]
    });
  }

  function renderAmenityBadges() {
    amenityLayerGroup.clearLayers();
    Object.entries(ZONE_AMENITIES).forEach(([zoneName, amenityIds]) => {
      const zone = findZoneByName(zoneName);
      if (!zone || zone.layer !== currentLayerId || amenityIds.length === 0) return;
      const marker = L.marker(xyToLatLng(zone.x, zone.y), { icon: amenityBadgeIcon(amenityIds) });
      const labels = amenityIds.map(id => amenityDef(id)).filter(Boolean).map(def => def.label).join(", ");
      marker.bindPopup(`<div class="map-popup"><h3>${zoneName}</h3><p>${labels}</p></div>`);
      amenityLayerGroup.addLayer(marker);
    });

    AMENITY_POINTS
      .filter(p => p.layer === currentLayerId)
      .forEach(p => {
        const def = amenityDef(p.type);
        const marker = L.marker(xyToLatLng(p.x, p.y), { icon: amenityPointIcon(p.type) });
        const content = document.createElement("div");
        content.className = "map-popup";
        content.innerHTML = `<h3>${def ? def.label : p.type}</h3><p>x:${p.x} y:${p.y}</p>`;
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.className = "amenity-point-remove";
        removeBtn.addEventListener("click", () => {
          const idx = AMENITY_POINTS.indexOf(p);
          if (idx !== -1) AMENITY_POINTS.splice(idx, 1);
          renderAmenityBadges();
          updateTagStatus();
        });
        content.appendChild(removeBtn);
        marker.bindPopup(content);
        amenityLayerGroup.addLayer(marker);
      });

    amenityLayerGroup.addTo(map);
  }

  // ---- Dev: drag-and-drop amenity tagging ----
  function renderAmenityPalette() {
    const wrap = document.getElementById("dev-amenity-palette");
    wrap.innerHTML = "";
    AMENITY_TYPES.forEach(def => {
      const chip = document.createElement("div");
      chip.className = "amenity-drag-chip";
      chip.draggable = true;
      chip.style.background = def.color;
      chip.innerHTML = `<span class="chip-symbol">${def.symbol}</span><span>${def.label}</span>`;
      chip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", def.id);
        e.dataTransfer.effectAllowed = "copy";
      });
      wrap.appendChild(chip);
    });
  }

  function updateTagStatus(message) {
    document.getElementById("dev-tag-status").textContent = message || `${AMENITY_POINTS.length} point(s) tagged this session`;
  }

  function formatAmenityPointsFile(points) {
    const lines = points.map(p => {
      const fields = [`type: ${JSON.stringify(p.type)}`, `layer: ${JSON.stringify(p.layer)}`, `x: ${Math.round(p.x)}`, `y: ${Math.round(p.y)}`];
      return `  { ${fields.join(", ")} }`;
    });
    return `const AMENITY_POINTS = [\n${lines.join(",\n")}\n];\n`;
  }

  function renderAmenityLegend() {
    const wrap = document.getElementById("amenity-legend");
    wrap.innerHTML = "";
    AMENITY_TYPES.forEach(def => {
      const row = document.createElement("div");
      row.className = "amenity-legend-row";
      row.innerHTML = `<span class="amenity-badge" style="background:${def.color}">${def.symbol}</span><span>${def.label}</span>`;
      wrap.appendChild(row);
    });
  }

  function renderZoneSelect() {
    const select = document.getElementById("zone-select");
    const sorted = [...ZONES].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach(zone => {
      const opt = document.createElement("option");
      opt.value = zone.name;
      opt.textContent = zone.name;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      if (!select.value) return;
      const zone = sorted.find(z => z.name === select.value);
      if (zone) goTo(zone);
      select.value = "";
    });
  }

  function renderLayerSelect() {
    const select = document.getElementById("layer-select");
    select.innerHTML = "";
    MAP_LAYERS.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.name;
      select.appendChild(opt);
    });
    select.value = currentLayerId;
    select.addEventListener("change", () => loadLayer(select.value));
  }

  function flashAt(x, y) {
    const circle = L.circleMarker(xyToLatLng(x, y), {
      className: "zone-flash",
      radius: 40
    }).addTo(map);
    let r = 40;
    const grow = setInterval(() => {
      r += 18;
      circle.setRadius(r);
      circle.setStyle({ opacity: Math.max(0, 1 - r / 220), fillOpacity: Math.max(0, 0.2 - r / 1100) });
      if (r > 220) {
        clearInterval(grow);
        map.removeLayer(circle);
      }
    }, 30);
  }

  function goTo(item) {
    if (item.layer !== currentLayerId) {
      loadLayer(item.layer);
    }
    map.setView(xyToLatLng(item.x, item.y), Math.max(map.getZoom(), 0));
    flashAt(item.x, item.y);
    if (item._marker) item._marker.openPopup();
  }

  // ---- Shareable view links ----
  // A link like ?layer=land-of-kaid&x=1234&y=567&z=1 pans/zooms straight to that spot on load.
  function buildViewLink(layer, x, y, zoom) {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("layer", layer);
    url.searchParams.set("x", Math.round(x));
    url.searchParams.set("y", Math.round(y));
    url.searchParams.set("z", zoom);
    return url.toString();
  }

  function copyViaExecCommand(text) {
    const tmp = document.createElement("textarea");
    tmp.value = text;
    tmp.style.position = "fixed";
    tmp.style.opacity = "0";
    document.body.appendChild(tmp);
    tmp.focus();
    tmp.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(tmp);
    return ok;
  }

  function copyToClipboard(text, onDone) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        () => onDone && onDone(true),
        () => onDone && onDone(copyViaExecCommand(text))
      );
      return;
    }
    onDone && onDone(copyViaExecCommand(text));
  }

  function flashButton(btn, label) {
    const original = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  // ---- Draggable panels ----
  function makeDraggable(panel, handle, storageKey) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    function clamp(value, max) {
      return Math.min(Math.max(0, value), Math.max(0, max));
    }

    function applyPosition(left, top) {
      const maxLeft = window.innerWidth - panel.offsetWidth;
      const maxTop = window.innerHeight - panel.offsetHeight;
      panel.style.left = `${clamp(left, maxLeft)}px`;
      panel.style.top = `${clamp(top, maxTop)}px`;
      panel.style.right = "auto";
    }

    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const { left, top } = JSON.parse(saved);
          applyPosition(left, top);
        } catch (e) { /* ignore malformed saved position */ }
      }
    }

    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      panel.classList.add("dragging");
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      applyPosition(e.clientX - offsetX, e.clientY - offsetY);
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("dragging");
      if (storageKey) {
        const rect = panel.getBoundingClientRect();
        localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
      }
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  function applyViewFromUrl() {
    const params = new URLSearchParams(location.search);
    const layer = params.get("layer");
    const x = parseFloat(params.get("x"));
    const y = parseFloat(params.get("y"));
    const z = params.get("z") !== null ? parseFloat(params.get("z")) : NaN;
    if (!layer || !layersById[layer] || Number.isNaN(x) || Number.isNaN(y)) return false;
    loadLayer(layer);
    map.setView(xyToLatLng(x, y), Number.isNaN(z) ? map.getZoom() : z);
    flashAt(x, y);
    return true;
  }

  // ---- Search ----
  function searchIndex() {
    const zoneEntries = ZONES.map(z => ({ ...z, kind: "zone" }));
    const markerEntries = MARKERS.map(m => ({ ...m, kind: "marker" }));
    return zoneEntries.concat(markerEntries);
  }

  function runSearch(query) {
    const q = query.trim().toLowerCase();
    const resultsEl = document.getElementById("search-results");
    resultsEl.innerHTML = "";
    if (!q) {
      resultsEl.classList.remove("visible");
      return;
    }
    const matches = searchIndex()
      .filter(item => item.name.toLowerCase().includes(q))
      .slice(0, 25);

    if (matches.length === 0) {
      resultsEl.classList.remove("visible");
      return;
    }

    matches.forEach(item => {
      const row = document.createElement("div");
      row.className = "search-result";
      row.innerHTML = `${item.name}<span class="r-type">${item.kind === "zone" ? "zone" : (item.type || "marker")}</span>`;
      row.addEventListener("click", () => {
        goTo(item);
        resultsEl.classList.remove("visible");
        document.getElementById("search-box").value = item.name;
      });
      resultsEl.appendChild(row);
    });
    resultsEl.classList.add("visible");
  }

  // ---- Dev coordinate picker ----
  function updateDevOutput() {
    document.getElementById("dev-output").value = JSON.stringify(devPoints, null, 2);
  }

  function renderDevPoints() {
    const wrap = document.getElementById("dev-points");
    wrap.innerHTML = "";
    if (devPoints.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dev-point-empty";
      empty.textContent = "Click the map to pick a coordinate.";
      wrap.appendChild(empty);
      return;
    }
    devPoints.forEach((pt, i) => {
      const row = document.createElement("div");
      row.className = "dev-point-row";

      const coords = document.createElement("span");
      coords.className = "dev-point-coords";
      coords.textContent = `x:${pt.x} y:${pt.y}`;

      const flyBtn = document.createElement("button");
      flyBtn.textContent = "Fly To";
      flyBtn.addEventListener("click", () => goTo(pt));

      const linkBtn = document.createElement("button");
      linkBtn.textContent = "Copy Link";
      linkBtn.addEventListener("click", () => {
        const link = buildViewLink(pt.layer, pt.x, pt.y, map.getZoom());
        copyToClipboard(link, (ok) => flashButton(linkBtn, ok ? "Copied!" : "Copy failed"));
      });

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        devPoints.splice(i, 1);
        renderDevPoints();
        updateDevOutput();
      });

      row.append(coords, flyBtn, linkBtn, removeBtn);
      wrap.appendChild(row);
    });
  }

  function toggleDevPicker(forceState) {
    devPickerActive = forceState !== undefined ? forceState : !devPickerActive;
    document.getElementById("dev-toggle").classList.toggle("active", devPickerActive);
    document.getElementById("dev-panel").classList.toggle("hidden", !devPickerActive);
    map.getContainer().style.cursor = devPickerActive ? "crosshair" : "";
  }

  // ---- Dev: re-center a zone by clicking the map ----
  function renderDevZoneTargetSelect() {
    const select = document.getElementById("dev-zone-target");
    [...ZONES]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(zone => {
        const opt = document.createElement("option");
        opt.value = zone.name;
        opt.textContent = zone.name;
        select.appendChild(opt);
      });
  }

  function findZoneByName(name) {
    return ZONES.find(z => z.name === name);
  }

  function updateRecenterStatus() {
    const status = document.getElementById("dev-recenter-status");
    if (!recenterTargetName) {
      status.textContent = "";
      return;
    }
    const zone = findZoneByName(recenterTargetName);
    const dirty = modifiedZoneNames.has(recenterTargetName) ? " (moved)" : "";
    status.textContent = zone ? `x:${zone.x} y:${zone.y}${dirty}` : "";
  }

  function formatZonesFile(zones) {
    const lines = zones.map(z => {
      const fields = [`name: ${JSON.stringify(z.name)}`, `layer: ${JSON.stringify(z.layer)}`, `x: ${Math.round(z.x)}`, `y: ${Math.round(z.y)}`];
      return `  { ${fields.join(", ")} }`;
    });
    return `const ZONES = [\n${lines.join(",\n")}\n];\n`;
  }

  map.on("click", (e) => {
    if (!devPickerActive) return;
    const { x, y } = latLngToXY(e.latlng);

    if (recenterTargetName) {
      const zone = findZoneByName(recenterTargetName);
      if (zone) {
        zone.x = x;
        zone.y = y;
        modifiedZoneNames.add(recenterTargetName);
        updateRecenterStatus();
        flashAt(x, y);
      }
      return;
    }

    devPoints.push({ layer: currentLayerId, x, y });
    renderDevPoints();
    updateDevOutput();
    flashAt(x, y);
  });

  const mapContainer = map.getContainer();
  mapContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    mapContainer.classList.add("drag-over-active");
  });
  mapContainer.addEventListener("dragleave", (e) => {
    if (e.target === mapContainer) mapContainer.classList.remove("drag-over-active");
  });
  mapContainer.addEventListener("drop", (e) => {
    e.preventDefault();
    mapContainer.classList.remove("drag-over-active");
    const amenityId = e.dataTransfer.getData("text/plain");
    if (!amenityDef(amenityId)) return;
    const raw = latLngToXY(map.mouseEventToLatLng(e));
    const { x, y } = clampToLayerBounds(currentLayerId, raw.x, raw.y);
    AMENITY_POINTS.push({ type: amenityId, layer: currentLayerId, x, y });
    renderAmenityBadges();
    updateTagStatus();
    flashAt(x, y);
  });

  // ---- Wire up UI ----
  document.getElementById("dev-toggle").addEventListener("click", () => toggleDevPicker());
  document.getElementById("dev-close").addEventListener("click", () => toggleDevPicker(false));
  document.getElementById("dev-clear").addEventListener("click", () => {
    devPoints.length = 0;
    renderDevPoints();
    updateDevOutput();
  });
  document.getElementById("dev-copy-view-link").addEventListener("click", (e) => {
    const center = map.getCenter();
    const { x, y } = latLngToXY(center);
    const link = buildViewLink(currentLayerId, x, y, map.getZoom());
    copyToClipboard(link, (ok) => flashButton(e.target, ok ? "Copied!" : "Copy failed"));
  });
  document.getElementById("dev-zone-target").addEventListener("change", (e) => {
    recenterTargetName = e.target.value;
    updateRecenterStatus();
    if (recenterTargetName) {
      const zone = findZoneByName(recenterTargetName);
      if (zone) goTo(zone);
    }
  });
  document.getElementById("dev-export-zones").addEventListener("click", (e) => {
    copyToClipboard(formatZonesFile(ZONES), (ok) => flashButton(e.target, ok ? "Copied!" : "Copy failed"));
  });
  document.getElementById("dev-export-amenity-points").addEventListener("click", (e) => {
    copyToClipboard(formatAmenityPointsFile(AMENITY_POINTS), (ok) => flashButton(e.target, ok ? "Copied!" : "Copy failed"));
  });
  document.getElementById("search-box").addEventListener("input", (e) => runSearch(e.target.value));
  document.getElementById("search-box").addEventListener("focus", (e) => runSearch(e.target.value));
  document.addEventListener("click", (e) => {
    if (!document.getElementById("search-wrap").contains(e.target)) {
      document.getElementById("search-results").classList.remove("visible");
    }
  });

  renderZoneSelect();
  renderDevZoneTargetSelect();
  renderLayerSelect();
  renderFilterChips();
  renderAmenityLegend();
  renderAmenityPalette();
  updateTagStatus();
  renderDevPoints();
  makeDraggable(document.getElementById("control-box"), document.getElementById("control-box-header"), "controlBoxPosition");
  if (!applyViewFromUrl()) {
    loadLayer(currentLayerId);
  }
})();
