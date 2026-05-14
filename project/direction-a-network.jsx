// Direction A — additional screens · part 1: Interfaces, WAN & Load Balance,
// Firewall (block sites), Bandwidth (simple queues).

// --- Shared sub-bits ---------------------------------------

const ATopBar = ({ title, sub, right }) => (
  <div style={{ height: 56, padding: '0 22px', display: 'flex', alignItems: 'center', gap: 12,
    borderBottom: `1px solid ${A.border}`, flex: '0 0 auto' }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.015em' }}>{title}</div>
      <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginTop: 2 }}>{sub}</div>
    </div>
    <span style={{ flex: 1 }} />
    <div style={{ display: 'flex', padding: 2, background: A.surface,
      border: `1px solid ${A.border}`, borderRadius: 8 }}>
      <div style={{ padding: '5px 12px', borderRadius: 6, background: A.accent, color: '#fff',
        fontSize: 12, fontWeight: 500 }}>Simple</div>
      <div style={{ padding: '5px 12px', borderRadius: 6, color: A.textDim, fontSize: 12 }}>Advanced</div>
    </div>
    {right}
  </div>
);

// Tiny CLI preview block — shows the RouterOS commands an action will run.
const ACliPreview = ({ lines, title = 'Commands to apply', sub = '/ip firewall · preview' }) => (
  <div style={{ background: 'rgba(0,0,0,0.35)', border: `1px solid ${A.border}`, borderRadius: 9,
    padding: '10px 12px', fontFamily: A.mono, fontSize: 11.5, lineHeight: 1.55 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: A.accent }} />
      <span style={{ fontSize: 11, color: A.text, fontWeight: 500 }}>{title}</span>
      <span style={{ fontSize: 10.5, color: A.textFaint }}>{sub}</span>
    </div>
    {lines.map((l, i) => (
      <div key={i} style={{ color: l.startsWith('#') ? A.textFaint : (l.startsWith('  ') ? A.textDim : A.text) }}>
        {l.startsWith('/') ? <span style={{ color: A.accent }}>{l.split(' ')[0]}</span> : null}
        {l.startsWith('/') ? l.slice(l.split(' ')[0].length) : l}
      </div>
    ))}
  </div>
);

// ---------- Interfaces -------------------------------------

const AInterfaces = () => {
  const ifaces = [
    { name: 'ether1', role: 'WAN1 · Airtel', up: true, speed: '1G full', tx: '124M', rx: '184M', mac: 'B8:69:F4:11:22:33' },
    { name: 'ether2', role: 'WAN2 · Jio', up: true, speed: '1G full', tx: '38M', rx: '62M', mac: 'B8:69:F4:11:22:34' },
    { name: 'ether3', role: 'LAN · bridge', up: true, speed: '1G full', tx: '92M', rx: '184M', mac: 'B8:69:F4:11:22:35' },
    { name: 'ether4', role: 'LAN · bridge', up: true, speed: '1G full', tx: '12M', rx: '8M', mac: 'B8:69:F4:11:22:36' },
    { name: 'ether5', role: 'unassigned', up: false, speed: '—', tx: '0', rx: '0', mac: 'B8:69:F4:11:22:37' },
    { name: 'sfp1', role: 'WAN3 · BSNL', up: false, speed: '— sfp+', tx: '0', rx: '0', mac: 'B8:69:F4:11:22:38' },
    { name: 'wlan1', role: 'capsman · 5G', up: true, speed: '866M', tx: '24M', rx: '52M', mac: 'B8:69:F4:11:22:39' },
    { name: 'wlan2', role: 'capsman · 2.4G', up: true, speed: '144M', tx: '6M', rx: '14M', mac: 'B8:69:F4:11:22:3A' },
  ];
  return (
    <ABase>
      <ATitleBar title="Interfaces" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Interfaces" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Interfaces" sub="ethernet · sfp · wireless · 8 total · 6 up"
            right={<><ABtn kind="secondary" icon={Icons.refresh}>Refresh</ABtn><ABtn kind="primary" icon={Icons.plus}>Add bridge</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 320px', gap: 14 }}>
            {/* table */}
            <ACard pad={0}>
              <div style={{ display: 'grid', gridTemplateColumns: '24px 1.1fr 1.5fr 1fr 90px 90px 24px',
                padding: '10px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${A.border}`, gap: 8 }}>
                <span></span><span>name</span><span>role</span><span>speed · mac</span>
                <span style={{ textAlign: 'right' }}>rx</span><span style={{ textAlign: 'right' }}>tx</span><span></span>
              </div>
              {ifaces.map(i => (
                <div key={i.name} style={{ display: 'grid',
                  gridTemplateColumns: '24px 1.1fr 1.5fr 1fr 90px 90px 24px',
                  padding: '11px 14px', alignItems: 'center', gap: 8,
                  borderBottom: `1px solid ${A.border}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999,
                    background: i.up ? A.good : A.textFaint,
                    boxShadow: i.up ? `0 0 8px ${A.good}` : 'none' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{i.name}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>
                      {i.up ? 'running' : 'no link'}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: A.text }}>{i.role}</span>
                  <span style={{ fontSize: 11, color: A.textDim, fontFamily: A.mono }}>
                    {i.speed} · {i.mac}
                  </span>
                  <span style={{ fontFamily: A.mono, fontSize: 11.5, textAlign: 'right',
                    color: i.up ? A.text : A.textFaint }}>
                    <span style={{ color: A.accent }}>↓</span> {i.rx}
                  </span>
                  <span style={{ fontFamily: A.mono, fontSize: 11.5, textAlign: 'right',
                    color: i.up ? A.text : A.textFaint }}>
                    <span style={{ color: '#A78BFA' }}>↑</span> {i.tx}
                  </span>
                  <span style={{ color: A.textFaint, cursor: 'pointer' }}>{Icons.chevRight}</span>
                </div>
              ))}
            </ACard>

            {/* details panel */}
            <ACard pad={0}>
              <div style={{ padding: '14px 16px 6px' }}>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono,
                  textTransform: 'uppercase', letterSpacing: '0.06em' }}>Selected</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, letterSpacing: '-0.015em' }}>ether1</div>
                <div style={{ fontSize: 11.5, color: A.textDim, fontFamily: A.mono }}>WAN1 · Airtel · 200 / 200 Mbps</div>
              </div>
              <div style={{ padding: '6px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  ['Status', <APill tone="good" mono>up · 14d 03h</APill>],
                  ['MAC', <span style={{ fontFamily: A.mono, fontSize: 11.5 }}>B8:69:F4:11:22:33</span>],
                  ['IPv4', <span style={{ fontFamily: A.mono, fontSize: 11.5 }}>122.50.18.7/24</span>],
                  ['Gateway', <span style={{ fontFamily: A.mono, fontSize: 11.5 }}>122.50.18.1</span>],
                  ['MTU', <span style={{ fontFamily: A.mono, fontSize: 11.5 }}>1500</span>],
                  ['Auto-neg', <APill tone="accent" mono>1G full · ok</APill>],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '6px 0',
                    borderBottom: `1px solid ${A.border}` }}>
                    <span style={{ fontSize: 11.5, color: A.textDim, flex: 1 }}>{k}</span>
                    {v}
                  </div>
                ))}
              </div>
              <div style={{ padding: '0 16px 12px' }}>
                <ACliPreview title="On selection" sub="/interface ethernet"
                  lines={[
                    '# basic info',
                    '/interface ethernet print stats where name=ether1',
                    '  rx-bytes: 4.21 TB · tx-bytes: 1.84 TB',
                    '  rx-packets: 8.12B · tx-packets: 6.04B',
                  ]} />
              </div>
              <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8 }}>
                <ABtn kind="secondary">Disable</ABtn>
                <ABtn kind="secondary">Monitor</ABtn>
                <span style={{ flex: 1 }} />
                <ABtn kind="primary">Edit</ABtn>
              </div>
            </ACard>
          </div>
        </main>
      </div>
    </ABase>
  );
};

// ---------- WAN & Load Balance — KEY screen ---------------

const AWanLB = () => (
  <ABase>
    <ATitleBar title="WAN & Load Balance" />
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <ASidebar active="WAN & Load Balance" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ATopBar title="WAN & Load Balance" sub="combine multiple ISPs · pcc · nth · failover"
          right={<ABtn kind="primary" icon={Icons.bolt}>Apply</ABtn>} />
        <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
          gridTemplateColumns: '1fr 380px', gap: 14 }}>

          {/* main config */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
            {/* select WANs */}
            <ACard>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>1 · Select WAN interfaces</span>
                <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>pick 2 or more · drag to set order</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { name: 'ether1', isp: 'Airtel · 200/200', selected: true, weight: 2, status: 'up · 18ms' },
                  { name: 'ether2', isp: 'Jio · 150/150',    selected: true, weight: 1, status: 'up · 22ms' },
                  { name: 'sfp1',   isp: 'BSNL · 100/100',   selected: false, weight: 1, status: 'down' },
                  { name: 'ether6', isp: 'unassigned · LTE backup', selected: false, weight: 1, status: 'idle' },
                ].map(w => (
                  <div key={w.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    background: w.selected ? A.accentSoft : A.surface,
                    border: `1px solid ${w.selected ? A.accentLine : A.border}`, borderRadius: 9 }}>
                    <span style={{ color: A.textFaint, cursor: 'grab' }}>{Icons.drag}</span>
                    <div style={{ width: 18, height: 18, borderRadius: 4,
                      background: w.selected ? A.accent : 'transparent',
                      border: `1.5px solid ${w.selected ? A.accent : 'rgba(255,255,255,0.25)'}`,
                      display: 'grid', placeItems: 'center' }}>
                      {w.selected && <svg width="12" height="12" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>}
                    </div>
                    <div style={{ minWidth: 130 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{w.name}</div>
                      <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{w.isp}</div>
                    </div>
                    <APill tone={w.status.startsWith('up') ? 'good' : (w.status === 'down' ? 'bad' : 'dim')} mono>{w.status}</APill>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: A.textDim }}>weight</span>
                    <div style={{ display: 'flex', border: `1px solid ${A.border}`, borderRadius: 6, overflow: 'hidden' }}>
                      {[1, 2, 3].map(n => (
                        <span key={n} style={{ padding: '4px 10px', fontSize: 11, fontFamily: A.mono,
                          background: n === w.weight ? A.accent : 'transparent',
                          color: n === w.weight ? '#fff' : A.textDim, cursor: 'pointer' }}>{n}x</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ACard>

            {/* method */}
            <ACard>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>2 · Distribution method</span>
                <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>how traffic is split between the WANs</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { k: 'pcc', label: 'PCC', plain: 'Per-connection', desc: 'Same client → same WAN. Best for HTTPS, banking.', sel: true },
                  { k: 'nth', label: 'NTH', plain: 'Round-robin packets', desc: 'Splits packet-by-packet. Highest aggregate speed.' },
                  { k: 'failover', label: 'Failover', plain: 'Primary + standby', desc: 'Use WAN1; switch to WAN2 if it dies.' },
                ].map(m => (
                  <div key={m.k} style={{ padding: '12px 14px',
                    background: m.sel ? A.accentSoft : A.surface,
                    border: `1.5px solid ${m.sel ? A.accent : A.border}`, borderRadius: 10, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{m.label}</span>
                      <span style={{ fontFamily: A.mono, fontSize: 10.5, color: A.textFaint }}>{m.plain}</span>
                      {m.sel && <span style={{ marginLeft: 'auto', color: A.accent }}>{Icons.check}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: A.textDim, marginTop: 6, lineHeight: 1.4 }}>{m.desc}</div>
                  </div>
                ))}
              </div>
            </ACard>

            {/* options */}
            <ACard>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>3 · Advanced options</span>
                <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>safe defaults · tune if needed</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <AToggleRow label="Pin banking & UPI to WAN1" sub="address-list: sticky-domains" on />
                <AToggleRow label="Health-check via netwatch" sub="ping 1.1.1.1 every 5s" on />
                <AToggleRow label="Mark connection (mangle)" sub="conn-mark wan1-conn / wan2-conn" on />
                <AToggleRow label="Remove rules on uninstall" sub="adds comment=netforge-lb" on />
              </div>
            </ACard>
          </div>

          {/* preview & status sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
            <ACard>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Live distribution</span>
                <span style={{ flex: 1 }} />
                <APill tone="good" mono>balancing</APill>
              </div>
              <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden',
                border: `1px solid ${A.border}` }}>
                <div style={{ width: '66%', background: A.accent }} />
                <div style={{ width: '34%', background: '#A78BFA' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11,
                fontFamily: A.mono, color: A.textDim, marginTop: 8 }}>
                <span><span style={{ color: A.accent }}>■</span> ether1 · 66% · 124M</span>
                <span><span style={{ color: '#A78BFA' }}>■</span> ether2 · 34% · 62M</span>
              </div>
            </ACard>

            <ACard pad={0} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '14px 14px 8px' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Will run on Apply</span>
              </div>
              <div style={{ padding: '0 14px 14px', overflow: 'hidden', flex: 1 }}>
                <ACliPreview title="Mangle + Routing" sub="pcc · 2 wans · weight 2:1"
                  lines={[
                    '# mark routes for two WANs',
                    '/ip firewall mangle add chain=prerouting',
                    '  in-interface=bridge1 connection-state=new',
                    '  per-connection-classifier=both-addresses:3/0',
                    '  action=mark-connection new-connection-mark=wan1-conn',
                    '/ip firewall mangle add chain=prerouting',
                    '  in-interface=bridge1 connection-state=new',
                    '  per-connection-classifier=both-addresses:3/1',
                    '  action=mark-connection new-connection-mark=wan1-conn',
                    '/ip firewall mangle add chain=prerouting',
                    '  in-interface=bridge1 connection-state=new',
                    '  per-connection-classifier=both-addresses:3/2',
                    '  action=mark-connection new-connection-mark=wan2-conn',
                    '/ip route add gateway=122.50.18.1 routing-mark=wan1',
                    '/ip route add gateway=10.20.30.1   routing-mark=wan2',
                  ]} />
              </div>
              <div style={{ padding: '10px 14px', borderTop: `1px solid ${A.border}`, display: 'flex', gap: 8 }}>
                <ABtn kind="ghost">Copy</ABtn>
                <span style={{ flex: 1 }} />
                <APill tone="warn" mono>safe-mode 60s</APill>
              </div>
            </ACard>
          </div>
        </div>
      </main>
    </div>
  </ABase>
);

// ---------- Firewall · Block sites ------------------------

const AFirewall = () => {
  const presets = [
    { name: 'YouTube',  cat: 'streaming', match: 'youtube.com · googlevideo.com · ytimg.com', on: true,  hits: '1.2k' },
    { name: 'Facebook', cat: 'social',    match: 'facebook.com · fbcdn.net · instagram.com', on: false, hits: '—' },
    { name: 'TikTok',   cat: 'social',    match: 'tiktok.com · tiktokcdn.com · musical.ly',  on: true,  hits: '342' },
    { name: 'Netflix',  cat: 'streaming', match: 'netflix.com · nflxvideo.net',              on: false, hits: '—' },
    { name: 'Adult content', cat: 'safety', match: 'IWF list · L7 keywords',                 on: true,  hits: '88' },
    { name: 'Torrents · BT', cat: 'p2p',  match: 'tracker · DHT · bittorrent L7',           on: true,  hits: '14' },
    { name: 'Gambling',     cat: 'safety', match: 'curated domain list · 2.4k entries',     on: false, hits: '—' },
    { name: 'Crypto mining', cat: 'safety', match: 'stratum+tcp · pool list',               on: true,  hits: '6' },
  ];
  return (
    <ABase>
      <ATitleBar title="Firewall" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Firewall" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Block sites & services" sub="L7 + DNS + IP-list combined rules · /ip firewall filter"
            right={<><ABtn kind="secondary" icon={Icons.list}>All rules</ABtn><ABtn kind="primary" icon={Icons.plus}>Custom block</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 360px', gap: 14 }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
              {/* category tabs */}
              <div style={{ display: 'flex', gap: 4, padding: 4, background: A.surface,
                border: `1px solid ${A.border}`, borderRadius: 9, alignSelf: 'flex-start' }}>
                {['All', 'Social', 'Streaming', 'Safety', 'P2P', 'Custom'].map((t, i) => (
                  <div key={t} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12,
                    background: i === 0 ? A.accent : 'transparent',
                    color: i === 0 ? '#fff' : A.textDim, fontWeight: i === 0 ? 600 : 500, cursor: 'pointer' }}>
                    {t}
                  </div>
                ))}
              </div>

              <ACard pad={0} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '36px 1.4fr 0.7fr 1.6fr 70px 24px',
                  padding: '10px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  borderBottom: `1px solid ${A.border}`, gap: 8 }}>
                  <span></span><span>service</span><span>category</span><span>match</span>
                  <span style={{ textAlign: 'right' }}>hits/h</span><span></span>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {presets.map(p => (
                    <div key={p.name} style={{ display: 'grid',
                      gridTemplateColumns: '36px 1.4fr 0.7fr 1.6fr 70px 24px',
                      padding: '11px 14px', alignItems: 'center', gap: 8,
                      borderBottom: `1px solid ${A.border}`,
                      background: p.on ? 'rgba(59,130,246,0.04)' : 'transparent' }}>
                      <div style={{ width: 30, height: 18, borderRadius: 999,
                        background: p.on ? A.accent : 'rgba(255,255,255,0.08)', position: 'relative' }}>
                        <div style={{ width: 14, height: 14, borderRadius: 999, background: '#fff',
                          position: 'absolute', top: 2, left: p.on ? 14 : 2 }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 7,
                          background: p.on ? A.accentSoft : 'rgba(255,255,255,0.04)',
                          display: 'grid', placeItems: 'center', color: p.on ? A.accent : A.textFaint }}>
                          {Icons.block}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                          <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>
                            {p.on ? 'blocked · all clients' : 'allowed'}
                          </div>
                        </div>
                      </div>
                      <APill tone="dim">{p.cat}</APill>
                      <span style={{ fontSize: 11.5, color: A.textDim, fontFamily: A.mono,
                        textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{p.match}</span>
                      <span style={{ fontFamily: A.mono, fontSize: 11.5, color: p.on ? A.text : A.textFaint, textAlign: 'right' }}>{p.hits}</span>
                      <span style={{ color: A.textFaint }}>{Icons.chevRight}</span>
                    </div>
                  ))}
                </div>
              </ACard>
            </div>

            {/* right rail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
              <ACard>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Apply to clients</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginBottom: 10 }}>
                  scope which devices/networks the block hits
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <ARadio label="All clients on LAN" sub="src=192.168.88.0/24" checked />
                  <ARadio label="Specific group" sub="address-list · staff · students · guests" />
                  <ARadio label="By time" sub="schedule · 22:00 → 06:00" />
                </div>
              </ACard>

              <ACard pad={0} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '14px 14px 6px' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Custom rule</span>
                  <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginTop: 2 }}>
                    add a domain or keyword to block
                  </div>
                </div>
                <div style={{ padding: '6px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px',
                    background: A.surface, border: `1px solid ${A.borderStrong}`, borderRadius: 9 }}>
                    <span style={{ color: A.textFaint }}>{Icons.globe}</span>
                    <span style={{ fontFamily: A.mono, fontSize: 12, color: A.text }}>chess.com</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <APill tone="accent">DNS</APill><APill tone="accent">L7</APill><APill tone="dim">IP-list</APill>
                  </div>
                </div>
                <div style={{ padding: '0 14px 14px', flex: 1, minHeight: 0 }}>
                  <ACliPreview title="Will add" sub="firewall + dns" lines={[
                    '/ip dns static add type=FWD',
                    '  match-subdomain=yes name=chess.com',
                    '  forward-to=0.0.0.0',
                    '/ip firewall layer7-protocol add',
                    '  name=block-chess regexp="(chess\\\\.com)"',
                    '/ip firewall filter add chain=forward',
                    '  layer7-protocol=block-chess action=drop',
                  ]} />
                </div>
                <div style={{ padding: '10px 14px', borderTop: `1px solid ${A.border}`, display: 'flex', gap: 8 }}>
                  <span style={{ flex: 1 }} />
                  <ABtn kind="ghost">Test</ABtn>
                  <ABtn kind="primary" icon={Icons.plus}>Add block</ABtn>
                </div>
              </ACard>
            </div>
          </div>
        </main>
      </div>
    </ABase>
  );
};

// ---------- Bandwidth · Simple Queue --------------------

const ABandwidth = () => {
  const queues = [
    { name: 'Reception PC',  ip: '192.168.88.31', up: '5M', down: '20M', usedDn: 0.62, usedUp: 0.18, prio: 'normal', on: true },
    { name: 'CCTV NVR',      ip: '192.168.88.107', up: '2M', down: '8M',  usedDn: 0.05, usedUp: 0.62, prio: 'low',    on: true },
    { name: 'Guest network', ip: '192.168.99.0/24', up: '10M', down: '30M', usedDn: 0.41, usedUp: 0.22, prio: 'low',    on: true },
    { name: 'Manager laptop', ip: '192.168.88.18', up: '20M', down: '100M', usedDn: 0.18, usedUp: 0.04, prio: 'high',  on: true },
    { name: 'Rohit-PC',      ip: '192.168.88.42', up: '5M',  down: '20M', usedDn: 0.92, usedUp: 0.55, prio: 'normal', on: false },
  ];
  return (
    <ABase>
      <ATitleBar title="Bandwidth" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Bandwidth" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Bandwidth limits" sub="simple queue · pcq · /queue simple"
            right={<><ABtn kind="secondary" icon={Icons.gauge}>Speed test</ABtn><ABtn kind="primary" icon={Icons.plus}>New queue</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 360px', gap: 14 }}>

            <ACard pad={0}>
              <div style={{ display: 'grid', gridTemplateColumns: '36px 1.6fr 1fr 1fr 1.5fr 80px 24px',
                padding: '10px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                borderBottom: `1px solid ${A.border}`, gap: 8 }}>
                <span></span><span>name · target</span><span>down</span><span>up</span>
                <span>usage</span><span>prio</span><span></span>
              </div>
              {queues.map(q => (
                <div key={q.name} style={{ display: 'grid',
                  gridTemplateColumns: '36px 1.6fr 1fr 1fr 1.5fr 80px 24px',
                  padding: '11px 14px', alignItems: 'center', gap: 8,
                  borderBottom: `1px solid ${A.border}` }}>
                  <div style={{ width: 30, height: 18, borderRadius: 999,
                    background: q.on ? A.accent : 'rgba(255,255,255,0.08)', position: 'relative' }}>
                    <div style={{ width: 14, height: 14, borderRadius: 999, background: '#fff',
                      position: 'absolute', top: 2, left: q.on ? 14 : 2 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{q.name}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{q.ip}</div>
                  </div>
                  <span style={{ fontFamily: A.mono, fontSize: 12,
                    color: q.on ? A.text : A.textFaint }}><span style={{ color: A.accent }}>↓</span> {q.down}</span>
                  <span style={{ fontFamily: A.mono, fontSize: 12,
                    color: q.on ? A.text : A.textFaint }}><span style={{ color: '#A78BFA' }}>↑</span> {q.up}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ width: `${q.usedDn * 100}%`, height: '100%', background: A.accent, borderRadius: 4 }} />
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ width: `${q.usedUp * 100}%`, height: '100%', background: '#A78BFA', borderRadius: 4 }} />
                    </div>
                  </div>
                  <APill tone={q.prio === 'high' ? 'accent' : (q.prio === 'low' ? 'dim' : 'good')}>{q.prio}</APill>
                  <span style={{ color: A.textFaint }}>{Icons.chevRight}</span>
                </div>
              ))}
            </ACard>

            {/* new queue form */}
            <ACard>
              <div style={{ fontSize: 13, fontWeight: 600 }}>New queue</div>
              <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginBottom: 12 }}>
                limit speed for an IP, range, or address-list
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ALabeledField label="Name" sub="any label" value="Guest WiFi cap" />
                <ALabeledField label="Target" sub="ip · cidr · address-list" value="192.168.99.0/24" mono />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Download
                      <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginLeft: 6 }}>max-limit/rx</span></div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['5M', '10M', '30M', '100M'].map(v => (
                        <span key={v} style={{ flex: 1, padding: '7px 0', textAlign: 'center', fontSize: 12,
                          fontFamily: A.mono, borderRadius: 6,
                          background: v === '30M' ? A.accent : A.surface,
                          color: v === '30M' ? '#fff' : A.text,
                          border: `1px solid ${v === '30M' ? A.accent : A.border}`, cursor: 'pointer' }}>{v}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Upload
                      <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginLeft: 6 }}>max-limit/tx</span></div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['2M', '5M', '10M', '20M'].map(v => (
                        <span key={v} style={{ flex: 1, padding: '7px 0', textAlign: 'center', fontSize: 12,
                          fontFamily: A.mono, borderRadius: 6,
                          background: v === '10M' ? A.accent : A.surface,
                          color: v === '10M' ? '#fff' : A.text,
                          border: `1px solid ${v === '10M' ? A.accent : A.border}`, cursor: 'pointer' }}>{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <AToggleRow label="Burst boost" sub="2x for 10s · burst-limit · burst-time" on />
                <AToggleRow label="Per-client equal share (PCQ)" sub="auto-divide between active devices" on={false} />
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <ABtn kind="ghost">Cancel</ABtn>
                <span style={{ flex: 1 }} />
                <ABtn kind="primary" icon={Icons.plus}>Add queue</ABtn>
              </div>
            </ACard>
          </div>
        </main>
      </div>
    </ABase>
  );
};

Object.assign(window, { AInterfaces, AWanLB, AFirewall, ABandwidth, ATopBar, ACliPreview });
