'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import * as turf from '@turf/turf';

import {
  FavoriteHotel,
  Hotel,
  LocalStation,
  SearchCandidate,
  TargetLocation,
} from '../types/truestay';
import {
  formatDistance,
  normalizeSearchKeyword,
  reverseGeocode,
} from '../utils/geo';
import TopSearchBar from './TopSearchBar';
import HotelSidebar from './HotelSidebar';

const FAVORITES_STORAGE_KEY = 'truestay_favorites_v1';

export default function TrueStayMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const currentPolygonLayerRef = useRef<L.Layer | null>(null);
  const allHotelsRef = useRef<Hotel[]>([]);
  const localStationsRef = useRef<LocalStation[]>([]);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const activeHotelMarkerRef = useRef<L.Marker | null>(null);
  const distanceLineRef = useRef<L.Polyline | null>(null);
  const activeHotelRef = useRef<Hotel | null>(null);
  const targetLocationRef = useRef<TargetLocation | null>(null);
  const isPlacingPinRef = useRef(false);

  const [status, setStatus] = useState('正在載入全台旅宿資料...');
  const [selectedHotels, setSelectedHotels] = useState<Hotel[]>([]);
  const [hasDrawnArea, setHasDrawnArea] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteHotel[]>([]);
  const [activeTab, setActiveTab] = useState<'results' | 'favorites'>('results');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCandidates, setSearchCandidates] = useState<SearchCandidate[]>([]);
  const [allMatchedHotels, setAllMatchedHotels] = useState<Hotel[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isPlacingPin, setIsPlacingPin] = useState(false);
  const [targetLocation, setTargetLocation] = useState<TargetLocation | null>(null);
  const [activeHotelId, setActiveHotelId] = useState<string | null>(null);
  const [activeDistance, setActiveDistance] = useState<string | null>(null);

  function updateTargetLocation(next: TargetLocation | null) {
    targetLocationRef.current = next;
    setTargetLocation(next);
  }

  // 載入已儲存的收藏清單（localStorage）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (saved) setFavorites(JSON.parse(saved));
    } catch (err) {
      console.error('讀取收藏清單失敗', err);
    }
  }, []);

  function persistFavorites(next: FavoriteHotel[]) {
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.error('儲存收藏清單失敗', err);
    }
  }

  function toggleFavorite(hotel: Hotel, e: React.MouseEvent) {
    e.stopPropagation();
    const exists = favorites.some((f) => f.id === hotel.id);
    if (exists) {
      persistFavorites(favorites.filter((f) => f.id !== hotel.id));
    } else {
      persistFavorites([{ ...hotel, note: '', savedAt: Date.now() }, ...favorites]);
    }
  }

  function updateFavoriteNote(hotelId: string, note: string) {
    persistFavorites(
      favorites.map((f) => (f.id === hotelId ? { ...f, note } : f))
    );
  }

  useEffect(() => {
    isPlacingPinRef.current = isPlacingPin;
    if (mapContainerRef.current) {
      mapContainerRef.current.style.cursor = isPlacingPin ? 'crosshair' : '';
    }
  }, [isPlacingPin]);

  // 1. 讀取政府旅宿開放資料
  useEffect(() => {
    async function loadHotels() {
      try {
        const res = await fetch('/data/hotels.json');
        const text = await res.text();
        const raw = JSON.parse(text.replace(/^\uFEFF/, ''));

        const list =
          raw?.Hotels ||
          raw?.XML_Head?.Infos?.Info ||
          (Array.isArray(raw) ? raw : []);

        const parsed: Hotel[] = list
          .map((item: any, idx: number) => {
            const lat = Number(item.PositionLat ?? item.Position?.PositionLat ?? item.Py);
            const lng = Number(item.PositionLon ?? item.Position?.PositionLon ?? item.Px);
            if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

            return {
              id: item.HotelID || item.Id || String(idx),
              name: item.HotelName || item.Name || '未命名旅宿',
              address:
                item.PostalAddress?.StreetAddress ||
                item.Add ||
                item.Address ||
                '無地址資料',
              lat,
              lng,
              parking: item.ParkingInfo || item.Parkinginfo || '',
              picture: item.Images?.[0]?.URL || item.Picture1 || '',
            };
          })
          .filter(Boolean);

        allHotelsRef.current = parsed;
        setStatus(`已載入 ${parsed.length.toLocaleString()} 筆合法旅宿！請輸入地標或手動放地標。`);
      } catch (err) {
        console.error(err);
        setStatus('讀取 hotels.json 失敗，請確認檔案路徑是否為 public/data/hotels.json');
      }
    }

    loadHotels();
  }, []);

  function clearDrawnSelection() {
    if (currentPolygonLayerRef.current) {
      currentPolygonLayerRef.current.remove();
      currentPolygonLayerRef.current = null;
    }
    if (mapRef.current) {
      mapRef.current.pm.getGeomanDrawLayers().forEach((layer: any) => {
        layer.remove();
      });
    }
    markersLayerRef.current?.clearLayers();
    activeHotelMarkerRef.current?.remove();
    distanceLineRef.current?.remove();
    activeHotelRef.current = null;
    setSelectedHotels([]);
    setHasDrawnArea(false);
    setActiveHotelId(null);
    setActiveDistance(null);
  }

  function addHotelBlueMarker(hotel: Hotel) {
    if (!markersLayerRef.current) return;

    const dot = L.circleMarker([hotel.lat, hotel.lng], {
      radius: 7,
      fillColor: '#2563eb',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.9,
    });

    dot.bindTooltip(hotel.name, { direction: 'top', offset: [0, -8] });
    dot.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      handleSelectHotel(hotel, true);
    });

    dot.addTo(markersLayerRef.current);
  }

  function evaluatePolygonLayer(layer: any) {
    const rawGeo = layer.toGeoJSON();
    const polygonFeature =
      rawGeo.type === 'FeatureCollection' ? rawGeo.features[0] : rawGeo;
    if (!polygonFeature) return;

    const inside = allHotelsRef.current.filter((h) =>
      turf.booleanPointInPolygon(turf.point([h.lng, h.lat]), polygonFeature)
    );

    if (typeof layer.setStyle === 'function') {
      layer.setStyle(
        inside.length === 0
          ? {
              color: '#ef4444',
              fillColor: '#ef4444',
              fillOpacity: 0.12,
              dashArray: '6, 6',
              weight: 2,
            }
          : {
              color: '#2563eb',
              fillColor: '#3b82f6',
              fillOpacity: 0.15,
              dashArray: '',
              weight: 2,
            }
      );
    }

    setSelectedHotels(inside);
    setHasDrawnArea(true);
    setActiveTab('results');
    setActiveHotelId(null);
    setActiveDistance(null);
    activeHotelRef.current = null;
    activeHotelMarkerRef.current?.remove();
    distanceLineRef.current?.remove();

    markersLayerRef.current?.clearLayers();
    inside.forEach((h) => addHotelBlueMarker(h));

    setStatus(
      inside.length === 0
        ? '此框選範圍內無合法旅宿，可點擊右側「往外擴大 500 公尺」或重畫新框'
        : `在框選範圍內找到 ${inside.length} 間合法旅宿（點擊藍點或右側清單可算距離）`
    );
  }

  function handleExpandPolygon() {
    if (!currentPolygonLayerRef.current || !mapRef.current) return;

    const currentLayer: any = currentPolygonLayerRef.current;
    const rawGeo = currentLayer.toGeoJSON();
    const feature =
      rawGeo.type === 'FeatureCollection' ? rawGeo.features[0] : rawGeo;
    if (!feature) return;

    const buffered = turf.buffer(feature, 0.5, { units: 'kilometers' });
    if (!buffered) return;

    currentLayer.remove();
    const expandedLayer = L.geoJSON(buffered).addTo(mapRef.current);
    currentPolygonLayerRef.current = expandedLayer;

    mapRef.current.fitBounds(expandedLayer.getBounds(), { padding: [30, 30] });
    evaluatePolygonLayer(expandedLayer);
  }

  function renderActiveHotelVisuals(hotel: Hotel, target: TargetLocation | null) {
    if (!mapRef.current) return;

    activeHotelMarkerRef.current?.remove();
    distanceLineRef.current?.remove();

    let distanceText: string | null = null;
    if (target) {
      const meters = turf.distance(
        turf.point([target.lng, target.lat]),
        turf.point([hotel.lng, hotel.lat]),
        { units: 'meters' }
      );
      distanceText = formatDistance(meters);

      distanceLineRef.current = L.polyline(
        [
          [target.lat, target.lng],
          [hotel.lat, hotel.lng],
        ],
        {
          color: '#10b981',
          weight: 3,
          dashArray: '6, 8',
          opacity: 0.85,
        }
      ).addTo(mapRef.current);
    }
    setActiveDistance(distanceText);

    const hotelIcon = L.divIcon({
      className: '',
      html: `
        <div style="
          width: 32px; height: 32px;
          background: #10b981;
          border: 3px solid #ffffff;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
        ">🏨</div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const tooltipLabel = distanceText
      ? `🏨 ${hotel.name}（距地標 ${distanceText}）`
      : `🏨 ${hotel.name}`;

    activeHotelMarkerRef.current = L.marker([hotel.lat, hotel.lng], {
      icon: hotelIcon,
      zIndexOffset: 1000,
    })
      .addTo(mapRef.current)
      .bindTooltip(tooltipLabel, {
        permanent: true,
        direction: 'top',
        offset: [0, -18],
      })
      .openTooltip();
  }

  function focusTargetLocation(
    lat: number,
    lng: number,
    label: string,
    zoom?: number
  ) {
    if (!mapRef.current) return;

    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
    }

    const targetIcon = L.divIcon({
      className: '',
      html: `
        <div style="position: relative; width: 26px; height: 26px; cursor: grab;">
          <span style="position: absolute; inset: 0; border-radius: 9999px; background: rgba(239, 68, 68, 0.45); animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
          <span style="position: absolute; top: 5px; left: 5px; width: 16px; height: 16px; border-radius: 9999px; background: #ef4444; border: 3px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></span>
        </div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    const marker = L.marker([lat, lng], {
      icon: targetIcon,
      draggable: true,
      zIndexOffset: 900,
    })
      .addTo(mapRef.current)
      .bindTooltip(`📍 ${label}（可拖曳）`, {
        permanent: true,
        direction: 'top',
        offset: [0, -14],
      })
      .openTooltip();

    marker.on('dragend', async () => {
      const pos = marker.getLatLng();
      marker.setTooltipContent('📍 更新地標名稱中...');

      const resolvedName = await reverseGeocode(pos.lat, pos.lng);
      const updatedTarget: TargetLocation = {
        lat: pos.lat,
        lng: pos.lng,
        name: resolvedName,
      };

      updateTargetLocation(updatedTarget);
      marker.setTooltipContent(`📍 ${resolvedName}（可拖曳）`);
      setStatus(`地標已更新為「${resolvedName}」`);

      if (activeHotelRef.current) {
        renderActiveHotelVisuals(activeHotelRef.current, updatedTarget);
      }
    });

    searchMarkerRef.current = marker;
    const newTarget: TargetLocation = { lat, lng, name: label };
    updateTargetLocation(newTarget);

    if (zoom !== undefined) {
      mapRef.current.setView([lat, lng], zoom);
    }

    if (activeHotelRef.current) {
      renderActiveHotelVisuals(activeHotelRef.current, newTarget);
    }

    return marker;
  }

  // 2. 初始化 Leaflet 地圖與 Geoman 畫框工具
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current).setView([22.6273, 120.3014], 13);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: true,
      drawPolygon: true,
      drawCircle: false,
      drawText: false,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      removalMode: true,
    });

    map.on('click', async (e: L.LeafletMouseEvent) => {
      if (!isPlacingPinRef.current) return;

      setIsPlacingPin(false);
      const { lat, lng } = e.latlng;
      const marker = focusTargetLocation(lat, lng, '查詢地名中...');
      setStatus('正在辨識自訂地標位置...');

      const resolvedName = await reverseGeocode(lat, lng);
      const updatedTarget: TargetLocation = { lat, lng, name: resolvedName };
      updateTargetLocation(updatedTarget);
      marker?.setTooltipContent(`📍 ${resolvedName}（可拖曳）`);
      setStatus(`已手動放置地標「${resolvedName}」`);

      if (activeHotelRef.current) {
        renderActiveHotelVisuals(activeHotelRef.current, updatedTarget);
      }
    });

    map.on('pm:create', (e: any) => {
      if (currentPolygonLayerRef.current) {
        currentPolygonLayerRef.current.remove();
      }
      currentPolygonLayerRef.current = e.layer;

      e.layer.on('pm:edit', () => {
        evaluatePolygonLayer(e.layer);
      });

      evaluatePolygonLayer(e.layer);
    });

    map.on('pm:remove', () => {
      currentPolygonLayerRef.current = null;
      markersLayerRef.current?.clearLayers();
      activeHotelMarkerRef.current?.remove();
      distanceLineRef.current?.remove();
      activeHotelRef.current = null;
      setSelectedHotels([]);
      setHasDrawnArea(false);
      setActiveHotelId(null);
      setActiveDistance(null);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 3. 綜合搜尋
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const keyword = searchQuery.trim();
    if (!keyword || !mapRef.current) return;

    setSearchCandidates([]);
    setAllMatchedHotels([]);
    setIsSearching(true);

    const matchedStations: SearchCandidate[] = localStationsRef.current
      .filter((s) => s.name.toLowerCase().includes(keyword.toLowerCase()))
      .slice(0, 10)
      .map((s) => ({
        id: `station-${s.id}`,
        name: s.name,
        displayName: `${s.name}（官方${s.type}車站座標）`,
        lat: s.lat,
        lng: s.lng,
        source: 'station',
      }));

    const fullMatchedHotels = allHotelsRef.current.filter((h) =>
      h.name.toLowerCase().includes(keyword.toLowerCase())
    );
    setAllMatchedHotels(fullMatchedHotels);

    const matchedHotelCandidates: SearchCandidate[] = fullMatchedHotels
      .slice(0, 10)
      .map((h) => ({
        id: `hotel-${h.id}`,
        name: h.name,
        displayName: h.address,
        lat: h.lat,
        lng: h.lng,
        source: 'hotel',
        hotelData: h,
      }));

    const normalizedKeyword = normalizeSearchKeyword(keyword);
    let osmCandidates: SearchCandidate[] = [];

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(normalizedKeyword)}&countrycodes=tw&limit=10&addressdetails=1&accept-language=zh-TW`
      );
      const data = await res.json();

      osmCandidates = data.map((item: any, idx: number) => ({
        id: `osm-${item.place_id ?? idx}`,
        name: item.name || normalizedKeyword,
        displayName: item.display_name,
        lat: Number(item.lat),
        lng: Number(item.lon),
        source: 'osm' as const,
      }));
    } catch {
      console.error('Nominatim 地標搜尋失敗，僅顯示本地資料');
    } finally {
      setIsSearching(false);
    }

    const combined = [...matchedStations, ...osmCandidates, ...matchedHotelCandidates];

    if (combined.length === 0) {
      alert('找不到相關地標或旅宿，請試試看加上縣市名稱（例如：高雄巨蛋、台北小巨蛋）');
    } else if (combined.length === 1 && fullMatchedHotels.length <= 1) {
      handleSelectCandidate(combined[0]);
    } else {
      setSearchCandidates(combined);
      setStatus(
        normalizedKeyword !== keyword
          ? `已自動校正為「${normalizedKeyword}」，請從下方選單挑選`
          : `找到相關地標與旅宿，請從下方選單挑選`
      );
    }
  }

  function handleSelectCandidate(candidate: SearchCandidate) {
    setSearchCandidates([]);
    setSearchQuery(candidate.name);
    clearDrawnSelection();

    if (candidate.source === 'hotel' && candidate.hotelData) {
      const hotel = candidate.hotelData;
      setSelectedHotels([hotel]);
      setActiveTab('results');
      setActiveHotelId(hotel.id);
      activeHotelRef.current = hotel;

      addHotelBlueMarker(hotel);
      focusTargetLocation(hotel.lat, hotel.lng, hotel.name, 17);
      setStatus(`已定位至旅宿「${hotel.name}」`);
    } else {
      setActiveTab('results');
      focusTargetLocation(candidate.lat, candidate.lng, candidate.name, 16);
      setStatus(`已定位至「${candidate.name}」，可拖曳紅點微調或直接框選周邊飯店`);
    }
  }

  function handleShowAllMatchedHotels() {
    if (allMatchedHotels.length === 0 || !mapRef.current) return;

    setSearchCandidates([]);
    clearDrawnSelection();
    setSelectedHotels(allMatchedHotels);
    setActiveTab('results');

    allMatchedHotels.forEach((h) => addHotelBlueMarker(h));

    const first = allMatchedHotels[0];
    mapRef.current.setView([first.lat, first.lng], 14);
    setStatus(`已在右側列出全部 ${allMatchedHotels.length} 間符合「${searchQuery}」的旅宿`);
  }

  function handleSelectHotel(hotel: Hotel, fromMap = false) {
    if (!mapRef.current) return;

    setActiveHotelId(hotel.id);
    activeHotelRef.current = hotel;
    renderActiveHotelVisuals(hotel, targetLocationRef.current);

    if (fromMap) {
      setActiveTab('results');
      setTimeout(() => {
        document
          .getElementById(`hotel-card-${hotel.id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      const targetZoom = Math.max(mapRef.current.getZoom(), 16);
      mapRef.current.setView([hotel.lat, hotel.lng], targetZoom);
    } else {
      mapRef.current.setView([hotel.lat, hotel.lng], 17);
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <TopSearchBar
        searchQuery={searchQuery}
        onSearchQueryChange={(val) => {
          setSearchQuery(val);
          if (searchCandidates.length > 0) setSearchCandidates([]);
        }}
        onSearch={handleSearch}
        isSearching={isSearching}
        isPlacingPin={isPlacingPin}
        onTogglePlacingPin={() => {
          setIsPlacingPin((prev) => !prev);
          setStatus(
            !isPlacingPin
              ? '請直接點擊地圖上的任意位置來放置地標'
              : '已取消手動放置地標'
          );
        }}
        searchCandidates={searchCandidates}
        onSelectCandidate={handleSelectCandidate}
        allMatchedHotels={allMatchedHotels}
        onShowAllMatchedHotels={handleShowAllMatchedHotels}
        status={status}
      />

      <div className="flex flex-1 overflow-hidden">
        <div ref={mapContainerRef} className="h-full flex-1" />

        <HotelSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedHotels={selectedHotels}
          hasDrawnArea={hasDrawnArea}
          favorites={favorites}
          activeHotelId={activeHotelId}
          activeDistance={activeDistance}
          targetLocation={targetLocation}
          onSelectHotel={(hotel) => handleSelectHotel(hotel, false)}
          onToggleFavorite={toggleFavorite}
          onUpdateFavoriteNote={updateFavoriteNote}
          onExpandPolygon={handleExpandPolygon}
          onClearDrawnSelection={clearDrawnSelection}
        />
      </div>
    </div>
  );
}