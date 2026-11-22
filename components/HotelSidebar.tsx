'use client';

import React from 'react';
import { FavoriteHotel, Hotel, TargetLocation } from '../types/truestay';

interface HotelSidebarProps {
  activeTab: 'results' | 'favorites';
  onTabChange: (tab: 'results' | 'favorites') => void;
  selectedHotels: Hotel[];
  hasDrawnArea: boolean;
  favorites: FavoriteHotel[];
  activeHotelId: string | null;
  activeDistance: string | null;
  targetLocation: TargetLocation | null;
  onSelectHotel: (hotel: Hotel) => void;
  onToggleFavorite: (hotel: Hotel, e: React.MouseEvent) => void;
  onUpdateFavoriteNote: (hotelId: string, note: string) => void;
  onExpandPolygon: () => void;
  onClearDrawnSelection: () => void;
}

export default function HotelSidebar({
  activeTab,
  onTabChange,
  selectedHotels,
  hasDrawnArea,
  favorites,
  activeHotelId,
  activeDistance,
  targetLocation,
  onSelectHotel,
  onToggleFavorite,
  onUpdateFavoriteNote,
  onExpandPolygon,
  onClearDrawnSelection,
}: HotelSidebarProps) {
  return (
    <div className="flex w-80 flex-col border-l bg-white text-slate-800">
      {/* 分頁切換列 */}
      <div className="flex border-b bg-slate-50 text-sm font-semibold">
        <button
          type="button"
          onClick={() => onTabChange('results')}
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
          onClick={() => onTabChange('favorites')}
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
                    onClick={onExpandPolygon}
                    className="w-full rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                  >
                    🔍 往外擴大 500 公尺重找
                  </button>
                  <button
                    type="button"
                    onClick={onClearDrawnSelection}
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
                    onClick={() => onSelectHotel(h)}
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
                        onClick={(e) => onToggleFavorite(h, e)}
                        title={isFav ? '移除收藏' : '加入收藏'}
                        className="shrink-0 text-base leading-none transition hover:scale-110"
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
                  onClick={() => onSelectHotel(h)}
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
                      onClick={(e) => onToggleFavorite(h, e)}
                      title="移除收藏"
                      className="shrink-0 text-base leading-none transition hover:scale-110"
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

                  <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={h.note}
                      onChange={(e) => onUpdateFavoriteNote(h.id, e.target.value)}
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
  );
}