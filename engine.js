"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // server/game/constants.js
  var require_constants = __commonJS({
    "server/game/constants.js"(exports, module) {
      "use strict";
      var CHARACTER_CATEGORIES = [
        "profession",
        "biology",
        "body",
        "trait",
        "health",
        "hobby",
        "phobia",
        "luggage",
        "backpack",
        "fact",
        "special"
      ];
      var CATEGORY_TOTAL = CHARACTER_CATEGORIES.length;
      var DECK_FILES = [
        "professions",
        "biology",
        "body",
        "traits",
        "health",
        "hobbies",
        "phobias",
        "luggage",
        "backpack",
        "facts",
        "specials",
        "catastrophes",
        "bunker"
      ];
      var PHASES_LIST = [
        "lobby",
        "reveal",
        "discussion",
        "voting",
        "defense",
        "finale"
      ];
      module.exports = {
        CHARACTER_CATEGORIES,
        CATEGORY_TOTAL,
        DECK_FILES,
        PHASES_LIST
      };
    }
  });

  // server/game/rng.js
  var require_rng = __commonJS({
    "server/game/rng.js"(exports, module) {
      "use strict";
      function createRng(seed) {
        let a = seed >>> 0;
        const rng = function next() {
          a |= 0;
          a = a + 1831565813 | 0;
          let t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
        rng.int = (min, max) => min + Math.floor(rng() * (max - min + 1));
        rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
        rng.chance = (p) => rng() < p;
        rng.shuffle = (arr) => {
          const out = arr.slice();
          for (let i = out.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
          }
          return out;
        };
        rng.sample = (arr, n) => rng.shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length)));
        return rng;
      }
      function randomSeed() {
        return Math.floor(Math.random() * 4294967295) >>> 0;
      }
      module.exports = { createRng, randomSeed };
    }
  });

  // server/game/decks.js
  var require_decks = __commonJS({
    "server/game/decks.js"(exports, module) {
      "use strict";
      var { CHARACTER_CATEGORIES, DECK_FILES } = require_constants();
      var cache = /* @__PURE__ */ new Map();
      var nodeFs = null;
      function fileSystem() {
        if (!nodeFs) {
          nodeFs = { fs: __require("fs"), path: __require("path") };
        }
        return nodeFs;
      }
      function readJson(fileName) {
        const bundled = globalThis.__BUNKER_DECKS__;
        if (bundled) {
          if (!bundled[fileName]) {
            throw new Error(`\u041A\u043E\u043B\u043E\u0434\u0430 ${fileName} \u043D\u0435 \u043F\u043E\u043F\u0430\u043B\u0430 \u0432 \u0441\u0442\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u0441\u0431\u043E\u0440\u043A\u0443`);
          }
          return bundled[fileName];
        }
        const { fs, path } = fileSystem();
        const full = path.join(__dirname, "data", `${fileName}.json`);
        const raw = fs.readFileSync(full, "utf8").replace(/^\uFEFF/, "");
        return JSON.parse(raw);
      }
      function loadDeck(fileName) {
        if (cache.has(fileName)) return cache.get(fileName);
        const deck = readJson(fileName);
        if (!deck || !Array.isArray(deck.cards)) {
          throw new Error(`\u041A\u043E\u043B\u043E\u0434\u0430 ${fileName}.json: \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 "cards"`);
        }
        cache.set(fileName, deck);
        return deck;
      }
      function loadAllDecks() {
        const out = {};
        for (const f of DECK_FILES) out[f] = loadDeck(f);
        return out;
      }
      function loadHelp() {
        if (cache.has("__help")) return cache.get("__help");
        const help = readJson("help");
        cache.set("__help", help);
        return help;
      }
      function categoryMeta() {
        const decks = loadAllDecks();
        const meta = {};
        for (const f of DECK_FILES) {
          const d = decks[f];
          if (!d.category || !CHARACTER_CATEGORIES.includes(d.category)) continue;
          meta[d.category] = {
            category: d.category,
            label: d.label,
            icon: d.icon,
            size: d.cards.length,
            deckFile: f
          };
        }
        return meta;
      }
      function findCardById(id) {
        const decks = loadAllDecks();
        for (const f of DECK_FILES) {
          const found = decks[f].cards.find((c) => c.id === id);
          if (found) return { ...found, _deck: f };
        }
        return null;
      }
      function validateDecks() {
        const problems = [];
        const seenTitles = /* @__PURE__ */ new Map();
        const decks = loadAllDecks();
        for (const f of DECK_FILES) {
          const deck = decks[f];
          if (!deck.label || !deck.icon || !deck.category) {
            problems.push(`${f}.json: \u043D\u0435 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u044B category/label/icon`);
          }
          const seenIds = /* @__PURE__ */ new Set();
          for (const card of deck.cards) {
            if (!card.id) problems.push(`${f}.json: \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0431\u0435\u0437 id`);
            if (seenIds.has(card.id)) problems.push(`${f}.json: \u0434\u0443\u0431\u043B\u0438\u043A\u0430\u0442 id ${card.id}`);
            seenIds.add(card.id);
            if (!card.title) problems.push(`${f}.json/${card.id}: \u043D\u0435\u0442 title`);
            if (!card.text) problems.push(`${f}.json/${card.id}: \u043D\u0435\u0442 text`);
            if (!card.tip) problems.push(`${f}.json/${card.id}: \u043D\u0435\u0442 tip`);
            if (!Array.isArray(card.tags) || card.tags.length === 0) {
              problems.push(`${f}.json/${card.id}: \u043D\u0435\u0442 tags`);
            }
            if (seenTitles.has(card.title)) {
              problems.push(`\u0434\u0443\u0431\u043B\u0438\u043A\u0430\u0442 title "${card.title}" (${seenTitles.get(card.title)} \u0438 ${card.id})`);
            } else {
              seenTitles.set(card.title, card.id);
            }
          }
        }
        for (const cat of CHARACTER_CATEGORIES) {
          const meta = Object.values(decks).find((d) => d.category === cat);
          if (!meta) problems.push(`\u043D\u0435\u0442 \u043A\u043E\u043B\u043E\u0434\u044B \u0434\u043B\u044F \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 ${cat}`);
        }
        if (problems.length) {
          throw new Error(`\u0414\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043B\u043E\u0434 \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443:
 - ${problems.join("\n - ")}`);
        }
        return true;
      }
      module.exports = {
        CHARACTER_CATEGORIES,
        DECK_FILES,
        loadDeck,
        loadAllDecks,
        loadHelp,
        categoryMeta,
        findCardById,
        validateDecks
      };
    }
  });

  // server/game/DeckGenerator.js
  var require_DeckGenerator = __commonJS({
    "server/game/DeckGenerator.js"(exports, module) {
      "use strict";
      var { createRng } = require_rng();
      var { loadAllDecks, CHARACTER_CATEGORIES } = require_decks();
      var DeckGenerator = class {
        constructor(seed) {
          this.seed = seed >>> 0;
          this.rng = createRng(this.seed);
          const decks = loadAllDecks();
          this.decks = decks;
          this.pools = {};
          for (const cat of CHARACTER_CATEGORIES) {
            const deck = Object.values(decks).find((d) => d.category === cat);
            if (!deck) throw new Error(`\u041D\u0435\u0442 \u043A\u043E\u043B\u043E\u0434\u044B \u0434\u043B\u044F \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 ${cat}`);
            this.pools[cat] = this.rng.shuffle(deck.cards);
          }
          this.meta = {};
          for (const cat of CHARACTER_CATEGORIES) {
            const deck = Object.values(decks).find((d) => d.category === cat);
            this.meta[cat] = { label: deck.label, icon: deck.icon };
          }
        }
        /** Достаёт карту категории; если колода исчерпана — начинает заново. */
        draw(category) {
          const pool = this.pools[category];
          if (!pool || pool.length === 0) {
            const deck = Object.values(this.decks).find((d) => d.category === category);
            this.pools[category] = this.rng.shuffle(deck.cards);
          }
          return this.pools[category].pop();
        }
        /** Случайная карта конкретной категории (для замены/переброса). */
        drawSpecific(category) {
          return this.draw(category);
        }
        /** Катастрофа партии. */
        generateCatastrophe() {
          const card = this.rng.pick(this.decks.catastrophes.cards);
          return { ...card };
        }
        /**
         * Бункер: 3 карты преимуществ + 2 карты проблем.
         * Итоговые площадь/еда/спальни — сумма всех карт.
         */
        generateBunker() {
          const cards = this.decks.bunker.cards;
          const advantages = this.rng.sample(cards.filter((c) => c.kind === "advantage"), 3);
          const hazards = this.rng.sample(cards.filter((c) => c.kind === "hazard"), 2);
          const all = [...advantages, ...hazards];
          const sum = (key) => all.reduce((acc, c) => acc + (Number(c[key]) || 0), 0);
          return {
            cards: all.map((c) => ({ ...c })),
            advantages: advantages.map((c) => c.id),
            hazards: hazards.map((c) => c.id),
            area_sqm: sum("area_sqm"),
            food_units: sum("food_units"),
            sleeping_rooms: sum("sleeping_rooms"),
            items: all.flatMap((c) => c.items || [])
          };
        }
        /** Персонаж: по одной карте в каждой из 11 категорий. */
        generateCharacter() {
          const cards = {};
          for (const cat of CHARACTER_CATEGORIES) cards[cat] = this.draw(cat).id;
          return cards;
        }
        /** Полная раздача для N игроков. */
        generateGame(playerCount) {
          return {
            catastrophe: this.generateCatastrophe(),
            bunker: this.generateBunker(),
            characters: Array.from({ length: playerCount }, () => this.generateCharacter())
          };
        }
      };
      module.exports = { DeckGenerator };
    }
  });

  // server/game/rules.js
  var require_rules = __commonJS({
    "server/game/rules.js"(exports, module) {
      "use strict";
      var { CATEGORY_TOTAL } = require_constants();
      var SEATS_MODE = {
        AUTO: "auto",
        // половина игроков с округлением вниз — официальное правило
        FIXED: "fixed"
        // фиксированное число, заданное хостом
      };
      var EXILE_THRESHOLD = 0.7;
      function revealCountForRound(playerCount, roundIndex) {
        if (roundIndex < 0) return 0;
        if (playerCount <= 6) {
          const plan = [3, 3, 2];
          return roundIndex < plan.length ? plan[roundIndex] : 0;
        }
        if (playerCount <= 8) return [3, 2, 2][roundIndex] ?? 1;
        if (playerCount <= 10) return [3, 2, 1][roundIndex] ?? 1;
        if (playerCount <= 12) return [2, 2, 1][roundIndex] ?? 1;
        return [2, 1, 1][roundIndex] ?? 1;
      }
      function bunkerSeats({ mode = SEATS_MODE.AUTO, fixed = null, players }) {
        const n = Math.max(2, Math.floor(Number(players) || 0));
        const upper = Math.max(1, n - 1);
        let seats;
        if (mode === SEATS_MODE.FIXED) {
          seats = Math.floor(Number(fixed) || 0);
        } else {
          seats = Math.floor(n / 2);
        }
        return Math.min(upper, Math.max(1, seats));
      }
      function exilesNeeded(players, seats) {
        return Math.max(0, players - seats);
      }
      function seatsLabel({ mode, fixed, players }) {
        const seats = bunkerSeats({ mode, fixed, players });
        const hint = mode === SEATS_MODE.FIXED ? "\u0437\u0430\u0434\u0430\u043D\u043E \u0445\u043E\u0441\u0442\u043E\u043C" : `\u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043E\u0442 ${players} \u0441 \u043E\u043A\u0440\u0443\u0433\u043B\u0435\u043D\u0438\u0435\u043C \u0432\u043D\u0438\u0437`;
        return { seats, hint };
      }
      function tallyVotes(ballots, activeIds, weights = null) {
        const counts = {};
        let skipVotes = 0;
        let totalVotes = 0;
        for (const voterId of activeIds) {
          const weight = Math.max(1, Math.floor(Number(weights && weights[voterId]) || 1));
          const raw = ballots[voterId];
          if (raw === "skip") {
            skipVotes += weight;
            totalVotes += weight;
            continue;
          }
          const target = raw && activeIds.includes(raw) ? raw : voterId;
          counts[target] = (counts[target] || 0) + weight;
          totalVotes += weight;
        }
        let max = 0;
        for (const id of Object.keys(counts)) max = Math.max(max, counts[id]);
        const top = Object.keys(counts).filter((id) => counts[id] === max && max > 0);
        return { counts, totalVotes, skipVotes, max, top };
      }
      function passesThreshold(tally) {
        if (!tally.totalVotes) return false;
        return tally.max / tally.totalVotes >= EXILE_THRESHOLD;
      }
      function resolvePrimaryVote(tally, { roundNumber, activeCount }) {
        const majoritySkip = tally.skipVotes * 2 > activeCount;
        if (majoritySkip && roundNumber === 1) {
          return { action: "skip", targets: [] };
        }
        if (tally.top.length === 1 && passesThreshold(tally)) {
          return { action: "exile", targets: tally.top };
        }
        return { action: "defense", targets: tally.top };
      }
      function resolveRevote(tally, { roundNumber }) {
        if (tally.top.length === 0) return { action: "no_exile", targets: [] };
        if (tally.top.length === 1) return { action: "exile", targets: tally.top };
        if (roundNumber === 1) return { action: "no_exile", targets: [] };
        return { action: "exile", targets: tally.top };
      }
      var DEFAULT_TIMERS = {
        speak: 60,
        // представление персонажа
        discussion: 60,
        // коллективное обсуждение
        accusation: 30,
        // обвинение/оправдание перед голосованием
        voting: 15,
        // окно голосования
        defense: 30,
        // оправдательная речь после голосования
        farewell: 15
        // прощальная речь изгнанного
      };
      function defaultSettings() {
        return {
          seatsMode: SEATS_MODE.AUTO,
          seatsFixed: 3,
          maxRounds: 7,
          timers: { ...DEFAULT_TIMERS },
          autoAdvance: true,
          // автоматически переходить по таймеру
          exilesKeepVoting: false,
          // изгнанные сохраняют право голоса
          enableSpecials: true
        };
      }
      function clampInt(value, min, max, fallback) {
        const n = Math.floor(Number(value));
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
      }
      function applySettingsPatch(settings, patch, { maxPlayers = 16 } = {}) {
        const s = settings;
        if (patch.seatsMode && Object.values(SEATS_MODE).includes(patch.seatsMode)) s.seatsMode = patch.seatsMode;
        if (patch.seatsFixed != null) s.seatsFixed = clampInt(patch.seatsFixed, 1, maxPlayers - 1, s.seatsFixed);
        if (patch.maxRounds != null) s.maxRounds = clampInt(patch.maxRounds, 1, 12, s.maxRounds);
        if (patch.autoAdvance != null) s.autoAdvance = !!patch.autoAdvance;
        if (patch.exilesKeepVoting != null) s.exilesKeepVoting = !!patch.exilesKeepVoting;
        if (patch.enableSpecials != null) s.enableSpecials = !!patch.enableSpecials;
        if (patch.timers && typeof patch.timers === "object") {
          for (const key of Object.keys(s.timers)) {
            const v = Number(patch.timers[key]);
            if (Number.isFinite(v)) s.timers[key] = clampInt(v, 5, 300, s.timers[key]);
          }
        }
        return s;
      }
      module.exports = {
        CATEGORY_TOTAL,
        SEATS_MODE,
        EXILE_THRESHOLD,
        DEFAULT_TIMERS,
        revealCountForRound,
        bunkerSeats,
        exilesNeeded,
        seatsLabel,
        tallyVotes,
        passesThreshold,
        resolvePrimaryVote,
        resolveRevote,
        defaultSettings,
        applySettingsPatch,
        clampInt
      };
    }
  });

  // server/game/GameState.js
  var require_GameState = __commonJS({
    "server/game/GameState.js"(exports, module) {
      "use strict";
      var { CHARACTER_CATEGORIES } = require_constants();
      var { DeckGenerator } = require_DeckGenerator();
      var { findCardById } = require_decks();
      var {
        SEATS_MODE,
        bunkerSeats,
        exilesNeeded,
        seatsLabel,
        revealCountForRound,
        tallyVotes,
        resolvePrimaryVote,
        resolveRevote,
        defaultSettings,
        CATEGORY_TOTAL
      } = require_rules();
      var PHASES = {
        LOBBY: "lobby",
        INTRO: "intro",
        REVEAL: "reveal",
        DISCUSSION: "discussion",
        ACCUSATION: "accusation",
        VOTING: "voting",
        DEFENSE: "defense",
        REVOTE: "revote",
        FAREWELL: "farewell",
        SUMMARY: "summary",
        FINALE: "finale",
        ENDED: "ended"
      };
      var PHASE_TIMER = {
        [PHASES.REVEAL]: "speak",
        [PHASES.DISCUSSION]: "discussion",
        [PHASES.ACCUSATION]: "accusation",
        [PHASES.VOTING]: "voting",
        [PHASES.DEFENSE]: "defense",
        [PHASES.REVOTE]: "voting",
        [PHASES.FAREWELL]: "farewell"
      };
      var GameError = class extends Error {
        constructor(message) {
          super(message);
          this.name = "GameError";
          this.userFacing = true;
        }
      };
      var GameState = class {
        constructor({ roomCode, settings, seed, players }) {
          this.roomCode = roomCode;
          this.settings = { ...defaultSettings(), ...settings || {} };
          this.settings.timers = { ...defaultSettings().timers, ...settings && settings.timers || {} };
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
          this.defendedThisRound = /* @__PURE__ */ new Set();
          this.lastTally = null;
          this.lastOutcome = null;
          this.catastrophe = null;
          this.bunker = null;
          this.seatCount = this.seatInfo().seats;
          this.pendingExile = [];
          this.finaleReport = null;
          this.startedAt = null;
        }
        /** Добавляет участника до старта партии. Нужно ботам и локальному режиму. */
        addPlayer({ id, nickname, isHost = false, isBot = false }) {
          if (this.phase !== PHASES.LOBBY) throw new GameError("\u0421\u043E\u0441\u0442\u0430\u0432 \u043D\u0430\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043E \u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u0430\u0440\u0442\u0438\u0438");
          const player = this._blankPlayer({ id, nickname, isHost, isBot, connected: true });
          this.players.push(player);
          this.seatCount = this.seatInfo().seats;
          return player;
        }
        /** Убирает бота из лобби. */
        removeBotById(id) {
          if (this.phase !== PHASES.LOBBY) throw new GameError("\u0421\u043E\u0441\u0442\u0430\u0432 \u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043E \u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u0430\u0440\u0442\u0438\u0438");
          const idx = this.players.findIndex((p) => p.id === id && p.isBot);
          if (idx === -1) throw new GameError("\u0422\u0430\u043A\u043E\u0433\u043E \u0431\u043E\u0442\u0430 \u043D\u0435\u0442 \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0435");
          const [removed] = this.players.splice(idx, 1);
          this.seatCount = this.seatInfo().seats;
          return removed;
        }
        _blankPlayer(p) {
          return {
            id: p.id,
            nickname: p.nickname,
            isHost: !!p.isHost,
            isBot: !!p.isBot,
            connected: p.connected !== false,
            exiled: false,
            cards: null,
            // { category: cardId }
            revealed: [],
            // раскрытые категории
            notes: "",
            hasVoted: false,
            voteTarget: null,
            specialsUsed: [],
            immune: false,
            voteWeight: 1,
            silent: false,
            peeked: [],
            // id игроков, чьи карты этот игрок подсмотрел
            extraReveals: 0,
            joinedAt: p.joinedAt || Date.now()
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
            players: n
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
        _log(text, kind = "info") {
          const entry = { t: Date.now(), text, kind, round: this.round };
          this.log.push(entry);
          if (this.log.length > 200) this.log.shift();
          this.events.push({ type: "log", entry });
          return entry;
        }
        _toast(message, kind = "info") {
          this.events.push({ type: "toast", message, kind });
        }
        _sound(name) {
          this.events.push({ type: "sound", name });
        }
        drainEvents() {
          const out = this.events;
          this.events = [];
          return out;
        }
        // ─────────────────────────────── старт партии ───────────────────────────────
        start() {
          if (this.phase !== PHASES.LOBBY) throw new GameError("\u041F\u0430\u0440\u0442\u0438\u044F \u0443\u0436\u0435 \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C");
          if (this.players.length < 2) throw new GameError("\u041D\u0443\u0436\u043D\u043E \u043C\u0438\u043D\u0438\u043C\u0443\u043C 2 \u0438\u0433\u0440\u043E\u043A\u0430");
          const deck = new DeckGenerator(this.seed);
          const draw = deck.generateGame(this.players.length);
          this.catastrophe = draw.catastrophe;
          this.bunker = draw.bunker;
          this.players.forEach((p, i) => {
            p.cards = draw.characters[i];
            p.revealed = [];
            p.revealedThisRound = 0;
            p.notes = p.notes || "";
          });
          this.seatCount = this.seatInfo().seats;
          this.startedAt = Date.now();
          this.phase = PHASES.INTRO;
          this.deadline = null;
          this._log(
            `\u041A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0430: ${this.catastrophe.title}. \u0411\u0443\u043D\u043A\u0435\u0440 \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D \u043D\u0430 ${this.seatCount} \u043C\u0435\u0441\u0442(\u0430) \u0438\u0437 ${this.players.length} \u0432\u044B\u0436\u0438\u0432\u0448\u0438\u0445.`,
            "story"
          );
          this._sound("start");
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
          this.defendedThisRound = /* @__PURE__ */ new Set();
          for (const p of this.players) {
            p.hasVoted = false;
            p.voteTarget = null;
            p.immune = false;
            p.voteWeight = 1;
            p.extraReveals = 0;
            p.revealedThisRound = 0;
          }
          const base = this.activePlayers().filter((p) => !p.silent);
          this.order = n % 2 === 1 ? base.map((p) => p.id) : base.map((p) => p.id).reverse();
          this.turnIndex = 0;
          this._setPhase(PHASES.REVEAL);
          this._log(`\u0420\u0430\u0443\u043D\u0434 ${n}: \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F ${revealCountForRound(this.players.length, n - 1)} \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A(\u0438) \u043D\u0430 \u0438\u0433\u0440\u043E\u043A\u0430.`);
          this._sound("round");
          return this;
        }
        _setPhase(phase, { duration } = {}) {
          this.phase = phase;
          const timerKey = PHASE_TIMER[phase];
          const seconds = duration != null ? duration : timerKey ? this.settings.timers[timerKey] : 0;
          this.phaseDuration = seconds;
          this.deadline = seconds > 0 ? Date.now() + seconds * 1e3 : null;
          return this;
        }
        /** Хост (или автотаймер) двигает партию дальше. */
        advance(actorId = null) {
          if (actorId) {
            const p = this.getPlayer(actorId);
            if (!p || !p.isHost) throw new GameError("\u0414\u0432\u0438\u0433\u0430\u0442\u044C \u043F\u0430\u0440\u0442\u0438\u044E \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439");
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
              return this._resolveVote("primary");
            case PHASES.DEFENSE:
              return this._nextDefense();
            case PHASES.REVOTE:
              return this._resolveVote("revote");
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
          if (this.phase !== PHASES.REVEAL) throw new GameError("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435 \u0444\u0430\u0437\u0430 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0438\u044F");
          const player = this.getPlayer(playerId);
          if (!player) throw new GameError("\u0418\u0433\u0440\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
          if (player.exiled) throw new GameError("\u0418\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438");
          if (this.currentTurnPlayerId() !== playerId) {
            throw new GameError("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435 \u0432\u0430\u0448 \u0445\u043E\u0434 \u2014 \u0434\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u0441\u0432\u043E\u0435\u0439 \u043E\u0447\u0435\u0440\u0435\u0434\u0438");
          }
          if (!CHARACTER_CATEGORIES.includes(category)) throw new GameError("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F");
          if (player.revealed.includes(category)) throw new GameError("\u042D\u0442\u0430 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0430 \u0443\u0436\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430");
          if (this.round === 1 && !player.revealed.includes("profession") && category !== "profession") {
            throw new GameError("\u0412 \u043F\u0435\u0440\u0432\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u044F");
          }
          if (this.revealsLeftFor(player) <= 0) throw new GameError("\u0412 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u0432\u044B \u0443\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u043B\u0438 \u0432\u0441\u0435 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0435 \u043A\u0430\u0440\u0442\u044B");
          player.revealed.push(category);
          player.revealedThisRound = (player.revealedThisRound || 0) + 1;
          const card = findCardById(player.cards[category]);
          this._log(`${player.nickname} \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442: ${card ? card.title : category}`);
          this._sound("reveal");
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
          const current = this.getPlayer(this.currentTurnPlayerId());
          if (current && this.revealsLeftFor(current) > 0) {
            const hidden = CHARACTER_CATEGORIES.filter(
              (c) => !current.revealed.includes(c) && !(this.round === 1 && !current.revealed.includes("profession") && c !== "profession")
            );
            while (this.revealsLeftFor(current) > 0 && hidden.length) {
              const pick = hidden.splice(Math.floor(Math.random() * hidden.length), 1)[0];
              this._forceReveal(current, pick);
            }
            this._log(`${current.nickname} \u043D\u0435 \u0443\u0441\u043F\u0435\u043B \u2014 \u043A\u0430\u0440\u0442\u044B \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.`, "warn");
          }
          return this._nextTurn();
        }
        _nextTurn() {
          this.turnIndex += 1;
          if (this.turnIndex >= this.order.length) return this._startDiscussion();
          this._setPhase(PHASES.REVEAL);
          const next = this.getPlayer(this.currentTurnPlayerId());
          if (next) this._log(`\u0425\u043E\u0434: ${next.nickname}`, "turn");
          return this;
        }
        _startDiscussion() {
          this._setPhase(PHASES.DISCUSSION);
          this._log("\u041A\u043E\u043B\u043B\u0435\u043A\u0442\u0438\u0432\u043D\u043E\u0435 \u043E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435: \u0443\u0441\u043F\u0435\u0439\u0442\u0435 \u0437\u0430\u0434\u0430\u0442\u044C \u0432\u043E\u043F\u0440\u043E\u0441\u044B.", "phase");
          return this;
        }
        _startAccusations() {
          this.turnIndex = 0;
          this._setPhase(PHASES.ACCUSATION);
          const first = this.getPlayer(this.currentTurnPlayerId());
          this._log(`\u041E\u0431\u0432\u0438\u043D\u0435\u043D\u0438\u044F \u0438 \u043E\u043F\u0440\u0430\u0432\u0434\u0430\u043D\u0438\u044F. \u0421\u043B\u043E\u0432\u043E: ${first ? first.nickname : "\u2014"}`, "phase");
          return this;
        }
        _nextAccusation() {
          this.turnIndex += 1;
          if (this.turnIndex >= this.order.length) return this._openVoting(PHASES.VOTING, "primary");
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
            stage === "primary" ? `\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435: \u0443 \u0432\u0430\u0441 ${this.settings.timers.voting} \u0441\u0435\u043A\u0443\u043D\u0434. \u041A\u0442\u043E \u043F\u043E\u043A\u0438\u043D\u0435\u0442 \u043B\u0430\u0433\u0435\u0440\u044C?` : "\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u043E\u0441\u043B\u0435 \u043E\u043F\u0440\u0430\u0432\u0434\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0440\u0435\u0447\u0435\u0439.",
            "phase"
          );
          this._sound("vote");
          return this;
        }
        castVote(voterId, targetId) {
          if (this.phase !== PHASES.VOTING && this.phase !== PHASES.REVOTE) {
            throw new GameError("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435 \u0432\u0440\u0435\u043C\u044F \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C");
          }
          const voter = this.getPlayer(voterId);
          if (!voter) throw new GameError("\u0418\u0433\u0440\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
          if (!this.voters().some((p) => p.id === voterId)) {
            throw new GameError("\u0412\u044B \u043D\u0435 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u0442\u0435 \u0432 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438");
          }
          if (targetId !== "skip") {
            const target = this.getPlayer(targetId);
            if (!target || target.exiled) throw new GameError("\u041D\u0435\u043B\u044C\u0437\u044F \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u044D\u0442\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430");
            if (targetId === voterId) throw new GameError("\u041D\u0435\u043B\u044C\u0437\u044F \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F");
            if (this.voteStage === "revote" && !this.voteCandidates.includes(targetId)) {
              throw new GameError("\u0412 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u044E\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u044B \u043D\u0430 \u0432\u044B\u043B\u0435\u0442");
            }
          }
          this.votes[voterId] = targetId;
          voter.hasVoted = true;
          voter.voteTarget = targetId === "skip" ? "skip" : null;
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
          for (const p of this.players) {
            if (p.immune && tally.counts[p.id]) {
              delete tally.counts[p.id];
              this._log(`${p.nickname} \u0437\u0430\u0449\u0438\u0449\u0451\u043D \u0441\u043F\u0435\u0446. \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C\u044E \u2014 \u0433\u043E\u043B\u043E\u0441\u0430 \u043F\u0440\u043E\u0442\u0438\u0432 \u043D\u0435\u0433\u043E \u043D\u0435 \u0441\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F.`, "warn");
            }
          }
          const recount = Object.keys(tally.counts).filter((id) => tally.counts[id] > 0);
          let max = 0;
          for (const id of recount) max = Math.max(max, tally.counts[id]);
          tally.max = max;
          tally.top = recount.filter((id) => tally.counts[id] === max && max > 0);
          this.lastTally = tally;
          const outcome = stage === "primary" ? resolvePrimaryVote(tally, { roundNumber: this.round, activeCount: this.voters().length }) : resolveRevote(tally, { roundNumber: this.round });
          this.lastOutcome = { ...outcome, stage };
          this._log(`\u0413\u043E\u043B\u043E\u0441\u0430: ${this._tallyText(tally)}`);
          if (outcome.action === "skip") {
            this._log("\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E: \u0431\u043E\u043B\u044C\u0448\u0438\u043D\u0441\u0442\u0432\u043E \u0440\u0435\u0448\u0438\u043B\u043E \u043D\u0435 \u0438\u0441\u043A\u043B\u044E\u0447\u0430\u0442\u044C \u043D\u0438\u043A\u043E\u0433\u043E.", "warn");
            this._toast("\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E", "info");
            this.phase = PHASES.SUMMARY;
            this.deadline = null;
            return this;
          }
          if (outcome.action === "no_exile") {
            this._log("\u041A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u044B \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u0438 \u0440\u0430\u0432\u043D\u043E\u0435 \u0447\u0438\u0441\u043B\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432 \u2014 \u0440\u0430\u0443\u043D\u0434 \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0431\u0435\u0437 \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F.", "warn");
            this.phase = PHASES.SUMMARY;
            this.deadline = null;
            return this;
          }
          if (outcome.action === "exile") {
            this.pendingExile = this._clampExiles(outcome.targets);
            if (this.pendingExile.length === 0) {
              this._log("\u0418\u0437\u0433\u043E\u043D\u044F\u0442\u044C \u043D\u0435\u043A\u043E\u0433\u043E: \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u043C\u0435\u0441\u0442 \u0443\u0436\u0435 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C.", "warn");
              this.phase = PHASES.SUMMARY;
              this.deadline = null;
              return this;
            }
            return this._startFarewell();
          }
          this.voteCandidates = outcome.targets.filter((id) => !this.defendedThisRound.has(id));
          if (this.voteCandidates.length === 0) {
            return this._openVoting(PHASES.REVOTE, "revote");
          }
          this.turnIndex = 0;
          return this._startDefense();
        }
        _tallyText(tally) {
          const parts = Object.keys(tally.counts).sort((a, b) => tally.counts[b] - tally.counts[a]).map((id) => {
            const p = this.getPlayer(id);
            return `${p ? p.nickname : id} \u2014 ${tally.counts[id]}`;
          });
          if (tally.skipVotes) parts.push(`\u0432\u043E\u0437\u0434\u0435\u0440\u0436\u0430\u043B\u0438\u0441\u044C \u2014 ${tally.skipVotes}`);
          return parts.join(", ") || "\u043D\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432";
        }
        _startDefense() {
          this._setPhase(PHASES.DEFENSE);
          const cand = this.getPlayer(this.voteCandidates[this.turnIndex]);
          this._log(`\u041E\u043F\u0440\u0430\u0432\u0434\u0430\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0440\u0435\u0447\u044C: ${cand ? cand.nickname : "\u2014"} (${this.settings.timers.defense} \u0441\u0435\u043A\u0443\u043D\u0434)`, "phase");
          return this;
        }
        _nextDefense() {
          const currentId = this.voteCandidates[this.turnIndex];
          if (currentId) this.defendedThisRound.add(currentId);
          this.turnIndex += 1;
          if (this.turnIndex >= this.voteCandidates.length) {
            return this._openVoting(PHASES.REVOTE, "revote");
          }
          return this._startDefense();
        }
        // ─────────────────────────────── изгнание ───────────────────────────────
        _startFarewell() {
          this._setPhase(PHASES.FAREWELL);
          const names = this.pendingExile.map((id) => (this.getPlayer(id) || {}).nickname).join(", ");
          this._log(`\u041F\u0440\u043E\u0449\u0430\u043B\u044C\u043D\u0430\u044F \u0440\u0435\u0447\u044C: ${names} (${this.settings.timers.farewell} \u0441\u0435\u043A\u0443\u043D\u0434)`, "phase");
          this._sound("exile");
          return this;
        }
        _applyExile() {
          for (const id of this.pendingExile) {
            const p = this.getPlayer(id);
            if (!p || p.exiled) continue;
            p.exiled = true;
            p.exiledRound = this.round;
            this.history.push({ round: this.round, exiled: id, nickname: p.nickname });
            this._log(`${p.nickname} \u043F\u043E\u043A\u0438\u0434\u0430\u0435\u0442 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0439 \u043B\u0430\u0433\u0435\u0440\u044C.`, "danger");
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
            this._log("\u041C\u0435\u0441\u0442\u0430 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u044B. \u0414\u0432\u0435\u0440\u0438 \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u044E\u0442\u0441\u044F.", "story");
            this._sound("finale");
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
          const names = result.map((id) => (this.getPlayer(id) || {}).nickname).join(", ");
          this._log(`\u0413\u043E\u043B\u043E\u0441\u0430 \u0440\u0430\u0437\u0434\u0435\u043B\u0438\u043B\u0438\u0441\u044C, \u0430 \u043C\u0435\u0441\u0442 \u043C\u0435\u043D\u044C\u0448\u0435: \u0436\u0440\u0435\u0431\u0438\u0439 \u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442 \u0441\u043D\u0430\u0440\u0443\u0436\u0438 ${names}.`, "warn");
          this._toast("\u0420\u0430\u0432\u0435\u043D\u0441\u0442\u0432\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432 \u2014 \u0441\u0443\u0434\u044C\u0431\u0443 \u0440\u0435\u0448\u0438\u043B \u0436\u0440\u0435\u0431\u0438\u0439", "warn");
          return result;
        }
        _afterSummary() {
          if (this._checkFinish()) return this;
          const remaining = this.activePlayers().length - this.seatCount;
          if (remaining <= 0) return this._checkFinish();
          if (this.round >= this.maxRounds) {
            const active = this.activePlayers().slice();
            for (let i = active.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [active[i], active[j]] = [active[j], active[i]];
            }
            const excess = active.slice(0, remaining);
            this._log(
              `\u041B\u0438\u043C\u0438\u0442 \u0440\u0430\u0443\u043D\u0434\u043E\u0432 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D: \u043B\u0430\u0433\u0435\u0440\u044C \u043F\u043E\u043A\u0438\u0434\u0430\u044E\u0442 ${excess.length} \u0438\u0433\u0440\u043E\u043A(\u043E\u0432) \u043F\u043E \u0436\u0440\u0435\u0431\u0438\u044E.`,
              "warn"
            );
            this.pendingExile = excess.map((p) => p.id);
            return this._applyExile();
          }
          return this.beginRound(this.round + 1);
        }
        // ─────────────────────────────── спец. возможности ───────────────────────────────
        useSpecial(playerId, targetId = null) {
          if (!this.settings.enableSpecials) throw new GameError("\u0421\u043F\u0435\u0446. \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u0438 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u044B \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445");
          const player = this.getPlayer(playerId);
          if (!player) throw new GameError("\u0418\u0433\u0440\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
          if (player.exiled) throw new GameError("\u0418\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u0438");
          if (player.specialsUsed.includes("special")) throw new GameError("\u0421\u043F\u0435\u0446. \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0430");
          if (!player.revealed.includes("special")) throw new GameError("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0440\u0430\u0441\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0432\u043E\u044E \u0441\u043F\u0435\u0446. \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C");
          const card = findCardById(player.cards.special);
          if (!card) throw new GameError("\u041A\u0430\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430");
          const effect = card.effect;
          const target = targetId ? this.getPlayer(targetId) : null;
          if (card.targeting === "one_player" && !target) throw new GameError("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0433\u0440\u043E\u043A\u0430");
          if (target && target.exiled) throw new GameError("\u041D\u0435\u043B\u044C\u0437\u044F \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430");
          switch (effect) {
            case "immune_vote":
              player.immune = true;
              this._log(`${player.nickname} \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442 \xAB${card.title}\xBB: \u0433\u043E\u043B\u043E\u0441\u0430 \u043F\u0440\u043E\u0442\u0438\u0432 \u043D\u0435\u0433\u043E \u043D\u0435 \u0441\u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442.`, "warn");
              break;
            case "double_vote":
              player.voteWeight = 2;
              this._log(`${player.nickname} \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442 \xAB${card.title}\xBB: \u0435\u0433\u043E \u0433\u043E\u043B\u043E\u0441 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0437\u0430 \u0434\u0432\u0430.`, "warn");
              break;
            case "reveal_other": {
              const hidden = CHARACTER_CATEGORIES.filter((c) => !target.revealed.includes(c));
              if (hidden.length) {
                const cat = hidden[Math.floor(Math.random() * hidden.length)];
                const revealed = this._forceReveal(target, cat);
                this._log(`${player.nickname} \u0432\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u043A\u0430\u0440\u0442\u0443 ${target.nickname}: ${revealed ? revealed.title : cat}`, "warn");
              }
              break;
            }
            case "peek_other":
              if (!player.peeked.includes(target.id)) player.peeked.push(target.id);
              this._log(`${player.nickname} \u0442\u0430\u0439\u043D\u043E \u0438\u0437\u0443\u0447\u0430\u0435\u0442 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438 ${target.nickname}.`, "warn");
              break;
            case "heal_self": {
              const deck = new DeckGenerator(this.seed + this.round);
              player.cards.health = deck.drawSpecific("health").id;
              this._log(`${player.nickname} \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442 \xAB${card.title}\xBB: \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u0437\u0430\u043C\u0435\u043D\u0435\u043D\u043E.`, "warn");
              break;
            }
            case "swap_card": {
              const mine = CHARACTER_CATEGORIES.filter((c) => c !== "special" && !player.revealed.includes(c));
              const theirs = CHARACTER_CATEGORIES.filter((c) => c !== "special" && !target.revealed.includes(c));
              if (mine.length && theirs.length) {
                const a = mine[Math.floor(Math.random() * mine.length)];
                const b = theirs[Math.floor(Math.random() * theirs.length)];
                const tmp = player.cards[a];
                player.cards[a] = target.cards[b];
                target.cards[b] = tmp;
                this._log(`${player.nickname} \u043E\u0431\u043C\u0435\u043D\u044F\u043B\u0441\u044F \u0437\u0430\u043A\u0440\u044B\u0442\u043E\u0439 \u043A\u0430\u0440\u0442\u043E\u0439 \u0441 ${target.nickname}.`, "warn");
              }
              break;
            }
            case "cancel_vote":
              this._log(`${player.nickname} \u043E\u0442\u043C\u0435\u043D\u044F\u0435\u0442 \u0442\u0435\u043A\u0443\u0449\u0435\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435!`, "danger");
              this.votes = {};
              this.pendingExile = [];
              this.phase = PHASES.SUMMARY;
              this.deadline = null;
              break;
            case "extra_time":
              if (this.deadline) this.deadline += 3e4;
              this._log(`${player.nickname} \u0432\u044B\u0442\u043E\u0440\u0433\u043E\u0432\u044B\u0432\u0430\u0435\u0442 \u0435\u0449\u0451 30 \u0441\u0435\u043A\u0443\u043D\u0434.`, "warn");
              break;
            case "silence_player":
              target.silent = true;
              this._log(`${target.nickname} \u043B\u0438\u0448\u0430\u0435\u0442\u0441\u044F \u043F\u0440\u0430\u0432\u0430 \u0441\u043B\u043E\u0432\u0430 \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u0440\u0430\u0443\u043D\u0434\u0430.`, "danger");
              break;
            case "boost_self":
              player.extraReveals += 1;
              this._log(`${player.nickname} \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u043F\u0440\u0430\u0432\u043E \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044C \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443.`, "warn");
              break;
            case "reroll_card": {
              const deck = new DeckGenerator(this.seed + this.round + 7);
              const hidden = CHARACTER_CATEGORIES.filter((c) => c !== "special" && !player.revealed.includes(c));
              if (hidden.length) {
                const cat = hidden[Math.floor(Math.random() * hidden.length)];
                player.cards[cat] = deck.drawSpecific(cat).id;
                this._log(`${player.nickname} \u043F\u0435\u0440\u0435\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u0442 \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443.`, "warn");
              }
              break;
            }
            case "return_player": {
              const exiled = this.players.filter((p) => p.exiled);
              if (!exiled.length) throw new GameError("\u0412 \u043B\u0430\u0433\u0435\u0440\u0435 \u043D\u0435\u0442 \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0445 \u0438\u0433\u0440\u043E\u043A\u043E\u0432");
              const back = target && target.exiled ? target : exiled[exiled.length - 1];
              back.exiled = false;
              this.history.push({ round: this.round, returned: back.id, nickname: back.nickname });
              this._log(`${back.nickname} \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442\u0441\u044F \u0432 \u043B\u0430\u0433\u0435\u0440\u044C!`, "ok");
              break;
            }
            default:
              throw new GameError("\u042D\u0442\u0430 \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F");
          }
          player.specialsUsed.push("special");
          this._sound("special");
          return this;
        }
        // ─────────────────────────────── финал ───────────────────────────────
        buildFinaleReport() {
          const survivors = this.activePlayers();
          const months = parseDurationMonths(this.catastrophe ? this.catastrophe.duration : "1 \u0433\u043E\u0434");
          const foodMonths = Number(this.bunker ? this.bunker.food_units : 0);
          const foodRatio = months > 0 ? foodMonths / months : 1;
          const bedCapacity = Number(this.bunker ? this.bunker.sleeping_rooms : 0) * 2;
          const hazards = this.bunker ? this.bunker.hazards.length : 0;
          const advantages = this.bunker ? this.bunker.advantages.length : 0;
          if (survivors.length === 0) {
            return {
              score: 0,
              verdict: {
                key: "fail",
                title: "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043D\u0438\u043A\u043E\u0433\u043E \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C",
                text: "\u041B\u0430\u0433\u0435\u0440\u044C \u0438\u0437\u0433\u043D\u0430\u043B \u0432\u0441\u0435\u0445 \u043F\u043E\u0434\u0440\u044F\u0434 \u2014 \u0434\u0432\u0435\u0440\u0438 \u0437\u0430\u043A\u0440\u044B\u043B\u0438\u0441\u044C \u0432 \u043F\u0443\u0441\u0442\u043E\u0442\u0435. \u0422\u0430\u043A\u043E\u0439 \u0438\u0441\u0445\u043E\u0434 \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442 \u043E\u0448\u0438\u0431\u043A\u0443 \u0432 \u043F\u0440\u0430\u0432\u0438\u043B\u0430\u0445, \u0430 \u043D\u0435 \u043F\u0430\u0440\u0442\u0438\u044E."
              },
              food: { have: foodMonths, need: months, ratio: 0, months },
              beds: { capacity: bedCapacity, people: 0 },
              hazards,
              survivors: [],
              exiled: this.players.filter((p) => p.exiled).map((p) => ({ id: p.id, nickname: p.nickname, round: p.exiledRound })),
              perPlayer: [],
              catastrophe: this.catastrophe,
              bunker: this.bunker
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
          const hasSpecial = survivors.filter((p) => p.revealed.includes("special")).length;
          score += Math.min(6, hasSpecial);
          score = Math.max(0, Math.min(100, Math.round(score)));
          const verdict = score >= 70 ? { key: "survive", title: "\u0412\u044B \u0432\u044B\u0436\u0438\u043B\u0438", text: "\u0417\u0430\u043F\u0430\u0441\u043E\u0432, \u0440\u0435\u043C\u043E\u043D\u0442\u0430 \u0438 \u0433\u043E\u043B\u043E\u0432 \u043D\u0430 \u043F\u043B\u0435\u0447\u0430\u0445 \u0445\u0432\u0430\u0442\u0438\u043B\u043E: \u0431\u0443\u043D\u043A\u0435\u0440 \u043F\u0435\u0440\u0435\u0436\u0438\u0432\u0430\u0435\u0442 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0443." } : score >= 45 ? { key: "struggle", title: "\u0412\u044B \u0432\u044B\u0436\u0438\u043B\u0438, \u043D\u043E \u043D\u0430 \u043F\u0440\u0435\u0434\u0435\u043B\u0435", text: "\u0427\u0430\u0441\u0442\u044C \u0437\u0430\u043F\u0430\u0441\u043E\u0432 \u043F\u0440\u0438\u0434\u0451\u0442\u0441\u044F \u0440\u0430\u0441\u0442\u044F\u043D\u0443\u0442\u044C, \u0430 \u0447\u0430\u0441\u0442\u044C \u2014 \u0434\u043E\u0431\u044B\u0432\u0430\u0442\u044C \u0441\u043D\u0430\u0440\u0443\u0436\u0438. \u041D\u0435 \u0432\u0441\u0435 \u0434\u043E\u0436\u0438\u0432\u0443\u0442 \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u0441\u0440\u043E\u043A\u0430." } : { key: "fail", title: "\u0411\u0443\u043D\u043A\u0435\u0440 \u043D\u0435 \u043F\u0435\u0440\u0435\u0436\u0438\u043B \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0443", text: "\u041D\u0435 \u0445\u0432\u0430\u0442\u0438\u043B\u043E \u0437\u0430\u043F\u0430\u0441\u043E\u0432 \u0438\u043B\u0438 \u043B\u044E\u0434\u0435\u0439 \u0441 \u043D\u0443\u0436\u043D\u044B\u043C\u0438 \u0440\u0443\u043A\u0430\u043C\u0438. \u0413\u0440\u0443\u043F\u043F\u0430 \u043E\u0431\u0440\u0435\u0447\u0435\u043D\u0430." };
          const perPlayer = survivors.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            cards: Object.fromEntries(p.revealed.map((c) => [c, findCardById(p.cards[c])]))
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
            bunker: this.bunker
          };
        }
        _endGame() {
          this.phase = PHASES.ENDED;
          this.deadline = null;
          this._log("\u041F\u0430\u0440\u0442\u0438\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430.", "story");
          return this;
        }
        // ─────────────────────────────── тик таймера ───────────────────────────────
        /** Вызывается раз в секунду. Возвращает true, если состояние изменилось. */
        tick(now = Date.now()) {
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
            return bot && bot.isBot ? this._botDelay(bot, now, 1200, `accuse:${this.round}:${this.turnIndex}`, () => this._nextAccusation()) : false;
          }
          if (this.phase === PHASES.DEFENSE) {
            const bot = this.getPlayer(this.voteCandidates[this.turnIndex]);
            return bot && bot.isBot ? this._botDelay(bot, now, 1600, `defense:${this.round}:${this.turnIndex}`, () => this._nextDefense()) : false;
          }
          if (this.phase === PHASES.FAREWELL) {
            const bot = this.pendingExile.map((id) => this.getPlayer(id)).find((p) => p && p.isBot);
            return bot ? this._botDelay(bot, now, 1300, `farewell:${this.round}:${bot.id}`, () => this._applyExile()) : false;
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
            this._log(`\u0411\u043E\u0442 ${bot.nickname} \u043D\u0435 \u0441\u043C\u043E\u0433 \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u0445\u043E\u0434: ${err.message}`, "warn");
          }
          return true;
        }
        _botRevealTurn(bot, now) {
          return this._botDelay(bot, now, 900, `reveal:${this.round}:${this.turnIndex}`, () => {
            let guard = 0;
            while (this.revealsLeftFor(bot) > 0 && guard < 12) {
              guard += 1;
              const mustProfession = this.round === 1 && !bot.revealed.includes("profession");
              const pool = CHARACTER_CATEGORIES.filter(
                (c) => !bot.revealed.includes(c) && (!mustProfession || c === "profession")
              );
              if (!pool.length) break;
              this.reveal(bot.id, pool[Math.floor(Math.random() * pool.length)]);
            }
            if (this.phase === PHASES.REVEAL && this.currentTurnPlayerId() === bot.id) this._finishTurn();
          });
        }
        _botVote(bot, now) {
          return this._botDelay(bot, now, 1100, `vote:${this.round}:${this.voteStage}:${bot.id}`, () => {
            if (!this.voters().some((p) => p.id === bot.id) || bot.hasVoted) return;
            const pool = this.phase === PHASES.REVOTE && this.voteCandidates.length ? this.voteCandidates : this.activePlayers().map((p) => p.id);
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
            silent: p.silent
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
          const myCards = viewer && viewer.cards ? CHARACTER_CATEGORIES.map((cat) => {
            const card = findCardById(viewer.cards[cat]);
            return {
              category: cat,
              id: card ? card.id : null,
              title: card ? card.title : "\u2014",
              text: card ? card.text : "",
              tip: card ? card.tip : "",
              tags: card ? card.tags : [],
              effect: card ? card.effect : void 0,
              targeting: card ? card.targeting : void 0,
              revealed: viewer.revealed.includes(cat)
            };
          }) : [];
          const peeked = {};
          if (viewer) {
            for (const targetId of viewer.peeked) {
              const target = this.getPlayer(targetId);
              if (!target || !target.cards) continue;
              peeked[targetId] = CHARACTER_CATEGORIES.filter((c) => !target.revealed.includes(c)).map((c) => {
                const card = findCardById(target.cards[c]);
                return { category: c, title: card ? card.title : "\u2014", text: card ? card.text : "" };
              });
            }
          }
          const remaining = this.deadline ? Math.max(0, Math.round((this.deadline - Date.now()) / 1e3)) : 0;
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
            me: viewer ? {
              id: viewer.id,
              nickname: viewer.nickname,
              isHost,
              exiled: viewer.exiled,
              cards: myCards,
              revealedThisRound: viewer.revealedThisRound || 0,
              requiredReveals: this.requiredRevealsFor(viewer),
              revealsLeft: this.revealsLeftFor(viewer),
              notes: viewer.notes,
              specialUsed: viewer.specialsUsed.includes("special"),
              hasSpecial: viewer.revealed.includes("special"),
              hasVoted: viewer.hasVoted,
              voteTarget: viewer.voteTarget,
              immune: viewer.immune,
              voteWeight: viewer.voteWeight,
              canVote: this.voters().some((p) => p.id === viewer.id),
              isTurn: this.currentTurnPlayerId() === viewer.id && this.phase === PHASES.REVEAL
            } : null,
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
              tally: this.phase === PHASES.SUMMARY || this.phase === PHASES.FINALE || this.phase === PHASES.ENDED ? this.lastTally : null
            },
            turn: {
              currentId: this.currentTurnPlayerId(),
              index: this.turnIndex,
              total: this.order.length,
              order: this.order.slice(),
              speakingId: this.players.find((p) => this._isSpeaking(p.id)) ? this.players.find((p) => this._isSpeaking(p.id)).id : null,
              defenseCandidateId: this.phase === PHASES.DEFENSE ? this.voteCandidates[this.turnIndex] || null : null
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
            })
          };
        }
      };
      function parseDurationMonths(text) {
        const s = String(text || "").toLowerCase();
        const num = parseFloat((s.match(/(\d+([.,]\d+)?)/) || [])[1] || "1");
        const value = Number.isFinite(num) ? num : 1;
        if (s.includes("\u043C\u0435\u0441\u044F\u0446")) return Math.max(1, Math.round(value));
        if (s.includes("\u043D\u0435\u0434\u0435\u043B")) return Math.max(1, Math.round(value / 4));
        if (s.includes("\u0434\u043D")) return Math.max(1, Math.round(value / 30));
        if (s.includes("\u0433\u043E\u0434") || s.includes("\u043B\u0435\u0442")) return Math.max(1, Math.round(value * 12));
        return Math.max(1, Math.round(value * 12));
      }
      module.exports = { GameState, GameError, PHASES, parseDurationMonths };
    }
  });

  // static/engine-entry.js
  var require_engine_entry = __commonJS({
    "static/engine-entry.js"() {
      var { GameState, GameError, PHASES, parseDurationMonths } = require_GameState();
      var { loadHelp, categoryMeta, findCardById, loadDeck } = require_decks();
      var rules = require_rules();
      window.BunkerEngine = {
        GameState,
        GameError,
        PHASES,
        parseDurationMonths,
        loadHelp,
        categoryMeta,
        findCardById,
        loadDeck,
        ...rules
      };
    }
  });
  require_engine_entry();
})();
