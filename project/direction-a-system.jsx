// Direction A — Logs, Scripts/Scheduler, Backup

const ALogs = () => {
  const rows = [
    { t: '14:32:08', cat: 'system',   tone: 'good',   src: 'admin@192.168.88.5',  msg: 'logged in via api-ssl' },
    { t: '14:31:54', cat: 'firewall', tone: 'accent', src: 'forward · drop',      msg: '192.168.88.42 → youtube.com (L7 block-youtube)' },
    { t: '14:31:22', cat: 'dhcp',     tone: 'good',   src: 'lease · ether3',      msg: 'assigned 192.168.88.31 to B0:7F:4E:55:66:77 (reception)' },
    { t: '14:30:41', cat: 'firewall', tone: 'accent', src: 'forward · drop',      msg: '192.168.88.107 → 49.207.x.x (rule "block-tiktok")' },
    { t: '14:30:08', cat: 'wireless', tone: 'warn',   src: 'capsman · cap2',      msg: 'station 64:5A:ED:88:99:AA roamed AP-warehouse → AP-reception' },
    { t: '14:29:55', cat: 'pppoe',    tone: 'good',   src: 'session up',          msg: '<aman> 10.5.0.42 connected · profile=20M' },
    { t: '14:28:11', cat: 'system',   tone: 'warn',   src: 'memory',              msg: 'usage above threshold · 74% (788/1024 MB)' },
    { t: '14:27:42', cat: 'wireguard',tone: 'good',   src: 'wg0 · peer up',       msg: 'home-pc handshake · endpoint=82.x.x.x:42118' },
    { t: '14:25:18', cat: 'firewall', tone: 'bad',    src: 'input · drop',        msg: '203.0.113.44 → 192.168.88.1:23 (port-scan)' },
    { t: '14:23:01', cat: 'queue',    tone: 'accent', src: 'simple-queue',        msg: 'rule "Reception PC" hit max-limit-down (20M) for 90s' },
    { t: '14:22:48', cat: 'system',   tone: 'good',   src: 'script · hourly',     msg: 'backup-export.rsc finished · 124KB' },
    { t: '14:22:00', cat: 'dhcp',     tone: 'dim',    src: 'lease · expired',     msg: 'released 192.168.88.144 (unknown-44)' },
  ];
  return (
    <ABase>
      <ATitleBar title="Logs" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Logs" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Logs" sub="live tail · /log print follow · 12.4k events today"
            right={<><APill tone="good" mono>● live</APill><ABtn kind="secondary" icon={Icons.list}>Filters</ABtn><ABtn kind="ghost" icon={Icons.save}>Export</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '220px 1fr', gap: 14 }}>

            {/* filter rail */}
            <ACard pad={0}>
              <div style={{ padding: '14px 14px 6px' }}>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono,
                  textTransform: 'uppercase', letterSpacing: '0.06em' }}>Topics</div>
              </div>
              <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[
                  { k: 'all', label: 'All events',  count: 12421, sel: true },
                  { k: 'fw',  label: 'Firewall',    count: 3214 },
                  { k: 'sys', label: 'System',      count: 412 },
                  { k: 'dhcp',label: 'DHCP',        count: 188 },
                  { k: 'wifi',label: 'Wireless',    count: 92 },
                  { k: 'pppoe', label: 'PPPoE',     count: 64 },
                  { k: 'wg',  label: 'WireGuard',   count: 42 },
                  { k: 'queue', label: 'Queues',    count: 36 },
                  { k: 'err', label: 'Errors',      count: 4, tone: 'bad' },
                ].map(t => (
                  <div key={t.k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                    borderRadius: 8,
                    background: t.sel ? A.accentSoft : 'transparent',
                    color: t.sel ? '#fff' : A.textDim, cursor: 'pointer' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999,
                      background: t.tone === 'bad' ? A.bad : (t.sel ? A.accent : A.textFaint) }} />
                    <span style={{ fontSize: 12.5, fontWeight: t.sel ? 600 : 500 }}>{t.label}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontFamily: A.mono, fontSize: 10.5, color: A.textFaint }}>{t.count}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '14px 14px 6px', borderTop: `1px solid ${A.border}` }}>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono,
                  textTransform: 'uppercase', letterSpacing: '0.06em' }}>Severity</div>
              </div>
              <div style={{ padding: '0 12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'Info',    tone: 'good',   on: true },
                  { label: 'Warning', tone: 'warn',   on: true },
                  { label: 'Error',   tone: 'bad',    on: true },
                  { label: 'Debug',   tone: 'dim',    on: false },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4,
                      background: s.on ? A.accent : 'transparent',
                      border: `1.5px solid ${s.on ? A.accent : 'rgba(255,255,255,0.25)'}`,
                      display: 'grid', placeItems: 'center' }}>
                      {s.on && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
                    </div>
                    <span style={{ fontSize: 12 }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </ACard>

            {/* log table */}
            <ACard pad={0} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '8px 14px', borderBottom: `1px solid ${A.border}`,
                display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: A.textFaint }}>{Icons.search}</span>
                <span style={{ fontSize: 12, color: A.textFaint, fontFamily: A.mono, flex: 1 }}>
                  Filter · type !drop, src=192.168.88.42, after:14:00…
                </span>
                <APill tone="dim" mono>last 1h</APill>
                <APill tone="dim" mono>auto-scroll</APill>
              </div>
              <div style={{ display: 'grid',
                gridTemplateColumns: '70px 90px 200px 1fr',
                padding: '8px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                borderBottom: `1px solid ${A.border}`, gap: 12 }}>
                <span>time</span><span>topic</span><span>source</span><span>message</span>
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: 'grid',
                    gridTemplateColumns: '70px 90px 200px 1fr',
                    padding: '8px 14px', fontFamily: A.mono, fontSize: 11.5, gap: 12,
                    borderBottom: `1px solid ${A.border}`, alignItems: 'baseline',
                    background: i % 2 ? 'rgba(255,255,255,0.012)' : 'transparent' }}>
                    <span style={{ color: A.textFaint }}>{r.t}</span>
                    <APill tone={r.tone} mono>{r.cat}</APill>
                    <span style={{ color: A.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.src}</span>
                    <span style={{ color: A.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.msg}</span>
                  </div>
                ))}
              </div>
            </ACard>
          </div>
        </main>
      </div>
    </ABase>
  );
};

// ---------- Scripts / Scheduler --------------------

const AScripts = () => {
  const scripts = [
    { name: 'backup-export', desc: 'Export config to flash + SMB', last: '14:22 · ok',  cron: 'every 1h',     on: true },
    { name: 'block-after-hours', desc: 'Disable guest WiFi 22:00 → 06:00', last: '22:00 · ok', cron: 'daily 22:00',  on: true },
    { name: 'isp-failover-check', desc: 'Ping WAN gateways, switch on loss', last: '14:31 · ok', cron: 'every 30s', on: true },
    { name: 'monthly-report',  desc: 'Email traffic report to admin', last: '01-Aug · failed', cron: '1st 09:00',  on: false, err: true },
    { name: 'reset-arp',  desc: 'Clear stale ARP entries', last: 'never', cron: 'manual', on: false },
  ];
  const code = [
    '/system script add name=block-after-hours \\',
    '  comment="netforge: disable guest 22:00-06:00" \\',
    '  source={',
    '    /interface wireless disable [find ssid="NetForge-Guest"];',
    '    /log info "guest wifi disabled by scheduler";',
    '  }',
    '/system scheduler add name=run-block-after-hours \\',
    '  start-time=22:00:00 interval=1d \\',
    '  on-event=block-after-hours',
  ];
  return (
    <ABase>
      <ATitleBar title="Scripts" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Scripts" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Scripts & scheduler" sub="/system script · /system scheduler · 5 scripts · 4 scheduled"
            right={<><ABtn kind="secondary" icon={Icons.terminal}>Run snippet</ABtn><ABtn kind="primary" icon={Icons.plus}>New script</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 1fr', gap: 14 }}>

            {/* scripts list */}
            <ACard pad={0}>
              <div style={{ display: 'grid', gridTemplateColumns: '36px 1.6fr 1fr 70px 24px',
                padding: '10px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                borderBottom: `1px solid ${A.border}`, gap: 8 }}>
                <span></span><span>name · description</span><span>last run · schedule</span>
                <span></span><span></span>
              </div>
              {scripts.map((s, i) => (
                <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '36px 1.6fr 1fr 70px 24px',
                  padding: '11px 14px', alignItems: 'center', gap: 8,
                  borderBottom: `1px solid ${A.border}`,
                  background: i === 1 ? A.accentSoft : 'transparent' }}>
                  <div style={{ width: 30, height: 18, borderRadius: 999,
                    background: s.on ? A.accent : 'rgba(255,255,255,0.08)', position: 'relative' }}>
                    <div style={{ width: 14, height: 14, borderRadius: 999, background: '#fff',
                      position: 'absolute', top: 2, left: s.on ? 14 : 2 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, fontFamily: A.mono, color: A.text }}>{s.name}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint }}>{s.desc}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontFamily: A.mono, color: s.err ? A.bad : A.text }}>{s.last}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{s.cron}</div>
                  </div>
                  <ABtn kind="ghost">Run</ABtn>
                  <span style={{ color: A.textFaint }}>{Icons.chevRight}</span>
                </div>
              ))}
            </ACard>

            {/* editor */}
            <ACard pad={0} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: A.accent }}>{Icons.terminal}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: A.mono }}>block-after-hours</div>
                  <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono }}>RouterOS scripting · saved 14 Aug</div>
                </div>
                <span style={{ flex: 1 }} />
                <APill tone="good" mono>last ok · 22:00</APill>
              </div>

              <div style={{ flex: 1, padding: '8px 14px 14px', minHeight: 0, overflow: 'hidden',
                display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: 'rgba(0,0,0,0.45)', border: `1px solid ${A.border}`, borderRadius: 9,
                  padding: '12px 14px', fontFamily: A.mono, fontSize: 11.5, lineHeight: 1.7, flex: 1,
                  display: 'flex', flexDirection: 'column' }}>
                  {code.map((line, i) => (
                    <div key={i} style={{ display: 'flex', gap: 14 }}>
                      <span style={{ color: A.textFaint, width: 18, textAlign: 'right' }}>{i + 1}</span>
                      <span style={{ color:
                        line.includes('comment')        ? '#A3E635'
                      : line.startsWith('/')             ? A.accent
                      : line.includes('disable')         ? '#FCA5A5'
                      : line.startsWith('  /')           ? A.accent
                      : A.text, whiteSpace: 'pre' }}>{line}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 500, marginBottom: 6 }}>Schedule
                    <span style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginLeft: 6 }}>/system scheduler</span></div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['Manual', 'Every 30s', 'Hourly', 'Daily 22:00', 'Custom cron'].map(c => (
                      <span key={c} style={{ padding: '6px 11px', fontSize: 11.5, fontFamily: A.mono,
                        background: c === 'Daily 22:00' ? A.accent : A.surface,
                        color: c === 'Daily 22:00' ? '#fff' : A.text,
                        border: `1px solid ${c === 'Daily 22:00' ? A.accent : A.border}`,
                        borderRadius: 6, cursor: 'pointer' }}>{c}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ padding: '10px 14px', borderTop: `1px solid ${A.border}`, display: 'flex', gap: 8 }}>
                <ABtn kind="ghost">Test</ABtn>
                <span style={{ flex: 1 }} />
                <ABtn kind="secondary" icon={Icons.bolt}>Run now</ABtn>
                <ABtn kind="primary" icon={Icons.check}>Save</ABtn>
              </div>
            </ACard>
          </div>
        </main>
      </div>
    </ABase>
  );
};

// ---------- Backup -------------------------------------

const ABackup = () => {
  const backups = [
    { name: 'office-rb5009-2026-05-10-1432.backup', size: '124 KB', when: 'just now',     who: 'manual',    type: 'binary' },
    { name: 'office-rb5009-2026-05-10-1300.rsc',    size:  '38 KB', when: '1h ago',       who: 'scheduler', type: 'export' },
    { name: 'office-rb5009-2026-05-10-1200.rsc',    size:  '38 KB', when: '2h ago',       who: 'scheduler', type: 'export' },
    { name: 'office-rb5009-2026-05-09-2200.backup', size: '124 KB', when: 'yesterday',    who: 'scheduler', type: 'binary' },
    { name: 'pre-firewall-edit-2026-05-09-1640',    size: '124 KB', when: 'before edit',  who: 'auto',      type: 'binary', tone: 'accent' },
    { name: 'office-rb5009-2026-05-08-2200.backup', size: '124 KB', when: '2 days ago',   who: 'scheduler', type: 'binary' },
  ];
  return (
    <ABase>
      <ATitleBar title="Backup" />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ASidebar active="Backup" />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ATopBar title="Backup & restore" sub="/system backup save · /export · stored on PC + flash"
            right={<><ABtn kind="secondary" icon={Icons.save}>Restore from file…</ABtn><ABtn kind="primary" icon={Icons.bolt}>Backup now</ABtn></>} />
          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'grid',
            gridTemplateColumns: '1fr 360px', gap: 14 }}>

            <ACard pad={0}>
              <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 90px 1fr 0.8fr 24px',
                padding: '10px 14px', fontSize: 10.5, color: A.textFaint, fontFamily: A.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                borderBottom: `1px solid ${A.border}`, gap: 8 }}>
                <span></span><span>file</span><span>size</span><span>when · trigger</span>
                <span>type</span><span></span>
              </div>
              {backups.map((b, i) => (
                <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '24px 2fr 90px 1fr 0.8fr 24px',
                  padding: '11px 14px', alignItems: 'center', gap: 8,
                  borderBottom: `1px solid ${A.border}`,
                  background: i === 0 ? A.accentSoft : 'transparent' }}>
                  <span style={{ color: b.tone === 'accent' ? A.warn : A.textFaint, display: 'flex' }}>{Icons.save}</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontFamily: A.mono, color: A.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>
                      {b.tone === 'accent' ? 'auto-saved before risky change' : 'configuration snapshot'}
                    </div>
                  </div>
                  <span style={{ fontFamily: A.mono, fontSize: 11.5, color: A.textDim }}>{b.size}</span>
                  <div>
                    <div style={{ fontSize: 12, fontFamily: A.mono, color: A.text }}>{b.when}</div>
                    <div style={{ fontSize: 10.5, color: A.textFaint, fontFamily: A.mono }}>{b.who}</div>
                  </div>
                  <APill tone={b.type === 'export' ? 'accent' : 'dim'} mono>{b.type}</APill>
                  <span style={{ color: A.textFaint }}>{Icons.chevRight}</span>
                </div>
              ))}
            </ACard>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
              <ACard>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Backup destinations</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginBottom: 10 }}>
                  where copies are stored
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <AToggleRow label="Router flash" sub="/file print" on />
                  <AToggleRow label="This PC" sub="C:\\Users\\…\\NetForge\\backups" on />
                  <AToggleRow label="SMB share" sub="\\\\nas01\\config-backups" on />
                  <AToggleRow label="Email a copy to admin" sub="weekly · zipped" on={false} />
                </div>
              </ACard>

              <ACard>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Schedule</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginBottom: 10 }}>
                  automatic backups via /system scheduler
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <ARadio label="Off" sub="manual only" />
                  <ARadio label="Hourly export (.rsc)" sub="text-readable · diffable" checked />
                  <ARadio label="Daily binary (.backup)" sub="full state · 22:00" />
                  <ARadio label="Both — recommended" sub="hourly export + nightly binary" />
                </div>
              </ACard>

              <ACard>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Retention</div>
                <div style={{ fontSize: 11, color: A.textFaint, fontFamily: A.mono, marginBottom: 10 }}>
                  prune old backups
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: A.textDim }}>Keep last</span>
                  <span style={{ padding: '5px 10px', borderRadius: 6, background: A.accent,
                    color: '#fff', fontFamily: A.mono, fontSize: 12 }}>30</span>
                  <span style={{ fontSize: 12, color: A.textDim }}>backups · ~3.7 MB on disk</span>
                </div>
              </ACard>
            </div>
          </div>
        </main>
      </div>
    </ABase>
  );
};

Object.assign(window, { ALogs, AScripts, ABackup });
