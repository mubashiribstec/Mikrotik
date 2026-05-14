// Shared icons + small helpers used by both directions.
// Stroke icons sized via currentColor; size via prop.

const Icon = ({ d, size = 16, sw = 1.6, fill = 'none', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

const Icons = {
  // nav
  dashboard: <Icon d={<><rect x="3" y="3" width="7" height="9" rx="1.2"/><rect x="14" y="3" width="7" height="5" rx="1.2"/><rect x="14" y="12" width="7" height="9" rx="1.2"/><rect x="3" y="16" width="7" height="5" rx="1.2"/></>} />,
  iface: <Icon d={<><rect x="3" y="8" width="18" height="10" rx="1.5"/><path d="M7 12v2M11 12v2M15 12v2M19 12v2"/></>} />,
  wan: <Icon d={<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>} />,
  shield: <Icon d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />,
  gauge: <Icon d={<><path d="M12 14l5-5"/><circle cx="12" cy="14" r="0.8" fill="currentColor"/><path d="M3 14a9 9 0 0 1 18 0"/></>} />,
  users: <Icon d={<><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M21 19c0-2.7-1.7-5-4-5"/></>} />,
  wifi: <Icon d={<><path d="M2 9c5.5-5 14.5-5 20 0"/><path d="M5 13c4-3.5 10-3.5 14 0"/><path d="M8.5 17c2-1.7 5-1.7 7 0"/><circle cx="12" cy="20" r="0.8" fill="currentColor"/></>} />,
  vpn: <Icon d={<><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>} />,
  list: <Icon d={<><path d="M4 6h16M4 12h16M4 18h10"/></>} />,
  terminal: <Icon d={<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h5"/></>} />,
  save: <Icon d={<><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/></>} />,
  cog: <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .4 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.4 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .4-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1A2 2 0 1 1 6.9 4.2l.1.1a1.7 1.7 0 0 0 1.9.4H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.4 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>} />,
  cpu: <Icon d={<><rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="0.5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></>} />,
  mem: <Icon d={<><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M7 6v12M11 6v12M15 6v12M19 6v12"/></>} />,
  disk: <Icon d={<><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>} />,
  arrowDown: <Icon d="M12 5v14M5 12l7 7 7-7" />,
  arrowUp: <Icon d="M12 19V5M5 12l7-7 7 7" />,
  arrowRight: <Icon d="M5 12h14M13 5l7 7-7 7" />,
  arrowLeft: <Icon d="M19 12H5M11 19l-7-7 7-7" />,
  search: <Icon d={<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>} />,
  bell: <Icon d={<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 0 0 4 0"/></>} />,
  plus: <Icon d="M12 5v14M5 12h14" />,
  check: <Icon d="M5 12l4 4 10-10" />,
  x: <Icon d="M6 6l12 12M18 6L6 18" />,
  chevDown: <Icon d="M6 9l6 6 6-6" />,
  chevRight: <Icon d="M9 6l6 6-6 6" />,
  eye: <Icon d={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>} />,
  link: <Icon d={<><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>} />,
  power: <Icon d={<><path d="M12 3v9"/><path d="M5.6 7a8 8 0 1 0 12.8 0"/></>} />,
  refresh: <Icon d={<><path d="M21 12a9 9 0 0 1-15.5 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.4L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></>} />,
  globe: <Icon d={<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 4 6 4 9s-1.5 6-4 9c-2.5-3-4-6-4-9s1.5-6 4-9z"/></>} />,
  lock: <Icon d={<><rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>} />,
  user: <Icon d={<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>} />,
  bolt: <Icon d="M13 3 4 14h7l-1 7 9-11h-7z" />,
  drag: <Icon d={<><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></>} />,
  block: <Icon d={<><circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/></>} />,
};

// Brand mark — original hex-node logo for "NetForge"
const NetForgeMark = ({ size = 22, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="2.6" fill={color} />
    <path d="M12 9.4V4M12 14.6V20M9.6 10.7 5 8.2M14.4 13.3 19 15.8M9.6 13.3 5 15.8M14.4 10.7 19 8.2" stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity="0.65" />
  </svg>
);

// Win11 traffic-light cluster (top right). Active flag controls active bg.
const WinChrome = ({ accent = '#3b82f6', tone = 'dark' }) => {
  const fg = tone === 'dark' ? 'rgba(255,255,255,.78)' : 'rgba(0,0,0,.78)';
  const hover = tone === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  return (
    <div style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' }}>
      {[
        <path key="m" d="M3 8h10" stroke={fg} strokeWidth="1" />,
        <g key="x"><rect x="3" y="3" width="10" height="10" stroke={fg} strokeWidth="1" fill="none" /></g>,
        <path key="c" d="M3 3l10 10M13 3 3 13" stroke={fg} strokeWidth="1" />,
      ].map((g, i) => (
        <div key={i} style={{ width: 46, display: 'grid', placeItems: 'center', cursor: 'default',
            background: i === 2 ? undefined : 'transparent' }}
            onMouseEnter={e => e.currentTarget.style.background = i === 2 ? '#e81123' : hover}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <svg width="16" height="16" viewBox="0 0 16 16">{g}</svg>
        </div>
      ))}
    </div>
  );
};

// Tiny inline sparkline-ish line chart from a values array.
const LineChart = ({ values, w = 280, h = 60, stroke = '#3b82f6', fill = 'rgba(59,130,246,0.15)', dashed = false }) => {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(1)}`);
  const linePath = 'M' + pts.join(' L');
  const fillPath = `${linePath} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={fillPath} fill={fill} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round"
            strokeDasharray={dashed ? '3 3' : undefined} />
    </svg>
  );
};

// Bar chart for traffic distribution
const BarChart = ({ values, w = 280, h = 60, color = '#3b82f6' }) => {
  const max = Math.max(...values, 1);
  const bw = (w - (values.length - 1) * 2) / values.length;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {values.map((v, i) => {
        const bh = (v / max) * (h - 2);
        return <rect key={i} x={i * (bw + 2)} y={h - bh} width={bw} height={bh} rx={Math.min(2, bw/3)} fill={color} opacity={0.35 + (v / max) * 0.65} />;
      })}
    </svg>
  );
};

// Sample traffic data, mostly stable with one peak
const SAMPLE_TRAFFIC_RX = [22,28,24,30,40,32,38,55,72,68,90,84,72,68,55,62,70,82,95,88,76,72,68,70,75,80,72,68];
const SAMPLE_TRAFFIC_TX = [12,16,18,15,22,18,22,28,38,36,48,45,38,35,28,32,36,42,50,46,40,38,35,36,40,42,38,36];
const SAMPLE_CPU = [18,22,24,20,28,32,26,30,42,38,36,32,30,28,34,40,52,48,44,42,38,36,34,32,30,28,30,32];
const SAMPLE_MEM = [62,64,63,65,66,67,68,68,69,70,71,72,72,73,73,74,74,75,75,76,76,76,77,77,76,76,75,75];

Object.assign(window, {
  Icon, Icons, NetForgeMark, WinChrome, LineChart, BarChart,
  SAMPLE_TRAFFIC_RX, SAMPLE_TRAFFIC_TX, SAMPLE_CPU, SAMPLE_MEM,
});
