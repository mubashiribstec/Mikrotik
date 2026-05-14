// Direction A — Clients · DHCP, Hotspot/PPPoE, Wireless, VPN

const AClients = () => {
  const clients = [
    { ip: '192.168.88.18', mac: 'A4:5E:60:11:22:33', host: 'aman-laptop',  vendor: 'Apple',     iface: 'wlan1', lease: '23h', tx: '4M', rx: '14M', tone: 'good' },
    { ip: '192.168.88.31', mac: 'B0:7F:4E:55:66:77', host: 'reception',    vendor: 'Lenovo',    iface: 'ether3', lease: 'static', tx: '24M', rx: '38M', tone: 'accent' },
    { ip: '192.168.88.42', mac: '64:5A:ED:88:99:AA', host: 'rohit-pc',     vendor: 'Dell',      iface: 'ether4', lease: '11h', tx: '48M', rx: '12M', tone: 'good' },
    { ip: '192.168.88.55', mac: 'AC:DE:48:00:11:22', host: 'mac-design',   vendor: 'Apple',     iface: 'wlan1', lease: '22h', tx: '8M',  rx: '22M', tone: 'good' },
    { ip: '192.168.88.107', mac: '00:11:22:33:44:55', host: 'cctv-nvr',     vendor: 'Hikvision', iface: 'ether5', lease: 'static', tx: '18M', rx: '4M', tone: 'accent' },
    { ip: '192.168.88.121', mac: '5C:CF:7F:DD:EE:11', host: 'esp-sensor-3', vendor: 'Espressif', iface: 'wlan2', lease: '18h', tx: '0',   rx: '0', tone: 'dim' },
    { ip: '192.168.88.144', mac: 'F0:9F:C2:01:23:45', host: 'unknown-44',   vendor: 'Ubiquiti',  iface: 'wlan1', lease: '6h',  tx: '2M',  rx: '6M',  tone: 'warn' },
    { ip: '192.168.88.158', mac: 'D8:3A:DD:55:66:99', host: 'iphone-rohit', vendor: 'Apple',     iface: 'wlan1', lease: '4h',  tx: '12M', rx: '24M', tone: 'good' },
  ];
  return (
    <ABase>
      <ATitleBar title="DHCP & Clients" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="DHCP & Clients" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Connected clients" sub="38 active leases · 12 reserved · /ip dhcp-server lease"
            right={<><ABtn kind="ghost" icon={Icons.search}>Search</ABtn><ABtn kind="secondary" icon={Icons.refresh}>Re-scan ARP</ABtn><ABtn kind="primary" icon={Icons.plus}>Reserve IP</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14, gridAutoRows: 'min-content' }}>

            {/* mini stats */}
            <ACard pad={14}>
              <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>active leases</div>
              <div style={{ fontSize: 24, fontWeight: 600, fontFamily: A.mono, marginTop: 2 }}>38</div>
              <div style={{ fontSize: 11, color: A.textDim, marginTop: 4 }}>6 wireless · 32 wired</div>
            </ACard>
            <ACard pad={14}>
              <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>pool · 192.168.88.0/24</div>
              <div style={{ fontSize: 24, fontWeight: 600, fontFamily: A.mono, marginTop: 2 }}>15<span style={{ fontSize: 13, color: A.textDim }}>%</span></div>
              <div style={{ height: 5, marginTop: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ width: '15%', height: '100%', background: A.accent, borderRadius: 4 }} />
              </div>
            </ACard>
            <ACard pad={14}>
              <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>reserved · static</div>
              <div style={{ fontSize: 24, fontWeight: 600, fontFamily: A.mono, marginTop: 2 }}>12</div>
              <div style={{ fontSize: 11, color: A.textDim, marginTop: 4 }}>servers · printers · cctv</div>
            </ACard>
            <ACard pad={14}>
              <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>unknown / new</div>
              <div style={{ fontSize: 24, fontWeight: 600, fontFamily: A.mono, marginTop: 2, color: A.warn }}>3</div>
              <div style={{ fontSize: 11, color: A.textDim, marginTop: 4 }}>seen in last hour</div>
            </ACard>

            {/* table spans full */}
            <ACard pad={0} style={{ gridColumn: 'span 4' }}>
              <div style={{ display: 'grid',
                gridTemplateColumns: '1.4fr 1.5fr 0.9fr 0.9fr 100px 100px 24px',
                padding: '10px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                borderBottom: `1px solid ${A.border}`, gap: 8 }}>
                <span>host · vendor</span><span>ip · mac</span><span>iface</span><span>lease</span>
                <span style={{ textAlign: 'right' }}>rx</span>
                <span style={{ textAlign: 'right' }}>tx</span><span></span>
              </div>
              {clients.map(c => (
                <div key={c.ip} style={{ display: 'grid',
                  gridTemplateColumns: '1.4fr 1.5fr 0.9fr 0.9fr 100px 100px 24px',
                  padding: '10px 14px', alignItems: 'center', gap: 8,
                  borderBottom: `1px solid ${A.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999,
                      background: c.tone === 'warn' ? A.warn : (c.tone === 'dim' ? A.textFaint : A.good),
                      boxShadow: c.tone !== 'dim' ? `0 0 6px currentColor` : 'none', color: c.tone === 'warn' ? A.warn : A.good }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.host}</div>
                      <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{c.vendor}</div>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontFamily: A.mono, color: A.text }}>{c.ip}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{c.mac}</div>
                  </div>
                  <APill tone="dim" mono>{c.iface}</APill>
                  <APill tone={c.lease === 'static' ? 'accent' : 'dim'} mono>{c.lease}</APill>
                  <span style={{ fontFamily: A.mono, fontSize: 11.5, textAlign: 'right' }}>
                    <span style={{ color: A.accent }}>↓</span> {c.rx}</span>
                  <span style={{ fontFamily: A.mono, fontSize: 11.5, textAlign: 'right' }}>
                    <span style={{ color: '#A78BFA' }}>↑</span> {c.tx}</span>
                  <span style={{ color: A.textFaint }}>{Icons.chevRight}</span>
                </div>
              ))}
            </ACard>
          </div>
        </main>
      </div>
    </ABase>
  );
};

// ---------- Hotspot / PPPoE ----------------------------

const AHotspot = () => {
  const users = [
    { name: 'rohit',     plan: '20M',  online: true,  ip: '10.5.0.18',  uptime: '2h 14m', used: '4.2 GB' },
    { name: 'priya',     plan: '10M',  online: true,  ip: '10.5.0.31',  uptime: '0h 22m', used: '420 MB' },
    { name: 'aman',      plan: '50M',  online: true,  ip: '10.5.0.42',  uptime: '6h 02m', used: '12.8 GB' },
    { name: 'guest-001', plan: '5M',   online: false, ip: '—',          uptime: '—',      used: '180 MB' },
    { name: 'office-staff-44', plan: '20M', online: true, ip: '10.5.0.55', uptime: '1h 12m', used: '2.1 GB' },
    { name: 'guest-002', plan: '5M',   online: false, ip: '—',          uptime: '—',      used: '0' },
  ];
  return (
    <ABase>
      <ATitleBar title="Hotspot / PPPoE" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Hotspot / PPPoE" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Users & profiles" sub="hotspot · pppoe · /ppp secret · /ip hotspot user"
            right={<><ABtn kind="secondary" icon={Icons.list}>Profiles</ABtn><ABtn kind="primary" icon={Icons.plus}>New user</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 360px', gap: 14 }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
              {/* sub tabs */}
              <div style={{ display: 'flex', gap: 4, padding: 4, background: A.surface,
                border: `1px solid ${A.border}`, borderRadius: 9, alignSelf: 'flex-start' }}>
                {['All', 'PPPoE', 'Hotspot', 'Online now', 'Disabled'].map((t, i) => (
                  <div key={t} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12,
                    background: i === 0 ? A.accent : 'transparent',
                    color: i === 0 ? '#fff' : A.textDim, fontWeight: i === 0 ? 600 : 500, cursor: 'pointer' }}>
                    {t}
                  </div>
                ))}
              </div>

              <ACard pad={0}>
                <div style={{ display: 'grid',
                  gridTemplateColumns: '14px 1.4fr 0.8fr 1.1fr 0.9fr 0.9fr 24px',
                  padding: '10px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  borderBottom: `1px solid ${A.border}`, gap: 8 }}>
                  <span></span><span>username</span><span>plan</span>
                  <span>ip · uptime</span><span>used</span><span>status</span><span></span>
                </div>
                {users.map(u => (
                  <div key={u.name} style={{ display: 'grid',
                    gridTemplateColumns: '14px 1.4fr 0.8fr 1.1fr 0.9fr 0.9fr 24px',
                    padding: '11px 14px', alignItems: 'center', gap: 8,
                    borderBottom: `1px solid ${A.border}` }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999,
                      background: u.online ? A.good : A.textFaint }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                      <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>
                        {u.name.startsWith('guest') ? 'hotspot' : 'pppoe'}
                      </div>
                    </div>
                    <APill tone="accent" mono>{u.plan}</APill>
                    <span style={{ fontFamily: A.mono, fontSize: 11.5, color: u.online ? A.text : A.textFaint }}>
                      {u.ip} · {u.uptime}
                    </span>
                    <span style={{ fontFamily: A.mono, fontSize: 11.5 }}>{u.used}</span>
                    <APill tone={u.online ? 'good' : 'dim'} mono>{u.online ? 'online' : 'offline'}</APill>
                    <span style={{ color: A.textFaint }}>{Icons.chevRight}</span>
                  </div>
                ))}
              </ACard>
            </div>

            {/* new user form */}
            <ACard>
              <div style={{ fontSize: 13, fontWeight: 600 }}>New PPPoE user</div>
              <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginBottom: 12 }}>
                creates /ppp secret + simple queue
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ALabeledField label="Username" sub="login · unique" value="rohit-new" />
                <ALabeledField label="Password" sub="auto-generated · copy on save" value="••••••••••" type="password" />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Plan
                    <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginLeft: 6 }}>profile</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      { name: '5 Mbps · ₹299', sub: '5M / 5M · daily', sel: false },
                      { name: '20 Mbps · ₹599', sub: '20M / 20M · daily', sel: true },
                      { name: '50 Mbps · ₹999', sub: '50M / 50M · daily', sel: false },
                    ].map(p => (
                      <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
                        background: A.surface,
                        border: `1px solid ${p.sel ? A.accentLine : A.border}`, borderRadius: 8 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 999,
                          border: `1.5px solid ${p.sel ? A.accent : 'rgba(255,255,255,0.25)'}`,
                          display: 'grid', placeItems: 'center' }}>
                          {p.sel && <div style={{ width: 6, height: 6, borderRadius: 999, background: A.accent }} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{p.name}</div>
                          <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{p.sub}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <AToggleRow label="Auto-disable on overdue payment" sub="schedule · disable user N+30d" on />
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <span style={{ flex: 1 }} />
                <ABtn kind="ghost">Cancel</ABtn>
                <ABtn kind="primary" icon={Icons.plus}>Create user</ABtn>
              </div>
            </ACard>
          </div>
        </main>
      </div>
    </ABase>
  );
};

// ---------- Wireless / CAPsMAN ------------------------

const AWireless = () => {
  const aps = [
    { name: 'AP-reception',  model: 'cAP ax', clients: 12, ssid: 'NetForge-WiFi', ch: '36 · 80MHz · 5G',  tone: 'good' },
    { name: 'AP-conference', model: 'cAP ax', clients: 8,  ssid: 'NetForge-WiFi', ch: '149 · 80MHz · 5G', tone: 'good' },
    { name: 'AP-warehouse',  model: 'wAP ac', clients: 4,  ssid: 'NetForge-WiFi', ch: '6 · 20MHz · 2.4G', tone: 'warn' },
    { name: 'AP-rooftop',    model: 'cAP ax', clients: 0,  ssid: '—',             ch: '—',                tone: 'bad'  },
  ];
  return (
    <ABase>
      <ATitleBar title="Wireless" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Wireless" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Wireless · CAPsMAN" sub="centralized AP control · 4 capabilities · 24 clients"
            right={<><ABtn kind="secondary" icon={Icons.refresh}>Provision all</ABtn><ABtn kind="primary" icon={Icons.plus}>New SSID</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 1fr', gap: 14, gridTemplateRows: 'auto 1fr' }}>

            {/* SSIDs */}
            <ACard style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Networks (SSIDs)</div>
                  <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>configurations · /caps-man configuration</div>
                </div>
                <span style={{ flex: 1 }} />
                <ABtn kind="ghost" icon={Icons.plus}>Add</ABtn>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { ssid: 'NetForge-WiFi', sec: 'WPA2/3', vlan: '88', clients: 24, sel: true,  tone: 'accent', col: A.accent },
                  { ssid: 'NetForge-Guest', sec: 'WPA2',  vlan: '99', clients: 6,  sel: false, tone: 'good',   col: '#34D399' },
                  { ssid: 'NetForge-IoT',   sec: 'WPA2',  vlan: '77', clients: 18, sel: false, tone: 'warn',   col: '#A78BFA' },
                ].map(s => (
                  <div key={s.ssid} style={{ padding: '12px 14px', background: s.sel ? A.accentSoft : A.surface,
                    border: `1.5px solid ${s.sel ? A.accent : A.border}`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: s.col, display: 'flex' }}>{Icons.wifi}</span>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{s.ssid}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <APill tone="dim" mono>{s.sec}</APill>
                      <APill tone="dim" mono>vlan {s.vlan}</APill>
                      <APill tone="accent" mono>{s.clients} clients</APill>
                    </div>
                  </div>
                ))}
              </div>
            </ACard>

            {/* APs list */}
            <ACard pad={0}>
              <div style={{ padding: '14px 16px 8px' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Access points</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>cap interfaces · 4 provisioned</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {aps.map(a => (
                  <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                    borderTop: `1px solid ${A.border}` }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8,
                      background: a.tone === 'bad' ? 'rgba(239,68,68,0.10)' : 'rgba(59,130,246,0.10)',
                      color: a.tone === 'bad' ? A.bad : A.accent,
                      display: 'grid', placeItems: 'center' }}>
                      {Icons.wifi}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
                      <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>
                        {a.model} · ch {a.ch}
                      </div>
                    </div>
                    <APill tone={a.tone}>{a.tone === 'bad' ? 'offline' : (a.tone === 'warn' ? 'low signal' : 'online')}</APill>
                    <span style={{ fontFamily: A.mono, fontSize: 11.5, color: A.text, minWidth: 60, textAlign: 'right' }}>
                      {a.clients} clients
                    </span>
                  </div>
                ))}
              </div>
            </ACard>

            {/* spectrum */}
            <ACard>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Channel utilization</div>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>5 GHz · last 5m</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, marginTop: 4 }}>
                {[36, 40, 44, 48, 149, 153, 157, 161].map((ch, i) => {
                  const u = [0.3, 0.42, 0.18, 0.62, 0.82, 0.34, 0.46, 0.22][i];
                  const color = u > 0.7 ? A.bad : u > 0.5 ? A.warn : A.accent;
                  return (
                    <div key={ch} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: '100%', height: 70, background: 'rgba(255,255,255,0.03)',
                        border: `1px solid ${A.border}`, borderRadius: 4, position: 'relative' }}>
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
                          height: `${u * 100}%`, background: color, borderRadius: '0 0 3px 3px' }} />
                      </div>
                      <span style={{ fontSize: 10.5, fontFamily: A.mono, color: A.textDim }}>{ch}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: A.surface, border: `1px solid ${A.border}`, borderRadius: 8 }}>
                <span style={{ color: A.warn }}>{Icons.bell}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>Channel 149 is congested (82%)</div>
                  <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>Recommend moving AP-conference to ch 161</div>
                </div>
                <ABtn kind="secondary">Move</ABtn>
              </div>
            </ACard>
          </div>
        </main>
      </div>
    </ABase>
  );
};

// ---------- VPN ----------------------------

const AVpn = () => (
  <ABase>
    <ATitleBar title="VPN" />
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <ASidebar active="VPN" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ATopBar title="VPN" sub="WireGuard · L2TP/IPsec · OpenVPN · /interface wireguard"
          right={<ABtn kind="primary" icon={Icons.plus}>New peer</ABtn>} />
        <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr', gap: 14, gridAutoRows: 'min-content' }}>

          {/* protocol cards */}
          {[
            { k: 'wg', name: 'WireGuard', plain: 'modern · fast', port: 'udp 51820', peers: 8, on: true,  tone: 'accent', icon: Icons.bolt },
            { k: 'l2', name: 'L2TP / IPsec', plain: 'windows native', port: 'udp 500/4500', peers: 3, on: true, tone: 'good', icon: Icons.lock },
            { k: 'ov', name: 'OpenVPN',   plain: 'tls · compatible', port: 'tcp 1194', peers: 0, on: false, tone: 'dim',    icon: Icons.vpn  },
          ].map(p => (
            <ACard key={p.k} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8,
                  background: p.on ? A.accentSoft : 'rgba(255,255,255,0.04)',
                  color: p.on ? A.accent : A.textFaint, display: 'grid', placeItems: 'center' }}>
                  {p.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>{p.plain}</div>
                </div>
                <div style={{ width: 32, height: 18, borderRadius: 999,
                  background: p.on ? A.accent : 'rgba(255,255,255,0.08)', position: 'relative' }}>
                  <div style={{ width: 14, height: 14, borderRadius: 999, background: '#fff',
                    position: 'absolute', top: 2, left: p.on ? 16 : 2 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <APill tone="dim" mono>{p.port}</APill>
                <APill tone={p.on ? 'good' : 'dim'} mono>{p.peers} peers</APill>
              </div>
            </ACard>
          ))}

          {/* WG peers */}
          <ACard pad={0} style={{ gridColumn: 'span 2' }}>
            <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>WireGuard peers</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>wg0 · 51820 · 8 peers · 6 connected</div>
              </div>
              <span style={{ flex: 1 }} />
              <ABtn kind="ghost" icon={Icons.plus}>Add peer</ABtn>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                { name: 'office-laptop', ip: '10.8.0.2', last: '2s ago', tx: '124M', rx: '38M', on: true },
                { name: 'iphone-rohit',  ip: '10.8.0.3', last: '12s ago', tx: '4M', rx: '6M', on: true },
                { name: 'home-pc',       ip: '10.8.0.4', last: '1m ago',  tx: '888M', rx: '1.2G', on: true },
                { name: 'travel-laptop', ip: '10.8.0.5', last: '2d ago',  tx: '0', rx: '0', on: false },
                { name: 'cctv-bridge',   ip: '10.8.0.6', last: '4s ago',  tx: '14M', rx: '6M', on: true },
              ].map(p => (
                <div key={p.name} style={{ display: 'grid',
                  gridTemplateColumns: '14px 1.6fr 1fr 1fr 100px 24px',
                  padding: '11px 16px', alignItems: 'center', gap: 8,
                  borderTop: `1px solid ${A.border}` }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999,
                    background: p.on ? A.good : A.textFaint }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{p.ip}</div>
                  </div>
                  <span style={{ fontSize: 11.5, fontFamily: A.mono, color: A.textDim }}>last · {p.last}</span>
                  <span style={{ fontFamily: A.mono, fontSize: 11.5 }}>
                    <span style={{ color: A.accent }}>↓</span> {p.rx}
                    <span style={{ marginLeft: 8, color: '#A78BFA' }}>↑</span> {p.tx}
                  </span>
                  <APill tone={p.on ? 'good' : 'dim'} mono>{p.on ? 'online' : 'offline'}</APill>
                  <span style={{ color: A.textFaint }}>{Icons.chevRight}</span>
                </div>
              ))}
            </div>
          </ACard>

          <ACard>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Add WireGuard client</div>
            <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginBottom: 10 }}>
              generates QR for phone · .conf for desktop
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ALabeledField label="Peer name" sub="any label" value="manager-iphone" />
              <ALabeledField label="Allowed IPs" sub="route through tunnel" value="0.0.0.0/0" mono />
              {/* QR placeholder */}
              <div style={{ aspectRatio: '1', maxHeight: 160, background: 'repeating-linear-gradient(45deg, #fff, #fff 6px, #0B1220 6px, #0B1220 12px)',
                border: `1px solid ${A.borderStrong}`, borderRadius: 8, position: 'relative', alignSelf: 'center', width: 160 }}>
                <div style={{ position: 'absolute', inset: 16, background: '#fff', display: 'grid', placeItems: 'center',
                  fontFamily: A.mono, fontSize: 10, color: '#0B1220' }}>QR · scan in WG app</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <ABtn kind="secondary">Download .conf</ABtn>
                <span style={{ flex: 1 }} />
                <ABtn kind="primary" icon={Icons.plus}>Create</ABtn>
              </div>
            </div>
          </ACard>
        </div>
      </main>
    </div>
  </ABase>
);

Object.assign(window, { AClients, AHotspot, AWireless, AVpn });
