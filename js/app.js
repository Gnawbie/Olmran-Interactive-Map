(function () {
  "use strict";

  const layersById = Object.fromEntries(MAP_LAYERS.map(l => [l.id, l]));
  let currentLayerId = MAP_LAYERS[0].id;
  let imageOverlay = null;
  let markerLayerGroup = L.layerGroup();
  let amenityLayerGroup = L.layerGroup();
  let tierPathLayerGroup = L.layerGroup();
  let tracePreviewLayer = null;
  let tracingActive = false;
  let currentTracePoints = [];
  const TIER_PATH_COLORS = { green: "#4ade56", red: "#d92b2b", purple: "#9b59d6" };
  let boundaryAreaLayerGroup = L.layerGroup();
  let areaPreviewLayer = null;
  let areaDrawActive = false;
  let currentAreaPoints = [];
  const layerImageCache = {};
  let devPickerActive = false;
  const devPoints = [];
  const activeTypeFilters = new Set();
  const hiddenAmenityTypes = new Set();
  let recenterTargetName = "";
  const modifiedZoneNames = new Set();
  let devSession = null; // { username, role }

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
    renderTierPaths();
    renderBoundaryAreas();
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
    Object.entries(ZONE_AMENITIES).forEach(([zoneName, allAmenityIds]) => {
      const zone = findZoneByName(zoneName);
      const amenityIds = allAmenityIds.filter(id => !hiddenAmenityTypes.has(id) && !(amenityDef(id) || {}).hidden);
      if (!zone || zone.layer !== currentLayerId || amenityIds.length === 0) return;
      const marker = L.marker(xyToLatLng(zone.x, zone.y), { icon: amenityBadgeIcon(amenityIds) });
      const labels = amenityIds.map(id => amenityDef(id)).filter(Boolean).map(def => def.label).join(", ");
      marker.bindPopup(`<div class="map-popup"><h3>${zoneName}</h3><p>${labels}</p></div>`);
      amenityLayerGroup.addLayer(marker);
    });

    AMENITY_POINTS
      .filter(p => p.layer === currentLayerId && !hiddenAmenityTypes.has(p.type) && !(amenityDef(p.type) || {}).hidden)
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

  // ---- Tier path overlays (Green/Red/Purple; White is left uncolored) ----
  function renderTierPaths() {
    tierPathLayerGroup.clearLayers();
    TIER_PATHS
      .filter(p => p.layer === currentLayerId)
      .forEach(p => {
        const color = TIER_PATH_COLORS[p.tier];
        if (!color || p.points.length < 2) return;
        const latlngs = p.points.map(([x, y]) => xyToLatLng(x, y));
        const line = L.polyline(latlngs, { color, weight: 5, opacity: 0.65 });
        const content = document.createElement("div");
        content.className = "map-popup";
        const label = p.tier.charAt(0).toUpperCase() + p.tier.slice(1);
        content.innerHTML = `<h3>${label} Tier Path</h3><p>${p.points.length} points</p>`;
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.className = "amenity-point-remove";
        removeBtn.addEventListener("click", () => {
          const idx = TIER_PATHS.indexOf(p);
          if (idx !== -1) TIER_PATHS.splice(idx, 1);
          renderTierPaths();
          updateTraceStatus();
        });
        content.appendChild(removeBtn);
        line.bindPopup(content);
        tierPathLayerGroup.addLayer(line);
      });
    tierPathLayerGroup.addTo(map);
  }

  function updateMapCursor() {
    map.getContainer().style.cursor = (tracingActive || devPickerActive || areaDrawActive) ? "crosshair" : "";
  }

  // Toolbar height varies (wraps to multiple rows on narrow/mobile screens,
  // or when login state changes which buttons are visible), so #map and the
  // floating panels' default top offset track it live via a CSS variable
  // instead of a hardcoded pixel value. Neither ResizeObserver nor the
  // window "resize" event reliably fires for every way the toolbar's size
  // can change (e.g. some viewport-emulation tools skip both), so this is
  // also polled on an interval as a cheap, guaranteed-correct fallback.
  let lastToolbarHeight = null;
  function syncToolbarHeight() {
    const toolbar = document.getElementById("toolbar");
    const h = toolbar.getBoundingClientRect().height;
    if (h === lastToolbarHeight) return;
    lastToolbarHeight = h;
    document.documentElement.style.setProperty("--toolbar-h", `${h}px`);
    map.invalidateSize();
  }

  function updateTracePreview() {
    if (tracePreviewLayer) {
      map.removeLayer(tracePreviewLayer);
      tracePreviewLayer = null;
    }
    if (currentTracePoints.length === 0) return;
    const latlngs = currentTracePoints.map(([x, y]) => xyToLatLng(x, y));
    const group = L.layerGroup();
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: "#ffd76c", weight: 4, dashArray: "6,6", opacity: 0.9 }).addTo(group);
    }
    latlngs.forEach(ll => {
      L.circleMarker(ll, { radius: 4, color: "#ffd76c", fillColor: "#ffd76c", fillOpacity: 1 }).addTo(group);
    });
    tracePreviewLayer = group;
    tracePreviewLayer.addTo(map);
  }

  function updateTraceStatus() {
    const el = document.getElementById("trace-status");
    if (!tracingActive) {
      el.textContent = `${TIER_PATHS.length} segment(s) saved`;
      return;
    }
    el.textContent = currentTracePoints.length < 2
      ? `${currentTracePoints.length} point(s) — need at least 2 to save`
      : `${currentTracePoints.length} point(s) — pick a tier to save, or Undo/Cancel`;
  }

  function toggleTracing(forceState) {
    const next = forceState !== undefined ? forceState : !tracingActive;
    if (next && !devSession) return;
    tracingActive = next;
    document.getElementById("trace-toggle-btn").textContent = tracingActive ? "Stop Tracing" : "Start Tracing";
    document.getElementById("trace-toggle-btn").classList.toggle("active", tracingActive);
    if (!tracingActive) {
      currentTracePoints = [];
      updateTracePreview();
    }
    updateMapCursor();
    updateTraceStatus();
  }

  function formatTierPathsFile(paths) {
    const lines = paths.map(p => {
      const pts = p.points.map(([x, y]) => `[${Math.round(x)}, ${Math.round(y)}]`).join(", ");
      return `  { tier: ${JSON.stringify(p.tier)}, layer: ${JSON.stringify(p.layer)}, points: [${pts}] }`;
    });
    return `const TIER_PATHS = [\n${lines.join(",\n")}\n];\n`;
  }

  // ---- Boundary boxes: recolor every white pixel inside a hand-drawn box ----
  function getLayerImage(layerId) {
    if (layerImageCache[layerId]) return Promise.resolve(layerImageCache[layerId]);
    const layer = layersById[layerId];
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { layerImageCache[layerId] = img; resolve(img); };
      img.onerror = reject;
      img.src = layer.image;
    });
  }

  function hexToRgbObj(hex) {
    const v = parseInt(hex.slice(1), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function buildRecoloredAreaOverlayDataUrl(img, area) {
    const xs = area.points.map(p => p[0]);
    const ys = area.points.map(p => p[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs);
    const y1 = Math.min(...ys), y2 = Math.max(...ys);
    const w = Math.max(1, Math.round(x2 - x1));
    const h = Math.max(1, Math.round(y2 - y1));
    const localPoly = area.points.map(([x, y]) => [x - x1, y - y1]);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, x1, y1, w, h, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const rgb = hexToRgbObj(TIER_PATH_COLORS[area.tier]);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const isWhite = data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
        if (isWhite && pointInPolygon(px, py, localPoly)) {
          data[i] = rgb.r;
          data[i + 1] = rgb.g;
          data[i + 2] = rgb.b;
          data[i + 3] = 220;
        } else {
          data[i + 3] = 0;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), bounds: [x1, y1, x2, y2] };
  }

  async function renderBoundaryAreas() {
    const areas = BOUNDARY_AREAS.filter(a => a.layer === currentLayerId);
    boundaryAreaLayerGroup.clearLayers();
    for (const area of areas) {
      try {
        const img = await getLayerImage(area.layer);
        const { dataUrl, bounds } = buildRecoloredAreaOverlayDataUrl(img, area);
        const latlngBounds = [xyToLatLng(bounds[0], bounds[1]), xyToLatLng(bounds[2], bounds[3])];
        const overlay = L.imageOverlay(dataUrl, latlngBounds, { interactive: true });
        const content = document.createElement("div");
        content.className = "map-popup";
        const label = area.tier.charAt(0).toUpperCase() + area.tier.slice(1);
        content.innerHTML = `<h3>${label} Area</h3><p>${area.points.length} points</p>`;
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.className = "amenity-point-remove";
        removeBtn.addEventListener("click", () => {
          const idx = BOUNDARY_AREAS.indexOf(area);
          if (idx !== -1) BOUNDARY_AREAS.splice(idx, 1);
          renderBoundaryAreas();
          updateAreaStatus();
        });
        content.appendChild(removeBtn);
        overlay.bindPopup(content);
        boundaryAreaLayerGroup.addLayer(overlay);
      } catch (e) {
        console.error("Failed to render boundary area", e);
      }
    }
    boundaryAreaLayerGroup.addTo(map);
    setBoundaryAreaOverlaysInteractive(!areaDrawActive);
  }

  // While actively drawing a new area, existing overlays must not intercept
  // clicks meant for the in-progress polygon — otherwise you can't trace a
  // new shape that overlaps a saved one, since clicking it just opens its
  // popup instead of adding a point.
  function setBoundaryAreaOverlaysInteractive(interactive) {
    boundaryAreaLayerGroup.eachLayer(layer => {
      const el = layer.getElement && layer.getElement();
      if (el) el.style.pointerEvents = interactive ? "" : "none";
    });
  }

  function clearAreaPreview() {
    if (areaPreviewLayer) {
      map.removeLayer(areaPreviewLayer);
      areaPreviewLayer = null;
    }
  }

  function updateAreaPreview() {
    clearAreaPreview();
    if (currentAreaPoints.length === 0) return;
    const group = L.layerGroup();
    const latlngs = currentAreaPoints.map(([x, y]) => xyToLatLng(x, y));
    if (latlngs.length > 1) {
      L.polygon(latlngs, { color: "#ffd76c", weight: 3, dashArray: "6,6", fillOpacity: 0.08 }).addTo(group);
    }
    latlngs.forEach(ll => {
      L.circleMarker(ll, { radius: 4, color: "#ffd76c", fillColor: "#ffd76c", fillOpacity: 1 }).addTo(group);
    });
    areaPreviewLayer = group;
    areaPreviewLayer.addTo(map);
  }

  function updateAreaStatus() {
    const el = document.getElementById("area-status");
    if (!areaDrawActive) {
      el.textContent = `${BOUNDARY_AREAS.length} area(s) saved`;
      return;
    }
    el.textContent = currentAreaPoints.length < 3
      ? `${currentAreaPoints.length} point(s) — need at least 3 to save`
      : `${currentAreaPoints.length} point(s) — pick a tier to save (auto-closes to point 1), or Undo/Cancel`;
  }

  function toggleAreaDraw(forceState) {
    const next = forceState !== undefined ? forceState : !areaDrawActive;
    if (next && !devSession) return;
    areaDrawActive = next;
    document.getElementById("area-toggle-btn").textContent = areaDrawActive ? "Stop Area" : "Start Area";
    document.getElementById("area-toggle-btn").classList.toggle("active", areaDrawActive);
    if (!areaDrawActive) {
      currentAreaPoints = [];
      clearAreaPreview();
    }
    setBoundaryAreaOverlaysInteractive(!areaDrawActive);
    updateMapCursor();
    updateAreaStatus();
  }

  function formatBoundaryAreasFile(areas) {
    const lines = areas.map(a => {
      const pts = a.points.map(([x, y]) => `[${Math.round(x)}, ${Math.round(y)}]`).join(", ");
      return `  { tier: ${JSON.stringify(a.tier)}, layer: ${JSON.stringify(a.layer)}, points: [${pts}] }`;
    });
    return `const BOUNDARY_AREAS = [\n${lines.join(",\n")}\n];\n`;
  }

  // ---- Dev: drag-and-drop amenity tagging ----
  function renderAmenityPalette() {
    const wrap = document.getElementById("dev-amenity-palette");
    wrap.innerHTML = "";
    AMENITY_TYPES.filter(def => !def.hidden).forEach(def => {
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
    AMENITY_TYPES.filter(def => !def.hidden).forEach(def => {
      const row = document.createElement("div");
      const hidden = hiddenAmenityTypes.has(def.id);
      row.className = "amenity-legend-row" + (hidden ? " legend-hidden" : "");
      row.title = hidden ? `Click to show ${def.label} on the map` : `Click to hide ${def.label} on the map`;
      row.innerHTML = `<span class="amenity-badge" style="background:${def.color}">${def.symbol}</span><span>${def.label}</span>`;
      row.addEventListener("click", () => {
        if (hiddenAmenityTypes.has(def.id)) hiddenAmenityTypes.delete(def.id);
        else hiddenAmenityTypes.add(def.id);
        renderAmenityLegend();
        renderAmenityBadges();
      });
      wrap.appendChild(row);
    });
  }

  // ---- Zone Tier Reference (temporary lookup panel for drawing boundary boxes) ----
  const TIER_TAG_IDS = ["zone-white", "zone-green", "zone-red", "zone-purple"];

  function renderZoneTierList(filterText) {
    const wrap = document.getElementById("zone-tier-list");
    wrap.innerHTML = "";
    const q = (filterText || "").trim().toLowerCase();
    [...ZONES]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(z => !q || z.name.toLowerCase().includes(q))
      .forEach(zone => {
        const tags = (ZONE_AMENITIES[zone.name] || []).filter(t => TIER_TAG_IDS.includes(t));
        const row = document.createElement("div");
        row.className = "zone-tier-row";

        const name = document.createElement("span");
        name.className = "zt-name";
        name.textContent = zone.name;
        name.title = zone.name;
        row.appendChild(name);

        if (tags.length === 0) {
          const none = document.createElement("span");
          none.className = "zt-none";
          none.textContent = "no tier";
          row.appendChild(none);
        } else {
          const swatches = document.createElement("span");
          swatches.className = "zt-swatches";
          tags.forEach(t => {
            const def = amenityDef(t);
            const sw = document.createElement("span");
            sw.className = "zt-swatch";
            sw.style.background = def ? def.color : "#666";
            sw.title = def ? def.label : t;
            swatches.appendChild(sw);
          });
          row.appendChild(swatches);
        }

        row.title = zone.name;
        row.addEventListener("click", () => goTo(zone));
        wrap.appendChild(row);
      });
  }

  function toggleZoneTierPanel(show) {
    document.getElementById("zone-tier-panel").classList.toggle("hidden", !show);
    if (show) renderZoneTierList(document.getElementById("zone-tier-search").value);
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

    if (item.kind !== "marker" && item.name && findZoneByName(item.name)) {
      renderItemsForZone(item.name);
    }
  }

  // ---- Items panel: shows the last zone searched/panned to ----
  function itemCategory(it) {
    const type = (it.type || "").toLowerCase();
    const slot = (it.slot || "").toLowerCase();
    if (type === "edible") return "edible";
    if (slot === "jewel") return "jewel";
    if (slot === "weapon") return "weapon";
    return "armor";
  }

  function fieldPart(label, value) {
    if (value === null || value === undefined || value === "") return null;
    return `${label}: ${value}`;
  }

  function valuePart(value) {
    if (value === null || value === undefined || value === "") return null;
    return `${value}`;
  }

  function weightPart(value) {
    if (value === null || value === undefined || value === "") return null;
    return `${value} lbs`;
  }

  function sigilPart(it) {
    if (!it.sigil) return null;
    return `Sigil: ${it.sigil}${it.sigilLvl != null ? " " + it.sigilLvl : ""}`;
  }

  // Field order per item category, as specified for the Items panel layout.
  function buildItemMeta(it) {
    const cat = itemCategory(it);
    let parts;
    if (cat === "jewel") {
      parts = [valuePart(it.spell), sigilPart(it)];
    } else if (cat === "weapon") {
      parts = [
        valuePart(it.type),
        valuePart(it.spell),
        fieldPart("Damage", it.damage),
        fieldPart("Fumble", it.fumble),
        weightPart(it.weight),
        fieldPart("Acc", it.accuracy),
        sigilPart(it),
      ];
    } else if (cat === "edible") {
      parts = ["Edible", valuePart(it.spell)];
    } else {
      parts = [
        valuePart(it.spell),
        fieldPart("Def", it.defense),
        sigilPart(it),
        valuePart(it.slot),
        valuePart(it.type),
      ];
    }
    return parts.filter(Boolean).join(" · ");
  }

  function renderItemsForZone(zoneName) {
    const titleEl = document.querySelector("#items-header span");
    const body = document.getElementById("items-body");
    const items = ZONE_ITEMS[zoneName];
    titleEl.textContent = `Items — ${zoneName}`;
    body.innerHTML = "";

    if (!items || items.length === 0) {
      const empty = document.createElement("div");
      empty.id = "items-empty";
      empty.textContent = "No item data for this zone.";
      body.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.id = "items-list";
    items.forEach(it => {
      const meta = buildItemMeta(it);

      const row = document.createElement("div");
      row.className = "item-row";

      const top = document.createElement("div");
      top.className = "item-top";

      const line = document.createElement("div");
      line.className = "item-line";
      line.innerHTML = `<span class="item-name">${it.item || "?"}</span>` +
        (meta ? ` <span class="item-field">${meta}</span>` : "");

      const mobBtn = document.createElement("button");
      mobBtn.className = "item-mob-btn collapsed";
      mobBtn.title = "Show dropped-by mob";
      mobBtn.textContent = "▼";

      const mobLine = document.createElement("div");
      mobLine.className = "item-mob-line hidden";
      mobLine.textContent = `Dropped by: ${it.mob || "unknown"}`;

      mobBtn.addEventListener("click", () => {
        const collapsed = mobBtn.classList.toggle("collapsed");
        mobLine.classList.toggle("hidden", collapsed);
      });

      top.appendChild(line);
      top.appendChild(mobBtn);
      row.appendChild(top);
      row.appendChild(mobLine);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  function toggleItemsCollapse(forceState) {
    const panel = document.getElementById("items-panel");
    const btn = document.getElementById("items-collapse-btn");
    const collapsed = forceState !== undefined ? forceState : !panel.classList.contains("collapsed");
    panel.classList.toggle("collapsed", collapsed);
    btn.classList.toggle("collapsed", collapsed);
    localStorage.setItem("itemsPanelCollapsed", collapsed ? "1" : "0");
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
      if (e.target.closest("button, input, select, textarea, a")) return;
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

  // ---- Search (typo-tolerant: exact substrings rank first, then fuzzy) ----
  function searchIndex() {
    const zoneEntries = ZONES.map(z => ({ ...z, kind: "zone" }));
    const markerEntries = MARKERS.map(m => ({ ...m, kind: "marker" }));
    return zoneEntries.concat(markerEntries);
  }

  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  // 0 = exact substring match. Otherwise, the smallest edit distance between
  // the query and any similarly-sized window of the name — lets a typo like
  // "feild of sorow" still find "Field of Sorrow" instead of showing nothing.
  function fuzzyScore(query, name) {
    if (name.includes(query)) return 0;
    let best = Infinity;
    const qLen = query.length;
    const minWin = Math.max(1, qLen - 2);
    const maxWin = Math.min(name.length, qLen + 2);
    for (let winLen = minWin; winLen <= maxWin; winLen++) {
      for (let start = 0; start <= name.length - winLen; start++) {
        const d = levenshtein(query, name.substr(start, winLen));
        if (d < best) best = d;
        if (best === 1) return best; // can't do better than 1 once we're not exact
      }
    }
    return best;
  }

  function fuzzyThreshold(queryLength) {
    return Math.max(1, Math.floor(queryLength * 0.25));
  }

  function runSearch(query) {
    const q = query.trim().toLowerCase();
    const resultsEl = document.getElementById("search-results");
    resultsEl.innerHTML = "";
    if (!q) {
      resultsEl.classList.remove("visible");
      return;
    }
    const threshold = fuzzyThreshold(q.length);
    const matches = searchIndex()
      .map(item => ({ item, score: fuzzyScore(q, item.name.toLowerCase()) }))
      .filter(m => m.score <= threshold)
      .sort((a, b) => a.score - b.score || a.item.name.length - b.item.name.length)
      .slice(0, 25)
      .map(m => m.item);

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
    const next = forceState !== undefined ? forceState : !devPickerActive;
    if (next && !devSession) return; // can't turn on without a session, but always allow turning off
    devPickerActive = next;
    document.getElementById("dev-toggle").classList.toggle("active", devPickerActive);
    document.getElementById("dev-panel").classList.toggle("hidden", !devPickerActive);
    updateMapCursor();
  }

  // ---- Dev login (PBKDF2-hashed, client-side only — see dev-accounts.js) ----
  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function randomSaltHex() {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
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

  function updateAuthUI() {
    const loggedIn = !!devSession;
    document.getElementById("dev-login-btn").classList.toggle("hidden", loggedIn);
    document.getElementById("dev-session-badge").classList.toggle("hidden", !loggedIn);
    document.getElementById("dev-toggle").classList.toggle("hidden", !loggedIn);
    document.getElementById("dev-manage-btn").classList.toggle("hidden", !(loggedIn && devSession.role === "main"));
    document.getElementById("dev-session-user").textContent = loggedIn ? devSession.username : "";
    if (!loggedIn) {
      toggleDevPicker(false);
      toggleTracing(false);
      toggleAreaDraw(false);
    }
  }

  function toggleLoginOverlay(show) {
    document.getElementById("login-overlay").classList.toggle("hidden", !show);
    document.getElementById("login-error").textContent = "";
    if (show) {
      document.getElementById("login-username").value = "";
      document.getElementById("login-password").value = "";
      document.getElementById("login-username").focus();
    }
  }

  function toggleManageOverlay(show) {
    document.getElementById("manage-overlay").classList.toggle("hidden", !show);
    document.getElementById("manage-error").textContent = "";
    if (show) renderManageList();
  }

  function renderManageList() {
    const wrap = document.getElementById("manage-list");
    wrap.innerHTML = "";
    DEV_ACCOUNTS.forEach(account => {
      const row = document.createElement("div");
      row.className = "manage-account-row";
      const name = document.createElement("span");
      name.className = "acct-name";
      name.textContent = account.username;
      const role = document.createElement("span");
      role.className = "acct-role";
      role.textContent = account.role;
      row.append(name, role);
      if (account.role !== "main") {
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
          const idx = DEV_ACCOUNTS.indexOf(account);
          if (idx !== -1) DEV_ACCOUNTS.splice(idx, 1);
          renderManageList();
        });
        row.appendChild(removeBtn);
      }
      wrap.appendChild(row);
    });
  }

  function formatDevAccountsFile(accounts) {
    const lines = accounts.map(a => {
      const fields = [
        `username: ${JSON.stringify(a.username)}`,
        `salt: ${JSON.stringify(a.salt)}`,
        `hash: ${JSON.stringify(a.hash)}`,
        `iterations: ${a.iterations}`,
        `role: ${JSON.stringify(a.role)}`
      ];
      return `  {\n    ${fields.join(",\n    ")}\n  }`;
    });
    return `const DEV_ACCOUNTS = [\n${lines.join(",\n")}\n];\n`;
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
    if (areaDrawActive) {
      const raw = latLngToXY(e.latlng);
      const { x, y } = clampToLayerBounds(currentLayerId, raw.x, raw.y);
      currentAreaPoints.push([x, y]);
      updateAreaPreview();
      updateAreaStatus();
      return;
    }

    if (tracingActive) {
      const raw = latLngToXY(e.latlng);
      const { x, y } = clampToLayerBounds(currentLayerId, raw.x, raw.y);
      currentTracePoints.push([x, y]);
      updateTracePreview();
      updateTraceStatus();
      return;
    }

    if (!devPickerActive) return;
    const rawPoint = latLngToXY(e.latlng);
    const { x, y } = clampToLayerBounds(currentLayerId, rawPoint.x, rawPoint.y);

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
    if (!devSession) return;
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
  document.getElementById("zone-tier-toggle-btn").addEventListener("click", () => toggleZoneTierPanel(true));
  document.getElementById("zone-tier-close").addEventListener("click", () => toggleZoneTierPanel(false));
  document.getElementById("zone-tier-search").addEventListener("input", (e) => renderZoneTierList(e.target.value));
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
  document.getElementById("trace-toggle-btn").addEventListener("click", () => toggleTracing());
  document.getElementById("trace-undo-btn").addEventListener("click", () => {
    currentTracePoints.pop();
    updateTracePreview();
    updateTraceStatus();
  });
  document.getElementById("trace-cancel-btn").addEventListener("click", () => {
    currentTracePoints = [];
    updateTracePreview();
    updateTraceStatus();
  });
  document.querySelectorAll(".tier-tag-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (currentTracePoints.length < 2) return;
      TIER_PATHS.push({ tier: btn.dataset.tier, layer: currentLayerId, points: currentTracePoints.slice() });
      currentTracePoints = [];
      updateTracePreview();
      updateTraceStatus();
      renderTierPaths();
    });
  });
  document.getElementById("tier-export-btn").addEventListener("click", (e) => {
    copyToClipboard(formatTierPathsFile(TIER_PATHS), (ok) => flashButton(e.target, ok ? "Copied!" : "Copy failed"));
  });
  document.getElementById("area-toggle-btn").addEventListener("click", () => toggleAreaDraw());
  document.getElementById("area-undo-btn").addEventListener("click", () => {
    currentAreaPoints.pop();
    updateAreaPreview();
    updateAreaStatus();
  });
  document.getElementById("area-cancel-btn").addEventListener("click", () => {
    currentAreaPoints = [];
    clearAreaPreview();
    updateAreaStatus();
  });
  document.querySelectorAll(".area-tag-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (currentAreaPoints.length < 3) return;
      BOUNDARY_AREAS.push({ tier: btn.dataset.tier, layer: currentLayerId, points: currentAreaPoints.slice() });
      currentAreaPoints = [];
      clearAreaPreview();
      updateAreaStatus();
      renderBoundaryAreas();
    });
  });
  document.getElementById("area-export-btn").addEventListener("click", (e) => {
    copyToClipboard(formatBoundaryAreasFile(BOUNDARY_AREAS), (ok) => flashButton(e.target, ok ? "Copied!" : "Copy failed"));
  });
  document.getElementById("search-box").addEventListener("input", (e) => runSearch(e.target.value));
  document.getElementById("search-box").addEventListener("focus", (e) => runSearch(e.target.value));
  document.addEventListener("click", (e) => {
    if (!document.getElementById("search-wrap").contains(e.target)) {
      document.getElementById("search-results").classList.remove("visible");
    }
  });

  // ---- Wire up login / account management UI ----
  document.getElementById("dev-login-btn").addEventListener("click", () => toggleLoginOverlay(true));
  document.getElementById("login-cancel").addEventListener("click", () => toggleLoginOverlay(false));
  document.getElementById("login-overlay").addEventListener("click", (e) => {
    if (e.target.id === "login-overlay") toggleLoginOverlay(false);
  });
  async function submitLogin() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    if (!username || !password) {
      errorEl.textContent = "Enter a username and password.";
      return;
    }
    const submitBtn = document.getElementById("login-submit");
    submitBtn.disabled = true;
    errorEl.textContent = "";
    try {
      const account = await attemptLogin(username, password);
      if (!account) {
        errorEl.textContent = "Invalid username or password.";
        return;
      }
      devSession = { username: account.username, role: account.role };
      saveDevSession();
      updateAuthUI();
      toggleLoginOverlay(false);
    } finally {
      submitBtn.disabled = false;
    }
  }
  document.getElementById("login-submit").addEventListener("click", submitLogin);
  document.getElementById("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitLogin();
  });
  document.getElementById("dev-logout-btn").addEventListener("click", () => {
    devSession = null;
    saveDevSession();
    updateAuthUI();
  });
  document.getElementById("dev-manage-btn").addEventListener("click", () => toggleManageOverlay(true));
  document.getElementById("manage-close-btn").addEventListener("click", () => toggleManageOverlay(false));
  document.getElementById("manage-overlay").addEventListener("click", (e) => {
    if (e.target.id === "manage-overlay") toggleManageOverlay(false);
  });
  document.getElementById("manage-add-btn").addEventListener("click", async () => {
    const usernameEl = document.getElementById("manage-new-username");
    const passwordEl = document.getElementById("manage-new-password");
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    const errorEl = document.getElementById("manage-error");
    errorEl.textContent = "";
    if (!username || !password) {
      errorEl.textContent = "Enter a username and password.";
      return;
    }
    if (findAccount(username)) {
      errorEl.textContent = "That username already exists.";
      return;
    }
    const addBtn = document.getElementById("manage-add-btn");
    addBtn.disabled = true;
    try {
      const salt = randomSaltHex();
      const iterations = 200000;
      const hash = await pbkdf2Hash(password, salt, iterations);
      DEV_ACCOUNTS.push({ username, salt, hash, iterations, role: "dev" });
      usernameEl.value = "";
      passwordEl.value = "";
      renderManageList();
    } finally {
      addBtn.disabled = false;
    }
  });
  document.getElementById("manage-export-btn").addEventListener("click", (e) => {
    copyToClipboard(formatDevAccountsFile(DEV_ACCOUNTS), (ok) => flashButton(e.target, ok ? "Copied!" : "Copy failed"));
  });

  renderZoneSelect();
  renderDevZoneTargetSelect();
  renderLayerSelect();
  renderFilterChips();
  renderAmenityLegend();
  renderAmenityPalette();
  updateTagStatus();
  updateTraceStatus();
  updateAreaStatus();
  renderDevPoints();
  makeDraggable(document.getElementById("control-box"), document.getElementById("control-box-header"), "controlBoxPosition");
  makeDraggable(document.getElementById("zone-tier-panel"), document.getElementById("zone-tier-header"), "zoneTierPanelPosition");
  makeDraggable(document.getElementById("items-panel"), document.getElementById("items-header"), "itemsPanelPosition");
  document.getElementById("items-collapse-btn").addEventListener("click", () => toggleItemsCollapse());
  toggleItemsCollapse(localStorage.getItem("itemsPanelCollapsed") === "1");
  loadDevSession();
  updateAuthUI();
  if (!applyViewFromUrl()) {
    loadLayer(currentLayerId);
  }

  if (window.ResizeObserver) {
    new ResizeObserver(() => syncToolbarHeight()).observe(document.getElementById("toolbar"));
  }
  window.addEventListener("resize", syncToolbarHeight);
  window.addEventListener("orientationchange", () => setTimeout(syncToolbarHeight, 100));
  setInterval(syncToolbarHeight, 400);
  syncToolbarHeight();
})();
