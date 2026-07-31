(function () {
  "use strict";

  const layersById = Object.fromEntries(MAP_LAYERS.map(l => [l.id, l]));
  let currentLayerId = MAP_LAYERS[0].id;
  let imageOverlay = null;
  let markerLayerGroup = L.layerGroup();
  let devPickerActive = false;
  const devPoints = [];
  const activeTypeFilters = new Set();

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

  map.on("click", (e) => {
    if (!devPickerActive) return;
    const { x, y } = latLngToXY(e.latlng);
    devPoints.push({ layer: currentLayerId, x, y });
    renderDevPoints();
    updateDevOutput();
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
  document.getElementById("search-box").addEventListener("input", (e) => runSearch(e.target.value));
  document.getElementById("search-box").addEventListener("focus", (e) => runSearch(e.target.value));
  document.addEventListener("click", (e) => {
    if (!document.getElementById("search-wrap").contains(e.target)) {
      document.getElementById("search-results").classList.remove("visible");
    }
  });

  renderLayerSelect();
  renderFilterChips();
  renderDevPoints();
  if (!applyViewFromUrl()) {
    loadLayer(currentLayerId);
  }
})();
