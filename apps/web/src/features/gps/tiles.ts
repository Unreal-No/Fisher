import L from 'leaflet';

/**
 * Base map. OpenStreetMap's volunteer tile servers block requests without a Referer ("Access blocked"), and the app's
 * Referrer-Policy (same-origin, nginx) sends none cross-origin — so tiles send just the site origin, never the page path.
 * For heavy production use, switch `url` to your own tile provider (OSM tile usage policy).
 */
export const BASE_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  options: {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    referrerPolicy: 'strict-origin-when-cross-origin',
  } satisfies L.TileLayerOptions,
};

export const addBaseLayer = (m: L.Map) => L.tileLayer(BASE_TILES.url, BASE_TILES.options).addTo(m);
