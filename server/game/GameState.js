'use strict';

const { CHARACTER_CATEGORIES } = require('./constants');
const { DeckGenerator } = require('./DeckGenerator');
const { findCardById } = require('./decks');
const {
  SEATS_MODE,
  bunkerSeats,
  exilesNeeded,
  seatsLabel,
  revealCountForRound,
  tallyVotes,
  resolvePrimaryVote,
  resolveRevote,
  defaultSettings,
  CATEGORY_TOTAL,
} = require('./rules');

/** Фазы партии. */
const PHASES = {
  LOBBY: 'lobby',
  INTRO: 'intro',
  REVEAL: 'reveal',
  DISCUSSION: 'discussion',
  ACCUSATION: 'accusation',
  VOTING: 'voting',
  DEFENSE: 'defense',
  REVOTE: 'revote',
  FAREWELL: 'farewell',
  SUMMARY: 'summary',
  FINALE: 'finale',
  ENDED: 'ended',
};

/** Какие таймеры использует каждая фаза. */
const PHASE_TIMER = {
  [PHASES.REVEAL]: 'speak',
  [PHASES.DISCUSSION]: 'discussion',
  [PHASES.ACCUSATION]: 'accusation',
  [PHASES.VOTING]: 'voting',
  [PHASES.DEFENSE]: 'defense',
  [PHASES.REVOTE]: 'voting',
  [PHASES.FAREWELL]: 'farewell',
};

class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameError';
    this.userFacing = true;
  }
}

class GameState {
  constructor({ roomCode, settings, seed, players }) {
    this.roomCode = roomCode;
    this.settings = { ...defaultSettings(), ...(settings || {}) };
    this.settings.timers = { ...defaultSettings().timers, ...((settings && settings.timers) || {}) };
    this.seed = seed;
    this.players = (players || []).map((p) => this._blankPlayer(p));
    this.phase = PHASES.LOBBY;
    this.round = 0;
    this.maxRounds = this.settings.maxRounds;
    this.log = [];
    this.history = [];
    this.events = [];
    this.deadline = null;
    this.phaseDuration = 0;
    this.order = [];
    this.turnIndex = 0;
    this.votes = {};
    this.voteStage = null;
    this.voteCandidates = [];
    this.defendedThisRound = new Set();
    this.lastTally = null;
    this.lastOutcome = null;
    this.catastrophe = null;
    this.bunker = null;
    this.seatCount = null;
    this.pendingExile = [];
    this.finaleReport = null;
    this.startedAt = null;
  }

  _blankPlayer(p) {
    return {
      id: p.id,
      nickname: p.nickname,
      isHost: !!p.isHost,
      isBot: !!p.isBot,
      connected: p.connected !== false,
      exiled: false,
      cards: null, // { category: cardId }
      revealed: [], // раскрытые категории
      notes: '',
      hasVoted: false,
      voteTarget: null,
      specialsUsed: [],
      immune: false,
      voteWeight: 1,
      silent: false,
      peeked: [], // id игроков, чьи карты этот игрок подсмотрел
      extraReveals: 0,
      joinedAt: p.joinedAt || Date.now(),
    };
  }

  // ─────────────────────────────── утилиты ───────────────────────────────

  getPlayer(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  activePlayers() {
    return this.players.filter((p) => !p.exiled);
  }

  /** Кто имеет право голоса. */
  voters() {
    if (this.settings.exilesKeepVoting) return this.players.slice();
    return this.activePlayers();
  }

  seatInfo() {
    const n = this.players.length;
    const { seats, hint } = seatsLabel({
      mode: this.settings.seatsMode,
      fixed: this.settings.seatsFixed,
      players: n,
    });
    return { seats, hint, mode: this.settings.seatsMode, players: n };
  }

  currentTurnPlayerId() {
    return this.order[this.turnIndex] || null;
  }

  /** Сколько карт игрок обязан раскрыть в текущем раунде. */
  requiredRevealsFor(player) {
    if (!player) return 0;
    const base = revealCountForRound(this.players.length, this.round - 1);
    const remaining = CATEGORY_TOTAL - player.revealed.length;
    return Math.max(0, Math.min(base + player.extraReveals, remaining));
  }

  /** Сколько ещё карт нужно раскрыть игроку в этом раунде. */
  revealsLeftFor(player) {
    if (!player) return 0;
    const revealedThisRound = player.revealedThisRound || 0;
    return Math.max(0, this.requiredRevealsFor(player) - revealedThisRound);
  }

  _log(text, kind = 'info') {
    const entry = { t: Date.now(), text, kind, round: this.round };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this.events.push({ type: 'log', entry });
    return entry;
  }

  _toast(message, kind = 'info') {
    this.events.push({ type: 'toast', message, kind });
  }

  _sound(name) {
    this.events.push({ type: 'sound', name });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ─────────────────────────────── старт партии ───────────────────────────────

  start() {
    if (this.phase !== PHASES.LOBBY) throw new GameError('Партия уже началась');
    if (this.players.length < 2) throw new GameError('Нужно минимум 2 игрока');

    const deck = new DeckGenerator(this.seed);
    const draw = deck.generateGame(this.players.length);
    this.catastrophe = draw.catastrophe;
    this.bunker = draw.bunker;
    this.players.forEach((p, i) => {
      p.cards = draw.characters[i];
      p.revealed = [];
      p.revealedThisRound = 0;
      p.notes = p.notes || '';
    });

    this.seatCount = this.seatInfo().seats;
    this.startedAt = Date.now();
    this.phase = PHASES.INTRO;
    this.deadline = null;
    this._log(
      `Катастрофа: ${this.catastrophe.title}. Бункер рассчитан на ${this.seatCount} мест(а) из ${this.players.length} выживших.`,
      'story',
    );
    this._sound('start');
    return this;
  }

  // ─────────────────────────────── раунды ───────────────────────────────

  beginRound(n) {
    this.round = n;
    this.votes = {};
    this.voteStage = null;
    this.voteCandidates = [];
    this.lastTally = null;
    this.lastOutcome = null;
    this.defendedThisRound = new Set();

    for (const p of this.players) {
      p.hasVoted = false;
      p.voteTarget = null;
      p.immune = false;
      p.voteWeight = 1;
      p.extraReveals = 0;
      p.revealedThisRound = 0;
    }

    // Порядок хода чередуется: нечётные раунды — прямой, чётные — обратный.
    const base = this.activePlayers().filter((p) => !p.silent);
    this.order = n % 2 === 1 ? base.map((p) => p.id) : base.map((p) => p.id).reverse();
    this.turnIndex = 0;
    this._setPhase(PHASES.REVEAL);
    this._log(`Раунд ${n}: открывается ${revealCountForRound(this.players.length, n - 1)} характеристик(и) на игрока.`);
    this._sound('round');
    return this;
  }

  _setPhase(phase, { duration } = {}) {
    this.phase = phase;
    const timerKey = PHASE_TIMER[phase];
    const seconds = duration != null ? duration : timerKey ? this.settings.timers[timerKey] : 0;
    this.phaseDuration = seconds;
    this.deadline = seconds > 0 ? Date.now() + seconds * 1000 : null;
    return this;
  }

  /** Хост (или автотаймер) двигает партию дальше. */
  advance(actorId = null) {
    if (actorId) {
      const p = this.getPlayer(actorId);
      if (!p || !p.isHost) throw new GameError('Двигать партию может только ведущий');
    }

    switch (this.phase) {
      case PHASES.INTRO:
        return this.beginRound(1);
      case PHASES.REVEAL:
        return this._finishTurn();
      case PHASES.DISCUSSION:
        return this._startAccusations();
      case PHASES.ACCUSATION:
        return this._nextAccusation();
      case PHASES.VOTING:
        return this._resolveVote('primary');
      case PHASES.DEFENSE:
        return this._nextDefense();
      case PHASES.REVOTE:
        return this._resolveVote('revote');
      case PHASES.FAREWELL:
        return this._applyExile();
      case PHASES.SUMMARY:
        return this._afterSummary();
      case PHASES.FINALE:
        return this._endGame();
      default:
        return this;
    }
  }

  // ─────────────────────────────── раскрытие ───────────────────────────────

  reveal(playerId, category) {
    if (this.phase !== PHASES.REVEAL) throw new GameError('Сейчас не фаза раскрытия');
    const player = this.getPlayer(playerId);
    if (!player) throw new GameError('Игрок не найден');
    if (player.exiled) throw new GameError('Изгнанный игрок не раскрывает характеристики');
    if (this.currentTurnPlayerId() !== playerId) {
      throw new GameError('Сейчас не ваш ход — дождитесь своей очереди');
    }
    if (!CHARACTER_CATEGORIES.includes(category)) throw new GameError('Неизвестная категория');
    if (player.revealed.includes(category)) throw new GameError('Эта характеристика уже раскрыта');

    // В первом раунде первым делом открывается профессия.
    if (this.round === 1 && !player.revealed.includes('profession') && category !== 'profession') {
      throw new GameError('В первом раунде сначала открывается профессия');
    }

    if (this.revealsLeftFor(player) <= 0) throw new GameError('В этом раунде вы уже открыли все положенные карты');

    player.revealed.push(category);
    player.revealedThisRound = (player.revealedThisRound || 0) + 1;
    const card = findCardById(player.cards[category]);
    this._log(`${player.nickname} раскрывает: ${card ? card.title : category}`);
    this._sound('reveal');

    if (this.revealsLeftFor(player) <= 0) this._finishTurn();
    return this;
  }

  /** Раскрыть карту вне очереди (спец. возможность). */
  _forceReveal(player, category) {
    if (player.revealed.includes(category)) return null;
    player.revealed.push(category);
    return findCardById(player.cards[category]);
  }

  _finishTurn() {
    // Добровольно-принудительно закрываем недобор карт, чтобы партия не встала.
    const current = this.getPlayer(this.currentTurnPlayerId());
    if (current && this.revealsLeftFor(current) > 0) {
      const hidden = CHARACTER_CATEGORIES.filter(
        (c) => !current.revealed.includes(c) && !(this.round === 1 && !current.revealed.includes('profession') && c !== 'profession'),
      );
      while (this.revealsLeftFor(current) > 0 && hidden.length) {
        const pick = hidden.splice(Math.floor(Math.random() * hidden.length), 1)[0];
        this._forceReveal(current, pick);
      }
      this._log(`${current.nickname} не успел — карты раскрыты автоматически.`, 'warn');
    }
    return this._nextTurn();
  }

  _nextTurn() {
    this.turnIndex += 1;
    if (this.turnIndex >= this.order.length) return this._startDiscussion();
    this._setPhase(PHASES.REVEAL);
    const next = this.getPlayer(this.currentTurnPlayerId());
    if (next) this._log(`Ход: ${next.nickname}`, 'turn');
    return this;
  }

  _startDiscussion() {
    this._setPhase(PHASES.DISCUSSION);
    this._log('Коллективное обсуждение: успейте задать вопросы.', 'phase');
    return this;
  }

  _startAccusations() {
    this.turnIndex = 0;
    this._setPhase(PHASES.ACCUSATION);
    const first = this.getPlayer(this.currentTurnPlayerId());
    this._log(`Обвинения и оправдания. Слово: ${first ? first.nickname : '—'}`, 'phase');
    return this;
  }

  _nextAccusation() {
    this.turnIndex += 1;
    if (this.turnIndex >= this.order.length) return this._openVoting(PHASES.VOTING, 'primary');
    this._setPhase(PHASES.ACCUSATION);
    return this;
  }

  // ─────────────────────────────── голосование ───────────────────────────────

  _openVoting(phase, stage) {
    this.phase = phase;
    this.voteStage = stage;
    this.votes = {};
    for (const p of this.voters()) {
      p.hasVoted = false;
      p.voteTarget = null;
    }
    this._setPhase(phase);
    this._log(
      stage === 'primary'
        ? `Голосование: у вас ${this.settings.timers.voting} секунд. Кто покинет лагерь?`
        : 'Повторное голосование после оправдательных речей.',
      'phase',
    );
    this._sound('vote');
    return this;
  }

  castVote(voterId, targetId) {
    if (this.phase !== PHASES.VOTING && this.phase !== PHASES.REVOTE) {
      throw new GameError('Сейчас не время голосовать');
    }
    const voter = this.getPlayer(voterId);
    if (!voter) throw new GameError('Игрок не найден');
    if (!this.voters().some((p) => p.id === voterId)) {
      throw new GameError('Вы не участвуете в голосовании');
    }
    if (targetId !== 'skip') {
      const target = this.getPlayer(targetId);
      if (!target || target.exiled) throw new GameError('Нельзя голосовать против этого игрока');
      if (targetId === voterId) throw new GameError('Нельзя голосовать против себя');
      if (this.voteStage === 'revote' && !this.voteCandidates.includes(targetId)) {
        throw new GameError('В повторном голосовании участвуют только кандидаты на вылет');
      }
    }
    this.votes[voterId] = targetId;
    voter.hasVoted = true;
    voter.voteTarget = targetId === 'skip' ? 'skip' : null; // цель держим в тайне до подсчёта

    const pending = this.voters().filter((p) => !p.hasVoted);
    if (pending.length === 0) this._resolveVote(this.voteStage);
    return this;
  }

  _weights() {
    const w = {};
    for (const p of this.voters()) w[p.id] = p.voteWeight;
    return w;
  }

  _resolveVote(stage) {
    const voterIds = this.voters().map((p) => p.id);
    const tally = tallyVotes(this.votes, voterIds, this._weights());
    // Иммунитет от голосования: голоса против такого игрока не действуют.
    for (const p of this.players) {
      if (p.immune && tally.counts[p.id]) {
        delete tally.counts[p.id];
        this._log(`${p.nickname} защищён спец. возможностью — голоса против него не считаются.`, 'warn');
      }
    }
    const recount = Object.keys(tally.counts).filter((id) => tally.counts[id] > 0);
    let max = 0;
    for (const id of recount) max = Math.max(max, tally.counts[id]);
    tally.max = max;
    tally.top = recount.filter((id) => tally.counts[id] === max && max > 0);
    this.lastTally = tally;

    const outcome =
      stage === 'primary'
        ? resolvePrimaryVote(tally, { roundNumber: this.round, activeCount: this.voters().length })
        : resolveRevote(tally, { roundNumber: this.round });

    this.lastOutcome = { ...outcome, stage };
    this._log(`Голоса: ${this._tallyText(tally)}`);

    if (outcome.action === 'skip') {
      this._log('Голосование пропущено: большинство решило не исключать никого.', 'warn');
      this._toast('Голосование пропущено', 'info');
      this.phase = PHASES.SUMMARY;
      this.deadline = null;
      return this;
    }

    if (outcome.action === 'no_exile') {
      this._log('Кандидаты получили равное число голосов — раунд закрывается без исключения.', 'warn');
      this.phase = PHASES.SUMMARY;
      this.deadline = null;
      return this;
    }

    if (outcome.action === 'exile') {
      this.pendingExile = this._clampExiles(outcome.targets);
      if (this.pendingExile.length === 0) {
        this._log('Изгонять некого: свободных мест уже не осталось.', 'warn');
        this.phase = PHASES.SUMMARY;
        this.deadline = null;
        return this;
      }
      return this._startFarewell();
    }

    // defense
    this.voteCandidates = outcome.targets.filter((id) => !this.defendedThisRound.has(id));
    if (this.voteCandidates.length === 0) {
      // Все кандидаты уже оправдывались — переходим к повторному голосованию.
      return this._openVoting(PHASES.REVOTE, 'revote');
    }
    this.turnIndex = 0;
    return this._startDefense();
  }

  _tallyText(tally) {
    const parts = Object.keys(tally.counts)
      .sort((a, b) => tally.counts[b] - tally.counts[a])
      .map((id) => {
        const p = this.getPlayer(id);
        return `${p ? p.nickname : id} — ${tally.counts[id]}`;
      });
    if (tally.skipVotes) parts.push(`воздержались — ${tally.skipVotes}`);
    return parts.join(', ') || 'нет голосов';
  }

  _startDefense() {
    this._setPhase(PHASES.DEFENSE);
    const cand = this.getPlayer(this.voteCandidates[this.turnIndex]);
    this._log(`Оправдательная речь: ${cand ? cand.nickname : '—'} (${this.settings.timers.defense} секунд)`, 'phase');
    return this;
  }

  _nextDefense() {
    const currentId = this.voteCandidates[this.turnIndex];
    if (currentId) this.defendedThisRound.add(currentId);
    this.turnIndex += 1;
    if (this.turnIndex >= this.voteCandidates.length) {
      return this._openVoting(PHASES.REVOTE, 'revote');
    }
    return this._startDefense();
  }

  // ─────────────────────────────── изгнание ───────────────────────────────

  _startFarewell() {
    this._setPhase(PHASES.FAREWELL);
    const names = this.pendingExile.map((id) => (this.getPlayer(id) || {}).nickname).join(', ');
    this._log(`Прощальная речь: ${names} (${this.settings.timers.farewell} секунд)`, 'phase');
    this._sound('exile');
    return this;
  }

  _applyExile() {
    for (const id of this.pendingExile) {
      const p = this.getPlayer(id);
      if (!p || p.exiled) continue;
      p.exiled = true;
      p.exiledRound = this.round;
      this.history.push({ round: this.round, exiled: id, nickname: p.nickname });
      this._log(`${p.nickname} покидает временный лагерь.`, 'danger');
    }
    this.pendingExile = [];
    this.voteCandidates = [];
    this.phase = PHASES.SUMMARY;
    this.deadline = null;
    this._checkFinish();
    return this;
  }

  _checkFinish() {
    if (this.activePlayers().length <= this.seatCount) {
      this.phase = PHASES.FINALE;
      this.deadline = null;
      this.finaleReport = this.buildFinaleReport();
      this._log('Места в бункере заполнены. Двери закрываются.', 'story');
      this._sound('finale');
      return true;
    }
    return false;
  }

  /**
   * Не даёт изгнать больше людей, чем нужно: в бункере всегда должно остаться
   * ровно столько, сколько мест. Если равенство голосов требует убрать больше
   * игроков, чем позволяет вместимость, судьбу решает жребий — правила прямо
   * допускают случайный выбор при неустранимом равенстве.
   */
  _clampExiles(targets) {
    const allowed = Math.max(0, this.activePlayers().length - this.seatCount);
    if (targets.length <= allowed) return targets;
    if (allowed <= 0) return [];
    const picked = targets.slice();
    for (let i = picked.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    const result = picked.slice(0, allowed);
    const names = result.map((id) => (this.getPlayer(id) || {}).nickname).join(', ');
    this._log(`Голоса разделились, а мест меньше: жребий оставляет снаружи ${names}.`, 'warn');
    this._toast('Равенство голосов — судьбу решил жребий', 'warn');
    return result;
  }

  _afterSummary() {
    if (this._checkFinish()) return this;
    const remaining = this.activePlayers().length - this.seatCount;
    if (remaining <= 0) return this._checkFinish();
    if (this.round >= this.maxRounds) {
      // Лимит раундов исчерпан: закрываем вопрос одним разом, иначе партия
      // никогда не дойдёт до нужного числа мест.
      const active = this.activePlayers().slice();
      for (let i = active.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [active[i], active[j]] = [active[j], active[i]];
      }
      const excess = active.slice(0, remaining);
      this._log(
        `Лимит раундов исчерпан: лагерь покидают ${excess.length} игрок(ов) по жребию.`,
        'warn',
      );
      this.pendingExile = excess.map((p) => p.id);
      return this._applyExile();
    }
    return this.beginRound(this.round + 1);
  }

  // ─────────────────────────────── спец. возможности ───────────────────────────────

  useSpecial(playerId, targetId = null) {
    if (!this.settings.enableSpecials) throw new GameError('Спец. возможности выключены в настройках');
    const player = this.getPlayer(playerId);
    if (!player) throw new GameError('Игрок не найден');
    if (player.exiled) throw new GameError('Изгнанный игрок не может использовать возможности');
    if (player.specialsUsed.includes('special')) throw new GameError('Спец. возможность уже использована');
    if (!player.revealed.includes('special')) throw new GameError('Сначала раскройте свою спец. возможность');

    const card = findCardById(player.cards.special);
    if (!card) throw new GameError('Карта не найдена');
    const effect = card.effect;
    const target = targetId ? this.getPlayer(targetId) : null;
    if (card.targeting === 'one_player' && !target) throw new GameError('Выберите игрока');
    if (target && target.exiled) throw new GameError('Нельзя выбрать изгнанного игрока');

    switch (effect) {
      case 'immune_vote':
        player.immune = true;
        this._log(`${player.nickname} использует «${card.title}»: голоса против него не сработают.`, 'warn');
        break;
      case 'double_vote':
        player.voteWeight = 2;
        this._log(`${player.nickname} использует «${card.title}»: его голос считается за два.`, 'warn');
        break;
      case 'reveal_other': {
        const hidden = CHARACTER_CATEGORIES.filter((c) => !target.revealed.includes(c));
        if (hidden.length) {
          const cat = hidden[Math.floor(Math.random() * hidden.length)];
          const revealed = this._forceReveal(target, cat);
          this._log(`${player.nickname} вскрывает карту ${target.nickname}: ${revealed ? revealed.title : cat}`, 'warn');
        }
        break;
      }
      case 'peek_other':
        if (!player.peeked.includes(target.id)) player.peeked.push(target.id);
        this._log(`${player.nickname} тайно изучает характеристики ${target.nickname}.`, 'warn');
        break;
      case 'heal_self': {
        const deck = new DeckGenerator(this.seed + this.round);
        player.cards.health = deck.drawSpecific('health').id;
        this._log(`${player.nickname} использует «${card.title}»: здоровье заменено.`, 'warn');
        break;
      }
      case 'swap_card': {
        const mine = CHARACTER_CATEGORIES.filter((c) => c !== 'special' && !player.revealed.includes(c));
        const theirs = CHARACTER_CATEGORIES.filter((c) => c !== 'special' && !target.revealed.includes(c));
        if (mine.length && theirs.length) {
          const a = mine[Math.floor(Math.random() * mine.length)];
          const b = theirs[Math.floor(Math.random() * theirs.length)];
          const tmp = player.cards[a];
          player.cards[a] = target.cards[b];
          target.cards[b] = tmp;
          this._log(`${player.nickname} обменялся закрытой картой с ${target.nickname}.`, 'warn');
        }
        break;
      }
      case 'cancel_vote':
        this._log(`${player.nickname} отменяет текущее голосование!`, 'danger');
        this.votes = {};
        this.pendingExile = [];
        this.phase = PHASES.SUMMARY;
        this.deadline = null;
        break;
      case 'extra_time':
        if (this.deadline) this.deadline += 30000;
        this._log(`${player.nickname} выторговывает ещё 30 секунд.`, 'warn');
        break;
      case 'silence_player':
        target.silent = true;
        this._log(`${target.nickname} лишается права слова до конца раунда.`, 'danger');
        break;
      case 'boost_self':
        player.extraReveals += 1;
        this._log(`${player.nickname} получает право раскрыть дополнительную карту.`, 'warn');
        break;
      case 'reroll_card': {
        const deck = new DeckGenerator(this.seed + this.round + 7);
        const hidden = CHARACTER_CATEGORIES.filter((c) => c !== 'special' && !player.revealed.includes(c));
        if (hidden.length) {
          const cat = hidden[Math.floor(Math.random() * hidden.length)];
          player.cards[cat] = deck.drawSpecific(cat).id;
          this._log(`${player.nickname} перебрасывает закрытую карту.`, 'warn');
        }
        break;
      }
      case 'return_player': {
        const exiled = this.players.filter((p) => p.exiled);
        if (!exiled.length) throw new GameError('В лагере нет изгнанных игроков');
        const back = target && target.exiled ? target : exiled[exiled.length - 1];
        back.exiled = false;
        this.history.push({ round: this.round, returned: back.id, nickname: back.nickname });
        this._log(`${back.nickname} возвращается в лагерь!`, 'ok');
        break;
      }
      default:
        throw new GameError('Эта возможность пока не поддерживается');
    }

    player.specialsUsed.push('special');
    this._sound('special');
    return this;
  }

  // ─────────────────────────────── финал ───────────────────────────────

  buildFinaleReport() {
    const survivors = this.activePlayers();
    // «Количество еды — запас продуктов, которых должно хватить на период
    // пребывания в бункере»: food_units — на сколько месяцев хватает запаса.
    const months = parseDurationMonths(this.catastrophe ? this.catastrophe.duration : '1 год');
    const foodMonths = Number(this.bunker ? this.bunker.food_units : 0);
    const foodRatio = months > 0 ? foodMonths / months : 1;
    const bedCapacity = Number(this.bunker ? this.bunker.sleeping_rooms : 0) * 2;
    const hazards = this.bunker ? this.bunker.hazards.length : 0;
    const advantages = this.bunker ? this.bunker.advantages.length : 0;

    // Страховка: пустой бункер — признак ошибки в логике изгнания,
    // а не игровой ситуации. Вердикт в этом случае честно это и говорит.
    if (survivors.length === 0) {
      return {
        score: 0,
        verdict: {
          key: 'fail',
          title: 'В бункере никого не осталось',
          text: 'Лагерь изгнал всех подряд — двери закрылись в пустоте. Такой исход означает ошибку в правилах, а не партию.',
        },
        food: { have: foodMonths, need: months, ratio: 0, months },
        beds: { capacity: bedCapacity, people: 0 },
        hazards,
        survivors: [],
        exiled: this.players.filter((p) => p.exiled).map((p) => ({ id: p.id, nickname: p.nickname, round: p.exiledRound })),
        perPlayer: [],
        catastrophe: this.catastrophe,
        bunker: this.bunker,
      };
    }

    let score = 50;
    if (foodRatio >= 1) score += 22;
    else if (foodRatio >= 0.7) score += 8;
    else if (foodRatio >= 0.4) score -= 8;
    else score -= 22;

    if (survivors.length <= bedCapacity) score += 8;
    else score -= 14;

    score -= hazards * 9;
    score += advantages * 4;
    score -= (Number(this.catastrophe ? this.catastrophe.severity : 3) - 3) * 6;

    // Ровный состав лучше перекошенного: нужны и руки, и головы.
    const hasSpecial = survivors.filter((p) => p.revealed.includes('special')).length;
    score += Math.min(6, hasSpecial);

    score = Math.max(0, Math.min(100, Math.round(score)));

    const verdict =
      score >= 70
        ? { key: 'survive', title: 'Вы выжили', text: 'Запасов, ремонта и голов на плечах хватило: бункер переживает катастрофу.' }
        : score >= 45
          ? { key: 'struggle', title: 'Вы выжили, но на пределе', text: 'Часть запасов придётся растянуть, а часть — добывать снаружи. Не все доживут до конца срока.' }
          : { key: 'fail', title: 'Бункер не пережил катастрофу', text: 'Не хватило запасов или людей с нужными руками. Группа обречена.' };

    const perPlayer = survivors.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      cards: Object.fromEntries(p.revealed.map((c) => [c, findCardById(p.cards[c])])),
    }));

    return {
      score,
      verdict,
      food: { have: foodMonths, need: months, ratio: Number(foodRatio.toFixed(2)), months },
      beds: { capacity: bedCapacity, people: survivors.length },
      hazards,
      survivors: survivors.map((p) => ({ id: p.id, nickname: p.nickname })),
      exiled: this.players.filter((p) => p.exiled).map((p) => ({ id: p.id, nickname: p.nickname, round: p.exiledRound })),
      perPlayer,
      catastrophe: this.catastrophe,
      bunker: this.bunker,
    };
  }

  _endGame() {
    this.phase = PHASES.ENDED;
    this.deadline = null;
    this._log('Партия завершена.', 'story');
    return this;
  }

  // ─────────────────────────────── тик таймера ───────────────────────────────

  /** Вызывается раз в секунду. Возвращает true, если состояние изменилось. */
  tick(now = Date.now()) {
    // Боты ходят сами, независимо от таймеров: иначе соло-партия стоит.
    let changed = this._botsAct(now);

    if (this.deadline && this.settings.autoAdvance && now >= this.deadline) {
      const phase = this.phase;
      this.deadline = null;
      switch (phase) {
        case PHASES.REVEAL:
          this._finishTurn();
          break;
        case PHASES.DISCUSSION:
          this._startAccusations();
          break;
        case PHASES.ACCUSATION:
          this._nextAccusation();
          break;
        case PHASES.VOTING:
        case PHASES.REVOTE:
          this._resolveVote(this.voteStage);
          break;
        case PHASES.DEFENSE:
          this._nextDefense();
          break;
        case PHASES.FAREWELL:
          this._applyExile();
          break;
        case PHASES.SUMMARY:
          this._afterSummary();
          break;
        default:
          return changed;
      }
      changed = true;
    }
    return changed;
  }

  // ─────────────────────────────── боты ───────────────────────────────

  /**
   * Один шаг ботов. Боты ходят с небольшой задержкой, чтобы партия
   * выглядела живо, а не как мгновенная прокрутка.
   */
  _botsAct(now) {
    if (this.phase === PHASES.REVEAL) {
      const bot = this.getPlayer(this.currentTurnPlayerId());
      return bot && bot.isBot ? this._botRevealTurn(bot, now) : false;
    }
    if (this.phase === PHASES.ACCUSATION) {
      const bot = this.getPlayer(this.order[this.turnIndex]);
      return bot && bot.isBot
        ? this._botDelay(bot, now, 1200, `accuse:${this.round}:${this.turnIndex}`, () => this._nextAccusation())
        : false;
    }
    if (this.phase === PHASES.DEFENSE) {
      const bot = this.getPlayer(this.voteCandidates[this.turnIndex]);
      return bot && bot.isBot
        ? this._botDelay(bot, now, 1600, `defense:${this.round}:${this.turnIndex}`, () => this._nextDefense())
        : false;
    }
    if (this.phase === PHASES.FAREWELL) {
      const bot = this.pendingExile.map((id) => this.getPlayer(id)).find((p) => p && p.isBot);
      return bot
        ? this._botDelay(bot, now, 1300, `farewell:${this.round}:${bot.id}`, () => this._applyExile())
        : false;
    }
    if (this.phase === PHASES.VOTING || this.phase === PHASES.REVOTE) {
      let acted = false;
      for (const bot of this.voters().filter((p) => p.isBot && !p.hasVoted)) {
        if (this._botVote(bot, now)) acted = true;
      }
      return acted;
    }
    return false;
  }

  /** Выполняет действие один раз, выдержав паузу на «размышление». */
  _botDelay(bot, now, ms, key, fn) {
    if (bot._actKey !== key) {
      bot._actKey = key;
      bot._actAt = now + ms + Math.floor(Math.random() * 500);
      return false;
    }
    if (now < bot._actAt) return false;
    bot._actKey = null;
    bot._actAt = 0;
    try {
      fn();
    } catch (err) {
      this._log(`Бот ${bot.nickname} не смог сделать ход: ${err.message}`, 'warn');
    }
    return true;
  }

  _botRevealTurn(bot, now) {
    return this._botDelay(bot, now, 900, `reveal:${this.round}:${this.turnIndex}`, () => {
      let guard = 0;
      while (this.revealsLeftFor(bot) > 0 && guard < 12) {
        guard += 1;
        const mustProfession = this.round === 1 && !bot.revealed.includes('profession');
        const pool = CHARACTER_CATEGORIES.filter(
          (c) => !bot.revealed.includes(c) && (!mustProfession || c === 'profession'),
        );
        if (!pool.length) break;
        this.reveal(bot.id, pool[Math.floor(Math.random() * pool.length)]);
      }
      // Если ход всё ещё у бота (например, раскрывать больше нечего) — закрываем.
      if (this.phase === PHASES.REVEAL && this.currentTurnPlayerId() === bot.id) this._finishTurn();
    });
  }

  _botVote(bot, now) {
    return this._botDelay(bot, now, 1100, `vote:${this.round}:${this.voteStage}:${bot.id}`, () => {
      if (!this.voters().some((p) => p.id === bot.id) || bot.hasVoted) return;
      const pool = this.phase === PHASES.REVOTE && this.voteCandidates.length
        ? this.voteCandidates
        : this.activePlayers().map((p) => p.id);
      const choices = pool.filter((id) => id !== bot.id);
      if (!choices.length) return;
      this.castVote(bot.id, choices[Math.floor(Math.random() * choices.length)]);
    });
  }

  // ─────────────────────────────── снапшот для клиента ───────────────────────────────

  /** Публичная карточка игрока: раскрытые характеристики видны всем. */
  _publicPlayer(p) {
    const revealedCards = p.revealed.map((cat) => {
      const card = findCardById(p.cards ? p.cards[cat] : null);
      return card ? { category: cat, id: card.id, title: card.title, text: card.text, tip: card.tip, tags: card.tags } : null;
    }).filter(Boolean);

    return {
      id: p.id,
      nickname: p.nickname,
      isHost: p.isHost,
      isBot: !!p.isBot,
      connected: p.connected,
      exiled: p.exiled,
      exiledRound: p.exiledRound || null,
      isTurn: this.currentTurnPlayerId() === p.id && this.phase === PHASES.REVEAL,
      isSpeaking: this._isSpeaking(p.id),
      hasVoted: p.hasVoted,
      revealed: p.revealed.slice(),
      revealedCards,
      revealedThisRound: p.revealedThisRound || 0,
      requiredReveals: this.requiredRevealsFor(p),
      immune: p.immune,
      silent: p.silent,
    };
  }

  _isSpeaking(id) {
    if (this.phase === PHASES.REVEAL && this.currentTurnPlayerId() === id) return true;
    if (this.phase === PHASES.ACCUSATION && this.order[this.turnIndex] === id) return true;
    if (this.phase === PHASES.DEFENSE && this.voteCandidates[this.turnIndex] === id) return true;
    return false;
  }

  snapshotFor(viewerId) {
    const viewer = this.getPlayer(viewerId);
    const isHost = !!(viewer && viewer.isHost);
    const myCards = viewer && viewer.cards
      ? CHARACTER_CATEGORIES.map((cat) => {
        const card = findCardById(viewer.cards[cat]);
        return {
          category: cat,
          id: card ? card.id : null,
          title: card ? card.title : '—',
          text: card ? card.text : '',
          tip: card ? card.tip : '',
          tags: card ? card.tags : [],
          effect: card ? card.effect : undefined,
          targeting: card ? card.targeting : undefined,
          revealed: viewer.revealed.includes(cat),
        };
      })
      : [];

    // Подсмотренные чужие карты — приватно, только этому игроку.
    const peeked = {};
    if (viewer) {
      for (const targetId of viewer.peeked) {
        const target = this.getPlayer(targetId);
        if (!target || !target.cards) continue;
        peeked[targetId] = CHARACTER_CATEGORIES
          .filter((c) => !target.revealed.includes(c))
          .map((c) => {
            const card = findCardById(target.cards[c]);
            return { category: c, title: card ? card.title : '—', text: card ? card.text : '' };
          });
      }
    }

    const remaining = this.deadline ? Math.max(0, Math.round((this.deadline - Date.now()) / 1000)) : 0;

    return {
      roomCode: this.roomCode,
      phase: this.phase,
      round: this.round,
      maxRounds: this.maxRounds,
      started: this.startedAt != null,
      seatCount: this.seatCount,
      seatInfo: this.seatInfo(),
      exilesNeeded: this.seatCount ? exilesNeeded(this.players.length, this.seatCount) : 0,
      players: this.players.map((p) => this._publicPlayer(p)),
      me: viewer
        ? {
          id: viewer.id,
          nickname: viewer.nickname,
          isHost,
          exiled: viewer.exiled,
          cards: myCards,
          revealedThisRound: viewer.revealedThisRound || 0,
          requiredReveals: this.requiredRevealsFor(viewer),
          revealsLeft: this.revealsLeftFor(viewer),
          notes: viewer.notes,
          specialUsed: viewer.specialsUsed.includes('special'),
          hasSpecial: viewer.revealed.includes('special'),
          hasVoted: viewer.hasVoted,
          voteTarget: viewer.voteTarget,
          immune: viewer.immune,
          voteWeight: viewer.voteWeight,
          canVote: this.voters().some((p) => p.id === viewer.id),
          isTurn: this.currentTurnPlayerId() === viewer.id && this.phase === PHASES.REVEAL,
        }
        : null,
      peeked,
      catastrophe: this.catastrophe,
      bunker: this.bunker,
      voting: {
        open: this.phase === PHASES.VOTING || this.phase === PHASES.REVOTE,
        stage: this.voteStage,
        candidates: this.voteCandidates,
        canSkip: this.round === 1,
        votedCount: this.voters().filter((p) => p.hasVoted).length,
        voterCount: this.voters().length,
        tally: this.phase === PHASES.SUMMARY || this.phase === PHASES.FINALE || this.phase === PHASES.ENDED ? this.lastTally : null,
      },
      turn: {
        currentId: this.currentTurnPlayerId(),
        index: this.turnIndex,
        total: this.order.length,
        order: this.order.slice(),
        speakingId: this.players.find((p) => this._isSpeaking(p.id)) ? this.players.find((p) => this._isSpeaking(p.id)).id : null,
        defenseCandidateId: this.phase === PHASES.DEFENSE ? this.voteCandidates[this.turnIndex] || null : null,
      },
      timer: { phase: this.phase, duration: this.phaseDuration, remaining, deadline: this.deadline },
      canAdvance: isHost,
      settings: this.settings,
      log: this.log.slice(-60),
      finale: this.finaleReport,
      history: this.history.slice(),
      pendingExile: this.pendingExile.map((id) => {
        const p = this.getPlayer(id);
        return { id, nickname: p ? p.nickname : id };
      }),
    };
  }
}

/** «5 лет» → 60 месяцев, «18 месяцев» → 18, «3 года» → 36. */
function parseDurationMonths(text) {
  const s = String(text || '').toLowerCase();
  const num = parseFloat((s.match(/(\d+([.,]\d+)?)/) || [])[1] || '1');
  const value = Number.isFinite(num) ? num : 1;
  if (s.includes('месяц')) return Math.max(1, Math.round(value));
  if (s.includes('недел')) return Math.max(1, Math.round(value / 4));
  if (s.includes('дн')) return Math.max(1, Math.round(value / 30));
  if (s.includes('год') || s.includes('лет')) return Math.max(1, Math.round(value * 12));
  return Math.max(1, Math.round(value * 12));
}

module.exports = { GameState, GameError, PHASES, parseDurationMonths };
