// Direction A — Dashboard + Settings screens

const ADashboard = () => (
  <ABase>
    <ATitleBar title="Dashboard" />
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <ASidebar active="Dashboard" />
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* topbar */}
        <div style={{ height: 56, padding: '0 22px', display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: `1px solid ${A.border}` }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.015em' }}>Office · RB5009UG+S+IN</div>
            <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginTop: 2 }}>
              connected · uptime 14d 03:42 · cpu load 22%
            </div>
          </div>
          <span style={{ flex: 1 }} />
          {/* simple/advanced segmented control */}
          <div style={{ display: 'flex', padding: 2, background: A.surface,
            border: `1px solid ${A.border}`, borderRadius: 8 }}>
            <div style={{ padding: '5px 12px', borderRadius: 6, background: A.accent, color: '#fff',
              fontSize: 12, fontWeight: 500 }}>Simple</div>
            <div style={{ padding: '5px 12px', borderRadius: 6, color: A.textDim, fontSize: 12 }}>Advanced</div>
          </div>
          <ABtn kind="secondary" icon={Icons.refresh}>Refresh</ABtn>
          <span style={{ position: 'relative' }}>
            <span style={{ color: A.textDim }}>{Icons.bell}</span>
            <span style={{ position: 'absolute', top: -2, right: -3, width: 7, height: 7, borderRadius: 999,
              background: A.warn, border: `2px solid ${A.bg}` }} />
          </span>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr 1fr', gridTemplateRows: 'auto auto 1fr', gap: 14 }}>

          {/* KPIs */}
          <AKpi icon={Icons.cpu} label="CPU load" plain="processor" value="22" unit="%" trend={SAMPLE_CPU} tone="accent" />
          <AKpi icon={Icons.mem} label="Memory" plain="ram in use" value="74" unit="%" trend={SAMPLE_MEM} tone="warn" detail="788 / 1024 MB" />
          <AKpi icon={Icons.disk} label="Storage" plain="flash" value="14" unit="%" detail="18 / 128 MB" tone="dim" />
          <AKpi icon={Icons.users} label="Active clients" plain="dhcp + arp" value="38" unit="" detail="6 wireless · 32 wired" tone="good" />

          {/* Traffic chart — spans 2 cols */}
          <ACard pad={0} style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px 8px' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Traffic · ether1-WAN</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>last 30 min · realtime</div>
              </div>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: A.textDim }}>
                <span style={{ width: 8, height: 2, background: A.accent, display: 'inline-block' }} /> RX
                <span style={{ fontFamily: A.mono, color: A.text, marginLeft: 2 }}>184 Mbps</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: A.textDim }}>
                <span style={{ width: 8, height: 2, background: '#A78BFA', display: 'inline-block' }} /> TX
                <span style={{ fontFamily: A.mono, color: A.text, marginLeft: 2 }}>92 Mbps</span>
              </span>
            </div>
            <div style={{ flex: 1, padding: '4px 12px 12px', position: 'relative' }}>
              <svg width="100%" height="100%" viewBox="0 0 480 140" preserveAspectRatio="none" style={{ display: 'block' }}>
                {[0,1,2,3].map(i => <line key={i} x1="0" x2="480" y1={i * 35 + 17} y2={i * 35 + 17} stroke="rgba(255,255,255,0.04)" />)}
                {/* RX */}
                <path d={pathFromValues(SAMPLE_TRAFFIC_RX, 480, 140, true)} fill="rgba(59,130,246,0.18)" />
                <path d={pathFromValues(SAMPLE_TRAFFIC_RX, 480, 140, false)} fill="none" stroke={A.accent} strokeWidth="1.6" />
                {/* TX */}
                <path d={pathFromValues(SAMPLE_TRAFFIC_TX, 480, 140, true)} fill="rgba(167,139,250,0.10)" />
                <path d={pathFromValues(SAMPLE_TRAFFIC_TX, 480, 140, false)} fill="none" stroke="#A78BFA" strokeWidth="1.4" strokeDasharray="3 3" />
              </svg>
            </div>
          </ACard>

          {/* WAN status — spans 2 cols */}
          <ACard pad={0} style={{ gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>WAN & load balance</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>pcc per-connection-classifier · 2 of 3 active</div>
              </div>
              <span style={{ flex: 1 }} />
              <ABtn kind="ghost" icon={Icons.cog}>Configure</ABtn>
            </div>
            <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { name: 'WAN1 · ether1', isp: 'Airtel · 200/200', tone: 'good', util: 0.62, bw: '124 Mbps', weight: '2x' },
                { name: 'WAN2 · ether2', isp: 'Jio · 150/150', tone: 'good', util: 0.41, bw: '62 Mbps', weight: '1x' },
                { name: 'WAN3 · sfp1', isp: 'BSNL · 100/100', tone: 'bad', util: 0, bw: 'down', weight: '—' },
              ].map(w => (
                <div key={w.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  background: A.surface, border: `1px solid ${A.border}`, borderRadius: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center',
                    background: w.tone === 'bad' ? 'rgba(239,68,68,0.10)' : 'rgba(59,130,246,0.10)',
                    color: w.tone === 'bad' ? A.bad : A.accent }}>
                    {Icons.globe}
                  </div>
                  <div style={{ minWidth: 110 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{w.name}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{w.isp}</div>
                  </div>
                  <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ width: `${w.util * 100}%`, height: '100%',
                      background: w.tone === 'bad' ? A.bad : A.accent }} />
                  </div>
                  <div style={{ fontFamily: A.mono, fontSize: 11.5, color: A.text, minWidth: 70, textAlign: 'right' }}>{w.bw}</div>
                  <APill tone={w.tone === 'bad' ? 'bad' : 'accent'} mono>{w.weight}</APill>
                </div>
              ))}
            </div>
          </ACard>

          {/* Quick actions row 1 */}
          <ACard style={{ gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>One-click actions</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>preset rules · idempotent</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              <AAction icon={Icons.block} title="Block YouTube" sub="L7 + DNS rules" tone="active" />
              <AAction icon={Icons.block} title="Block Facebook" sub="L7 + DNS rules" />
              <AAction icon={Icons.block} title="Block TikTok" sub="L7 + DNS rules" />
              <AAction icon={Icons.gauge} title="Limit speed" sub="simple queue" />
              <AAction icon={Icons.wan} title="Add load balance" sub="pcc 2-wan" />
              <AAction icon={Icons.shield} title="Safe-search" sub="dns rewrite" />
              <AAction icon={Icons.bolt} title="Speed test" sub="bandwidth-test" />
              <AAction icon={Icons.plus} title="Custom rule" sub="from snippet" />
            </div>
          </ACard>

          {/* Top talkers */}
          <ACard style={{ gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Top talkers</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>last 5 min · ip + dst</div>
              </div>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: A.textDim }}>see all</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { ip: '192.168.88.42', host: 'rohit-pc', tx: 48, rx: 12, top: 'youtube.com' },
                { ip: '192.168.88.31', host: 'reception', tx: 24, rx: 38, top: 'drive.google.com' },
                { ip: '192.168.88.107', host: 'cctv-nvr', tx: 18, rx: 4, top: '49.207.x.x' },
                { ip: '192.168.88.55', host: 'mac-design', tx: 8, rx: 22, top: 'figma.com' },
              ].map(t => (
                <div key={t.ip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px' }}>
                  <div style={{ width: 6, height: 6, borderRadius: 999, background: A.accent }} />
                  <div style={{ minWidth: 130 }}>
                    <div style={{ fontSize: 12.5 }}>{t.host}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{t.ip}</div>
                  </div>
                  <div style={{ fontSize: 11, color: A.textDim, fontFamily: A.mono, flex: 1 }}>{t.top}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontFamily: A.mono, color: A.text }}>
                    <span style={{ color: A.accent }}>↓</span>{t.rx}M
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontFamily: A.mono, color: A.text, minWidth: 42 }}>
                    <span style={{ color: '#A78BFA' }}>↑</span>{t.tx}M
                  </div>
                </div>
              ))}
            </div>
          </ACard>
        </div>
      </main>
    </div>
  </ABase>
);

const pathFromValues = (vals, w, h, fill) => {
  const max = Math.max(...vals); const min = Math.min(...vals);
  const range = max - min || 1;
  const stepX = w / (vals.length - 1);
  const pts = vals.map((v, i) => `${(i * stepX).toFixed(1)},${(h - ((v - min) / range) * (h - 12) - 6).toFixed(1)}`);
  const line = 'M' + pts.join(' L');
  return fill ? `${line} L${w},${h} L0,${h} Z` : line;
};

const AKpi = ({ icon, label, plain, value, unit, trend, tone, detail }) => {
  const toneCol = { accent: A.accent, good: A.good, warn: A.warn, bad: A.bad, dim: A.textDim }[tone] || A.accent;
  return (
    <ACard pad={14} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: toneCol, display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{plain}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
        <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', fontFamily: A.mono }}>{value}</span>
        <span style={{ fontSize: 13, color: A.textDim }}>{unit}</span>
      </div>
      {trend
        ? <div style={{ marginTop: 'auto' }}><LineChart values={trend} w={200} h={32} stroke={toneCol} fill={`${toneCol}22`} /></div>
        : <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginTop: 'auto' }}>{detail}</div>}
    </ACard>
  );
};

const AAction = ({ icon, title, sub, tone }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 11px',
    background: tone === 'active' ? A.accentSoft : A.surface,
    border: `1px solid ${tone === 'active' ? A.accentLine : A.border}`, borderRadius: 9, cursor: 'pointer' }}>
    <div style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center',
      background: tone === 'active' ? A.accent : 'rgba(255,255,255,0.04)',
      color: tone === 'active' ? '#fff' : A.accent }}>
      {icon}
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{sub}</div>
    </div>
    {tone === 'active' && <span style={{ marginLeft: 'auto', color: A.accent }}>{Icons.check}</span>}
  </div>
);

// ---------- Settings -----------------------------------------

const ASettings = () => {
  const groups = [
    { id: 'general', label: 'General', sub: 'app behavior', icon: Icons.cog, active: true },
    { id: 'connection', label: 'Connection', sub: 'api · ssl · timeouts', icon: Icons.link },
    { id: 'appearance', label: 'Appearance', sub: 'theme · density', icon: Icons.eye },
    { id: 'notifications', label: 'Notifications', sub: 'alerts · email', icon: Icons.bell },
    { id: 'backup', label: 'Backup defaults', sub: 'export · schedule', icon: Icons.save },
    { id: 'safety', label: 'Safety rails', sub: 'guardrails · simple mode', icon: Icons.shield },
    { id: 'advanced', label: 'Advanced', sub: 'cli · scripts', icon: Icons.terminal },
    { id: 'about', label: 'About', sub: 'version · licenses', icon: Icons.user },
  ];
  return (
    <ABase>
      <ATitleBar title="Settings" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Settings" />
        <main style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: '220px 1fr' }}>
          {/* settings nav */}
          <div style={{ padding: '20px 14px', borderRight: `1px solid ${A.border}`,
            display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 11, color: A.textFaint, textTransform: 'uppercase',
              letterSpacing: '0.08em', fontWeight: 600, padding: '4px 10px 8px' }}>Settings</div>
            {groups.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 8, background: g.active ? A.accentSoft : 'transparent',
                color: g.active ? '#fff' : A.textDim, cursor: 'pointer',
                borderLeft: g.active ? `2px solid ${A.accent}` : '2px solid transparent' }}>
                <span style={{ color: g.active ? A.accent : A.textFaint, display: 'flex' }}>{g.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: g.active ? 600 : 500 }}>{g.label}</div>
                  <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{g.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* settings body */}
          <div style={{ overflow: 'hidden', padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>General</h1>
              <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>app-wide preferences</span>
            </div>

            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'hidden' }}>
              <ASection title="Default mode" sub="how the app opens">
                <ARadio label="Simple" sub="plain language · presets · guardrails" checked />
                <ARadio label="Advanced" sub="full mikrotik vocabulary · raw rules" />
                <ARadio label="Remember per-router" sub="last used mode wins" />
              </ASection>

              <ASection title="Confirmations" sub="when an action changes router state">
                <AToggleRow label="Confirm before applying firewall changes" sub="show diff in /ip firewall filter" on />
                <AToggleRow label="Auto-export config before risky changes" sub="binary backup + .rsc to disk" on />
                <AToggleRow label="Run rules in safe-mode (60s revert)" sub="/system safe-mode" on={false} />
              </ASection>

              <ASection title="Telemetry" sub="anonymous diagnostics">
                <AToggleRow label="Send crash reports" sub="no router config · no credentials" on />
                <AToggleRow label="Send anonymous usage stats" sub="feature counts only" on={false} />
              </ASection>
            </div>

            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16,
              paddingTop: 14, borderTop: `1px solid ${A.border}` }}>
              <APill tone="dim" mono>changes saved automatically</APill>
              <span style={{ flex: 1 }} />
              <ABtn kind="ghost">Reset to defaults</ABtn>
              <ABtn kind="primary" icon={Icons.check}>Done</ABtn>
            </div>
          </div>
        </main>
      </div>
    </ABase>
  );
};

const ASection = ({ title, sub, children }) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>{sub}</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
  </div>
);

const ARadio = ({ label, sub, checked }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    background: A.surface, border: `1px solid ${checked ? A.accentLine : A.border}`, borderRadius: 9 }}>
    <div style={{ width: 16, height: 16, borderRadius: 999,
      border: `1.5px solid ${checked ? A.accent : 'rgba(255,255,255,0.25)'}`,
      display: 'grid', placeItems: 'center' }}>
      {checked && <div style={{ width: 7, height: 7, borderRadius: 999, background: A.accent }} />}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>{sub}</div>
    </div>
  </div>
);

Object.assign(window, { ADashboard, ASettings, AKpi, AAction, ASection, ARadio, pathFromValues });
