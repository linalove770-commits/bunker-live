'use strict';

/**
 * Контроллер интерфейса: держит последний снапшот состояния, решает,
 * что показать в панели действий, и отправляет команды на сервер.
 */
(function () {
  const S = window.BunkerSocket;
  const R = window.BunkerRender;
  const el = R.el;

  let state = null;
  let help = null;
  let pickedVote = null;
  let notesTimer = null;

  // ─────────────────────────── панель действий ───────────────────────────

  function button(label, action, { kind = 'primary', disabled = false, title = '' } = {}) {
    return { label, action, kind, disabled, title };
  }

  function actionPlan(st) {
    const me = st.me;
    const isHost = me && me.isHost;
    const hostNext = isHost ? [button('Дальше', 'advance', { kind: 'primary' })] : [];
    const hostHint = isHost ? '' : ' Ждём ведущего.';

    switch (st.phase) {
      case 'intro':
        return {
          what: 'Вводная: прочитайте условия',
          hint: 'Катастрофа и особенности бункера — основа для всех аргументов. Сверяйтесь с ними, когда будете доказывать пользу.',
          buttons: isHost ? [button('Начать раунд 1', 'advance')] : [],
          fallback: 'Ведущий открывает партию…',
        };

      case 'reveal': {
        const turnId = st.turn.currentId;
        const turnPlayer = st.players.find((p) => p.id === turnId);
        if (me && me.id === turnId) {
          const left = me.revealsLeft;
          const hidden = me.cards.filter((c) => !c.revealed);
          const mustProfession = st.round === 1 && !me.cards.some((c) => c.category === 'profession' && c.revealed);
          const usable = mustProfession ? hidden.filter((c) => c.category === 'profession') : hidden;
          return {
            what: `Ваш ход — раскройте ещё ${left} карт(ы)`,
            hint: mustProfession
              ? 'В первом раунде первым делом открывается профессия — это обязательный параметр партии.'
              : 'Выберите, что открыть: сильные стороны лучше показывать раньше, слабые — когда их можно объяснить.',
            buttons: usable.map((c) => button(
              `${R.catInfo(c.category).icon} ${c.title}`,
              `reveal:${c.category}`,
              { kind: 'ghost', title: c.text },
            )),
          };
        }
        return {
          what: turnPlayer ? `Говорит ${turnPlayer.nickname}` : 'Раскрытие характеристик',
          hint: `Слушайте и запоминайте: кто-то уже назвал профессию и здоровье — этим можно воспользоваться в споре.${hostHint}`,
          buttons: hostNext,
          fallback: turnPlayer ? `Ход: ${turnPlayer.nickname}` : '',
        };
      }

      case 'discussion':
        return {
          what: 'Коллективное обсуждение',
          hint: 'Задавайте вопросы: есть ли в бункере нужное оборудование, кто чем болен, у кого есть еда. Это ваша разведка.',
          buttons: hostNext,
          fallback: 'Обсуждайте.',
        };

      case 'accusation': {
        const speaker = st.turn.order && st.turn.order[st.turn.index]
          ? st.players.find((p) => p.id === st.turn.order[st.turn.index])
          : null;
        const mine = speaker && me && speaker.id === me.id;
        return {
          what: mine ? 'Ваше слово: кого выгнать и почему' : (speaker ? `Говорит ${speaker.nickname}` : 'Обвинения'),
          hint: 'Тридцать секунд на аргумент. Ссылайтесь на катастрофу: кто закроет главную угрозу бункера.',
          buttons: mine || isHost ? [button(mine ? 'Я закончил' : 'Дальше', 'advance')] : [],
          fallback: 'Слушайте.',
        };
      }

      case 'voting':
      case 'revote': {
        const canVote = me && me.canVote;
        const voted = me && me.hasVoted;
        if (canVote && !voted) {
          return {
            what: 'Ваш голос решает',
            hint: 'Набравший 70% голосов уходит сразу. Если меньше — кандидат получит 30 секунд на оправдание и будет повторное голосование.',
            buttons: [button('Голосовать', 'openVote')],
          };
        }
        return {
          what: voted ? 'Голос принят' : 'Идёт голосование',
          hint: `Проголосовали ${st.voting.votedCount} из ${st.voting.voterCount}. Ждём остальных.`,
          buttons: hostNext,
          fallback: 'Голосование идёт.',
        };
      }

      case 'defense': {
        const candId = st.turn.defenseCandidateId;
        const cand = st.players.find((p) => p.id === candId);
        const mine = cand && me && cand.id === me.id;
        return {
          what: mine ? 'Вы на вылет — оправдывайтесь!' : (cand ? `Оправдывается ${cand.nickname}` : 'Оправдание'),
          hint: mine
            ? 'Тридцать секунд. Не раскрывайте новые характеристики, но объясните, почему без вас бункер не выживет.'
            : 'Слушайте внимательно: после речи будет повторное голосование, и мнение можно изменить.',
          buttons: mine || isHost ? [button(mine ? 'Я закончил' : 'Дальше', 'advance')] : [],
          fallback: 'Идёт оправдание.',
        };
      }

      case 'farewell': {
        const mine = me && st.pendingExile.some((p) => p.id === me.id);
        return {
          what: mine ? 'Прощальное слово' : 'Изгнание',
          hint: mine
            ? 'Пятнадцать секунд. Здесь ещё можно применить спец. возможность, если она у вас есть.'
            : 'Изгнанный говорит последнее слово. Дальше он больше не участвует в партии.',
          buttons: mine || isHost ? [button(mine ? 'Я закончил' : 'Дальше', 'advance')] : [],
          fallback: 'Прощальная речь.',
        };
      }

      case 'summary':
        return {
          what: st.history.length ? 'Раунд закрыт' : 'Раунд закрыт без изгнания',
          hint: 'Отдохните и обдумайте следующий шаг: какие карты вы ещё не открыли и что это даст.',
          buttons: hostNext,
          fallback: 'Ждём ведущего.',
        };

      case 'finale':
        return {
          what: 'Двери бункера закрыты',
          hint: 'Смотрите финал: кто внутри, а кто остался снаружи.',
          buttons: [],
          fallback: '',
        };

      default:
        return { what: 'Партия идёт', hint: '', buttons: [], fallback: '' };
    }
  }

  function renderActionPanel(st) {
    const plan = actionPlan(st);
    el('action-what').textContent = plan.what;
    el('action-hint').textContent = plan.hint || '';

    const box = el('action-buttons');
    box.innerHTML = '';
    for (const b of plan.buttons) {
      const node = document.createElement('button');
      node.className = `btn btn--${b.kind === 'ghost' ? 'ghost' : 'primary'} btn--sm`;
      node.textContent = b.label;
      node.disabled = !!b.disabled;
      if (b.title) node.title = b.title;
      node.addEventListener('click', () => handleAction(b.action));
      box.appendChild(node);
    }

    if (!plan.buttons.length) {
      const span = document.createElement('span');
      span.className = 'hint';
      span.textContent = plan.fallback || 'Ждём остальных игроков.';
      box.appendChild(span);
    }

    // Спец. возможность — отдельной кнопкой, когда она доступна.
    const me = st.me;
    if (me && me.hasSpecial && !me.specialUsed && st.settings.enableSpecials && !me.exiled && st.started) {
      const btn = document.createElement('button');
      btn.className = 'btn btn--danger btn--sm';
      const card = me.cards.find((c) => c.category === 'special');
      btn.textContent = '⚡ Спец. возможность';
      btn.title = card ? `${card.title}: ${card.text}` : 'Разовая способность';
      btn.addEventListener('click', () => useSpecialFlow(st));
      box.appendChild(btn);
    }
  }

  function useSpecialFlow(st) {
    const card = st.me.cards.find((c) => c.category === 'special');
    if (!card) return;
    if (card.targeting === 'one_player') {
      openConfirm(`«${card.title}»`, `${card.text}\n\nВыберите игрока-цель.`, () => {
        const targets = st.players.filter((p) => !p.exiled && p.id !== st.me.id);
        showTargetPicker(targets, (targetId) => {
          S.useSpecial(targetId).then(afterAction);
        });
      });
      return;
    }
    openConfirm(`«${card.title}»`, `${card.text}\n\nПрименить сейчас?`, () => {
      S.useSpecial(null).then(afterAction);
    });
  }

  function showTargetPicker(targets, onPick) {
    const grid = el('vote-grid');
    const modal = el('modal-vote');
    el('vote-title').textContent = 'Выберите цель';
    el('vote-subtitle').textContent = 'Спец. возможность сработает сразу после выбора.';
    el('vote-tally').hidden = true;
    el('btn-vote-skip').hidden = true;
    el('btn-vote-confirm').disabled = true;
    el('btn-vote-confirm').textContent = 'Отмена';
    el('btn-vote-confirm').onclick = () => { modal.hidden = true; };
    grid.innerHTML = targets.map((p) => `
      <button class="vote-card" data-target="${R.esc(p.id)}" type="button">
        <span class="vote-card__avatar">${R.esc((p.nickname || '?').slice(0, 1).toUpperCase())}</span>
        <span class="vote-card__name">${R.esc(p.nickname)}</span>
        <span class="vote-card__meta">раскрыто ${p.revealed.length}</span>
      </button>`).join('');
    grid.querySelectorAll('[data-target]').forEach((node) => {
      node.addEventListener('click', () => {
        modal.hidden = true;
        onPick(node.dataset.target);
      });
    });
    modal.hidden = false;
  }

  // ─────────────────────────── подтверждение ───────────────────────────

  let confirmAction = null;
  function openConfirm(title, text, onYes) {
    el('confirm-title').textContent = title;
    el('confirm-text').textContent = text;
    confirmAction = onYes;
    el('modal-confirm').hidden = false;
  }
  function closeConfirm() {
    el('modal-confirm').hidden = true;
    confirmAction = null;
  }

  // ─────────────────────────── действия ───────────────────────────

  function afterAction(res) {
    if (res && res.ok === false) R.toast(res.error || 'Не получилось', 'danger');
  }

  function handleAction(action) {
    if (action === 'advance') { S.advance().then(afterAction); return; }
    if (action === 'openVote') { pickedVote = null; R.renderVoteModal(state, null); return; }
    if (action.startsWith('reveal:')) {
      const category = action.split(':')[1];
      S.reveal(category).then(afterAction);
    }
  }

  // ─────────────────────────── состояние ───────────────────────────

  function applyState(st) {
    const prev = state;
    state = st;

    if (st.phase === 'lobby') {
      R.renderLobby(st);
      R.renderVoteModal(st, null);
      el('modal-vote').hidden = true;
      return;
    }

    if (st.phase === 'finale' || st.phase === 'ended') {
      R.renderGame(st);
      R.renderFinale(st);
      el('modal-vote').hidden = true;
      return;
    }

    R.renderGame(st);
    renderActionPanel(st);
    R.renderVoteModal(st, pickedVote);

    if (prev && prev.phase !== st.phase && st.timer.remaining > 0) {
      R.toast(R.PHASE_LABEL[st.phase] || st.phase, 'info');
    }
    window.BunkerSounds.tick(st.timer.remaining);
  }

  // ─────────────────────────── привязка событий ───────────────────────────

  function bindHome() {
    el('btn-create').addEventListener('click', () => {
      const nick = el('create-nick').value.trim();
      const err = el('create-error');
      err.hidden = true;
      window.BunkerSounds.unlock();
      S.createRoom(nick).then((res) => {
        if (!res.ok) {
          err.textContent = res.error;
          err.hidden = false;
          return;
        }
        S.setToken(res.token);
        S.setCode(res.roomCode);
        S.setNickname(nick);
        history.replaceState(null, '', `?room=${res.roomCode}`);
      });
    });

    el('btn-join').addEventListener('click', () => {
      const code = el('join-code').value.trim().toUpperCase();
      const nick = el('join-nick').value.trim();
      const err = el('join-error');
      err.hidden = true;
      if (code.length !== 5) {
        err.textContent = 'Код состоит из 5 символов';
        err.hidden = false;
        return;
      }
      window.BunkerSounds.unlock();
      S.joinRoom({ code, nickname: nick, token: '' }).then((res) => {
        if (!res.ok) {
          err.textContent = res.error;
          err.hidden = false;
          return;
        }
        S.setToken(res.token);
        S.setCode(res.roomCode);
        S.setNickname(nick);
      });
    });

    el('join-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      const code = e.target.value;
      const preview = el('room-preview');
      if (code.length === 5) {
        fetch(`/api/room/${code}`).then((r) => r.json()).then((data) => {
          preview.hidden = false;
          preview.textContent = data.ok
            ? `Комната найдена: ${data.room.players} игрок(ов), ${data.room.started ? 'партия уже идёт' : 'ждёт игроков'}.`
            : 'Комната с таким кодом не найдена.';
        }).catch(() => { preview.hidden = true; });
      } else {
        preview.hidden = true;
      }
    });

    el('create-nick').value = S.getNickname();
    el('join-nick').value = S.getNickname();
  }

  function bindLobby() {
    const copy = (text, label) => {
      const done = () => R.toast(`${label} скопирован`, 'ok');
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    };
    const fallbackCopy = (text, done) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { R.toast('Скопируйте вручную: ' + text, 'warn'); }
      ta.remove();
    };

    el('btn-copy-code').addEventListener('click', () => {
      if (state) copy(state.roomCode, 'Код');
    });
    el('btn-copy-link').addEventListener('click', () => {
      if (state) copy(`${location.origin}${location.pathname}?room=${state.roomCode}`, 'Ссылка');
    });

    if (navigator.share) {
      el('btn-share').hidden = false;
      el('btn-share').addEventListener('click', () => {
        if (!state) return;
        navigator.share({
          title: 'Бункер Live',
          text: `Входи в бункер по коду ${state.roomCode}`,
          url: `${location.origin}${location.pathname}?room=${state.roomCode}`,
        }).catch(() => {});
      });
    }

    el('seats-mode').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      S.updateSettings({ seatsMode: btn.dataset.mode }).then(afterAction);
    });
    el('seats-fixed').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-seats]');
      if (!btn) return;
      S.updateSettings({ seatsFixed: Number(btn.dataset.seats) }).then(afterAction);
    });
    el('tempo').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tempo]');
      if (!btn) return;
      const presets = {
        chill: { speak: 90, discussion: 90, accusation: 40, voting: 25, defense: 40, farewell: 20 },
        normal: { speak: 60, discussion: 60, accusation: 30, voting: 15, defense: 30, farewell: 15 },
        fast: { speak: 40, discussion: 40, accusation: 20, voting: 12, defense: 20, farewell: 10 },
      };
      el('tempo').querySelectorAll('.segmented__item').forEach((b) => b.classList.toggle('is-active', b === btn));
      S.updateSettings({ timers: presets[btn.dataset.tempo] }).then(afterAction);
    });
    el('set-auto').addEventListener('change', (e) => S.updateSettings({ autoAdvance: e.target.checked }).then(afterAction));
    el('set-exiles').addEventListener('change', (e) => S.updateSettings({ exilesKeepVoting: e.target.checked }).then(afterAction));
    el('set-specials').addEventListener('change', (e) => S.updateSettings({ enableSpecials: e.target.checked }).then(afterAction));

    el('btn-start').addEventListener('click', () => S.startGame().then(afterAction));
    el('btn-leave-lobby').addEventListener('click', () => {
      openConfirm('Выйти из комнаты?', 'Вы покинете лобби. Вернуться можно будет по коду заново.', () => {
        S.leaveRoom().then(() => {
          S.clearSession();
          history.replaceState(null, '', location.pathname);
          R.showScreen('home');
        });
      });
    });
  }

  function bindGame() {
    el('btn-vote-confirm').addEventListener('click', () => {
      if (!pickedVote) return;
      const modal = el('modal-vote');
      S.vote(pickedVote).then((res) => {
        afterAction(res);
        if (res.ok) {
          modal.hidden = true;
          pickedVote = null;
        }
      });
    });
    el('btn-vote-skip').addEventListener('click', () => {
      const modal = el('modal-vote');
      S.skipVote().then((res) => {
        afterAction(res);
        if (res.ok) modal.hidden = true;
      });
    });
    el('vote-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-vote]');
      if (!card) return;
      pickedVote = card.dataset.vote;
      el('vote-grid').querySelectorAll('[data-vote]').forEach((n) => n.classList.toggle('is-picked', n === card));
      el('btn-vote-confirm').disabled = false;
    });

    el('my-notes').addEventListener('input', (e) => {
      clearTimeout(notesTimer);
      const value = e.target.value;
      notesTimer = setTimeout(() => {
        S.setNotes(value).then(() => {
          el('notes-status').textContent = 'Сохранено';
          setTimeout(() => { el('notes-status').textContent = ''; }, 1500);
        });
      }, 700);
    });
  }

  function bindHelp() {
    const open = () => {
      R.renderHelp(help);
      el('help-drawer').classList.add('is-open');
      el('help-drawer').setAttribute('aria-hidden', 'false');
    };
    const close = () => {
      el('help-drawer').classList.remove('is-open');
      el('help-drawer').setAttribute('aria-hidden', 'true');
    };
    ['btn-help-home', 'btn-help-lobby', 'btn-help-game', 'btn-help-finale'].forEach((id) => {
      const node = el(id);
      if (node) node.addEventListener('click', open);
    });
    el('btn-help-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        closeConfirm();
        el('modal-vote').hidden = true;
      }
    });
  }

  function bindModals() {
    document.querySelectorAll('[data-close-vote]').forEach((n) => n.addEventListener('click', () => { el('modal-vote').hidden = true; }));
    document.querySelectorAll('[data-close-confirm]').forEach((n) => n.addEventListener('click', closeConfirm));
    el('btn-confirm-no').addEventListener('click', closeConfirm);
    el('btn-confirm-yes').addEventListener('click', () => {
      const fn = confirmAction;
      closeConfirm();
      if (fn) fn();
    });
  }

  // ─────────────────────────── запуск ───────────────────────────

  function boot() {
    window.BunkerSounds.setMuted(S.getMuted());
    S.connect();

    S.on('meta', (m) => {
      help = m.help;
      R.setCategories(m.categories);
      R.renderHelp(help);
    });
    S.on('state', applyState);
    S.on('toast', (t) => R.toast(t.message, t.kind));
    S.on('sound', (s) => window.BunkerSounds.play(s.name));
    S.on('notesSaved', () => {});

    bindHome();
    bindLobby();
    bindGame();
    bindHelp();
    bindModals();

    // Ссылка-приглашение: ?room=CODE
    const params = new URLSearchParams(location.search);
    const roomFromUrl = (params.get('room') || '').toUpperCase();
    if (roomFromUrl) {
      el('join-code').value = roomFromUrl;
      el('join-code').dispatchEvent(new Event('input'));
      el('join-nick').focus();
    } else if (S.getNickname()) {
      el('create-nick').value = S.getNickname();
    }

    // Если есть сохранённая сессия — пробуем вернуться автоматически.
    const token = S.getToken();
    const code = S.getCode();
    if (token && code && !roomFromUrl) {
      S.joinRoom({ code, token }).then((res) => {
        if (!res.ok) S.clearSession();
      });
    }

    document.body.addEventListener('touchstart', () => window.BunkerSounds.unlock(), { once: true });
    document.body.addEventListener('click', () => window.BunkerSounds.unlock(), { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
