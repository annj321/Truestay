'use client';

import React from 'react';
import { Hotel, SearchCandidate } from '../types/truestay';

interface TopSearchBarProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearch: (e: React.FormEvent) => void;
  isSearching: boolean;
  isPlacingPin: boolean;
  onTogglePlacingPin: () => void;
  searchCandidates: SearchCandidate[];
  onSelectCandidate: (candidate: SearchCandidate) => void;
  allMatchedHotels: Hotel[];
  onShowAllMatchedHotels: () => void;
  status: string;
}

export default function TopSearchBar({
  searchQuery,
  onSearchQueryChange,
  onSearch,
  isSearching,
  isPlacingPin,
  onTogglePlacingPin,
  searchCandidates,
  onSelectCandidate,
  allMatchedHotels,
  onShowAllMatchedHotels,
  status,
}: TopSearchBarProps) {
  return (
    <div className="relative z-[1100] flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
      <div className="font-bold text-lg">TrueStay 地圖驗證版</div>

      {/* 搜尋框 + 手動放地標按鈕 */}
      <div className="relative flex items-center gap-2">
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
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
          onClick={onTogglePlacingPin}
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
                  onClick={() => onSelectCandidate(c)}
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
                onClick={onShowAllMatchedHotels}
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
  );
}