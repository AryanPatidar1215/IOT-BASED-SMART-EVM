(() => {
  const root = $('#root');
  const S = { me: null, status: 'draft', route: 'overview', feed: [], filter: 'all', search: '', refresh: null, es: null, timer: null };

  const NAV = [
    ['overview', 'Overview', 'dashboard'],
    ['voters', 'Voters', 'users'],
    ['election', 'Election', 'ballot'],
    ['booths', 'Booths', 'cpu'],
    ['audit', 'Audit log', 'shield'],
    ['settings', 'Account', 'lock']
  ];

  /* ---------- modal helper ---------- */
  function modal(html, onClose) {
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener('close', () => { d.remove(); if (onClose) onClose(); });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.showModal();
    return d;
  }
  const modalHead = (title) => `<header><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>`;

  function confirmDialog({ title, body, confirm, danger }) {
    return new Promise((resolve) => {
      let answer = false;
      const d = modal(`<div class="mform">${modalHead(esc(title))}<p style="margin-bottom:18px">${body}</p>
        <footer><button class="btn" type="button" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-yes>${esc(confirm)}</button></footer></div>`,
      () => resolve(answer));
      $('[data-yes]', d).addEventListener('click', () => { answer = true; d.close(); });
    });
  }

  /* ---------- login ---------- */
  function showLogin() {
    root.innerHTML = `
      <div class="login">
        <section class="login-art">
          <a class="brand" href="/"><span class="brand-mark">${icon('ballot', 18)}</span>Smart EVM</a>
          <div>
            <h1>One card, one vote, one record nobody can quietly edit.</h1>
            <p style="margin-top:16px">Sign in to register voters, run the election, and watch turnout live.</p>
          </div>
          <div class="slip" aria-hidden="true">
            <div class="ln"><span class="box">${icon('check', 14)}</span><span class="bar"></span></div>
            <div class="ln"><span class="box"></span><span class="bar" style="flex:.7"></span></div>
            <div class="ln"><span class="box"></span><span class="bar" style="flex:.85"></span></div>
          </div>
        </section>
        <section class="login-form">
          <form id="lform" novalidate>
            <h2>Admin sign in</h2>
            <p class="lead">Only the election admin can add voters or run the election.</p>
            <div class="field"><label for="lu">Username</label><input id="lu" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
            <div class="field"><label for="lp">Password</label><input id="lp" type="password" autocomplete="current-password"></div>
            <p class="error" id="lerr" role="alert"></p>
            <button class="btn primary" type="submit" style="width:100%" id="lgo">Sign in</button>
            <p class="hint" style="margin-top:16px">Voters don't sign in. They use their card at the booth. <a href="/">Public results page</a></p>
          </form>
        </section>
      </div>`;
    $('#lu').focus();
    $('#lform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#lu').value.trim();
      const password = $('#lp').value;
      const err = $('#lerr');
      err.textContent = '';
      if (!username || !password) { err.textContent = 'Enter your username and password.'; return; }
      $('#lgo').disabled = true;
      try {
        const r = await api('/api/auth/login', { method: 'POST', body: { username, password } });
        S.me = r.username;
        startApp();
      } catch (ex) {
        err.textContent = ex.message;
        $('#lgo').disabled = false;
      }
    });
  }

  /* ---------- shell ---------- */
  function startApp() {
    root.innerHTML = `
      <div class="shell">
        <aside class="side">
          <a class="brand" href="/admin"><span class="brand-mark">${icon('ballot', 18)}</span>Smart EVM</a>
          <nav class="nav" aria-label="Admin sections">
            ${NAV.map(([id, label, ic]) => `<a href="#${id}" data-nav="${id}">${icon(ic)}${label}</a>`).join('')}
          </nav>
          <div class="side-foot">
            <span>Signed in as <b>${esc(S.me)}</b></span>
            <button class="btn sm" data-act="logout">${icon('logout', 16)}Sign out</button>
          </div>
        </aside>
        <main class="main">
          <div class="top"><div><h1 id="ptitle"></h1><p id="psub"></p></div><div id="pchip"></div></div>
          <div id="view" aria-live="polite"></div>
        </main>
      </div>`;
    connectStream();
    route();
  }

  function setTop(title, sub) {
    $('#ptitle').textContent = title;
    $('#psub').textContent = sub || '';
    const st = STATUS[S.status];
    $('#pchip').innerHTML = `<span class="chip ${st.cls}"><span class="dot ${S.status === 'open' ? 'on' : ''}"></span>${st.label}</span>`;
  }

  async function route() {
    const id = (location.hash || '#overview').slice(1);
    S.route = NAV.some((n) => n[0] === id) ? id : 'overview';
    $$('[data-nav]').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === S.route ? 'page' : 'false'));
    S.refresh = null;
    try {
      const el = await api('/api/admin/election');
      S.status = el.status;
      await PAGES[S.route]();
    } catch (e) { handleError(e); }
  }

  function handleError(e) {
    if (e.status === 401) { closeStream(); showLogin(); return; }
    toast(e.message, 'bad');
  }

  /* ---------- live updates ---------- */
  function connectStream() {
    closeStream();
    const es = new EventSource('/api/admin/stream');
    S.es = es;
    const soon = () => { clearTimeout(S.timer); S.timer = setTimeout(() => { if (S.refresh) S.refresh().catch(() => {}); }, 250); };
    ['vote', 'election', 'device', 'voters', 'enrolled'].forEach((t) => es.addEventListener(t, () => {
      if (t === 'election') api('/api/admin/election').then((el) => { S.status = el.status; setTop($('#ptitle').textContent, $('#psub').textContent); }).catch(() => {});
      soon();
    }));
    es.addEventListener('activity', (ev) => {
      const d = JSON.parse(ev.data);
      S.feed.unshift({ kind: d.kind, text: d.text, ts: d.ts });
      S.feed = S.feed.slice(0, 40);
      const el = $('#feed');
      if (el) el.innerHTML = feedHtml();
    });
  }
  function closeStream() { if (S.es) { S.es.close(); S.es = null; } }

  const feedHtml = () => S.feed.length
    ? S.feed.map((f) => `<li class="${esc(f.kind)}"><span class="pip"></span><time>${fmtTime(f.ts)}</time><span>${esc(f.text)}</span></li>`).join('')
    : `<li><span class="hint">Booth activity shows up here as it happens.</span></li>`;

  /* ---------- overview ---------- */
  async function overview() {
    const draw = async () => {
      const st = await api('/api/admin/stats');
      S.status = st.election.status;
      setTop('Overview', st.election.title);
      const pct = st.registered ? Math.min(100, Math.round((st.voted / st.registered) * 100)) : 0;
      const waiting = Math.max(0, st.registered - st.voted);

      const timeline = st.timeline.length
        ? (() => {
            const max = Math.max(...st.timeline.map((t) => t.n));
            return `<div class="bars" role="img" aria-label="Votes per 5 minutes">${st.timeline.slice(-24).map((t) => `<div class="b" style="height:${Math.max(6, Math.round((t.n / max) * 100))}%" title="${fmtTime(t.at)}: ${t.n}"></div>`).join('')}</div>
            <div class="axis"><span>${fmtTime(st.timeline.slice(-24)[0].at)}</span><span>${fmtTime(st.timeline[st.timeline.length - 1].at)}</span></div>`;
          })()
        : `<div class="empty"><h3>No votes yet</h3><p>Bars appear here as ballots are cast, grouped in 5 minute blocks.</p></div>`;

      const booths = st.byBooth.length
        ? `<div class="rows">${st.byBooth.map((b) => `<div class="rowbar"><div class="head"><span>${esc(b.booth)}</span><b>${b.n}</b></div><div class="track"><div style="width:${Math.round((b.n / st.votesCast) * 100)}%;background:var(--ink-3)"></div></div></div>`).join('')}</div>`
        : `<div class="empty"><h3>No booth has recorded a vote</h3><p>Each booth's share of the votes will show here.</p></div>`;

      let results;
      if (st.results) {
        const total = st.results.reduce((a, c) => a + c.votes, 0);
        const max = Math.max(...st.results.map((c) => c.votes));
        results = `<div class="rows">${st.results.map((c) => {
          const p = total ? Math.round((c.votes / total) * 100) : 0;
          return `<div class="rowbar"><div class="head"><span class="cand">${swatch(c)}<b>${esc(c.name)}</b>${c.votes === max && max > 0 ? '<span class="chip good">Most votes</span>' : ''}</span><span>${c.votes} (${p}%)</span></div><div class="track"><div style="width:${p}%;background:${esc(c.color)}"></div></div></div>`;
        }).join('')}</div>`;
      } else {
        results = `<div class="sealed"><span class="seal">${icon('lock', 22)}</span><h3 style="font-size:18px">Results are sealed</h3><p class="hint">They unlock when you close the election, so nobody sees a running count. Turnout stays visible.</p></div>`;
      }

      $('#view').innerHTML = `
        <div class="grid-ov">
          <section class="card well">
            ${inkGauge(pct, 'turnout')}
            <div>
              <h2>${st.voted} of ${st.registered} voters have voted</h2>
              <p>${st.election.status === 'open' ? `${waiting} ${waiting === 1 ? 'voter is' : 'voters are'} still to vote.` : st.election.status === 'closed' ? 'Voting is closed. The final count is in the results panel.' : 'Voting has not started. Open the election when your booths are ready.'}</p>
            </div>
          </section>
          <div class="stats">
            <div class="stat"><div class="k">Registered voters</div><div class="v">${st.registered}</div><div class="n">${st.blocked ? st.blocked + ' blocked' : 'No blocked cards'}</div></div>
            <div class="stat"><div class="k">Booths online</div><div class="v">${st.devices.online}<small> / ${st.devices.total}</small></div><div class="n">${st.devices.total ? 'Seen in the last 30 seconds' : 'Add a booth to begin'}</div></div>
            <div class="stat"><div class="k">Ballots stored</div><div class="v">${st.votesCast}</div><div class="n">${st.mismatch ? 'Does not match voters who voted' : 'Matches voters who voted'}</div></div>
            <div class="stat"><div class="k">Election</div><div class="v" style="font-size:22px;padding-top:6px">${STATUS[st.election.status].label}</div><div class="n">${st.election.openedAt ? 'Opened ' + fmtDateTime(st.election.openedAt) : 'Not opened yet'}</div></div>
          </div>
        </div>
        ${st.mismatch ? `<div class="banner warn">${icon('alert')}<div><b>The ballot count and voter count differ.</b> This can happen if the server stopped mid-vote. Run the audit check and review the log before closing.</div></div>` : ''}
        <div class="two">
          <section class="card"><h2>Votes over time</h2><p class="sub">Ballots cast in each 5 minute block.</p>${timeline}</section>
          <section class="card"><h2>Votes by booth</h2><p class="sub">Which booths are carrying the load.</p>${booths}</section>
        </div>
        <div class="two">
          <section class="card"><h2>Results</h2><p class="sub">${st.results ? 'Final count.' : 'Hidden until the election closes.'}</p>${results}</section>
          <section class="card"><h2>Live activity</h2><p class="sub">Events from the booths, newest first.</p><ul class="feed" id="feed">${feedHtml()}</ul></section>
        </div>`;
    };
    S.refresh = draw;
    await draw();
  }

  /* ---------- voters ---------- */
  async function voters() {
    setTop('Voters', 'Only the admin can add voters, and every addition is logged.');
    $('#view').innerHTML = `
      <div class="toolbar">
        <div class="grow"><label class="sr" for="vs">Search voters</label>${icon('search', 18)}<input id="vs" type="search" placeholder="Search by name, voter ID or card" value="${esc(S.search)}"></div>
        <div class="seg" role="group" aria-label="Filter voters">
          ${[['all', 'All'], ['pending', 'Waiting'], ['voted', 'Voted'], ['blocked', 'Blocked']].map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}
        </div>
        <button class="btn" data-act="bulk">${icon('upload', 16)}Import list</button>
        <button class="btn primary" data-act="add-voter">${icon('plus', 16)}Add voter</button>
      </div>
      <section class="card" style="padding:6px 8px"><div class="tscroll" id="vrows"></div></section>`;
    const load = async () => {
      const q = new URLSearchParams();
      if (S.search) q.set('search', S.search);
      if (S.filter !== 'all') q.set('status', S.filter);
      const { voters } = await api('/api/admin/voters?' + q);
      const box = $('#vrows');
      if (!box) return;
      if (!voters.length) {
        box.innerHTML = `<div class="empty"><h3>${S.search || S.filter !== 'all' ? 'No voters match' : 'No voters yet'}</h3><p>${S.search || S.filter !== 'all' ? 'Try a different search or filter.' : 'Add your first voter, then tap their card on a booth to register it.'}</p></div>`;
        return;
      }
      box.innerHTML = `<table class="tbl"><thead><tr><th>Voter</th><th class="hide-s">Card</th><th>Status</th><th class="hide-s">Added</th><th></th></tr></thead><tbody>
        ${voters.map((v) => {
          const chip = !v.registered ? '<span class="chip bad">Blocked</span>' : v.hasVoted ? '<span class="chip good">Voted</span>' : '<span class="chip">Waiting</span>';
          return `<tr>
            <td><div class="name">${esc(v.name)}</div><div class="sub2">${esc(v.voterId)}</div></td>
            <td class="hide-s mono">${esc(v.uid)}</td>
            <td>${chip}</td>
            <td class="hide-s"><div>${fmtDate(v.createdAt)}</div><div class="sub2">by ${esc(v.createdBy || 'system')}</div></td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn sm ghost" data-act="toggle-block" data-id="${esc(v._id)}" data-reg="${v.registered}">${icon('ban', 15)}${v.registered ? 'Block' : 'Unblock'}</button>
              ${v.hasVoted ? '' : `<button class="icon-btn" data-act="del-voter" data-id="${esc(v._id)}" data-name="${esc(v.name)}" aria-label="Remove ${esc(v.name)}">${icon('trash', 16)}</button>`}
            </td></tr>`;
        }).join('')}</tbody></table>`;
    };
    S.refresh = load;
    let t;
    $('#vs').addEventListener('input', (e) => { S.search = e.target.value.trim(); clearTimeout(t); t = setTimeout(() => load().catch(handleError), 250); });
    await load();
  }

  function addVoterModal() {
    let mode = 'scan';
    const d = modal(`<form class="mform" novalidate>${modalHead('Add a voter')}
      <div class="field"><label for="av-name">Full name</label><input id="av-name" maxlength="60" autocomplete="off"></div>
      <div class="field"><label for="av-id">Voter ID</label><input id="av-id" maxlength="30" autocomplete="off" placeholder="PB-204518"></div>
      <div class="seg" role="group" aria-label="How to capture the card">
        <button type="button" data-mode="scan" aria-pressed="true">Scan at booth</button>
        <button type="button" data-mode="manual" aria-pressed="false">Type card UID</button>
      </div>
      <p class="hint" id="av-help" style="margin:-4px 0 14px">After you confirm, tap the voter's card on any online booth. The booth reads the card and registers it.</p>
      <div class="field" id="av-uidwrap" hidden><label for="av-uid">Card UID</label><input id="av-uid" maxlength="23" autocomplete="off" placeholder="4A7F21C9" class="mono"></div>
      <div class="field authz"><label for="av-pw">Your admin password</label><input id="av-pw" type="password" autocomplete="current-password"><span class="hint">Adding a voter changes who can vote, so it needs your password every time.</span></div>
      <p class="error" id="av-err" role="alert"></p>
      <footer><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" id="av-go">Start card scan</button></footer>
    </form>`);
    $('#av-name', d).focus();
    $$('[data-mode]', d).forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $$('[data-mode]', d).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#av-uidwrap', d).hidden = mode !== 'manual';
      $('#av-help', d).hidden = mode !== 'scan';
      $('#av-go', d).textContent = mode === 'scan' ? 'Start card scan' : 'Add voter';
    }));
    $('form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#av-err', d);
      err.textContent = '';
      const body = { name: $('#av-name', d).value, voterId: $('#av-id', d).value, uid: $('#av-uid', d).value, password: $('#av-pw', d).value };
      if (!body.name.trim() || !body.voterId.trim()) { err.textContent = 'Enter the voter name and voter ID.'; return; }
      if (mode === 'manual' && !body.uid.trim()) { err.textContent = 'Enter the card UID, or switch to Scan at booth.'; return; }
      if (!body.password) { err.textContent = 'Enter your admin password to authorize this.'; return; }
      $('#av-go', d).disabled = true;
      try {
        if (mode === 'manual') {
          await api('/api/admin/voters', { method: 'POST', body });
          toast(body.name.trim() + ' was added.');
          d.close();
          if (S.refresh) S.refresh();
        } else {
          let devices = [];
          try { devices = (await api('/api/admin/devices')).devices; } catch { /* non-fatal */ }
          const r = await api('/api/admin/enroll', { method: 'POST', body: { name: body.name, voterId: body.voterId, password: body.password } });
          scanView(d, body.name.trim(), body.voterId.trim().toUpperCase(), r.expiresAt, devices.some((x) => x.online));
        }
      } catch (ex) {
        err.textContent = ex.message;
        $('#av-go', d).disabled = false;
      }
    });
  }

  function scanView(d, name, voterId, expiresAt, anyOnline) {
    const startedAt = Date.now() - 2000;
    d.innerHTML = `<div class="scan">
      <div class="pulse">${icon('nfc', 32)}</div>
      <h2>Tap the voter's card on a booth</h2>
      <p>Any online booth will register the card as <b>${esc(name)}</b> (${esc(voterId)}).<br>This window closes in <b id="sc-t">60</b> seconds.</p>
      ${anyOnline ? '' : `<div class="banner warn" style="text-align:left;margin:0">${icon('alert')}<div>No booth is online right now. Power one on, or cancel and type the card UID instead.</div></div>`}
      <button class="btn" type="button" id="sc-cancel">Cancel</button></div>`;
    let done = false;
    const tick = setInterval(async () => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      const t = $('#sc-t', d); if (t) t.textContent = left;
      try {
        const s = await api('/api/admin/enroll');
        if (s.result && s.result.ok && s.result.at >= startedAt) return finish(true);
        if (!s.active && !done) return finish(false);
      } catch { /* retry next tick */ }
    }, 1200);
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearInterval(tick);
      d.innerHTML = `<div class="scan">
        <div class="pulse" style="${ok ? 'background:var(--good-bg);color:var(--good)' : 'background:var(--bad-bg);color:var(--bad)'}">${icon(ok ? 'check' : 'x', 34)}</div>
        <h2>${ok ? esc(name) + ' is registered' : 'No card was scanned'}</h2>
        <p>${ok ? 'The card now works at every booth.' : 'The scan window ended. Start again when the voter is at the booth.'}</p>
        <div style="display:flex;gap:10px"><button class="btn" type="button" data-close>Done</button>${ok ? '<button class="btn primary" type="button" id="sc-again">Add another</button>' : ''}</div></div>`;
      if (S.refresh) S.refresh();
      const again = $('#sc-again', d);
      if (again) again.addEventListener('click', () => { d.close(); addVoterModal(); });
    };
    $('#sc-cancel', d).addEventListener('click', async () => {
      done = true; clearInterval(tick);
      try { await api('/api/admin/enroll', { method: 'DELETE' }); } catch { /* ignore */ }
      d.close();
    });
    d.addEventListener('close', () => { clearInterval(tick); }, { once: true });
  }

  function bulkModal() {
    const d = modal(`<form class="mform" novalidate>${modalHead('Import voters')}
      <div class="field"><label for="bk-t">One voter per line</label>
        <textarea id="bk-t" placeholder="Aarav Singh, PB-204518, 4A7F21C9&#10;Meera Kaur, PB-204519, 9C03E5B1"></textarea>
        <span class="hint">Format: name, voter ID, card UID. Up to 500 lines.</span></div>
      <div class="field authz"><label for="bk-pw">Your admin password</label><input id="bk-pw" type="password" autocomplete="current-password"></div>
      <p class="error" id="bk-err" role="alert"></p><div id="bk-res"></div>
      <footer><button class="btn" type="button" data-close>Close</button><button class="btn primary" type="submit" id="bk-go">Import voters</button></footer></form>`);
    $('form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#bk-err', d);
      err.textContent = '';
      const rows = $('#bk-t', d).value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, voterId, uid] = l.split(',').map((x) => (x || '').trim()); return { name, voterId, uid }; });
      if (!rows.length) { err.textContent = 'Paste at least one line.'; return; }
      const password = $('#bk-pw', d).value;
      if (!password) { err.textContent = 'Enter your admin password to authorize this.'; return; }
      $('#bk-go', d).disabled = true;
      try {
        const r = await api('/api/admin/voters/bulk', { method: 'POST', body: { rows, password } });
        $('#bk-res', d).innerHTML = `<div class="banner ${r.skipped.length ? 'warn' : 'good'}">${icon(r.skipped.length ? 'alert' : 'check')}<div><b>${r.added} added.</b> ${r.skipped.length ? r.skipped.length + ' skipped: ' + r.skipped.slice(0, 5).map((s) => `line ${s.row} (${esc(s.reason)})`).join(', ') : ''}</div></div>`;
        if (S.refresh) S.refresh();
      } catch (ex) { err.textContent = ex.message; }
      $('#bk-go', d).disabled = false;
    });
  }

  /* ---------- election ---------- */
  async function election() {
    const draw = async () => {
      const el = await api('/api/admin/election');
      const st = await api('/api/admin/stats');
      S.status = el.status;
      setTop('Election', 'Set the ballot, then open and close voting.');
      const locked = el.status !== 'draft';
      const checks = [
        [el.candidates.length >= 2, 'Ballot has at least 2 candidates'],
        [st.registered > 0, `${st.registered} ${st.registered === 1 ? 'voter is' : 'voters are'} registered`],
        [st.devices.online > 0, `${st.devices.online} ${st.devices.online === 1 ? 'booth is' : 'booths are'} online`]
      ];
      $('#view').innerHTML = `
        <div class="two">
          <section class="card">
            <h2>Ballot</h2>
            <p class="sub">${locked ? 'The ballot is locked once voting opens.' : 'Each row matches a physical button on the booth.'}</p>
            <form id="eform" novalidate>
              <div class="field"><label for="e-title">Election title</label><input id="e-title" maxlength="80" value="${esc(el.title)}" ${locked ? 'disabled' : ''}></div>
              ${[0, 1, 2, 3].map((i) => {
                const c = el.candidates[i];
                const def = ['#e4e2da', '#d64545', '#e6b422', '#3f9d5a'][i];
                const btn = ['White', 'Red', 'Yellow', 'Green'][i];
                return `<div class="cand-edit"><span class="swatch" style="background:${def}" title="${btn} button">${i + 1}</span>
                  <input aria-label="Candidate ${i + 1} name (${btn} button)" data-cn="${i}" maxlength="40" placeholder="${i < 2 ? 'Required' : 'Optional'}" value="${c ? esc(c.name) : ''}" ${locked ? 'disabled' : ''}>
                  <input aria-label="Candidate ${i + 1} symbol" data-cs="${i}" maxlength="2" placeholder="Mark" value="${c ? esc(c.symbol) : ''}" ${locked ? 'disabled' : ''}></div>`;
              }).join('')}
              <p class="error" id="e-err" role="alert"></p>
              ${locked ? '' : '<button class="btn primary" type="submit">Save ballot</button>'}
            </form>
          </section>
          <section class="card">
            <h2>Voting</h2>
            <p class="sub">${el.status === 'draft' ? 'Check these before you open.' : el.status === 'open' ? 'Booths are accepting votes.' : 'Voting has ended.'}</p>
            ${el.status === 'draft' ? `<ul class="steps">${checks.map(([ok, t]) => `<li>${icon(ok ? 'check' : 'info')}<span class="${ok ? 'ok' : 'no'}">${esc(t)}</span></li>`).join('')}</ul>
              <p class="hint" style="margin:10px 0 16px">Booths online is a heads-up, not a requirement.</p>
              <button class="btn primary" data-act="open-el">${icon('vote', 16)}Open voting</button>` : ''}
            ${el.status === 'open' ? `<div class="banner good">${icon('check')}<div>Voting is open since ${fmtDateTime(el.openedAt)}. ${st.voted} of ${st.registered} voters have voted.</div></div>
              <button class="btn danger" data-act="close-el">Close voting and unseal results</button>` : ''}
            ${el.status === 'closed' ? `<div class="banner info">${icon('lock')}<div>Closed ${fmtDateTime(el.closedAt)}. Results are on the Overview page and the public page.</div></div>
              <button class="btn" data-act="reset-el">Reset for a new round</button>
              <p class="hint" style="margin-top:8px">Reset clears every vote and lets voters vote again. It needs your password.</p>` : ''}
          </section>
        </div>`;
      const form = $('#eform');
      if (form && !locked) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#e-err'); err.textContent = '';
        const candidates = [0, 1, 2, 3].map((i) => ({ name: $(`[data-cn="${i}"]`).value, symbol: $(`[data-cs="${i}"]`).value })).filter((c) => c.name.trim());
        try { await api('/api/admin/election', { method: 'PUT', body: { title: $('#e-title').value, candidates } }); toast('Ballot saved.'); draw(); }
        catch (ex) { err.textContent = ex.message; }
      });
    };
    S.refresh = draw;
    await draw();
  }

  /* ---------- booths ---------- */
  async function booths() {
    const draw = async () => {
      const { devices } = await api('/api/admin/devices');
      setTop('Booths', 'Each booth has its own key. Revoke one and it stops working at once.');
      const sig = (r) => { const n = r == null ? 0 : r > -55 ? 4 : r > -67 ? 3 : r > -78 ? 2 : 1; return `<span class="sig" title="${r == null ? 'No signal data' : r + ' dBm'}">${[5, 8, 11, 14].map((h, i) => `<i style="height:${h}px" class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`; };
      $('#view').innerHTML = `
        <div class="toolbar"><span class="grow"></span><button class="btn primary" data-act="add-booth">${icon('plus', 16)}Add booth</button></div>
        ${devices.length ? `<div class="cardgrid">${devices.map((d) => `
          <section class="card booth" style="${d.active ? '' : 'opacity:.6'}">
            <h3><span class="dot ${d.online ? 'on' : 'off'}"></span>${esc(d.name)}</h3>
            <p class="hint mono">${esc(d.deviceId)}</p>
            <dl><dt>Status</dt><dd>${!d.active ? 'Revoked' : d.online ? 'Online' : 'Offline'}</dd>
              <dt>Last seen</dt><dd>${timeAgo(d.lastSeen)}</dd>
              <dt>Address</dt><dd class="mono">${esc(d.ip || 'unknown')}</dd>
              <dt>Wi-Fi</dt><dd>${sig(d.rssi)}</dd>
              <dt>Firmware</dt><dd>${esc(d.fw || 'unknown')}</dd></dl>
            ${d.active ? `<button class="btn sm" data-act="revoke" data-id="${esc(d.deviceId)}" data-name="${esc(d.name)}">Revoke key</button>` : ''}
          </section>`).join('')}</div>`
        : `<section class="card"><div class="empty"><h3>No booths yet</h3><p>Add a booth to get its device ID and key, then paste them into the ESP32 firmware.</p></div></section>`}`;
    };
    S.refresh = draw;
    await draw();
  }

  function addBoothModal() {
    const d = modal(`<form class="mform" novalidate>${modalHead('Add a booth')}
      <div class="field"><label for="ab-n">Booth name</label><input id="ab-n" maxlength="30" placeholder="Booth 1" autocomplete="off"></div>
      <p class="error" id="ab-err" role="alert"></p>
      <footer><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Create booth</button></footer></form>`);
    $('#ab-n', d).focus();
    $('form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#ab-n', d).value.trim();
      if (!name) { $('#ab-err', d).textContent = 'Name the booth first.'; return; }
      try {
        const r = await api('/api/admin/devices', { method: 'POST', body: { name } });
        d.innerHTML = `<div class="mform">${modalHead('Booth created')}
          <div class="banner warn">${icon('alert')}<div>Copy the key now. It is shown once and can't be recovered. If you lose it, revoke this booth and create a new one.</div></div>
          <div class="keybox" id="kb"><span>DEVICE_ID = "${esc(r.deviceId)}"</span><span>DEVICE_KEY = "${esc(r.key)}"</span></div>
          <p class="hint" style="margin:10px 0 16px">Paste both values into the two constants at the top of the firmware, then flash the ESP32.</p>
          <footer><button class="btn" type="button" id="kcopy">${icon('copy', 16)}Copy both</button><button class="btn primary" type="button" data-close>Done</button></footer></div>`;
        $('#kcopy', d).addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(`const char* DEVICE_ID = "${r.deviceId}";\nconst char* DEVICE_KEY = "${r.key}";`); toast('Copied.'); }
          catch { toast('Copy failed. Select the text and copy it by hand.', 'bad'); }
        });
        if (S.refresh) S.refresh();
      } catch (ex) { $('#ab-err', d).textContent = ex.message; }
    });
  }

  /* ---------- audit ---------- */
  async function audit() {
    const draw = async () => {
      const { entries } = await api('/api/admin/audit?limit=200');
      setTop('Audit log', 'Every entry is hashed together with the one before it.');
      $('#view').innerHTML = `
        <div class="toolbar"><div id="vres" style="flex:1"></div><button class="btn primary" data-act="verify">${icon('shield', 16)}Verify the whole chain</button></div>
        <section class="card" style="padding:6px 8px"><div class="tscroll">
        ${entries.length ? `<table class="tbl"><thead><tr><th>#</th><th>When</th><th>Who</th><th>What happened</th><th class="hide-s">Hash</th></tr></thead><tbody>
          ${entries.map((e) => `<tr><td>${e.seq}</td><td style="white-space:nowrap">${fmtDateTime(e.ts)}</td><td>${esc(e.actor)}</td><td><b>${esc(e.action)}</b><div class="sub2">${esc(e.details)}</div></td><td class="hide-s mono">${esc(e.hash.slice(0, 10))}</td></tr>`).join('')}</tbody></table>`
          : `<div class="empty"><h3>Nothing logged yet</h3><p>Logins, voter changes and votes will appear here.</p></div>`}
        </div></section>`;
    };
    S.refresh = draw;
    await draw();
  }

  async function runVerify() {
    const r = await api('/api/admin/audit/verify');
    $('#vres').innerHTML = r.ok
      ? `<div class="banner good" style="margin:0">${icon('check')}<div><b>Chain intact.</b> ${r.count} entries checked, none were changed or removed.</div></div>`
      : `<div class="banner bad" style="margin:0">${icon('alert')}<div><b>Tampering detected at entry ${r.brokenAt}.</b> ${esc(r.reason)} Entries after it can't be trusted.</div></div>`;
  }

  /* ---------- settings ---------- */
  async function settings() {
    setTop('Account', 'Signed in as ' + S.me);
    $('#view').innerHTML = `
      <section class="card" style="max-width:520px"><h2>Change password</h2><p class="sub">Use at least 10 characters.</p>
        <form id="pform" novalidate>
          <div class="field"><label for="p-cur">Current password</label><input id="p-cur" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="p-new">New password</label><input id="p-new" type="password" autocomplete="new-password"></div>
          <p class="error" id="p-err" role="alert"></p>
          <button class="btn primary" type="submit">Update password</button>
        </form></section>`;
    $('#pform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#p-err'); err.textContent = '';
      const current = $('#p-cur').value; const next = $('#p-new').value;
      if (!current || !next) { err.textContent = 'Fill in both fields.'; return; }
      try { await api('/api/auth/change-password', { method: 'POST', body: { current, next } }); toast('Password updated.'); $('#pform').reset(); }
      catch (ex) { err.textContent = ex.message; }
    });
  }

  const PAGES = { overview, voters, election, booths, audit, settings };

  /* ---------- actions ---------- */
  document.addEventListener('click', async (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { const dlg = closeBtn.closest('dialog'); if (dlg) dlg.close(); return; }

    const f = e.target.closest('[data-filter]');
    if (f) { S.filter = f.dataset.filter; return voters().catch(handleError); }

    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    try {
      if (act === 'logout') { await api('/api/auth/logout', { method: 'POST' }); closeStream(); S.feed = []; showLogin(); }
      else if (act === 'add-voter') addVoterModal();
      else if (act === 'bulk') bulkModal();
      else if (act === 'toggle-block') {
        const reg = el.dataset.reg === 'true';
        await api('/api/admin/voters/' + el.dataset.id, { method: 'PATCH', body: { registered: !reg } });
        toast(reg ? 'Card blocked.' : 'Card unblocked.');
        if (S.refresh) S.refresh();
      } else if (act === 'del-voter') {
        if (await confirmDialog({ title: 'Remove this voter?', body: `${esc(el.dataset.name)} will no longer be able to vote. This is logged.`, confirm: 'Remove voter', danger: true })) {
          await api('/api/admin/voters/' + el.dataset.id, { method: 'DELETE' });
          toast('Voter removed.');
          if (S.refresh) S.refresh();
        }
      } else if (act === 'open-el') {
        if (await confirmDialog({ title: 'Open voting?', body: 'Booths will start accepting cards. The ballot and candidate names lock.', confirm: 'Open voting' })) {
          await api('/api/admin/election/open', { method: 'POST' });
          toast('Voting is open.');
          route();
        }
      } else if (act === 'close-el') {
        if (await confirmDialog({ title: 'Close voting?', body: 'Booths stop accepting votes and results unseal. You can\'t reopen this round.', confirm: 'Close voting', danger: true })) {
          await api('/api/admin/election/close', { method: 'POST' });
          toast('Voting is closed. Results are unsealed.');
          route();
        }
      } else if (act === 'reset-el') resetModal();
      else if (act === 'add-booth') addBoothModal();
      else if (act === 'revoke') {
        if (await confirmDialog({ title: 'Revoke this booth?', body: `${esc(el.dataset.name)} will be rejected on its next request. This can't be undone.`, confirm: 'Revoke key', danger: true })) {
          await api('/api/admin/devices/' + encodeURIComponent(el.dataset.id), { method: 'DELETE' });
          toast('Booth revoked.');
          if (S.refresh) S.refresh();
        }
      } else if (act === 'verify') await runVerify();
    } catch (ex) { handleError(ex); }
  });

  function resetModal() {
    const d = modal(`<form class="mform" novalidate>${modalHead('Reset for a new round')}
      <div class="banner warn">${icon('alert')}<div>This deletes every vote and lets all voters vote again. The audit log keeps a record that it happened.</div></div>
      <div class="field authz"><label for="rs-pw">Your admin password</label><input id="rs-pw" type="password" autocomplete="current-password"></div>
      <p class="error" id="rs-err" role="alert"></p>
      <footer><button class="btn" type="button" data-close>Cancel</button><button class="btn danger" type="submit">Reset election</button></footer></form>`);
    $('#rs-pw', d).focus();
    $('form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('#rs-pw', d).value;
      if (!password) { $('#rs-err', d).textContent = 'Enter your admin password to authorize this.'; return; }
      try { await api('/api/admin/election/reset', { method: 'POST', body: { password } }); toast('Election reset.'); d.close(); route(); }
      catch (ex) { $('#rs-err', d).textContent = ex.message; }
    });
  }

  /* ---------- boot ---------- */
  window.addEventListener('hashchange', () => { if ($('#view')) route(); });
  (async () => {
    try { const me = await api('/api/auth/me'); S.me = me.username; startApp(); }
    catch { showLogin(); }
  })();
})();
