/* Ported from the local biometric-attendance-sync tool; data from biometric_sync.display (Employee Checkin).
   Check-in Display: live board of today's check-ins / check-outs, with a full-screen kiosk mode.
   Labels come from DISPLAY_I18N (English / Urdu); the choice is kept per browser. */
'use strict';

const DISPLAY_I18N = {
  en: {
    dir: 'ltr', locale: undefined, switchTo: 'اردو', switchTitle: 'اردو میں دیکھیں',
    allMachines: 'All machines', reload: 'Reload now', fullScreen: 'Full screen', exit: 'Exit',
    toLight: 'Switch to light theme', toDark: 'Switch to dark theme',
    live: (ago) => `Live · machines read ${ago}`, showing: (d) => `Showing ${d}`,
    liveCap: (n, t) => `Live capture · ${n}/${t} machine${t === 1 ? '' : 's'} connected`,
    svcRunning: (up) => `Service running · up ${up}`, svcOffline: 'Service offline · reconnecting…',
    liveN: (n, t) => `Machines ${n}/${t} live`, liveOff: 'Live capture off',
    erpOk: 'ERP connected', erpDown: (t) => `ERP unreachable since ${t}`, erpNone: 'ERP not configured',
    syncing: 'Syncing…', lastSync: (t, st) => `Last sync ${t}${st === 'success' ? ' ✓' : st === 'failed' ? ' ✗' : ''}`, noSync: 'No sync yet',
    waitingN: (n) => `${n} waiting to send`, failedN: (n) => `${n} failed`,
    noteLive: 'Live capture is on: punches appear here the moment they are scanned.',
    latest: 'Latest punch', prevPunch: 'Last punch (previous day)', checkedIn: 'Checked in', checkedOut: 'Checked out', in: 'In', out: 'Out',
    division: 'Division', department: 'Department', subDepartment: 'Sub Department', designation: 'Designation',
    deviceUser: (id) => `Device user ${id}`, id: 'ID',
    synced: 'ERP', waiting: 'Waiting', failed: 'Failed', skipped: 'Skipped',
    attendance: 'Attendance', presentOf: 'present of active employees', summary: 'Summary',
    unlinked: (n) => `+ ${n} machine ID${n === '1' ? '' : 's'} not linked to an employee`,
    unlinkedTitle: 'These people punched, but no active employee in ERPNext has their machine ID. Link them in Employee Mapping.', readEmployees: 'read employees in Employee Mapping',
    kIn: 'Checked in', kInSub: 'currently in', kOut: 'Checked out', kOutSub: 'last punch is out',
    kAbsent: 'Not punched', kAbsentSub: 'active, no punch yet', kPunches: 'Punches',
    kPunchesSub: (s, w, f) => `${s} sent · ${w} waiting${f ? ` · ${f} failed` : ''}`,
    activity: 'Activity', lastN: (n) => `last ${n}`, noEarlier: 'No earlier punches.', nothingYet: 'Nothing yet.',
    employees: 'Employees', all: 'All', search: 'Search name, ID, department',
    cardView: 'Card view', listView: 'List view', employee: 'Employee', status: 'Status',
    firstIn: 'First in', lastOut: 'Last out', worked: 'Worked', running: 'Still inside, counting up',
    noPunches: 'No punches yet', noPunchesToday: 'Punches appear here after the machines are read.', noPunchesDay: 'No punches on this day.',
    nobody: 'Nobody here', noMatch: 'No employee matches this filter.', noneToday: 'No one has punched on this day yet.',
    note: (n) => `New punches appear after each sync${n ? ` (every ${n} min)` : ''}.`,
    guessed: ' * Direction is not set on this machine, so IN/OUT alternates through the day.',
    guessedTitle: 'Direction not set on the machine; IN/OUT alternates through the day',
    rel: (a) => a < 45 ? 'just now' : a < 3600 ? `${Math.round(a / 60)} min ago` : a < 86400 ? `${Math.round(a / 3600)} h ago` : `${Math.round(a / 86400)} d ago`,
    never: 'never',
    dur: (s) => fmtDuration(s),
  },
  ur: {
    dir: 'rtl', locale: 'ur-PK', switchTo: 'EN', switchTitle: 'View in English',
    allMachines: 'تمام مشینیں', reload: 'دوبارہ لوڈ کریں', fullScreen: 'فل اسکرین', exit: 'بند کریں',
    toLight: 'روشن تھیم', toDark: 'تاریک تھیم',
    live: (ago) => `لائیو · مشینیں ${ago} پڑھی گئیں`, showing: (d) => `${d} کا ریکارڈ`,
    liveCap: (n, t) => `لائیو کیپچر · ${n}/${t} مشینیں منسلک`,
    svcRunning: (up) => `سروس چل رہی ہے · ${up} سے`, svcOffline: 'سروس بند · دوبارہ جڑ رہی ہے…',
    liveN: (n, t) => `مشینیں ${n}/${t} لائیو`, liveOff: 'لائیو کیپچر بند',
    erpOk: 'ERP منسلک', erpDown: (t) => `ERP ${t} سے دستیاب نہیں`, erpNone: 'ERP ترتیب نہیں دیا گیا',
    syncing: 'سنک جاری ہے…', lastSync: (t, st) => `آخری سنک ${t}${st === 'success' ? ' ✓' : st === 'failed' ? ' ✗' : ''}`, noSync: 'ابھی کوئی سنک نہیں',
    waitingN: (n) => `${n} بھیجنے کے منتظر`, failedN: (n) => `${n} ناکام`,
    noteLive: 'لائیو کیپچر آن ہے: پنچ اسکین ہوتے ہی یہاں نظر آتے ہیں۔',
    latest: 'تازہ ترین حاضری', prevPunch: 'آخری حاضری (پچھلا دن)', checkedIn: 'آمد', checkedOut: 'روانگی', in: 'اندر', out: 'باہر',
    division: 'ڈویژن', department: 'شعبہ', subDepartment: 'ذیلی شعبہ', designation: 'عہدہ',
    deviceUser: (id) => `مشین صارف ${id}`, id: 'آئی ڈی',
    synced: 'ERP', waiting: 'زیرِ التوا', failed: 'ناکام', skipped: 'چھوڑ دیا گیا',
    attendance: 'حاضری', presentOf: 'فعال ملازمین میں سے حاضر', summary: 'خلاصہ',
    unlinked: (n) => `+ ${n} مشین آئی ڈیز کسی ملازم سے منسلک نہیں`,
    unlinkedTitle: 'ان لوگوں نے پنچ کیا، مگر ERPNext میں کسی فعال ملازم کے پاس یہ مشین آئی ڈی نہیں۔ Employee Mapping میں منسلک کریں۔', readEmployees: 'Employee Mapping سے ملازمین پڑھیں',
    kIn: 'موجود', kInSub: 'اس وقت اندر', kOut: 'روانہ', kOutSub: 'آخری پنچ روانگی',
    kAbsent: 'غیر حاضر', kAbsentSub: 'ابھی تک کوئی پنچ نہیں', kPunches: 'کل پنچ',
    kPunchesSub: (s, w, f) => `${s} بھیجے گئے · ${w} زیرِ التوا${f ? ` · ${f} ناکام` : ''}`,
    activity: 'سرگرمی', lastN: (n) => `آخری ${n}`, noEarlier: 'اس سے پہلے کوئی پنچ نہیں۔', nothingYet: 'ابھی کچھ نہیں۔',
    employees: 'ملازمین', all: 'سب', search: 'نام، آئی ڈی یا شعبہ تلاش کریں',
    cardView: 'کارڈ', listView: 'فہرست', employee: 'ملازم', status: 'حالت',
    firstIn: 'پہلی آمد', lastOut: 'آخری روانگی', worked: 'کام (گھنٹے)', running: 'ابھی اندر ہیں، وقت جاری ہے',
    noPunches: 'ابھی کوئی پنچ نہیں', noPunchesToday: 'مشینیں پڑھنے کے بعد پنچ یہاں نظر آئیں گے۔', noPunchesDay: 'اس دن کوئی پنچ نہیں۔',
    nobody: 'کوئی نہیں', noMatch: 'اس فلٹر سے کوئی ملازم نہیں ملا۔', noneToday: 'اس دن ابھی تک کسی نے پنچ نہیں کیا۔',
    note: (n) => `نئے پنچ ہر سنک کے بعد نظر آتے ہیں${n ? ` (ہر ${n} منٹ)` : ''}۔`,
    guessed: ' * اس مشین پر سمت مقرر نہیں، اس لیے آمد/روانگی باری باری لگائی گئی ہے۔',
    guessedTitle: 'مشین پر سمت مقرر نہیں؛ آمد/روانگی باری باری لگائی گئی ہے',
    rel: (a) => a < 45 ? 'ابھی' : a < 3600 ? `${Math.round(a / 60)} منٹ پہلے` : a < 86400 ? `${Math.round(a / 3600)} گھنٹے پہلے` : `${Math.round(a / 86400)} دن پہلے`,
    never: 'کبھی نہیں',
    dur: (s) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; },
  },
};

Pages.display = {
  title: 'Check-in Display',
  async render(view, args) {
    const f = { date: '', device: '', q: '', tab: 'all' };
    let devices = [];
    try { devices = await loadDevices(); } catch (e) { /* ignore */ }
    let data = null, seen = null, timer = null, clock = null, loading = false;
    // display settings (Settings → Check-in Display); a screen's own language / view choice wins
    let S = store.settings;
    try { S = await loadSettings(); } catch (e) { S = S || {}; }
    const opt = (k, d) => (S && S[k] !== undefined ? S[k] : d);
    const saved = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    let lang = (saved('bas-display-lang') || opt('display_language', 'en')) === 'ur' ? 'ur' : 'en';
    let peopleView = (saved('bas-display-view') || opt('display_view', 'cards')) === 'list' ? 'list' : 'cards';
    const urNames = opt('display_urdu_names', true), showPhotos = opt('display_show_photos', true);
    const showOrg = { division: opt('display_show_division', true), department: opt('display_show_department', true),
      sub_department: opt('display_show_sub_department', true), designation: opt('display_show_designation', true) };
    const T = () => DISPLAY_I18N[lang];

    // names from ERPNext: the Urdu version (when there is one) in Urdu mode
    const urOf = (p, k) => (lang === 'ur' && urNames && p[k + '_ur']) || null;
    const loc = (p, k) => urOf(p, k) || p[k] || '';
    const V = (p, k) => (loc(p, k) ? `<bdi class="${urOf(p, k) ? 'u' : ''}">${esc(loc(p, k))}</bdi>` : '');
    const who = (p) => (lang === 'ur' && urNames && p.employee_name_ur) || p.employee_name || p.name || p.device_user_name || `${T().id} ${p.user_id}`;
    const whoH = (p) => `<bdi class="${lang === 'ur' && urNames && p.employee_name_ur ? 'u' : ''}">${esc(who(p))}</bdi>`;
    const enName = (p) => p.employee_name || p.name || p.device_user_name || p.user_id;
    const initials = (s) => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    // stable soft colour per person, so avatars are easy to tell apart
    const HUES = [210, 340, 150, 25, 265, 185, 0, 95, 300, 45, 230, 165];
    const hue = (s) => { let h = 7; for (const c of String(s)) h = (h * 131 + c.charCodeAt(0) * 17) >>> 0; return HUES[h % HUES.length]; };
    // employee photo from ERPNext (cached by the service); initials when there is none
    const avatar = (p, cls = '') => `<div class="dx-av ${cls}" style="--h:${hue(p.user_id)}">${esc(initials(enName(p)))}${showPhotos && p.photo
      ? `<img src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>`;
    const rel = (ts) => { const d = parseTs(ts); return d && !isNaN(d) ? T().rel(Math.max(0, (Date.now() - d.getTime()) / 1000)) : T().never; };
    const typePill = (t, guessed) => !t ? '' :
      `<span class="dx-pill ${t === 'IN' ? 'in' : 'out'}" ${guessed ? `title="${esc(T().guessedTitle)}"` : ''}>${icon(t === 'IN' ? 'login' : 'logout', '')}${t === 'IN' ? T().in : T().out}${guessed ? '*' : ''}</span>`;
    const syncTag = (p) => p.sync_status === 'synced' ? `<span class="dx-sync ok">${icon('check', '')}${T().synced}</span>`
      : p.sync_status === 'failed' ? `<span class="dx-sync bad" title="${esc(reasonLabel(p.reason))}">${icon('xCircle', '')}${T().failed}</span>`
      : p.sync_status === 'skipped' ? `<span class="dx-sync" title="${esc(reasonLabel(p.reason))}">${T().skipped}</span>`
      : `<span class="dx-sync wait">${icon('clock', '')}${T().waiting}</span>`;
    const hm = (ts) => ts ? `<bdi>${esc(ts.slice(11, 16))}</bdi>` : '—';
    const org = (p) => [V(p, 'division'), V(p, p.sub_department ? 'sub_department' : 'department')].filter(Boolean).join(' · ');

    // Urdu web font for the Urdu labels and the language button (falls back to system fonts when offline)
    const loadUrduFont = () => {
      if (document.getElementById('dx-ur-font')) return;
      const l = document.createElement('link');
      l.id = 'dx-ur-font'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap';
      document.head.appendChild(l);
    };

    /* ---------- page shell (rebuilt when the language changes) ---------- */
    const shell = () => {
      const t = T();
      loadUrduFont();
      view.innerHTML = `
      <div class="dx" id="disp" dir="${t.dir}" lang="${lang}">
        <header class="dx-hero">
          <div class="dx-clock" id="d-clock" dir="ltr"></div>
          <div class="dx-hero-l">
            ${opt('display_title', '') ? `<div class="dx-title">${esc(opt('display_title', ''))}</div>` : ''}
            <div class="dx-date" id="d-date"></div>
            <div class="dx-live"><span class="dx-pulse"></span><span id="d-live"></span></div>
          </div>
          <div class="dx-hero-r">
            <div class="dx-ctrl">
              <select id="d-device" aria-label="Machine"><option value="">${t.allMachines}</option>${devices.map((d) => `<option value="${d.id}" ${String(f.device) === String(d.id) ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
              <input type="date" id="d-day" aria-label="Day" value="${esc(f.date)}">
              <button id="d-refresh" title="${t.reload}" aria-label="${t.reload}">${icon('refresh')}</button>
            </div>
            <button class="dx-lang" id="d-lang" title="${t.switchTitle}" lang="${lang === 'en' ? 'ur' : 'en'}">${t.switchTo}</button>
            <button class="dx-theme" id="d-theme"></button>
            <button class="dx-fs" id="d-kiosk"></button>
          </div>
        </header>

        <div class="dx-status" id="d-status" role="status" aria-live="polite"></div>

        <section class="dx-spot" id="d-hero"></section>

        <div class="dx-period" id="d-period"></div>
        <div class="dx-kpis" id="d-kpis"></div>

        <div class="dx-main">
          <div class="dx-col">
            <section class="dx-card">
              <div class="dx-card-h"><h3>${icon('activity', '')} ${t.activity}</h3><span class="dx-sub" id="d-count"></span></div>
              <div class="dx-feed" id="d-feed"></div>
            </section>
          </div>
          <section class="dx-card dx-board">
            <div class="dx-card-h">
              <h3>${icon('users', '')} ${t.employees}</h3>
              <div class="dx-seg" id="d-tabs" role="tablist">
                ${[['all', t.all], ['in', t.in], ['out', t.out]].map(([k, l]) => `<button data-tab="${k}" class="${f.tab === k ? 'active' : ''}">${l} <b id="d-n-${k}">0</b></button>`).join('')}
              </div>
              <div class="dx-seg dx-view" id="d-view">
                <button data-view="cards" class="${peopleView === 'cards' ? 'active' : ''}" title="${t.cardView}" aria-label="${t.cardView}">${icon('dashboard')}</button><button data-view="list" class="${peopleView === 'list' ? 'active' : ''}" title="${t.listView}" aria-label="${t.listView}">${icon('list')}</button>
              </div>
              <label class="dx-search">${icon('search')}<input id="d-q" placeholder="${t.search}" value="${esc(f.q)}"></label>
            </div>
            <div class="dx-people" id="d-people"></div>
          </section>
        </div>
        <div class="dx-note" id="d-note"></div>
      </div>`;
      bind();
    };

    const tick = () => {
      const c = $('#d-clock'); if (!c) return;
      const now = new Date();
      const [tm, ap] = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }).split(' ');
      c.innerHTML = `${esc(tm)}<span class="s">${String(now.getSeconds()).padStart(2, '0')}</span>${ap ? `<span class="ap">${esc(ap)}</span>` : ''}`;
      $('#d-date').textContent = now.toLocaleDateString(T().locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };

    const drawKpis = (s) => {
      const t = T();
      // the period the cards cover, e.g. "Thu, 5 Nov 07:00 → Fri, 6 Nov 06:59"
      if (data.window) {
        const fmt = (ts) => `${parseTs(ts).toLocaleDateString(t.locale, { weekday: 'short', day: 'numeric', month: 'short' })} <b dir="ltr">${esc(ts.slice(11, 16))}</b>`;
        $('#d-period').innerHTML = `${icon('calendar', '')} ${t.summary} · ${fmt(data.window[0])} <span dir="ltr">→</span> ${fmt(data.window[1])}`;
      }
      const presentA = s.present_active ?? s.present;  // active employees who punched
      const rate = s.active_employees ? Math.min(100, Math.round((presentA / s.active_employees) * 100)) : null;
      const k = (tone, ic, label, val, sub) => `<div class="dx-kpi ${tone}"><div class="dx-kpi-ic">${icon(ic)}</div><div class="dx-kpi-v">${val}</div><div class="dx-kpi-l">${label}</div><div class="dx-kpi-s">${sub}</div></div>`;
      $('#d-kpis').innerHTML = `
        <div class="dx-kpi dx-rate">
          <div class="dx-ring" style="--p:${rate ?? 0}"><span dir="ltr">${rate == null ? '—' : rate + '%'}</span></div>
          <div><div class="dx-kpi-l">${t.attendance}</div><div class="dx-kpi-v sm" dir="ltr">${fmtNum(s.active_employees ? presentA : s.present)}<small> / ${s.active_employees ? fmtNum(s.active_employees) : '—'}</small></div><div class="dx-kpi-s">${s.active_employees ? t.presentOf : t.readEmployees}</div>${s.active_employees && s.unlinked ? `<div class="dx-kpi-s dx-unlinked" title="${esc(t.unlinkedTitle)}">${t.unlinked(fmtNum(s.unlinked))}</div>` : ''}</div>
        </div>` +
        k('green', 'login', t.kIn, fmtNum(s.in), t.kInSub) +
        k('blue', 'logout', t.kOut, fmtNum(s.out), t.kOutSub) +
        k('amber', 'alert', t.kAbsent, s.absent == null ? '—' : fmtNum(s.absent), t.kAbsentSub) +
        k(s.failed ? 'red' : 'violet', 'fingerprint', t.kPunches, fmtNum(s.punches), t.kPunchesSub(fmtNum(s.synced), fmtNum(s.pending), s.failed ? fmtNum(s.failed) : 0));
      $('#d-n-all').textContent = fmtNum(s.present); $('#d-n-in').textContent = fmtNum(s.in); $('#d-n-out').textContent = fmtNum(s.out);
    };

    const drawHero = (p, fresh) => {
      const t = T();
      const el = $('#d-hero');
      el.className = `dx-spot ${p ? (p.type === 'OUT' ? 'out' : 'in') : 'none'}`;
      if (!p) {
        el.innerHTML = `<div class="dx-spot-empty">${icon('fingerprint')}<div><div class="t">${t.noPunches}</div><div>${data.is_today ? t.noPunchesToday : t.noPunchesDay}</div></div></div>`;
        return;
      }
      const tiles = [['t-div', 'layers', t.division, 'division'], ['t-dep', 'box', t.department, 'department'], ['t-sub', 'folder', t.subDepartment, 'sub_department'], ['t-des', 'user', t.designation, 'designation']].filter((x) => showOrg[x[3]] && p[x[3]]);
      const inOut = p.type === 'OUT' ? 'logout' : 'login';
      el.innerHTML = `
        <div class="dx-spot-photo">${avatar(p, 'xl')}</div>
        <div class="dx-spot-who">
          <div class="dx-spot-eyebrow"><span class="dx-spot-ic">${icon(inOut)}</span><span class="dx-spot-tag">${p.__prev ? t.prevPunch : t.latest}</span><span class="dx-spot-ago">${rel(p.ts)}</span></div>
          <div class="dx-spot-name">${whoH(p)}</div>
          <div class="dx-spot-sub">${p.employee_id ? `<span class="dx-spot-id" dir="ltr">${esc(p.employee_id)}</span>` : `<span class="dx-chip">${t.deviceUser(esc(p.user_id))}</span>`}<span class="dx-chip">${icon('fingerprint', '')}<bdi>${esc(p.device_name || '')}</bdi></span>${syncTag(p)}</div>
        </div>
        ${tiles.length ? `<div class="dx-spot-tiles">${tiles.map(([c, ic, l, k]) => `<div class="dx-tile ${c}"><div class="dx-tile-ic">${icon(ic)}</div><b title="${esc(loc(p, k))}">${V(p, k)}</b><span>${l}</span></div>`).join('')}</div>` : ''}
        <div class="dx-spot-when">
          <div class="dx-spot-act">${icon(inOut, '')} ${p.type === 'OUT' ? t.checkedOut : t.checkedIn}${p.type_guessed ? '*' : ''}</div>
          <div class="dx-spot-time" dir="ltr">${esc(p.ts.slice(11, 16))}</div>
        </div>`;
      if (fresh) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    };

    const drawFeed = (rows, freshIds) => {
      const t = T();
      // the board's time window, e.g. "07:00 → 06:59" when the day starts at 07:00
      const win = data.window ? `${data.window[0].slice(11, 16)} → ${data.window[1].slice(11, 16)}` : '';
      $('#d-count').innerHTML = [win && `<bdi dir="ltr">${esc(win)}</bdi>`, rows.length ? esc(t.lastN(rows.length)) : ''].filter(Boolean).join(' · ');
      $('#d-feed').innerHTML = rows.length > 1 ? `<ol class="dx-tl">${rows.slice(1).map((p) => `
        <li class="${p.type === 'OUT' ? 'out' : 'in'} ${freshIds.has(p.id) ? 'fresh' : ''}">
          <span class="dx-tl-time" dir="ltr">${esc(p.ts.slice(11, 16))}</span>
          <span class="dx-tl-dot"></span>
          ${avatar(p, 'sm')}
          <div class="dx-tl-txt"><div class="n">${whoH(p)}</div><div class="m">${[V(p, 'designation'), org(p) || `${t.id} ${esc(p.user_id)}`].filter(Boolean).join(' · ')}</div></div>
          ${typePill(p.type, p.type_guessed)}
        </li>`).join('')}</ol>`
        : `<div class="dx-empty sm">${rows.length ? t.noEarlier : t.nothingYet}</div>`;
    };

    const drawPeople = () => {
      if (!data) return;
      const t = T();
      const q = f.q.toLowerCase();
      const list = data.people.filter((p) => (f.tab === 'all' || p.status === f.tab) &&
        (!q || [p.name, p.employee_name_ur, p.user_id, p.employee_id, p.division, p.division_ur, p.department, p.department_ur, p.sub_department, p.sub_department_ur, p.designation, p.designation_ur].some((v) => String(v || '').toLowerCase().includes(q))));
      const box = $('#d-people');
      box.classList.toggle('list', peopleView === 'list');
      if (!list.length) {
        box.innerHTML = `<div class="dx-empty">${icon('users')}<div class="t">${t.nobody}</div><div>${f.q || f.tab !== 'all' ? t.noMatch : t.noneToday}</div></div>`;
        return;
      }
      const worked = (p) => `<b ${p.worked_running ? `class="dx-running" title="${esc(t.running)}"` : ''}><bdi>${p.worked_seconds != null ? t.dur(p.worked_seconds) : '—'}</bdi></b>`;
      if (peopleView === 'list') {
        box.innerHTML = `<table class="dx-list"><thead><tr><th>${t.employee}</th><th>${t.division} · ${t.department}</th><th>${t.firstIn}</th><th>${t.lastOut}</th><th>${t.worked}</th><th>${t.status}</th></tr></thead><tbody>
          ${list.map((p) => `<tr class="${p.status}">
            <td><div class="dx-list-who">${avatar(p, 'sm')}<div><div class="n">${whoH(p)}</div><div class="m">${V(p, 'designation') || `${t.id} ${esc(p.user_id)}`}</div></div></div></td>
            <td class="o">${org(p) || '—'}</td>
            <td class="t">${hm(p.first_in)}</td>
            <td class="t">${hm(p.last_out)}</td>
            <td class="t">${worked(p)}</td>
            <td><span class="dx-state ${p.status}"><i></i>${p.status === 'in' ? t.in : t.out}</span></td>
          </tr>`).join('')}</tbody></table>`;
        return;
      }
      box.innerHTML = list.map((p) => `
        <article class="dx-person ${p.status}">
          <div class="dx-person-top">
            ${avatar(p)}
            <div class="dx-person-id">
              <div class="n" title="${esc(who(p))}">${whoH(p)}</div>
              <div class="m">${V(p, 'designation') || `${t.id} ${esc(p.user_id)}`}</div>
              ${org(p) ? `<div class="o">${org(p)}</div>` : ''}
            </div>
            <span class="dx-state ${p.status}"><i></i>${p.status === 'in' ? t.in : t.out}</span>
          </div>
          <div class="dx-person-stats">
            <div><span>${t.firstIn}</span><b>${hm(p.first_in)}</b></div>
            <div><span>${t.lastOut}</span><b>${hm(p.last_out)}</b></div>
            <div><span>${t.worked}</span>${worked(p)}</div>
          </div>
        </article>`).join('');
    };

    const drawMeta = () => {
      const t = T();
      const lv = data.live || {};
      const liveOn = lv.enabled && (lv.machines || []).length > 0;
      $('#d-live').textContent = !data.is_today ? t.showing(parseTs(data.date).toLocaleDateString(t.locale, { weekday: 'short', month: 'short', day: 'numeric' }))
        : liveOn ? t.liveCap(lv.listening, lv.machines.length) : t.live(rel(data.last_read_at));
      $('#disp').classList.toggle('past', !data.is_today);
      $('#disp').classList.toggle('live-warn', !!(data.is_today && liveOn && lv.listening < lv.machines.length));
      $('#d-note').textContent = (liveOn ? t.noteLive : t.note(store.settings?.sync_interval_minutes)) + (data.recent.some((r) => r.type_guessed) ? t.guessed : '');
    };

    /* service status bar: service, live capture, ERP, last sync, punches still to send */
    const drawStatus = () => {
      const el = $('#d-status'); if (!el || !data) return;
      const t = T(), sv = data.service || {};
      const chip = (tone, ic, text, title = '') => `<span class="dx-st ${tone}" ${title ? `title="${esc(title)}"` : ''}>${icon(ic, '')}<span>${esc(text)}</span></span>`;
      const hhmm = (ts) => (ts ? String(ts).replace('T', ' ').slice(11, 16) : '');
      const parts = [chip(store.connected ? 'ok' : 'bad', store.connected ? 'cloud' : 'cloudOff', store.connected ? t.erpOk : t.svcOffline)];
      const lv = data.live || {};
      if (lv.enabled && (lv.machines || []).length) {
        const n = lv.machines.length;
        parts.push(chip(lv.listening === n ? 'ok' : lv.listening ? 'warn' : 'bad', 'fingerprint', t.liveCap(lv.listening, n),
          lv.machines.map((m) => `${m.name}: ${m.status}${m.last_error ? ' — ' + m.last_error : ''}`).join('\n')));
      }
      const devs = sv.devices || [];
      if (devs.length && !(lv.enabled && (lv.machines || []).length)) {
        const ok = devs.filter((d) => !d.last_error && String(d.status || '').toLowerCase() !== 'offline').length;
        parts.push(chip(ok === devs.length ? 'ok' : ok ? 'warn' : 'bad', 'fingerprint', t.liveN(ok, devs.length),
          devs.map((d) => `${d.name}: ${d.status || ''}${d.last_sync_at ? ' · ' + d.last_sync_at.slice(0, 16) : ''}${d.last_error ? ' — ' + d.last_error : ''}`).join('\n')));
      }
      parts.push(sv.last_sync ? chip(sv.last_sync.status === 'failed' ? 'bad' : 'off', 'history', t.lastSync(`${fmtDay(sv.last_sync.finished_at)} ${hhmm(sv.last_sync.finished_at)}`, sv.last_sync.status))
        : chip('off', 'history', t.live(rel(data.last_read_at))));
      el.innerHTML = parts.join('');
    };

    const drawAll = (freshIds = new Set()) => {
      if (!data) return;
      drawKpis(data.summary);
      const prev = !data.recent.length && data.previous ? { ...data.previous, __prev: true } : null;
      drawHero(data.recent[0] || prev, data.recent[0] && freshIds.has(data.recent[0].id));
      drawFeed(data.recent, freshIds);
      drawPeople();
      drawMeta();
      drawStatus();
    };

    const load = async () => {
      if (loading) return; loading = true;
      const p = new URLSearchParams();
      if (f.date) p.set('date', f.date);
      if (f.device) p.set('device', f.device);
      p.set('limit', opt('display_recent_count', 40));
      $('#d-refresh')?.classList.add('spinning');
      try {
        data = await api('/display/today?' + p);
        const freshIds = new Set();
        if (seen) data.recent.forEach((r) => { if (!seen.has(r.id)) freshIds.add(r.id); });
        seen = new Set(data.recent.map((r) => r.id));
        drawAll(freshIds);
      } catch (e) {
        if (e.status !== 401) $('#d-note').innerHTML = `<span class="st-failed">${icon('xCircle', '')} ${esc(e.message)}</span>`;
      } finally { loading = false; setTimeout(() => $('#d-refresh')?.classList.remove('spinning'), 400); }
    };

    /* light / dark: uses the app-wide theme, so the choice is remembered */
    const drawThemeBtn = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      const b = $('#d-theme'); if (!b) return;
      b.innerHTML = icon(dark ? 'sun' : 'moon');
      b.title = b.ariaLabel = dark ? T().toLight : T().toDark;
    };

    /* kiosk / full screen: hides the app chrome, for wall TVs */
    const drawKioskBtn = () => {
      const onOff = document.body.classList.contains('kiosk');
      const b = $('#d-kiosk'); if (b) b.innerHTML = onOff ? `${icon('minimize')} <span>${T().exit}</span>` : `${icon('maximize')} <span>${T().fullScreen}</span>`;
    };
    const setKiosk = (onOff) => {
      document.body.classList.toggle('kiosk', onOff);
      drawKioskBtn();
      if (onOff && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      if (!onOff && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    const onFs = () => { if (!document.fullscreenElement && document.body.classList.contains('kiosk')) setKiosk(false); };
    document.addEventListener('fullscreenchange', onFs);

    function bind() {
      $('#d-device').onchange = (e) => { f.device = e.target.value; seen = null; load(); };
      $('#d-day').onchange = (e) => { f.date = e.target.value; seen = null; load(); };
      $('#d-refresh').onclick = load;
      let qt; $('#d-q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value.trim(); drawPeople(); }, 200); };
      $$('#d-tabs [data-tab]').forEach((b) => (b.onclick = () => { f.tab = b.dataset.tab; $$('#d-tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b)); drawPeople(); }));
      $$('#d-view [data-view]').forEach((b) => (b.onclick = () => {
        peopleView = b.dataset.view;
        try { localStorage.setItem('bas-display-view', peopleView); } catch (e) { /* ignore */ }
        $$('#d-view [data-view]').forEach((x) => x.classList.toggle('active', x === b));
        drawPeople();
      }));
      $('#d-theme').onclick = () => toggleTheme();
      $('#d-kiosk').onclick = () => setKiosk(!document.body.classList.contains('kiosk'));
      $('#d-lang').onclick = () => {
        lang = lang === 'en' ? 'ur' : 'en';
        try { localStorage.setItem('bas-display-lang', lang); } catch (e) { /* ignore */ }
        shell(); tick(); drawAll();
      };
      drawThemeBtn(); drawKioskBtn();
    }

    shell();
    tick(); clock = setInterval(tick, 1000);
    await load();
    if (args[0] === 'kiosk') setKiosk(true);
    timer = setInterval(load, Math.max(5, Number(opt('display_refresh_seconds', 30))) * 1000);
    const reload = throttle(load, 3000);
    // live capture: a punch arrived from a machine -> refresh right away (batched to 1/s)
    const onPunch = throttle(() => { if (!f.date || f.date === todayStr()) load(); }, 1000);
    const onLive = (lv) => { if (data) { data.live = lv; drawMeta(); drawStatus(); } };
    const offs = [on('task', reload), on('run_finished', () => setTimeout(load, 800)), on('theme', drawThemeBtn),
      on('punch', onPunch), on('live', onLive), on('connection', (up) => { drawStatus(); if (up) load(); }), on('runs', drawStatus)];
    return () => {
      clearInterval(timer); clearInterval(clock);
      offs.forEach((o) => o());
      document.removeEventListener('fullscreenchange', onFs);
      setKiosk(false);
    };
  },
};
