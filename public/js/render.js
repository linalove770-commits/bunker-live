'use strict';

/**
 * Рендеринг интерфейса. Только чтение состояния и запись в DOM —
 * никакой игровой логики здесь нет, она живёт на сервере.
 */
(function () {
  const el = (id) => document.getElementById(id);

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const PHASE_LABEL = {
    lobby: 'Лобби',
    intro: 'Вводная',
    reveal: 'Раскрытие',
    discussion: 'Обсуждение',
    accusation: 'Обвинения',
    voting: 'Голосование',
    defense: 'Оправдание',
    revote: 'Повторное голосование',
    farewell: 'Прощальное слово',
    summary: 'Итоги раунда',
    finale: 'Финал',
    ended: 'Игра окончена',
  };

  const PHASE_HINT = {
    lobby: 'Ждём игроков. Отправьте друзьям код приглашения.',
    intro: 'Прочитайте катастрофу и условия бункера — это база для всех аргументов.',
    reveal: 'Открывайте карты по очереди и объясняйте, чем вы полезны.',
    discussion: 'Задавайте вопросы и уточняйте детали. Это ваше время на разведку.',
    accusation: 'Каждый коротко говорит, кого и почему стоит выгнать.',
    voting: 'Голосуйте против того, кто, по-вашему, меньше всего нужен бункеру.',
    defense: 'Кандидат на вылет оправдывается. Остальные молчат и слушают.',
    revote: 'Повторное голосование. Смените мнение, если речь была убедительной.',
    farewell: 'Изгнанный говорит последнее слово. Здесь можно применить спец. возможность.',
    summary: 'Раунд закрыт. Смотрите итоги и готовьтесь к следующему.',
    finale: 'Двери бункера закрыты. Смотрим, выжили ли вы.',
    ended: 'Партия завершена.',
  };

  let categoryMeta = {};

  function catInfo(category) {
    const m = categoryMeta[category];
    return m || { label: category, icon: '•' };
  }

  function setCategories(categories) {
    categoryMeta = categories || {};
  }

  // ─────────────────────────── экраны ───────────────────────────

  function showScreen(name) {
    const map = {
      home: 'screen-home',
      lobby: 'screen-lobby',
      game: 'screen-game',
      finale: 'screen-finale',
    };
    // Экраны скрываются атрибутом hidden (так устроен CSS), а класс is-active
    // оставляем для анимации появления.
    for (const key of Object.keys(map)) {
      const node = el(map[key]);
      if (!node) continue;
      const active = key === name;
      node.classList.toggle('is-active', active);
      if (active) node.removeAttribute('hidden');
      else node.setAttribute('hidden', '');
    }
    // Шторка персонажа живёт в оболочке и нужна только в партии.
    const sheet = el('my-sheet');
    if (sheet) {
      if (name === 'game') sheet.removeAttribute('hidden');
      else sheet.setAttribute('hidden', '');
    }
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ─────────────────────────── карточка ───────────────────────────

  function cardHtml(card, { mine = false, revealed = false, compact = false } = {}) {
    const info = catInfo(card.category);
    const classes = ['card'];
    classes.push(revealed ? 'card--revealed' : 'card--hidden');
    if (mine) classes.push('card--mine');
    const tip = card.tip
      ? `<div class="card__tip">💡 ${esc(card.tip)}</div>`
      : '';
    const tags = Array.isArray(card.tags) && card.tags.length
      ? `<div class="card__tags">${card.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
      : '';
    const title = revealed ? esc(card.title) : 'Закрыто';
    const text = revealed ? esc(card.text) : 'Характеристика ещё не раскрыта';
    // У раскрытой карты — иллюстрация категории; у закрытой остаётся эмодзи.
    const icon = revealed
      ? `<span class="card__icon card__icon--${esc(card.category)}" aria-hidden="true"></span>`
      : `<span class="card__icon" aria-hidden="true">${esc(info.icon)}</span>`;
    return `<article class="${classes.join(' ')}" ${compact ? '' : 'data-category="' + esc(card.category) + '"'}>
      <div class="card__cat">${icon} ${esc(info.label)}</div>
      <h4 class="card__title">${title}</h4>
      <p class="card__text">${text}</p>
      ${revealed ? tags : ''}
      ${revealed ? tip : ''}
    </article>`;
  }

  // ─────────────────────────── лобби ───────────────────────────

  function renderLobby(state) {
    showScreen('lobby');
    el('lobby-code').textContent = state.roomCode || '-----';
    el('lobby-count').textContent = `${state.players.length}/${state.maxPlayers || 16}`;
    el('lobby-round').textContent = state.players.length < 2 ? 'Нужен ещё хотя бы один игрок' : 'Можно начинать';

    el('lobby-players').innerHTML = state.players.map((p) => {
      const cls = ['player-chip'];
      if (p.isHost) cls.push('player-chip--host');
      if (p.id === state.me.id) cls.push('player-chip--me');
      if (!p.connected) cls.push('player-chip--out');
      const marks = [];
      if (p.isHost) marks.push('ведущий');
      if (p.id === state.me.id) marks.push('вы');
      if (!p.connected) marks.push('отключился');
      return `<div class="${cls.join(' ')}">
        <span class="player-chip__name">${esc(p.nickname)}</span>
        <span class="player-chip__marks">${marks.join(' · ')}</span>
      </div>`;
    }).join('');

    el('lobby-empty').hidden = state.players.length > 1;

    // Настройки доступны только ведущему.
    const isHost = state.me.isHost;
    el('settings-panel').classList.toggle('is-locked', !isHost);
    for (const node of el('settings-panel').querySelectorAll('button, input')) node.disabled = !isHost;

    el('btn-start').disabled = !isHost || state.players.length < 2;
    el('start-hint').textContent = !isHost
      ? 'Начать партию может только ведущий.'
      : state.players.length < 2
        ? 'Пригласите хотя бы одного игрока.'
        : 'Все на месте? Запускайте.';

    // Активные состояния сегментов.
    el('seats-mode').querySelectorAll('.segmented__item').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === state.settings.seatsMode);
    });
    el('seats-fixed-row').hidden = state.settings.seatsMode !== 'fixed';
    el('seats-fixed').querySelectorAll('.segmented__item').forEach((b) => {
      b.classList.toggle('is-active', Number(b.dataset.seats) === Number(state.settings.seatsFixed));
    });
    el('set-auto').checked = !!state.settings.autoAdvance;
    el('set-exiles').checked = !!state.settings.exilesKeepVoting;
    el('set-specials').checked = !!state.settings.enableSpecials;

    const seats = state.seatInfo.seats;
    const exiles = state.exilesNeeded;
    el('seats-preview').innerHTML = state.players.length < 2
      ? '<span class="muted">Добавьте игроков — покажем, сколько мест достанется и скольких изгонят.</span>'
      : `<b>${state.players.length}</b> выживших · <b>${seats}</b> мест(а) в бункере · <b>${exiles}</b> будет изгнано
         <span class="muted">(${esc(state.seatInfo.hint)})</span>`;
  }

  // ─────────────────────────── игра ───────────────────────────

  function renderGame(state) {
    showScreen('game');

    el('hud-phase').textContent = PHASE_LABEL[state.phase] || state.phase;
    el('hud-phase').classList.toggle('phase-badge--voting', state.phase === 'voting' || state.phase === 'revote');
    el('hud-round').textContent = state.round ? `Раунд ${state.round} из ${state.maxRounds}` : 'Вводная';
    el('hud-seats').textContent = `Мест в бункере: ${state.seatCount}`;

    const t = state.timer;
    const timerBox = el('hud-timer');
    timerBox.hidden = !t.duration;
    if (t.duration) {
      const ratio = Math.max(0, Math.min(1, t.remaining / t.duration));
      el('hud-timer-bar').style.width = `${ratio * 100}%`;
      timerBox.classList.toggle('timer--warn', t.remaining <= 10 && t.remaining > 5);
      timerBox.classList.toggle('timer--danger', t.remaining <= 5);
      el('hud-timer').setAttribute('data-remaining', String(t.remaining));
    }

    renderCatastrophe(state);
    renderBunker(state);
    renderSeatList(state);
    renderSheet(state);
    renderLog(state.log);

    el('seats-counter').textContent =
      `${state.players.filter((p) => !p.exiled).length} в лагере · ${state.exilesNeeded} изгнаний до финала`;
    el('my-reveal-count').textContent =
      `${state.me.cards.filter((c) => c.revealed).length} из ${state.me.cards.length} раскрыто`;

    const notes = el('my-notes');
    if (document.activeElement !== notes) notes.value = state.me.notes || '';
  }

  function renderCatastrophe(state) {
    const c = state.catastrophe;
    const box = el('catastrophe-box');
    if (!c) {
      box.innerHTML = '<div class="empty-state">Катастрофа станет известна после старта партии.</div>';
      return;
    }
    const sev = Math.max(1, Math.min(5, Number(c.severity) || 3));
    const threats = Array.isArray(c.threats) ? c.threats : [];
    box.innerHTML = `
      <div class="catastrophe__head">
        <span class="catastrophe__icon">☢</span>
        <div>
          <h3 class="catastrophe__title">${esc(c.title)}</h3>
          <span class="catastrophe__meta">Длительность: ${esc(c.duration || '—')}</span>
        </div>
      </div>
      <div class="catastrophe__severity" title="Уровень жёсткости: ${sev} из 5">
        ${Array.from({ length: 5 }, (_, i) => `<span class="${i < sev ? 'is-on' : ''}"></span>`).join('')}
      </div>
      <p class="catastrophe__text">${esc(c.text)}</p>
      ${threats.length ? `<div class="catastrophe__threats">${threats.map((t) => `<span class="tag tag--danger">${esc(t)}</span>`).join('')}</div>` : ''}
      ${c.tip ? `<div class="card__tip">💡 ${esc(c.tip)}</div>` : ''}
    `;
  }

  function renderBunker(state) {
    const b = state.bunker;
    const box = el('bunker-box');
    if (!b) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <h3 class="section-title">Бункер</h3>
      <div class="bunker-stats">
        <div class="bunker-stat"><b>${b.area_sqm}</b><span>м² площади</span></div>
        <div class="bunker-stat"><b>${b.food_units}</b><span>запас еды</span></div>
        <div class="bunker-stat"><b>${b.sleeping_rooms}</b><span>спален</span></div>
        <div class="bunker-stat"><b>${b.cards.length}</b><span>особенностей</span></div>
      </div>
      <div class="bunker-cards">
        ${b.cards.map((c) => `
          <article class="bunker-card bunker-card--${esc(c.kind)}">
            <div class="bunker-card__kind">${c.kind === 'hazard' ? 'Проблема' : 'Плюс'}</div>
            <h4>${esc(c.title)}</h4>
            <p>${esc(c.text)}</p>
            ${c.tip ? `<div class="card__tip">💡 ${esc(c.tip)}</div>` : ''}
          </article>`).join('')}
      </div>
    `;
  }

  function renderSeatList(state) {
    const list = el('seat-list');
    const seats = state.seatCount || 0;
    const active = state.players.filter((p) => !p.exiled);

    const seatsRow = `<div class="seats">${Array.from({ length: seats }, (_, i) => {
      // Слоты показывают вместимость бункера: они «загораются», когда лагерь
      // сократился до числа мест — то есть места вот-вот займут.
      const filled = active.length <= seats;
      return `<span class="seats__slot ${filled ? 'seats__slot--filled' : ''}" title="Место ${i + 1} из ${seats}">${i + 1}</span>`;
    }).join('')}</div>
    <p class="hint">В бункере ${seats} мест(а) на ${state.players.length} выживших — места займут те, кто доживёт до финала.</p>`;

    list.innerHTML = seatsRow + state.players.map((p) => {
      const cls = ['seat'];
      if (p.exiled) cls.push('seat--exiled');
      if (p.id === state.me.id) cls.push('seat--me');
      if (p.isTurn || p.isSpeaking) cls.push('seat--speaking');
      if (state.turn && state.turn.currentId === p.id) cls.push('seat--current');
      const status = [];
      if (p.exiled) status.push(`изгнан в раунде ${p.exiledRound || '—'}`);
      else if (p.isSpeaking) status.push('говорит');
      else if (state.voting.open) status.push(p.hasVoted ? 'проголосовал' : 'думает');
      else status.push(`раскрыто ${p.revealed.length}`);
      if (p.immune) status.push('под защитой');
      if (p.silent) status.push('без права слова');
      if (!p.connected) status.push('отключился');

      const cards = p.revealedCards.length
        ? `<div class="seat__cards">${p.revealedCards.map((c) => cardHtml(c, { revealed: true, compact: true })).join('')}</div>`
        : '<div class="seat__cards"><p class="seat__empty">Ещё ничего не раскрыл</p></div>';

      return `<div class="${cls.join(' ')}">
        <span class="seat__avatar">${esc((p.nickname || '?').slice(0, 1).toUpperCase())}</span>
        <span class="seat__name">${esc(p.nickname)}${p.isHost ? ' · ведущий' : ''}</span>
        <span class="seat__status">${esc(status.join(' · '))}</span>
        ${cards}
      </div>`;
    }).join('');
  }

  function renderSheet(state) {
    const body = el('my-sheet-body');
    if (!body) return;
    const me = state.me;
    if (!me || !me.cards || !me.cards.length) {
      body.innerHTML = '<div class="empty-state">Карты появятся после старта партии.</div>';
      return;
    }
    const revealedCount = me.cards.filter((c) => c.revealed).length;
    const title = el('sheet-title');
    if (title) title.textContent = `Мой персонаж — раскрыто ${revealedCount} из ${me.cards.length}`;
    body.innerHTML = me.cards.map((c) => cardHtml(c, {
      mine: true,
      revealed: c.revealed,
    })).join('');
  }

  function renderLog(entries) {
    const box = el('game-log');
    if (!entries || !entries.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `<h3 class="section-title">Хроника партии</h3>` + entries.slice(-25).map((e) =>
      `<div class="log__line log__line--${esc(e.kind || 'info')}"><span class="log__round">${e.round ? 'Р' + e.round : '·'}</span> ${esc(e.text)}</div>`,
    ).join('');
    box.scrollTop = box.scrollHeight;
  }

  // ─────────────────────────── финал ───────────────────────────

  function renderFinale(state) {
    showScreen('finale');
    const f = state.finale;
    const box = el('finale-box');
    if (!f) {
      box.innerHTML = '<div class="empty-state">Финал ещё не наступил.</div>';
      return;
    }
    const cls = f.verdict.key === 'survive' ? 'ok' : f.verdict.key === 'struggle' ? 'warn' : 'danger';
    box.innerHTML = `
      <div class="finale__verdict finale__verdict--${cls}">
        <div class="finale__score">${f.score}<span>/100</span></div>
        <h2>${esc(f.verdict.title)}</h2>
        <p>${esc(f.verdict.text)}</p>
      </div>
      <div class="board">
        <div class="board__col">
          <h3 class="section-title">Выжили в бункере (${f.survivors.length})</h3>
          <div class="players-grid">${f.survivors.map((s) => `<div class="player-chip player-chip--me"><span class="player-chip__name">${esc(s.nickname)}</span></div>`).join('')}</div>
          <h3 class="section-title">Остались снаружи (${f.exiled.length})</h3>
          <div class="players-grid">${f.exiled.length ? f.exiled.map((s) => `<div class="player-chip player-chip--out"><span class="player-chip__name">${esc(s.nickname)}</span><span class="player-chip__marks">раунд ${s.round || '—'}</span></div>`).join('') : '<span class="muted">Никого не изгнали</span>'}</div>
        </div>
        <div class="board__col">
          <h3 class="section-title">Расклад бункера</h3>
          <div class="tally">
            <div class="tally__row"><span>Запас еды</span><b>${f.food.have} мес.</b></div>
            <div class="tally__row"><span>Срок в бункере</span><b>${f.food.need} мес.</b></div>
            <div class="tally__row"><span>Покрытие запасами</span><b>${Math.round(f.food.ratio * 100)}%</b></div>
            <div class="tally__row"><span>Койко-мест</span><b>${f.beds.capacity} на ${f.beds.people} чел.</b></div>
            <div class="tally__row"><span>Проблем бункера</span><b>${f.hazards}</b></div>
          </div>
          <h3 class="section-title">Катастрофа</h3>
          <p>${esc(f.catastrophe ? f.catastrophe.title : '—')} · ${esc(f.catastrophe ? f.catastrophe.duration : '')}</p>
        </div>
      </div>
      <h3 class="section-title">Персонажи выживших</h3>
      <div class="sheet">${f.perPlayer.map((p) => `
        <div class="finale__player">
          <h4>${esc(p.nickname)}</h4>
          <div class="finale__cards">${Object.keys(p.cards).map((cat) => cardHtml({ ...p.cards[cat], category: cat }, { revealed: true })).join('')}</div>
        </div>`).join('')}
      </div>
    `;
  }

  // ─────────────────────────── голосование ───────────────────────────

  function renderVoteModal(state, pickedId) {
    const modal = el('modal-vote');
    const v = state.voting;
    if (!v.open) {
      modal.hidden = true;
      return;
    }
    modal.hidden = false;
    el('vote-title').textContent = v.stage === 'revote' ? 'Повторное голосование' : 'Кто покинет лагерь?';
    el('vote-subtitle').textContent = v.stage === 'revote'
      ? 'Кандидаты уже оправдались. Измените голос, если речь была убедительной.'
      : `Проголосовали ${v.votedCount} из ${v.voterCount}. Набравший 70% уходит сразу, иначе — оправдание.`;

    const candidates = state.players.filter((p) => {
      if (p.exiled) return false;
      if (p.id === state.me.id) return false;
      if (v.stage === 'revote' && v.candidates.length) return v.candidates.includes(p.id);
      return true;
    });

    el('vote-grid').innerHTML = candidates.map((p) => `
      <button class="vote-card ${pickedId === p.id ? 'is-picked' : ''}" data-vote="${esc(p.id)}" type="button">
        <span class="vote-card__avatar">${esc((p.nickname || '?').slice(0, 1).toUpperCase())}</span>
        <span class="vote-card__name">${esc(p.nickname)}</span>
        <span class="vote-card__meta">раскрыто ${p.revealed.length} · ${p.connected ? 'в игре' : 'отключился'}</span>
      </button>`).join('') || '<div class="empty-state">Некого выбирать.</div>';

    el('btn-vote-skip').hidden = !v.canSkip;
    el('btn-vote-confirm').disabled = !pickedId;
    el('btn-vote-skip').disabled = !!state.me.hasVoted;

    const tally = el('vote-tally');
    if (v.tally && state.phase === 'summary') {
      tally.hidden = false;
      const max = Math.max(1, ...Object.values(v.tally.counts));
      tally.innerHTML = `<h4>Итоги голосования</h4>` + Object.keys(v.tally.counts)
        .sort((a, b) => v.tally.counts[b] - v.tally.counts[a])
        .map((id) => {
          const p = state.players.find((x) => x.id === id);
          return `<div class="tally__row"><span>${esc(p ? p.nickname : id)}</span>
            <span class="tally__bar"><i style="width:${(v.tally.counts[id] / max) * 100}%"></i></span>
            <b class="tally__count">${v.tally.counts[id]}</b></div>`;
        }).join('');
    } else {
      tally.hidden = true;
    }
  }

  // ─────────────────────────── справка ───────────────────────────

  function renderHelp(help) {
    const body = el('help-body');
    if (!help) {
      body.innerHTML = '<div class="empty-state">Справка загружается…</div>';
      return;
    }
    const phases = (help.phases || []).map((p) => `
      <div class="help-phase">
        <h3>${esc(p.title)}</h3>
        <p class="hint">${esc(p.short)}</p>
        <p>${esc(p.text)}</p>
        ${(p.tips || []).length ? `<ul class="help-tips">${p.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');

    const faq = (help.faq || []).map((f, i) => `
      <details class="faq-item"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');

    const glossary = (help.glossary || []).map((g) => `
      <div class="glossary-item"><b>${esc(g.term)}</b><span>${esc(g.definition)}</span></div>`).join('');

    body.innerHTML = `
      <section><h3 class="section-title">Фазы партии</h3>${phases}</section>
      <section><h3 class="section-title">Частые вопросы</h3>${faq}</section>
      <section><h3 class="section-title">Словарь</h3>${glossary}</section>
    `;
  }

  // ─────────────────────────── тосты ───────────────────────────

  function toast(message, kind = 'info') {
    const box = el('toasts');
    const node = document.createElement('div');
    node.className = `toast toast--${kind}`;
    node.textContent = message;
    box.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  window.BunkerRender = {
    esc,
    el,
    showScreen,
    setCategories,
    cardHtml,
    renderLobby,
    renderGame,
    renderFinale,
    renderVoteModal,
    renderHelp,
    toast,
    PHASE_LABEL,
    PHASE_HINT,
    catInfo,
  };
})();
