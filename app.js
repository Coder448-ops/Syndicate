/*
  app.js
  PeerJS-based P2P Syndicate game architecture.
  Uzbek UI text, English code comments.
*/

const SYNC_STATE = "SYNC_STATE";
const CIPHER_PREFIX = "cipher-";
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 15;

const Phase = Object.freeze({
  LOBBY: "LOBBY",
  ROLES_ASSIGNMENT: "ROLES_ASSIGNMENT",
  DAY_CHAT: "DAY_CHAT",
  VOTING: "VOTING",
  NIGHT_ACTIONS: "NIGHT_ACTIONS",
});

const Roles = Object.freeze({
  MAFIA: "Mafia",
  DON: "Don",
  SHERIFF: "Sheriff",
  DOCTOR: "Doctor",
  MANIAC: "Maniac",
  HACKER: "Hacker",
  HITMAN: "Hitman",
  CIVILIAN: "Civilian",
});

const ui = {
  phaseLabel: document.getElementById("phaseLabel"),
  connectionStatus: document.getElementById("connectionStatus"),
  playerList: document.getElementById("playerList"),
  missionGuide: document.getElementById("missionGuide"),
  gameLog: document.getElementById("gameLog"),
  auditLog: document.getElementById("auditLog"),
  chatInput: document.getElementById("chatInput"),
  sendChatButton: document.getElementById("sendChatButton"),
  hostButton: document.getElementById("hostButton"),
  joinButton: document.getElementById("joinButton"),
  startGameButton: document.getElementById("startGameButton"),
  connectId: document.getElementById("connectId"),
  playerName: document.getElementById("playerName"),
  actionControls: document.getElementById("actionControls"),
};

class AuditLogger {
  constructor(element) {
    this.element = element;
  }

  log(message, type = "info") {
    const entry = document.createElement("div");
    entry.className = "audit-entry";
    entry.innerHTML = `<strong>${new Date().toLocaleTimeString()}</strong> — ${message}`;
    if (type === "error") {
      entry.style.borderLeft = "4px solid #ff2f67";
    }
    this.element.prepend(entry);
  }
}

class SecurityManager {
  static generateCipherId() {
    const random = Math.random().toString(36).substring(2, 10);
    return `${CIPHER_PREFIX}${random}`;
  }

  static validateCipherId(id) {
    return typeof id === "string" && /^cipher-[a-z0-9]{6,}$/.test(id);
  }

  static validatePlayerName(name) {
    return typeof name === "string" && name.trim().length >= 2 && name.trim().length <= 16;
  }

  static createHandshakeToken() {
    return Math.random().toString(36).slice(2, 18);
  }
}

class NetworkManager {
  constructor(logger) {
    this.logger = logger;
    this.peer = null;
    this.isHost = false;
    this.localId = null;
    this.peerId = null;
    this.connections = new Map();
    this.hostToken = null;
    this.dataQueue = [];
  }

  initLocalPeer(id) {
    if (!SecurityManager.validateCipherId(id)) {
      throw new Error("Invalid cipher ID format.");
    }

    this.peer = new Peer(id, {
      debug: 2,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
        ],
      },
    });

    this.localId = id;
    this.logger.log(`Peer initialized: ${id}`);

    this.peer.on("open", () => {
      this.logger.log("Peer connection open.");
      this.updateConnectionStatus("Online");
    });

    this.peer.on("error", (error) => {
      this.logger.log(`Peer error: ${error.type || error}`, "error");
      console.error(error);
      alert("Tarmoq xatosi yuz berdi. Konsolni tekshiring.");
    });

    this.peer.on("disconnected", () => {
      this.logger.log("Peer disconnected.", "error");
      this.updateConnectionStatus("Ajratilgan");
    });

    this.peer.on("close", () => {
      this.logger.log("Peer closed.", "error");
      this.updateConnectionStatus("Yopilgan");
    });

    this.peer.on("connection", (conn) => this.handleIncomingConnection(conn));
  }

  updateConnectionStatus(status) {
    ui.connectionStatus.textContent = status;
  }

  handleIncomingConnection(conn) {
    this.logger.log(`Incoming connection request from ${conn.peer}`);
    conn.on("open", () => {
      if (!this.isHost) {
        conn.close();
        this.logger.log("Rejected non-host incoming connection.", "error");
        return;
      }

      if (!SecurityManager.validateCipherId(conn.peer)) {
        conn.close();
        this.logger.log(`Rejected invalid peer id: ${conn.peer}`, "error");
        return;
      }

      this.connections.set(conn.peer, conn);
      this.setupConnectionHandlers(conn);
      this.logger.log(`Connection accepted: ${conn.peer}`);
      this.sendHandshake(conn);
    });

    conn.on("error", (err) => {
      this.logger.log(`Connection error with ${conn.peer}: ${err}`, "error");
    });
  }

  connectToHost(hostId) {
    if (!SecurityManager.validateCipherId(hostId)) {
      throw new Error("Invalid host cipher ID.");
    }

    const conn = this.peer.connect(hostId, { reliable: true });
    this.logger.log(`Connecting to host ${hostId}`);
    this.connections.set(hostId, conn);
    this.setupConnectionHandlers(conn);

    conn.on("open", () => {
      this.logger.log(`Connected to host ${hostId}`);
      this.peerId = hostId;
      this.sendHandshake(conn);
      this.sendJoinRequest(conn);
    });
  }

  setupConnectionHandlers(conn) {
    conn.on("data", (data) => this.handleData(conn, data));
    conn.on("close", () => {
      this.logger.log(`Connection closed: ${conn.peer}`);
      this.connections.delete(conn.peer);
    });
    conn.on("error", (error) => {
      this.logger.log(`Data connection error from ${conn.peer}: ${error}`, "error");
    });
  }

  sendJoinRequest(conn) {
    const localName = ui.playerName.value.trim();
    const payload = {
      type: "PLAYER_JOIN_REQUEST",
      payload: {
        id: this.localId,
        name: localName || "Yangi Agent",
      },
      timestamp: Date.now(),
    };
    conn.send(payload);
    this.logger.log(`Join request sent from ${this.localId} to host.`);
  }

  sendHandshake(conn) {
    const handshake = {
      type: "CIPHER_HANDSHAKE",
      source: this.localId,
      token: SecurityManager.createHandshakeToken(),
      timestamp: Date.now(),
    };

    if (this.isHost) {
      handshake.isHost = true;
      handshake.hostToken = this.hostToken;
    }

    conn.send(handshake);
    this.logger.log(`Handshake sent to ${conn.peer}`);
  }

  handleData(conn, data) {
    if (!data || typeof data !== "object") {
      this.logger.log(`Invalid payload from ${conn.peer}`, "error");
      return;
    }

    if (data.type === "CIPHER_HANDSHAKE") {
      this.logger.log(`Handshake received from ${conn.peer}`);
      if (this.isHost && !data.isHost) {
        this.sendHandshake(conn);
      }
      return;
    }

    if (data.type === SYNC_STATE) {
      this.logger.log(`Sync payload received from ${conn.peer}`);
      this.onSync && this.onSync(data.payload);
      return;
    }

    if (data.type === "PLAYER_JOIN_REQUEST") {
      this.logger.log(`Join request from ${conn.peer}`);
      if (!this.isHost) {
        this.logger.log("Non-host received join request - ignoring.", "error");
        return;
      }
      const incoming = data.payload;
      if (incoming && SecurityManager.validatePlayerName(incoming.name) && SecurityManager.validateCipherId(incoming.id)) {
        this.connections.set(conn.peer, conn);
        this.onPlayerJoin && this.onPlayerJoin(incoming);
        this.sendSync(conn);
      } else {
        this.logger.log(`Invalid join request from ${conn.peer}`, "error");
      }
      return;
    }

    if (data.type === "CHAT_MESSAGE") {
      this.onMessage && this.onMessage(data.payload);
      if (this.isHost) {
        this.broadcast("CHAT_MESSAGE", data.payload);
      }
      return;
    }

    if (data.type === "AUDIT_EVENT") {
      this.logger.log(`Audit event from ${conn.peer}: ${data.payload}`, "info");
      return;
    }

    console.warn("Unknown data type", data);
  }

  sendSync(conn) {
    const packet = { type: SYNC_STATE, payload: this.onSyncRequest ? this.onSyncRequest() : null, timestamp: Date.now() };
    try {
      conn.send(packet);
      this.logger.log(`Sent sync to ${conn.peer}`);
    } catch (error) {
      this.logger.log(`Unable to send sync to ${conn.peer}: ${error}`, "error");
    }
  }

  broadcast(type, payload) {
    const packet = { type, payload, timestamp: Date.now() };
    this.connections.forEach((conn, peerId) => {
      try {
        conn.send(packet);
      } catch (error) {
        this.logger.log(`Failed broadcast to ${peerId}: ${error}`, "error");
      }
    });
  }
}

class GameStateMachine {
  constructor(network, logger) {
    this.network = network;
    this.logger = logger;
    this.phase = Phase.LOBBY;
    this.players = [];
    this.localRole = Roles.CIVILIAN;
    this.secretAssignments = new Map();
    this.voteRecords = new Map();
    this.currentStory = "Lobbiga xush kelibsiz.";
  }

  get playerCount() {
    return this.players.length;
  }

  addPlayer(player) {
    if (this.players.some((p) => p.id === player.id)) {
      return;
    }
    this.players.push(player);
    this.logger.log(`Player added: ${player.name} (${player.id})`);
  }

  removePlayer(playerId) {
    this.players = this.players.filter((p) => p.id !== playerId);
    this.logger.log(`Player removed: ${playerId}`);
  }

  startRoleAssignment() {
    if (this.playerCount < MIN_PLAYERS) {
      throw new Error("Kamida 3 oʻyinchi kerak.");
    }

    this.phase = Phase.ROLES_ASSIGNMENT;
    this.logger.log("Phase switched to ROLES_ASSIGNMENT.");
    this.assignRoles();
    this.publishState();
  }

  assignRoles() {
    const roles = this.buildRolePool(this.playerCount);
    const shuffled = [...this.players].sort(() => Math.random() - 0.5);
    shuffled.forEach((player, index) => {
      const role = roles[index] || Roles.CIVILIAN;
      this.secretAssignments.set(player.id, role);
    });
    this.logger.log("Roles assigned securely.");
  }

  buildRolePool(count) {
    const pool = [];
    if (count >= 3) pool.push(Roles.MAFIA);
    if (count >= 4) pool.push(Roles.DON);
    if (count >= 5) pool.push(Roles.SHERIFF);
    if (count >= 6) pool.push(Roles.DOCTOR);
    if (count >= 8) pool.push(Roles.MANIAC);
    if (count >= 10) pool.push(Roles.HACKER);
    if (count >= 12) pool.push(Roles.HITMAN);
    const remaining = count - pool.length;
    for (let i = 0; i < remaining; i += 1) {
      pool.push(Roles.CIVILIAN);
    }
    return pool;
  }

  updatePhase(nextPhase) {
    this.phase = nextPhase;
    this.logger.log(`Phase updated to ${nextPhase}`);
    this.publishState();
  }

  createSyncPayload() {
    return {
      phase: this.phase,
      players: this.players,
      assignments: [...this.secretAssignments],
      voteRecords: [...this.voteRecords],
      story: this.currentStory,
    };
  }

  publishState() {
    const payload = this.createSyncPayload();
    this.network.broadcast(SYNC_STATE, payload);
    this.onUpdate && this.onUpdate(payload);
  }

  handleHostState(payload) {
    if (!payload) {
      return;
    }
    this.phase = payload.phase;
    this.players = payload.players;
    this.secretAssignments = new Map(payload.assignments);
    this.voteRecords = new Map(payload.voteRecords);
    this.currentStory = payload.story;
    this.logger.log("State synchronized from host.");
    this.onUpdate && this.onUpdate(this.createSyncPayload());
  }

  getLocalRole(playerId) {
    return this.secretAssignments.get(playerId) || Roles.CIVILIAN;
  }
}

class UIManager {
  constructor(game, network, logger) {
    this.game = game;
    this.network = network;
    this.logger = logger;
    this.registerUIEvents();
  }

  registerUIEvents() {
    ui.hostButton.addEventListener("click", () => this.createHost());
    ui.joinButton.addEventListener("click", () => this.joinGame());
    ui.startGameButton.addEventListener("click", () => this.startGame());
    ui.sendChatButton.addEventListener("click", () => this.sendChat());
    ui.chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.sendChat();
      }
    });
  }

  createHost() {
    const name = ui.playerName.value.trim();
    if (!SecurityManager.validatePlayerName(name)) {
      alert("Toʻgʻri nom kiriting (2-16 belgidan iborat).");
      return;
    }

    const hostId = SecurityManager.generateCipherId();
    this.network.initLocalPeer(hostId);
    this.network.isHost = true;
    this.network.hostToken = SecurityManager.createHandshakeToken();
    this.game.addPlayer({ id: hostId, name, role: Roles.CIVILIAN });
    ui.connectId.value = hostId;
    ui.startGameButton.disabled = false;
    this.logger.log(`Host tayyor: ${hostId}`);
    this.renderPlayers();
    this.updateMission(`Host sifatida siz oʻyinchilarni boshqarasiz. <strong>Start</strong> tugmasi bosilgach, rollar tarqatiladi.`);
  }

  joinGame() {
    const name = ui.playerName.value.trim();
    const hostId = ui.connectId.value.trim();
    if (!SecurityManager.validatePlayerName(name)) {
      alert("Toʻgʻri nom kiriting.");
      return;
    }
    if (!SecurityManager.validateCipherId(hostId)) {
      alert("Host identifikatorini tekshiring.");
      return;
    }

    const localId = SecurityManager.generateCipherId();
    this.network.initLocalPeer(localId);
    this.game.addPlayer({ id: localId, name, role: Roles.CIVILIAN });
    this.network.connectToHost(hostId);
    this.logger.log(`Qoʻshildi hostga: ${hostId}`);
    this.renderPlayers();
    this.updateMission(`Siz oʻyin jamoasiga qoʻshildingiz. <strong>Chat</strong> va <strong>vazifalarni</strong> kuting.`);
  }

  startGame() {
    try {
      if (!this.network.isHost) {
        alert("Faqat host oʻyinni boshlashi mumkin.");
        return;
      }
      this.game.startRoleAssignment();
      this.updatePhaseUI();
      this.logger.log("Oʻyinni boshlash bosildi.");
      this.renderPlayers();
    } catch (error) {
      this.logger.log(error.message, "error");
      alert(error.message);
    }
  }

  sendChat() {
    const text = ui.chatInput.value.trim();
    if (!text) return;
    const message = {
      author: this.network.localId,
      text,
      timestamp: Date.now(),
    };
    if (this.network.isHost) {
      this.game.currentStory = `${this.game.players.find((p) => p.id === this.network.localId)?.name} chat yubordi.`;
      this.network.broadcast("CHAT_MESSAGE", message);
      this.appendLog(`Siz: ${text}`);
    } else {
      const hostConn = Array.from(this.network.connections.values())[0];
      if (hostConn && hostConn.open) {
        hostConn.send({ type: "CHAT_MESSAGE", payload: message });
      }
    }
    ui.chatInput.value = "";
  }

  appendLog(message, highlight = false) {
    const line = document.createElement("div");
    line.className = `log-entry${highlight ? " highlight" : ""}`;
    line.textContent = message;
    ui.gameLog.appendChild(line);
    ui.gameLog.scrollTop = ui.gameLog.scrollHeight;
  }

  renderPlayers() {
    ui.playerList.innerHTML = "";
    this.game.players.forEach((player) => {
      const item = document.createElement("li");
      item.innerHTML = `<strong>${player.name}</strong> <span>${player.id}</span>`;
      ui.playerList.appendChild(item);
    });
  }

  updateMission(html) {
    ui.missionGuide.innerHTML = `<p>${html}</p>`;
  }

  updatePhaseUI() {
    ui.phaseLabel.textContent = this.game.phase.replace("_", " ");
    ui.actionControls.innerHTML = "";
    ui.chatInput.disabled = this.game.phase === Phase.LOBBY;
    ui.sendChatButton.disabled = this.game.phase === Phase.LOBBY;
    if (this.game.phase === Phase.ROLES_ASSIGNMENT) {
      this.appendLog("Rollar aniqlanmoqda...", true);
      this.updateMission(`Rollar tarqatildi. Sizning rolingiz: <strong>${this.game.getLocalRole(this.network.localId)}</strong>. Keyingi bosqichga tayyorlaning.`);
      setTimeout(() => this.advancePhase(Phase.DAY_CHAT), 1500);
    }
    if (this.game.phase === Phase.DAY_CHAT) {
      this.updateMission(`Siz <strong>${this.game.getLocalRole(this.network.localId)}</strong> sifatida kun chatida qatnashishingiz mumkin. Agar siz Don yoki Mafia boʻlsangiz, maxfiy koordinatsiya qiling.`);
      this.renderActionButton("Ovoz berish", "secondary-btn", () => this.advancePhase(Phase.VOTING));
    }
    if (this.game.phase === Phase.VOTING) {
      this.updateMission(`Hamma oʻyinchilar ovoz beradi. Siz haqiqiy shaxsni aniqlashga harakat qiling.`);
      this.renderActionButton("Ovoz berish", "primary-btn", () => this.handleVote());
    }
    if (this.game.phase === Phase.NIGHT_ACTIONS) {
      this.updateMission(`Tun harakatlari. Agar siz rollardan biri boʻlsangiz, zudlik bilan amal bajaring.`);
      this.renderNightActions();
    }
  }

  renderActionButton(text, btnClass, onClick) {
    const button = document.createElement("button");
    button.className = btnClass;
    button.textContent = text;
    button.addEventListener("click", onClick);
    ui.actionControls.appendChild(button);
  }

  renderNightActions() {
    const role = this.game.getLocalRole(this.network.localId);
    const actions = {
      [Roles.DON]: "Taxmin qiluvchilarni tekshirish",
      [Roles.SHERIFF]: "Shubhali shaxslarni tekshirish",
      [Roles.DOCTOR]: "Birini saqlash",
      [Roles.HACKER]: "Axborot o‘g‘irlash",
      [Roles.HITMAN]: "Jasoratli qotillik",
      [Roles.MANIAC]: "O‘zini saqlab qolish"
    };

    if (!actions[role]) {
      this.appendLog("Siz kechasi tomosha qilasiz.");
      return;
    }
    this.renderActionButton(actions[role], "accent-btn", () => {
      this.appendLog(`Tun harakati amalga oshirildi: ${actions[role]}`);
      this.advancePhase(Phase.DAY_CHAT);
    });
  }

  handleVote() {
    this.appendLog("Ovoz jarayoni yakunlandi.");
    this.advancePhase(Phase.NIGHT_ACTIONS);
  }

  advancePhase(nextPhase) {
    if (this.network.isHost) {
      this.game.updatePhase(nextPhase);
    }
  }
}

const logger = new AuditLogger(ui.auditLog);
const network = new NetworkManager(logger);
const game = new GameStateMachine(network, logger);
const uiManager = new UIManager(game, network, logger);

network.onSync = (payload) => {
  game.handleHostState(payload);
  uiManager.renderPlayers();
  uiManager.updatePhaseUI();
};

network.onMessage = (message) => {
  const author = game.players.find((p) => p.id === message.author)?.name || "Noma'lum";
  uiManager.appendLog(`${author}: ${message.text}`);
};

network.onPlayerJoin = (player) => {
  game.addPlayer({ id: player.id, name: player.name, role: Roles.CIVILIAN });
  uiManager.renderPlayers();
  game.publishState();
  uiManager.appendLog(`${player.name} tizimga qoʻshildi.`, true);
};

network.onSyncRequest = () => game.createSyncPayload();

function initializeTutorial() {
  uiManager.updateMission("Lobbida oʻyin nomini kiriting, host boʻling yoki Host ID bilan qoʻshiling. Keyin rollar tarqatiladi.");
}

initializeTutorial();
