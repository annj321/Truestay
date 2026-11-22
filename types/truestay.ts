export interface Hotel {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  parking?: string;
  picture?: string;
}

export interface FavoriteHotel extends Hotel {
  note: string;
  savedAt: number;
}

// 【方法 3 預留接口】未來匯入政府捷運/台鐵車站 JSON 用的資料結構
export interface LocalStation {
  id: string;
  name: string;
  type: 'MRT' | 'TRA' | 'LRT';
  lat: number;
  lng: number;
}

export interface TargetLocation {
  lat: number;
  lng: number;
  name: string;
}

export interface SearchCandidate {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  source: 'station' | 'osm' | 'hotel';
  hotelData?: Hotel;
}