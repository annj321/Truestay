// 【方法 1】台灣常見地標說法自動校正（對齊 OpenStreetMap 命名習慣）
export function normalizeSearchKeyword(raw: string): string {
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
export function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} 公尺`
    : `${(meters / 1000).toFixed(2)} 公里`;
}

// 反向地理編碼：透過經緯度反查該處的真實地名或路名
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
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