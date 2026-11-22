'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import * as turf from '@turf/turf';

interface Hotel {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  parking?: string;
  picture?: string;
}

interface FavoriteHotel extends Hotel {
  note: string;
  savedAt: number;
}

// 【方法 3 預留接口】未來匯入政府捷運/台鐵車站 JSON 用的資料結構
interface LocalStation {
  id: string;
  name: string;
  type: 'MRT' | 'TRA' | 'LRT';
  lat: number;
  lng: number;
}

interface TargetLocation {
  lat: number;
  lng: number;
  name: string;
}

interface SearchCandidate {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  source: 'station' | 'osm' | 'hotel';
  hotelData?: Hotel;
}

const FAVORITES_STORAGE_KEY = 'truestay_favorites_v1';

// 【方法 1】台灣常見地標說法自動校正（對齊 OpenStreetMap 命名習慣）
function normalizeSearchKeyword(raw: string): string {
  let q = raw.trim();
  if (/^(.+)捷運站$/.test(q) && !q.startsWith('捷運')) {
    q = q.replace(/^(.+)捷運站$/, '捷運$1站');
  }
  if (/^(.+)火車站$/.test(q)) {
    q = q.replace(/^(.+)火車站$/, '$1車站');
  }
  return q;
}

// 格式化距離顯示
function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} 公尺`
    : `${(meters / 1000).toFixed(2)} 公里`;
}

// 反向地理編碼：透過經緯度反查該處的真實地名或路名
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=zh-TW`
    );
    const data = await res.json();
    if (data?.name) return data.name;
    const addr = data?.address;
    if (addr) {
      const road = addr.road || addr.pedestrian || addr.neighbourhood || addr.suburb;
      const house = addr.house_number ? `${addr.house_number}號` : '';
      if (road) return `${road}${house}`;
    }
    if (data?.display_name) {
      return data.display_name.split(',')[0];
    }
    return '自訂地標';
  } catch {
    return '自訂地標';
  }
}

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
  const targetLocationRef = useRef<TargetLocation | null>(null); // 確保點擊地圖藍點時永遠讀到最新地標
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

  // 同步更新地標 state 與 ref
  function updateTargetLocation(next: TargetLocation | null) {
    targetLocationRef.current = next;
    setTargetLocation(next);
  }

  // 載入已儲存的收藏清單（localStorage）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (saved) {
        setFavorites(JSON.parse(saved));
      }
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
      const newFav: FavoriteHotel = {
        ...hotel,
        note: '',
        savedAt: Date.now(),
      };
      persistFavorites([newFav, ...favorites]);
    }
  }

  function updateFavoriteNote(hotelId: string, note: string) {
    const next = favorites.map((f) =>
      f.id === hotelId ? { ...f, note } : f
    );
    persistFavorites(next);
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

  // 共用工具：清除地圖上所有已畫的多邊形與框選結果
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

  // 共用工具：在地圖上畫一顆可點擊的藍色飯店點（點擊後與右側清單完全連動）
  function addHotelBlueMarker(hotel: Hotel) {
    if (!markersLayerRef.current) return;

    const dot = L.circleMarker([hotel.lat, hotel.lng], {
      radius: 7,
      fillColor: '#2563eb',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.9,
    });

    // 滑鼠移過顯示名稱，點擊直接觸發選中與距離計算
    dot.bindTooltip(hotel.name, { direction: 'top', offset: [0, -8] });
    dot.on('click', (e) => {
      L.DomEvent.stopPropagation(e); // 避免同時觸發地圖的「手動放地標」點擊事件
      handleSelectHotel(hotel, true);
    });

    dot.addTo(markersLayerRef.current);
  }

  // 共用工具：根據框選的多邊形圖層篩選飯店，並自動切換空框/有結果樣式
  function evaluatePolygonLayer(layer: any) {
    const rawGeo = layer.toGeoJSON();
    const polygonFeature =
      rawGeo.type === 'FeatureCollection' ? rawGeo.features[0] : rawGeo;

    if (!polygonFeature) return;

    const inside = allHotelsRef.current.filter((h) =>
      turf.booleanPointInPolygon(turf.point([h.lng, h.lat]), polygonFeature)
    );

    if (typeof layer.setStyle === 'function') {
      if (inside.length === 0) {
        layer.setStyle({
          color: '#ef4444',
          fillColor: '#ef4444',
          fillOpacity: 0.12,
          dashArray: '6, 6',
          weight: 2,
        });
      } else {
        layer.setStyle({
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
          dashArray: '',
          weight: 2,
        });
      }
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

  // 一鍵往外擴大目前框選範圍 500 公尺
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

  // 共用工具：重繪「目標地標 <-> 選中飯店」的虛線、距離與綠色標誌
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

  // 共用工具：插上「可自由拖曳」的紅色目的地標誌
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

  // 3. 綜合搜尋：專心找全台車站、地標與旅宿
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

  // 4. 點選飯店（不論從右側清單或直接點地圖藍點，都會走這裡）
  function handleSelectHotel(hotel: Hotel, fromMap = false) {
    if (!mapRef.current) return;

    setActiveHotelId(hotel.id);
    activeHotelRef.current = hotel;
    renderActiveHotelVisuals(hotel, targetLocationRef.current);

    if (fromMap) {
      // 從地圖點藍點時：切換回框選結果分頁，並自動捲動右側清單到該飯店卡片
      setActiveTab('results');
      setTimeout(() => {
        document
          .getElementById(`hotel-card-${hotel.id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      // 保持目前縮放等級平滑移動過去（若原本縮太小才稍微放大到 16）
      const targetZoom = Math.max(mapRef.current.getZoom(), 16);
      mapRef.current.setView([hotel.lat, hotel.lng], targetZoom);
    } else {
      mapRef.current.setView([hotel.lat, hotel.lng], 17);
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      {/* 頂部搜尋列 */}
      <div className="relative z-[1100] flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
        <div className="font-bold text-lg">TrueStay 地圖驗證版</div>

        {/* 搜尋框 + 手動放地標按鈕 */}
        <div className="relative flex items-center gap-2">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (searchCandidates.length > 0) setSearchCandidates([]);
              }}
              placeholder="輸入地標或飯店名稱（如：巨蛋、西門捷運站）"
              className="w-72 rounded bg-white px-3 py-1.5 text-sm text-black"
            />
            <button
              type="submit"
              disabled={isSearching}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:bg-blue-800"
            >
              {isSearching ? '搜尋中...' : '搜尋'}
            </button>
          </form>

          {/* 手動放地標切換按鈕 */}
          <button
            type="button"
            onClick={() => {
              setIsPlacingPin((prev) => !prev);
              setStatus(
                !isPlacingPin
                  ? '請直接點擊地圖上的任意位置來放置地標'
                  : '已取消手動放置地標'
              );
            }}
            className={`rounded px-3 py-1.5 text-sm font-medium transition ${
              isPlacingPin
                ? 'bg-rose-600 text-white ring-2 ring-rose-300'
                : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
            }`}
          >
            {isPlacingPin ? '🎯 請點地圖放置（取消）' : '📍 手動放地標'}
          </button>

          {/* 綜合下拉選單 */}
          {searchCandidates.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-96 overflow-hidden rounded-md border border-slate-200 bg-white text-slate-800 shadow-lg">
              <ul className="max-h-72 overflow-y-auto">
                {searchCandidates.map((c) => (
                  <li
                    key={c.id}
                    onClick={() => handleSelectCandidate(c)}
                    className="cursor-pointer border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 hover:bg-blue-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {c.source === 'station' && '🚇 '}
                        {c.source === 'osm' && '📍 '}
                        {c.source === 'hotel' && '🏨 '}
                        {c.name}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          c.source === 'hotel'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {c.source === 'station' && '車站'}
                        {c.source === 'osm' && '地標'}
                        {c.source === 'hotel' && '旅宿'}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-slate-500">
                      {c.displayName}
                    </div>
                  </li>
                ))}
              </ul>

              {allMatchedHotels.length > 1 && (
                <button
                  type="button"
                  onClick={handleShowAllMatchedHotels}
                  className="w-full border-t border-slate-200 bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  🏨 查看全部 {allMatchedHotels.length} 間相符旅宿 ➔
                </button>
              )}
            </div>
          )}
        </div>

        <div className="text-xs text-slate-300">{status}</div>
      </div>

      {/* 主畫面：左地圖、右雙分頁清單 */}
      <div className="flex flex-1 overflow-hidden">
        <div ref={mapContainerRef} className="h-full flex-1" />

        <div className="flex w-80 flex-col border-l bg-white text-slate-800">
          {/* 分頁切換列 */}
          <div className="flex border-b bg-slate-50 text-sm font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={`flex-1 py-2.5 text-center transition ${
                activeTab === 'results'
                  ? 'border-b-2 border-blue-600 bg-white text-blue-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              🔍 框選結果 ({selectedHotels.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('favorites')}
              className={`flex-1 py-2.5 text-center transition ${
                activeTab === 'favorites'
                  ? 'border-b-2 border-rose-500 bg-white text-rose-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              ❤️ 收藏清單 ({favorites.length})
            </button>
          </div>

          {/* 分頁內容區 */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'results' ? (
              selectedHotels.length === 0 ? (
                hasDrawnArea ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-center">
                    <div className="text-sm font-semibold text-rose-700">
                      這個範圍內目前沒有合法旅宿
                    </div>
                    <p className="mt-1.5 text-xs text-rose-600/90">
                      你可以往外擴大目前範圍，或直接在地圖上重畫一個新框（會自動取代舊框）。
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleExpandPolygon}
                        className="w-full rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                      >
                        🔍 往外擴大 500 公尺重找
                      </button>
                      <button
                        type="button"
                        onClick={clearDrawnSelection}
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        清除目前框選
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    請先搜尋地標或點上方「📍 手動放地標」，再點地圖左上角的「多邊形」或「矩形」圖示框選想住的區域。
                  </p>
                )
              ) : (
                <ul className="space-y-3">
                  {selectedHotels.map((h) => {
                    const isSelected = activeHotelId === h.id;
                    const isFav = favorites.some((f) => f.id === h.id);
                    return (
                      <li
                        key={h.id}
                        id={`hotel-card-${h.id}`}
                        onClick={() => handleSelectHotel(h)}
                        className={`cursor-pointer rounded border p-3 transition ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                            : 'hover:bg-blue-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-sm">{h.name}</div>
                          <button
                            type="button"
                            onClick={(e) => toggleFavorite(h, e)}
                            title={isFav ? '移除收藏' : '加入收藏'}
                            className="shrink-0 text-base leading-none hover:scale-110 transition"
                          >
                            {isFav ? '❤️' : '🤍'}
                          </button>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{h.address}</div>
                        {h.parking && (
                          <div className="mt-1 text-xs text-emerald-700">
                            🅿️ {h.parking}
                          </div>
                        )}
                        {isSelected && activeDistance && targetLocation && (
                          <div className="mt-2 inline-block rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
                            📏 距「{targetLocation.name}」約 {activeDistance}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : favorites.length === 0 ? (
              <p className="text-sm text-slate-500">
                目前還沒有收藏任何飯店。點擊飯店卡片右上角的 🤍 即可加入收藏，並記錄個人優缺點筆記！
              </p>
            ) : (
              <ul className="space-y-3">
                {favorites.map((h) => {
                  const isSelected = activeHotelId === h.id;
                  return (
                    <li
                      key={h.id}
                      onClick={() => handleSelectHotel(h)}
                      className={`cursor-pointer rounded border p-3 transition ${
                        isSelected
                          ? 'border-rose-400 bg-rose-50/60 ring-1 ring-rose-400'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-sm">{h.name}</div>
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(h, e)}
                          title="移除收藏"
                          className="shrink-0 text-base leading-none hover:scale-110 transition"
                        >
                          ❤️
                        </button>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{h.address}</div>
                      {h.parking && (
                        <div className="mt-1 text-xs text-emerald-700">
                          🅿️ {h.parking}
                        </div>
                      )}
                      {isSelected && activeDistance && targetLocation && (
                        <div className="mt-2 inline-block rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
                          📏 距「{targetLocation.name}」約 {activeDistance}
                        </div>
                      )}

                      <div
                        className="mt-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <textarea
                          value={h.note}
                          onChange={(e) => updateFavoriteNote(h.id, e.target.value)}
                          placeholder="記錄優點、房價或備註（自動存檔）..."
                          rows={2}
                          className="w-full resize-none rounded border border-slate-200 bg-white p-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-rose-400 focus:outline-none"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}