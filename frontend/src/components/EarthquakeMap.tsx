import { useEffect, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  MapOptions,
  StyleSpecification,
} from "maplibre-gl";
import type { EarthquakeEvent, Region } from "../domain";

interface EarthquakeMapProps {
  events: EarthquakeEvent[];
  region: Region;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

const locationApiKey = import.meta.env.VITE_AMAZON_LOCATION_API_KEY?.trim();
const locationMapName = import.meta.env.VITE_AMAZON_LOCATION_MAP_NAME?.trim();
const awsRegion = import.meta.env.VITE_AWS_REGION?.trim() || "us-east-1";
const configuredAmazonMap = Boolean(locationApiKey && locationMapName);
const openStreetMapFallback =
  import.meta.env.DEV &&
  import.meta.env.VITE_MAP_PROVIDER?.trim() !== "disabled";

export default function EarthquakeMap({
  events,
  region,
  selectedEventId,
  onSelectEvent,
}: EarthquakeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventsRef = useRef(events);
  const onSelectEventRef = useRef(onSelectEvent);
  eventsRef.current = events;
  onSelectEventRef.current = onSelectEvent;
  const [mapError, setMapError] = useState<string | null>(null);
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);

  useEffect(() => {
    let disposed = false;
    let removeClickListeners = () => {};
    let map: MapLibreMap | null = null;

    async function initialize(): Promise<void> {
      if (!containerRef.current) return;
      try {
        if (!configuredAmazonMap && !openStreetMapFallback) {
          setMapError(
            "Amazon Location is not configured. Set the map name and restricted API key.",
          );
          return;
        }
        const maplibregl = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;

        const mapStyle: string | StyleSpecification = configuredAmazonMap
          ? (() => {
              const style = new URL(
                `https://maps.geo.${awsRegion}.amazonaws.com/maps/v0/maps/${encodeURIComponent(locationMapName!)}/style-descriptor`,
              );
              style.searchParams.set("key", locationApiKey!);
              return style.toString();
            })()
          : {
                version: 8,
                sources: {
                  openstreetmap: {
                    type: "raster",
                    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                    tileSize: 256,
                    attribution:
                      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
                  },
                },
                layers: [
                  {
                    id: "openstreetmap",
                    type: "raster",
                    source: "openstreetmap",
                    paint: { "raster-opacity": 0.78 },
                  },
                ],
              };

        const mapOptions: MapOptions = {
          container: containerRef.current,
          center: region === "india" ? [78.9, 22.7] : [24, 14],
          zoom: region === "india" ? 3.45 : 1.15,
          minZoom: region === "india" ? 2 : 0.65,
          maxZoom: 14,
          cooperativeGestures: true,
          style: mapStyle,
        };
        map = new maplibregl.Map(mapOptions);
        mapRef.current = map;

        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.on("error", (event) => {
          if (event.error && !configuredAmazonMap) {
            setMapError("OpenStreetMap tiles could not be loaded.");
          } else if (event.error) {
            setMapError(
              "Amazon Location could not load. Check the map name, region, API key and key restrictions.",
            );
          }
        });
        map.on("load", () => {
          if (disposed || !map) return;
          map.addSource("earthquakes", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: eventsRef.current.map((event) => ({
                type: "Feature" as const,
                geometry: {
                  type: "Point" as const,
                  coordinates: [event.longitude, event.latitude],
                },
                properties: {
                  id: event.id,
                  magnitude: event.magnitude,
                  depthKm: event.depthKm,
                  place: event.place,
                },
              })),
            },
            cluster: true,
            clusterRadius: 46,
            clusterMaxZoom: 8,
          });
          map.addLayer({
            id: "earthquake-heatmap",
            type: "heatmap",
            source: "earthquakes",
            maxzoom: 8,
            layout: { visibility: "none" },
            paint: {
              "heatmap-weight": [
                "interpolate",
                ["linear"],
                ["get", "magnitude"],
                0,
                0.2,
                5,
                1,
              ],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                0.8,
                8,
                2.4,
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                16,
                8,
                40,
              ],
              "heatmap-opacity": 0.76,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(33, 102, 172, 0)",
                0.2,
                "#38bdf8",
                0.45,
                "#22c55e",
                0.72,
                "#fbbf24",
                1,
                "#f97316",
              ],
            },
          });
          map.addLayer({
            id: "earthquake-clusters",
            type: "circle",
            source: "earthquakes",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": [
                "step",
                ["get", "point_count"],
                "#0e7490",
                10,
                "#0891b2",
                40,
                "#e99042",
                120,
                "#ea6448",
              ],
              "circle-radius": [
                "step",
                ["get", "point_count"],
                18,
                10,
                23,
                40,
                28,
                120,
                34,
              ],
              "circle-opacity": 0.88,
              "circle-stroke-color": "#fff5e8",
              "circle-stroke-width": 1.4,
            },
          });
          map.addLayer({
            id: "earthquake-cluster-count",
            type: "symbol",
            source: "earthquakes",
            filter: ["has", "point_count"],
            layout: {
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 11,
              "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            },
            paint: { "text-color": "#ffffff" },
          });
          map.addLayer({
            id: "earthquake-points",
            type: "circle",
            source: "earthquakes",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "magnitude"],
                -1,
                4,
                2,
                6,
                4,
                9,
                6,
                12,
                8,
                16,
              ],
              "circle-color": [
                "step",
                ["get", "magnitude"],
                "#34d399",
                2,
                "#fbbf24",
                4,
                "#fb923c",
                6,
                "#ef5b54",
              ],
              "circle-opacity": 0.88,
              "circle-stroke-color": "#fff5e8",
              "circle-stroke-width": 1.15,
            },
          });
          map.on("mouseenter", "earthquake-clusters", () => {
            map?.getCanvas().style.setProperty("cursor", "pointer");
          });
          map.on("mouseleave", "earthquake-clusters", () => {
            map?.getCanvas().style.setProperty("cursor", "");
          });
          map.on("mouseenter", "earthquake-points", () => {
            map?.getCanvas().style.setProperty("cursor", "pointer");
          });
          map.on("mouseleave", "earthquake-points", () => {
            map?.getCanvas().style.setProperty("cursor", "");
          });
          const clusterClick = (event: MapMouseEvent) => {
            const feature = map?.queryRenderedFeatures(event.point, {
              layers: ["earthquake-clusters"],
            })[0];
            const clusterId = feature?.properties?.cluster_id;
            const source = map?.getSource("earthquakes") as
              | GeoJSONSource
              | undefined;
            if (
              source &&
              feature &&
              typeof clusterId === "number" &&
              feature.geometry.type === "Point"
            ) {
              void source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
                if (!map || feature.geometry.type !== "Point") return;
                map.easeTo({
                  center: feature.geometry.coordinates as [number, number],
                  zoom,
                  duration: 450,
                });
              });
            }
          };
          const pointClick = (event: MapMouseEvent) => {
            const feature = map?.queryRenderedFeatures(event.point, {
              layers: ["earthquake-points"],
            })[0];
            const id = feature?.properties?.id;
            if (typeof id !== "string") return;
            onSelectEventRef.current(id);
            if (!map || !feature || feature.geometry.type !== "Point") {
              return;
            }
            const selected = eventsRef.current.find((item) => item.id === id);
            if (!selected) return;
            const description = document.createElement("div");
            description.className = "quake-popup";
            const heading = document.createElement("strong");
            heading.textContent = `M ${selected.magnitude.toFixed(1)} · ${selected.place}`;
            const details = document.createElement("p");
            details.textContent = `${selected.depthKm === null ? "Depth unknown" : `${selected.depthKm.toFixed(1)} km depth`} · ${new Date(selected.timeMs).toLocaleString()}`;
            description.append(heading, details);
            const link = document.createElement("a");
            link.href = selected.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Open USGS event ↗";
            description.append(link);
            new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
              .setLngLat(feature.geometry.coordinates as [number, number])
              .setDOMContent(description)
              .addTo(map);
          };
          map.on("click", "earthquake-clusters", clusterClick);
          map.on("click", "earthquake-points", pointClick);
          removeClickListeners = () => {
            map?.off("click", "earthquake-clusters", clusterClick);
            map?.off("click", "earthquake-points", pointClick);
          };
        });
      } catch (error) {
        if (!disposed) {
          console.error("Could not initialize the earthquake map.", error);
          setMapError(
            configuredAmazonMap
              ? "Map initialization failed. Check the map configuration and key restrictions."
              : "The local map could not be initialized.",
          );
        }
      }
    }

    void initialize();
    return () => {
      disposed = true;
      removeClickListeners();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateSource = () => {
      const source = map.getSource("earthquakes") as
        | GeoJSONSource
        | undefined;
      if (!source) return;
      source.setData({
        type: "FeatureCollection",
        features: events.map((event) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [event.longitude, event.latitude],
          },
          properties: {
            id: event.id,
            magnitude: event.magnitude,
            depthKm: event.depthKm,
            place: event.place,
          },
        })),
      });
    };
    if (map.isStyleLoaded()) updateSource();
    else map.once("load", updateSource);
  }, [events]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyVisibility = () => {
      if (!map.getLayer("earthquake-heatmap")) return;
      map.setLayoutProperty(
        "earthquake-heatmap",
        "visibility",
        heatmapEnabled ? "visible" : "none",
      );
      map.setLayoutProperty(
        "earthquake-points",
        "visibility",
        heatmapEnabled ? "none" : "visible",
      );
      map.setLayoutProperty(
        "earthquake-clusters",
        "visibility",
        heatmapEnabled ? "none" : "visible",
      );
      map.setLayoutProperty(
        "earthquake-cluster-count",
        "visibility",
        heatmapEnabled ? "none" : "visible",
      );
    };
    if (map.isStyleLoaded()) applyVisibility();
    else map.once("load", applyVisibility);
  }, [heatmapEnabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: region === "india" ? [78.9, 22.7] : [24, 14],
      zoom: region === "india" ? 3.45 : 1.15,
      duration: 550,
    });
  }, [region]);

  useEffect(() => {
    const map = mapRef.current;
    const event = events.find((candidate) => candidate.id === selectedEventId);
    if (!map || !event) return;
    map.easeTo({
      center: [event.longitude, event.latitude],
      zoom: Math.max(map.getZoom(), 6),
      duration: 500,
    });
  }, [events, selectedEventId]);

  return (
    <div className="relative min-h-[350px] flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#071421] sm:min-h-[480px]">
      <div
        ref={containerRef}
        role="application"
        aria-label="Interactive earthquake map"
        className="absolute inset-0"
      />
      {mapError && (
        <div className="absolute inset-x-4 bottom-4 z-10 rounded-xl border border-rose-400/30 bg-[#241925]/95 p-3 text-xs text-rose-100">
          {mapError}
        </div>
      )}
      <button
        type="button"
        className="absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#071421]/90 px-3 py-2 text-xs font-medium text-slate-100 shadow-lg backdrop-blur transition hover:border-cyan-300/50"
        aria-pressed={heatmapEnabled}
        onClick={() => setHeatmapEnabled((enabled) => !enabled)}
      >
        <span className="h-2 w-2 rounded-full bg-orange-400 shadow-[0_0_10px_#fb923c]" />
        {heatmapEnabled ? "Hide activity heatmap" : "Activity heatmap"}
      </button>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-white/10 bg-[#071421]/90 px-3 py-2 text-[10px] text-slate-400 shadow-lg backdrop-blur">
        {configuredAmazonMap
          ? `Amazon Location · ${locationMapName}`
          : openStreetMapFallback
            ? "Local preview · OpenStreetMap fallback"
            : "Amazon Location configuration required"}
      </div>
    </div>
  );
}
