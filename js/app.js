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

  function boundsForLayer(layer) {
    // Leaflet CRS.Simple: [y, x] pairs, y grows downward here to match image coords.
    return [[0, 0], [layer.height, layer.width]];
  }

  function xyToLatLng(x, y) {
    return L.latLng(y, x);
  }

  function latLngToXY(latlng) {
    return { x: Math.round(latlng.lng), y: Math.round(latlng.lat) };
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
    map.setMaxBounds(bounds.map((c, i) => i === 0 ? [c[0] - 500, c[1] - 500] : [c[0] + 500, c[1] + 500]));

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
    updateDevOutput();
    flashAt(x, y);
  });

  // ---- Wire up UI ----
  document.getElementById("dev-toggle").addEventListener("click", () => toggleDevPicker());
  document.getElementById("dev-close").addEventListener("click", () => toggleDevPicker(false));
  document.getElementById("dev-clear").addEventListener("click", () => {
    devPoints.length = 0;
    updateDevOutput();
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
  loadLayer(currentLayerId);
})();
