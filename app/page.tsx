'use client';

import dynamic from 'next/dynamic';

const TrueStayMap = dynamic(() => import('../components/TrueStayMap'), {
  ssr: false,
  loading: () => <div className="p-8 text-center">地圖載入中...</div>,
});

export default function Home() {
  return <TrueStayMap />;
}