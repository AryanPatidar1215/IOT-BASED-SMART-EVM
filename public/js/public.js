(() => {
  $('#brandmark').innerHTML = icon('ballot', 18);
  $('#adminlink').innerHTML = icon('lock', 16) + 'Admin sign in';

  const view = $('#view');
  let data = null;
  let results = null;

  async function load() {
    try {
      data = await api('/api/public/election');
      results = data.status === 'closed' ? await api('/api/public/results') : null;
      render();
    } catch (e) {
      view.innerHTML = `<div class="banner bad">${icon('alert')}<div>Can't reach the election server right now. This page will retry automatically.</div></div>`;
    }
  }

  function render() {
    const st = STATUS[data.status];
    const pct = data.registered ? Math.min(100, Math.round((data.voted / data.registered) * 100)) : 0;
    const lead = {
      draft: 'The ballot is set, and voting has not started. Polling opens when the election officer starts it.',
      open: 'Voting is running at the booths now. Tap your card, press the button next to your candidate, and keep your receipt.',
      closed: 'Voting is over and the results below are final.'
    }[data.status];

    let html = `
      <section class="hero">
        <div>
          <span class="chip ${st.cls}"><span class="dot ${data.status === 'open' ? 'on' : ''}"></span>${st.label}</span>
          <h1>${esc(data.title)}</h1>
          <p class="lead">${lead}</p>
        </div>
        <div>${inkGauge(pct, 'turnout')}<p class="hint" style="text-align:center;margin-top:8px">${data.voted} of ${data.registered} registered voters</p></div>
      </section>

      <section class="sect">
        <h2>On the ballot</h2>
        <p class="sub">The button on the booth matches the number beside each name.</p>
        <div class="ballot">
          ${data.candidates.map((c) => `
            <div class="card cand">${swatch(c)}<div><div style="font-weight:600">${esc(c.name)}</div><div class="hint">Booth button ${c.no}</div></div></div>`).join('')}
        </div>
      </section>`;

    if (results) {
      const max = Math.max(...results.candidates.map((c) => c.votes));
      html += `
      <section class="sect">
        <h2>Final results</h2>
        <p class="sub">${results.total} ${results.total === 1 ? 'vote' : 'votes'} counted.</p>
        <div class="card"><div class="rows">
          ${results.candidates.map((c) => {
            const p = results.total ? Math.round((c.votes / results.total) * 100) : 0;
            const win = c.votes === max && max > 0;
            return `<div class="rowbar"><div class="head"><span class="cand">${swatch(c)}<b>${esc(c.name)}</b>${win ? '<span class="chip good">Most votes</span>' : ''}</span><span>${c.votes} (${p}%)</span></div>
              <div class="track"><div style="width:${p}%;background:${esc(c.color)}"></div></div></div>`;
          }).join('')}
        </div></div>
      </section>`;
    } else {
      html += `
      <section class="sect">
        <div class="banner info">${icon('lock')}<div><b>Results are sealed.</b> Nobody, including the election officer, can see the count until voting closes.</div></div>
      </section>`;
    }

    html += `
      <section class="sect">
        <h2>Check your receipt</h2>
        <p class="sub">After you vote, the booth screen shows a receipt like K7F-29Q. Enter it to confirm your vote was counted.</p>
        <form class="receipt" id="rform" novalidate>
          <label class="sr" for="rc">Receipt code</label>
          <input id="rc" maxlength="7" autocomplete="off" placeholder="K7F-29Q">
          <button class="btn primary" type="submit">Check receipt</button>
        </form>
        <p class="error" id="rres" role="status"></p>
      </section>

      <section class="sect">
        <h2>How your vote stays private</h2>
        <div class="privacy">
          <p><b>Your card is checked, your ballot is not tied to it.</b> The booth confirms you are registered and haven't voted, then stores your choice with no card number or name attached.</p>
          <p><b>A receipt proves counting, not choice.</b> The code only says a ballot with that code exists. It never reveals which candidate you picked.</p>
          <p><b>Every admin action is logged.</b> Each log entry is chained to the one before it, so a quiet edit breaks the chain and shows up in the audit check.</p>
        </div>
      </section>`;

    const hadFocus = document.activeElement && document.activeElement.id === 'rc';
    const val = $('#rc') ? $('#rc').value : '';
    view.innerHTML = html;
    if ($('#rc')) { $('#rc').value = val; if (hadFocus) $('#rc').focus(); }
  }

  document.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'rform') return;
    ev.preventDefault();
    const out = $('#rres');
    const code = $('#rc').value.trim().toUpperCase();
    out.style.color = '';
    if (!code) { out.style.color = 'var(--bad)'; out.textContent = 'Enter the receipt code from the booth screen.'; return; }
    try {
      const r = await api('/api/public/receipt/' + encodeURIComponent(code));
      out.style.color = r.counted ? 'var(--good)' : 'var(--bad)';
      out.textContent = r.counted ? 'Your vote was counted. Your choice stays private.' : 'No ballot matches that code. Check it and try again.';
    } catch (e) {
      out.style.color = 'var(--bad)';
      out.textContent = e.message;
    }
  });

  load();
  setInterval(load, 10000);
})();
