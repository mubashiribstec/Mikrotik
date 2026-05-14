// Direction A — "Bridge"
// Friendly NOC. Mica-blurred deep navy, electric blue, rounded cards.
// Inter UI + JetBrains Mono for data.

const A = {
  bg: '#0B1220',
  // Mica vibe — radial blue glow blended over a darker navy.
  bgLayered: 'radial-gradient(120% 80% at 0% 0%, rgba(56,118,255,0.18), transparent 55%), radial-gradient(80% 60% at 100% 100%, rgba(99,102,241,0.10), transparent 60%), #0B1220',
  surface: 'rgba(255,255,255,0.035)',
  surfaceStrong: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.12)',
  text: '#E6EAF2',
  textDim: 'rgba(230,234,242,0.62)',
  textFaint: 'rgba(230,234,242,0.42)',
  accent: '#3B82F6',
  accentSoft: 'rgba(59,130,246,0.16)',
  accentLine: 'rgba(59,130,246,0.55)',
  good: '#22C55E',
  warn: '#F59E0B',
  bad: '#EF4444',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  ui: 'Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
};

// ---------- Atoms -------------------------------------------------

const ABase = ({ children }) => (
  <div style={{ width: '100%', height: '100%', background: A.bgLayered, color: A.text,
    fontFamily: A.ui, fontSize: 13, lineHeight: 1.45, letterSpacing: '-0.005em',
    display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    {children}
  </div>
);

const ATitleBar = ({ title }) => (
  <div style={{ height: 32, display: 'flex', alignItems: 'center', flex: '0 0 auto',
    borderBottom: `1px solid ${A.border}`, background: 'rgba(7,11,20,0.5)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', color: A.textDim, fontSize: 12 }}>
      <NetForgeMark size={14} color={A.accent} />
      <span style={{ fontWeight: 500, color: A.text }}>NetForge</span>
      <span style={{ color: A.textFaint }}>·</span>
      <span>{title}</span>
    </div>
    <div style={{ flex: 1 }} />
    <WinChrome accent={A.accent} />
  </div>
);

const APill = ({ children, tone = 'dim', mono = false }) => {
  const tones = {
    dim: { bg: 'rgba(255,255,255,0.05)', fg: A.textDim, dot: A.textFaint },
    good: { bg: 'rgba(34,197,94,0.12)', fg: '#86EFAC', dot: A.good },
    warn: { bg: 'rgba(245,158,11,0.12)', fg: '#FCD34D', dot: A.warn },
    bad: { bg: 'rgba(239,68,68,0.12)', fg: '#FCA5A5', dot: A.bad },
    accent: { bg: A.accentSoft, fg: '#BFDBFE', dot: A.accent },
  }[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px 3px 8px', borderRadius: 999, background: tones.bg,
      fontFamily: mono ? A.mono : A.ui, fontSize: 11, color: tones.fg, fontWeight: 500 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tones.dot }} />
      {children}
    </span>
  );
};

const ABtn = ({ children, kind = 'ghost', icon, onClick, full = false, sub }) => {
  const styles = {
    primary: { bg: A.accent, fg: '#fff', border: 'transparent', shadow: '0 1px 0 rgba(255,255,255,0.15) inset, 0 4px 14px rgba(59,130,246,0.35)' },
    secondary: { bg: A.surfaceStrong, fg: A.text, border: A.borderStrong, shadow: 'none' },
    ghost: { bg: 'transparent', fg: A.textDim, border: 'transparent', shadow: 'none' },
  }[kind];
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: sub ? '8px 14px' : '7px 12px',
      borderRadius: 8, border: `1px solid ${styles.border}`, background: styles.bg, color: styles.fg,
      fontFamily: A.ui, fontSize: 13, fontWeight: 500, cursor: 'pointer',
      boxShadow: styles.shadow, width: full ? '100%' : undefined, justifyContent: 'center',
    }}>
      {icon}
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
        <span>{children}</span>
        {sub && <span style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.7, fontFamily: A.mono, marginTop: 2 }}>{sub}</span>}
      </span>
    </button>
  );
};

const ACard = ({ children, pad = 16, style }) => (
  <div style={{ background: A.surface, border: `1px solid ${A.border}`, borderRadius: 12,
    padding: pad, backdropFilter: 'blur(8px)', ...style }}>
    {children}
  </div>
);

// ---------- Sidebar ----------------------------------------------

const ASidebar = ({ active = 'Dashboard' }) => {
  const items = [
    { label: 'Dashboard', sub: 'overview', icon: Icons.dashboard },
    { label: 'Interfaces', sub: 'ethernet · sfp', icon: Icons.iface },
    { label: 'WAN & Load Balance', sub: 'pcc · nth · failover', icon: Icons.wan },
    { label: 'Firewall', sub: 'rules · L7 · NAT', icon: Icons.shield },
    { label: 'Bandwidth', sub: 'simple queue · pcq', icon: Icons.gauge },
    { label: 'DHCP & Clients', sub: 'leases · arp', icon: Icons.users },
    { label: 'Hotspot / PPPoE', sub: 'users · profiles', icon: Icons.user },
    { label: 'Wireless', sub: 'capsman · wifi', icon: Icons.wifi },
    { label: 'VPN', sub: 'wg · l2tp · ovpn', icon: Icons.vpn },
    { label: 'Logs', sub: 'system · firewall', icon: Icons.list },
    { label: 'Scripts', sub: 'scheduler', icon: Icons.terminal },
    { label: 'Backup', sub: 'export · restore', icon: Icons.save },
  ];
  return (
    <aside style={{ width: 232, flex: '0 0 232px', borderRight: `1px solid ${A.border}`,
      display: 'flex', flexDirection: 'column', background: 'rgba(7,11,20,0.35)' }}>
      <div style={{ padding: '14px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px',
          borderRadius: 9, background: A.surface, border: `1px solid ${A.border}` }}>
          <div style={{ width: 26, height: 26, borderRadius: 7,
            background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
            display: 'grid', placeItems: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,0.08) inset' }}>
            <NetForgeMark size={15} color="#fff" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em' }}>RB5009UG+S+IN</span>
            <span style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>192.168.88.1 · v7.15</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 8px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,0.025)', border: `1px solid ${A.border}` }}>
          <span style={{ color: A.textFaint }}>{Icons.search}</span>
          <span style={{ fontSize: 12, color: A.textFaint }}>Search or run command</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: A.textFaint, fontFamily: A.mono,
            border: `1px solid ${A.border}`, borderRadius: 4, padding: '1px 5px' }}>Ctrl K</span>
        </div>
      </div>

      <nav style={{ flex: 1, overflow: 'hidden', padding: '4px 8px' }}>
        {items.map(item => {
          const isActive = item.label === active;
          return (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
              borderRadius: 8, marginBottom: 1,
              background: isActive ? A.accentSoft : 'transparent',
              color: isActive ? '#DBEAFE' : A.textDim,
              borderLeft: isActive ? `2px solid ${A.accent}` : '2px solid transparent',
              cursor: 'pointer',
            }}>
              <span style={{ color: isActive ? A.accent : A.textFaint, display: 'flex' }}>{item.icon}</span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: isActive ? 600 : 500, color: isActive ? '#fff' : A.text }}>{item.label}</span>
                <span style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{item.sub}</span>
              </span>
            </div>
          );
        })}
      </nav>

      <div style={{ padding: '8px 10px', borderTop: `1px solid ${A.border}`,
        display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 26, height: 26, borderRadius: 999, background: '#374151',
          display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600 }}>RZ</div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>admin</span>
          <span style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>full access · 1h 24m</span>
        </div>
        <span style={{ color: A.textFaint }}>{Icons.cog}</span>
      </div>
    </aside>
  );
};

// ---------- Login screen ----------------------------------------

const ALogin = () => {
  const recents = [
    { name: 'Office · RB5009', host: '192.168.88.1', last: '2 min ago', tone: 'good' },
    { name: 'Branch · hEX', host: '10.10.0.1', last: '3 days', tone: 'dim' },
    { name: 'Lab · CHR', host: '172.16.4.1:8728', last: '5 days', tone: 'dim' },
    { name: 'Datacenter · CCR2004', host: 'ccr.example.net', last: '2 weeks', tone: 'warn' },
  ];
  return (
    <ABase>
      <ATitleBar title="Connect" />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>
        {/* Left — recent connections */}
        <div style={{ padding: '32px 28px 24px 36px', borderRight: `1px solid ${A.border}`, overflow: 'hidden',
          display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #3B82F6, #6366F1)', display: 'grid', placeItems: 'center',
              boxShadow: '0 8px 24px rgba(59,130,246,0.4)' }}>
              <NetForgeMark size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>NetForge</div>
              <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>mikrotik manager · v0.4.0</div>
            </div>
          </div>
          <div style={{ marginTop: 22, fontSize: 11, color: A.textFaint, textTransform: 'uppercase',
            letterSpacing: '0.08em', fontWeight: 600 }}>Recent connections</div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'hidden' }}>
            {recents.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px',
                background: i === 0 ? A.surfaceStrong : A.surface,
                border: `1px solid ${i === 0 ? A.borderStrong : A.border}`, borderRadius: 10, cursor: 'pointer',
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 7,
                  background: 'rgba(59,130,246,0.10)', border: `1px solid ${A.border}`,
                  display: 'grid', placeItems: 'center', color: A.accent }}>
                  {Icons.iface}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>{r.host}</div>
                </div>
                <APill tone={r.tone}>{r.last}</APill>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <ABtn icon={Icons.refresh} kind="secondary">Discover on LAN</ABtn>
            <ABtn icon={Icons.plus} kind="ghost">New profile</ABtn>
          </div>
        </div>

        {/* Right — connection form */}
        <div style={{ padding: '32px 36px 24px 28px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, color: A.textFaint, textTransform: 'uppercase',
            letterSpacing: '0.08em', fontWeight: 600 }}>Connect to</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>Office · RB5009</div>
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ALabeledField label="Host" sub="ip address or hostname" value="192.168.88.1" mono />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
              <ALabeledField label="Username" sub="api user" value="admin" />
              <ALabeledField label="Port" sub="api / api-ssl" value="8728" mono />
            </div>
            <ALabeledField label="Password" sub="stored in windows credential manager" value="••••••••••••" type="password" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <AToggleRow label="Use TLS (api-ssl)" sub="recommended over WAN" on />
              <AToggleRow label="Save credentials" sub="encrypted with DPAPI" on />
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <APill tone="good" mono>last online · 14:32</APill>
            <span style={{ flex: 1 }} />
            <ABtn kind="secondary">Test</ABtn>
            <ABtn kind="primary" icon={Icons.power}>Connect</ABtn>
          </div>
        </div>
      </div>
    </ABase>
  );
};

const ALabeledField = ({ label, sub, value, type = 'text', mono = false }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>{sub}</span>
    </span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px',
      background: A.surface, border: `1px solid ${A.borderStrong}`, borderRadius: 9 }}>
      <span style={{ fontFamily: mono || type === 'password' ? A.mono : A.ui,
        fontSize: 13, color: A.text }}>{value}</span>
    </div>
  </label>
);

const AToggleRow = ({ label, sub, on }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    background: A.surface, border: `1px solid ${A.border}`, borderRadius: 9 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>{sub}</div>
    </div>
    <div style={{ width: 32, height: 18, borderRadius: 999,
      background: on ? A.accent : 'rgba(255,255,255,0.1)',
      position: 'relative', flex: '0 0 auto' }}>
      <div style={{ width: 14, height: 14, borderRadius: 999, background: '#fff',
        position: 'absolute', top: 2, left: on ? 16 : 2 }} />
    </div>
  </div>
);

Object.assign(window, { A, ABase, ATitleBar, APill, ABtn, ACard, ASidebar, ALogin,
  ALabeledField, AToggleRow });
