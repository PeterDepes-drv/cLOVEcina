// Globálny stav hry
const state = {
  mode: 'local', // 'local' | 'live' | 'async'
  roomCode: '',
  playerName: '',
  partnerName: '',
  playerRole: 'host', // 'host' | 'guest' in Live P2P; 'player1' | 'player2' in Async
  currentCategory: 'komfort',
  currentCardIndex: -1,
  isFlipped: false,
  connection: null, // PeerJS connection object
  peer: null, // PeerJS instance
  firestoreUnsubscribe: null, // Firebase unsubscribe function
  db: null, // Firebase db instance
  firebaseConfig: null,
  answers: { player1: '', player2: '' },
  questionsHistory: {
    komfort: [],
    rozvoj: [],
    intimita: [],
    sny: [],
    nocna: []
  }
};

// Predvolené názvy
const DEFAULT_HOST_NAME = "Partner A";
const DEFAULT_GUEST_NAME = "Partner B";

// Načítanie nastavení pri štarte
function loadSettings() {
  const savedConfig = localStorage.getItem('clovecina_firebase_config');
  if (savedConfig) {
    try {
      state.firebaseConfig = JSON.parse(savedConfig);
    } catch (e) {
      console.error("Chyba pri načítaní Firebase configu", e);
    }
  }

  state.playerName = localStorage.getItem('clovecina_player_name') || '';
}

// Uloženie nastavení do localStorage
function saveFirebaseConfig(config) {
  state.firebaseConfig = config;
  localStorage.setItem('clovecina_firebase_config', JSON.stringify(config));
}

function savePlayerName(name) {
  state.playerName = name;
  localStorage.setItem('clovecina_player_name', name);
}

// Inicializácia rozhrania po načítaní stránky
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initUI();
  setupEventListeners();
  
  // Predvolený stav - skryť hru, zobraziť lobby
  showScreen('lobby');
});

// Zmena obrazoviek
function showScreen(screen) {
  if (screen === 'lobby') {
    document.getElementById('lobby-screen').style.display = 'block';
    document.getElementById('game-screen').style.display = 'none';
  } else if (screen === 'game') {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    renderCard();
  }
}

// Výber elementov a nastavenie počiatočného UI
function initUI() {
  // Vyplnenie uložených mien
  document.getElementById('settings-player-name').value = state.playerName;
  if (state.firebaseConfig) {
    document.getElementById('fb-api-key').value = state.firebaseConfig.apiKey || '';
    document.getElementById('fb-project-id').value = state.firebaseConfig.projectId || '';
  }
  
  // Zobraziť aktuálny režim v lobby
  updateLobbyModeUI();
}

function updateLobbyModeUI() {
  const mode = state.mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Skryť/Zobraziť panely podľa režimu
  document.getElementById('panel-live').style.display = mode === 'live' ? 'flex' : 'none';
  document.getElementById('panel-async').style.display = mode === 'async' ? 'flex' : 'none';
  document.getElementById('panel-local').style.display = mode === 'local' ? 'block' : 'none';
}

// Event Listeners pre celú aplikáciu
function setupEventListeners() {
  // Prepínanie režimov v Lobby
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      updateLobbyModeUI();
    });
  });

  // Modal Nastavenia
  const modal = document.getElementById('settings-modal');
  document.getElementById('btn-settings').addEventListener('click', () => {
    modal.classList.add('is-active');
  });
  document.querySelector('.modal-close').addEventListener('click', () => {
    modal.classList.remove('is-active');
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('is-active');
  });

  // Uloženie nastavení v modale
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const nameInput = document.getElementById('settings-player-name').value.trim();
    savePlayerName(nameInput);


    const apiKey = document.getElementById('fb-api-key').value.trim();
    const projectId = document.getElementById('fb-project-id').value.trim();

    if (apiKey && projectId) {
      saveFirebaseConfig({
        apiKey,
        authDomain: `${projectId}.firebaseapp.com`,
        projectId,
        storageBucket: `${projectId}.appspot.com`,
        messagingSenderId: "123456789",
        appId: `1:123456789:web:abcdef`
      });
      showToast("Firebase nastavenia boli uložené.");
    } else if (!apiKey && !projectId) {
      // Vymazanie konfigurácie
      localStorage.removeItem('clovecina_firebase_config');
      state.firebaseConfig = null;
    }

    modal.classList.remove('is-active');
    updateLobbyModeUI();
  });

  // Spustenie lokálnej hry
  document.getElementById('btn-start-local').addEventListener('click', () => {
    state.mode = 'local';
    state.playerName = state.playerName || "Hráč 1";
    state.partnerName = "Hráč 2";
    initLocalGame();
  });

  // Hostovanie Live hry (PeerJS)
  document.getElementById('btn-host-live').addEventListener('click', () => {
    startLiveHosting();
  });

  // Pripojenie do Live hry (PeerJS)
  document.getElementById('btn-join-live').addEventListener('click', () => {
    const code = document.getElementById('live-code-input').value.trim().toLowerCase();
    if (!code) {
      showToast("Zadajte kód miestnosti.");
      return;
    }
    joinLiveGame(code);
  });

  // Hostovanie Async hry (Firebase)
  document.getElementById('btn-create-async').addEventListener('click', () => {
    createAsyncGame();
  });

  // Pripojenie do Async hry (Firebase)
  document.getElementById('btn-join-async').addEventListener('click', () => {
    const code = document.getElementById('async-code-input').value.trim().toLowerCase();
    if (!code) {
      showToast("Zadajte kód hry.");
      return;
    }
    joinAsyncGame(code);
  });

  // Návrat do Lobby
  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    leaveCurrentRoom();
    showScreen('lobby');
  });

  // Výber kategórie (Zmena záložiek)
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const category = tab.dataset.category;
      if (state.mode === 'live' && state.playerRole !== 'host') {
        showToast("Iba hostiteľ (Partner A) môže vyberať kategórie.");
        return;
      }
      changeCategory(category);
      if (state.mode === 'live' && state.connection) {
        state.connection.send({ type: 'CHANGE_CATEGORY', category });
      }
    });
  });

  // Otočenie karty
  document.getElementById('card-scene').addEventListener('click', (e) => {
    // Nechceme otočiť kartu, ak používateľ klikol na tlačidlo v pätičke
    if (e.target.closest('.card-actions') || e.target.closest('.btn-love')) return;
    
    if (state.mode === 'live' && state.playerRole !== 'host') {
      showToast("Iba hostiteľ (Partner A) môže otáčať kartu.");
      return;
    }

    toggleCardFlip();
  });

  // Tlačidlo: Ťahať novú kartu
  document.getElementById('btn-draw-card').addEventListener('click', () => {
    if (state.mode === 'live' && state.playerRole !== 'host') {
      showToast("Iba hostiteľ (Partner A) môže ťahať novú kartu.");
      return;
    }
    drawNewCard();
  });

  // Tlačidlo: Srdiečko (Poslať reakciu)
  document.getElementById('btn-love-card').addEventListener('click', (e) => {
    createFloatingHearts();
    if (state.mode === 'live' && state.connection) {
      state.connection.send({ type: 'HEART' });
    } else if (state.mode === 'async' && state.db && state.roomCode) {
      // V asynchrónnom režime môžeme zapísať reakciu do DB (napr. inkrementovať čítač sŕdc)
      sendHeartAsync();
    }
  });

  // Uloženie odpovede v asynchrónnom režime
  document.getElementById('btn-submit-answer').addEventListener('click', () => {
    const text = document.getElementById('answer-textarea').value.trim();
    if (!text) {
      showToast("Najprv napíšte svoju odpoveď.");
      return;
    }
    submitAsyncAnswer(text);
  });

  // WhatsApp: Zdieľať otázku
  document.getElementById('btn-share-whatsapp').addEventListener('click', () => {
    if (state.currentCardIndex === -1) return;
    const question = QUESTIONS[state.currentCategory][state.currentCardIndex];
    const categoryNames = { komfort: 'Komfort', rozvoj: 'Rozvoj', intimita: 'Intimita', sny: 'Naše sny', nocna: 'Po 22:00 🌙' };
    const catName = categoryNames[state.currentCategory] || 'Človečina';
    
    const text = `*čLOVEčina pre nás dvoch* ❤️ (${catName})\n\n*Otázka:* "${question}"\n\nAké sú naše odpovede? 😉`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  });

  // WhatsApp: Upozorniť partnera (Async)
  document.getElementById('btn-async-notify-wa').addEventListener('click', () => {
    const question = QUESTIONS[state.currentCategory][state.currentCardIndex];
    const text = `Ahoj! Napísal/a som odpoveď na dnešnú kartu Človečiny. 🤫\n\n*Otázka:* "${question}"\n\nTeraz si na rade ty! Otvor hru a napíš svoju odpoveď, aby sa nám odhalili: ${window.location.href}`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  });

  // WhatsApp: Poslať odpovede (Async)
  document.getElementById('btn-async-share-answers-wa').addEventListener('click', () => {
    const question = QUESTIONS[state.currentCategory][state.currentCardIndex];
    const myRole = state.playerRole;
    const partnerRole = myRole === 'player1' ? 'player2' : 'player1';
    
    const myName = state.playerName || "Partner A";
    const partnerName = state.partnerName || "Partner B";
    
    const myAnswer = state.answers[myRole] || '';
    const partnerAnswer = state.answers[partnerRole] || '';

    const text = `*Naša čLOVEčina - odpovede* ❤️\n\n*Otázka:* "${question}"\n\n*Odpoveď (${myName}):*\n"${myAnswer}"\n\n*Odpoveď (${partnerName}):*\n"${partnerAnswer}"`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  });
}

// Zmena kategórie
function changeCategory(category) {
  state.currentCategory = category;
  state.currentCardIndex = -1;
  state.isFlipped = false;
  
  // Aktualizácia aktívnej záložky
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  renderCard();
}

// Otočenie karty
function toggleCardFlip() {
  state.isFlipped = !state.isFlipped;
  const container = document.getElementById('card-container');
  container.classList.toggle('is-flipped', state.isFlipped);

  if (state.mode === 'live' && state.connection) {
    state.connection.send({ type: 'FLIP_CARD', isFlipped: state.isFlipped });
  }

  // Ak hráme asynchrónne a otočili sme kartu
  if (state.mode === 'async' && state.db && state.playerRole === 'player1') {
    updateAsyncRoom({ isFlipped: state.isFlipped });
  }
}

// Potiahnutie novej karty
async function drawNewCard() {
  const categoryQuestions = QUESTIONS[state.currentCategory];
  if (!categoryQuestions || categoryQuestions.length === 0) return;

  // Ak sme už prešli všetky otázky, vyčistíme históriu pre túto kategóriu
  if (state.questionsHistory[state.currentCategory].length >= categoryQuestions.length) {
    state.questionsHistory[state.currentCategory] = [];
    showToast("Kategória prečítaná. Začíname odznova!");
  }

  // Hľadanie náhodného indexu, ktorý sme ešte neťahali
  let randomIndex;
  let attempts = 0;
  do {
    randomIndex = Math.floor(Math.random() * categoryQuestions.length);
    attempts++;
  } while (
    state.questionsHistory[state.currentCategory].includes(randomIndex) && 
    attempts < 100
  );

  state.questionsHistory[state.currentCategory].push(randomIndex);
  state.currentCardIndex = randomIndex;
  state.isFlipped = false;

  renderCard();

  // Synchrónne odoslanie cez PeerJS
  if (state.mode === 'live' && state.connection) {
    state.connection.send({ 
      type: 'DRAW_CARD', 
      category: state.currentCategory, 
      index: randomIndex 
    });
  }

  // Asynchrónne zapísanie do Firebase
  if (state.mode === 'async' && state.db && state.roomCode) {
    updateAsyncRoom({
      currentCategory: state.currentCategory,
      currentCardIndex: randomIndex,
      isFlipped: false,
      answers: { player1: '', player2: '' }, // Reset odpovedí pre novú kartu
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

// Vykreslenie karty podľa aktuálneho stavu
function renderCard() {
  const container = document.getElementById('card-container');
  const cardText = document.getElementById('card-text');
  const categoryLabel = document.getElementById('card-category-label');
  const cardFront = document.getElementById('card-front');
  
  // Nastavenie farby kategórie
  const categoryColors = {
    komfort: 'var(--color-komfort)',
    rozvoj: 'var(--color-rozvoj)',
    intimita: 'var(--color-intimita)',
    sny: 'var(--color-sny)',
    nocna: 'var(--color-nocna)'
  };
  const color = categoryColors[state.currentCategory] || 'var(--color-komfort)';
  
  cardFront.style.background = 'linear-gradient(135deg, #221c35 0%, #0d0c12 100%)';
  cardFront.style.setProperty('--category-color', color);

  // Kategória názov
  const categoryNames = {
    komfort: 'Komfort',
    rozvoj: 'Rozvoj',
    intimita: 'Intimita',
    sny: 'Naše sny',
    nocna: 'Po 22:00 🌙'
  };
  categoryLabel.innerText = categoryNames[state.currentCategory] || 'Karta';

  // Otočenie karty vizuálne
  container.classList.toggle('is-flipped', state.isFlipped);

  // Text na karte
  const waShareBtn = document.getElementById('btn-share-whatsapp');
  if (state.currentCardIndex === -1) {
    cardText.innerHTML = `<span style="font-style:italic; font-size:1.3rem;">Kliknite na "Ťahať kartu" pre začiatok</span>`;
    document.getElementById('btn-love-card').style.display = 'none';
    waShareBtn.style.display = 'none';
  } else {
    const question = QUESTIONS[state.currentCategory][state.currentCardIndex];
    cardText.innerText = question || "Chyba pri načítaní otázky.";
    document.getElementById('btn-love-card').style.display = 'flex';
    waShareBtn.style.display = 'flex';
  }

  // Zobraziť/skryť panel odpovedí pre asynchrónny režim
  const answersSection = document.getElementById('async-answers-section');
  if (state.mode === 'async' && state.currentCardIndex !== -1) {
    answersSection.style.display = 'flex';
    renderAnswers();
  } else {
    answersSection.style.display = 'none';
  }
}

// === HERNÝ REŽIM: LOKÁLNY ===
function initLocalGame() {
  showScreen('game');
  document.getElementById('partner-status-text').innerText = "Lokálny režim (Offline)";
  document.getElementById('partner-status-dot').className = "status-dot";
  document.getElementById('room-id-indicator').innerText = "Lokálna hra";
  
  // Odstrániť obmedzenia zmeny pre guest-a
  state.playerRole = 'host'; 
}

// === HERNÝ REŽIM: LIVE (PEERJS) ===

// Generovanie náhodného kódu pre izbu
function generateRoomCode() {
  const words = ['srdce', 'laska', 'blizkost', 'sny', 'spojenie', 'dvera', 'vztah', 'radost', 'stastie', 'cit'];
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomNumber = Math.floor(1000 + Math.random() * 9000);
  return `${randomWord}-${randomNumber}`;
}

function startLiveHosting() {
  state.playerName = state.playerName || DEFAULT_HOST_NAME;
  savePlayerName(state.playerName);

  const roomCode = generateRoomCode();
  state.roomCode = roomCode;
  state.playerRole = 'host';

  document.getElementById('live-status-info').innerHTML = `Vytváram izbu s kódom <strong class="room-code-display" id="copy-code-btn">${roomCode}</strong>...`;
  
  // Inicializácia PeerJS
  // Využijeme bezplatný PeerJS server
  state.peer = new Peer(roomCode, {
    debug: 2
  });

  state.peer.on('open', (id) => {
    document.getElementById('live-status-info').innerHTML = `Čakám na pripojenie manželky...<br>Pošlite jej kód izby: <strong class="room-code-display" id="copy-code-btn">${roomCode} <i class="fas fa-copy"></i></strong>`;
    setupCopyCodeEvent(roomCode);
  });

  state.peer.on('connection', (conn) => {
    state.connection = conn;
    setupPeerListeners();
    showToast("Manželka sa pripojila!");
    
    // Poslať meno partnerovi
    state.connection.on('open', () => {
      state.connection.send({ 
        type: 'HANDSHAKE', 
        name: state.playerName,
        category: state.currentCategory,
        index: state.currentCardIndex,
        isFlipped: state.isFlipped
      });
    });
  });

  state.peer.on('error', (err) => {
    console.error(err);
    if (err.type === 'unavailable-id') {
      showToast("Tento kód izby je už obsadený. Skúste znova.");
      state.peer.destroy();
      startLiveHosting();
    } else {
      showToast("Chyba pri vytváraní izby.");
    }
  });
}

function joinLiveGame(code) {
  state.playerName = state.playerName || DEFAULT_GUEST_NAME;
  savePlayerName(state.playerName);

  state.roomCode = code;
  state.playerRole = 'guest';

  document.getElementById('live-status-info').innerText = "Pripájam sa...";
  
  // Inicializácia peera s náhodným ID pre hosťa
  state.peer = new Peer(null, {
    debug: 2
  });

  state.peer.on('open', () => {
    const conn = state.peer.connect(code);
    state.connection = conn;
    setupPeerListeners();
  });

  state.peer.on('error', (err) => {
    console.error(err);
    showToast("Nepodarilo sa pripojiť. Skontrolujte kód izby.");
    document.getElementById('live-status-info').innerText = "";
  });
}

function setupPeerListeners() {
  state.connection.on('open', () => {
    showScreen('game');
    document.getElementById('room-id-indicator').innerText = `Kód izby: ${state.roomCode}`;
    document.getElementById('partner-status-dot').className = "status-dot";
    document.getElementById('partner-status-text').innerText = "Online";

    // Poslať svoje meno
    state.connection.send({ type: 'NAME', name: state.playerName });
  });

  state.connection.on('data', (data) => {
    handlePeerData(data);
  });

  state.connection.on('close', () => {
    showToast("Pripojenie bolo stratené.");
    document.getElementById('partner-status-dot').className = "status-dot offline";
    document.getElementById('partner-status-text').innerText = "Odpojený";
  });
}

function handlePeerData(data) {
  switch (data.type) {
    case 'HANDSHAKE':
      state.partnerName = data.name;
      document.getElementById('partner-status-text').innerText = `${state.partnerName} (Online)`;
      // Synchronizovať kartu, ak sme hosť
      if (state.playerRole === 'guest') {
        state.currentCategory = data.category;
        state.currentCardIndex = data.index;
        state.isFlipped = data.isFlipped;
        
        // Zmeniť vizuál záložiek
        document.querySelectorAll('.tab-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.category === state.currentCategory);
        });
        renderCard();
      }
      break;
    case 'NAME':
      state.partnerName = data.name;
      document.getElementById('partner-status-text').innerText = `${state.partnerName} (Online)`;
      break;
    case 'CHANGE_CATEGORY':
      state.currentCategory = data.category;
      state.currentCardIndex = -1;
      state.isFlipped = false;
      
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === state.currentCategory);
      });
      renderCard();
      showToast(`${state.partnerName} zmenil/a kategóriu na ${data.category}`);
      break;
    case 'DRAW_CARD':
      state.currentCategory = data.category;
      state.currentCardIndex = data.index;
      state.isFlipped = false;
      renderCard();
      showToast(`${state.partnerName} vytiahol/tiahla novú kartu`);
      break;
    case 'FLIP_CARD':
      state.isFlipped = data.isFlipped;
      document.getElementById('card-container').classList.toggle('is-flipped', state.isFlipped);
      break;
    case 'HEART':
      createFloatingHearts();
      break;
  }
}

// === HERNÝ REŽIM: ASYNCHRÓNNY (FIREBASE) ===

function checkFirebaseInitialized() {
  if (!state.firebaseConfig) {
    showToast("Najprv vložte Firebase konfiguráciu v Nastaveniach.");
    document.getElementById('settings-modal').classList.add('is-active');
    return false;
  }
  
  if (!state.db) {
    try {
      // Ak je už firebase inicializované (napr. predchádzajúca hra), vynecháme inicializáciu
      if (firebase.apps.length === 0) {
        firebase.initializeApp(state.firebaseConfig);
      }
      state.db = firebase.firestore();
    } catch (e) {
      console.error(e);
      showToast("Chyba inicializácie Firebase. Skontrolujte kľúče.");
      return false;
    }
  }
  return true;
}

function createAsyncGame() {
  if (!checkFirebaseInitialized()) return;

  state.playerName = state.playerName || DEFAULT_HOST_NAME;
  savePlayerName(state.playerName);

  const roomCode = generateRoomCode();
  state.roomCode = roomCode;
  state.playerRole = 'player1';

  const statusEl = document.getElementById('async-status-info');
  statusEl.innerHTML = `Vytváram asynchrónnu hru...`;

  // Spustíme 10s časovač pre prípad, že Firebase neodpovedá (napr. kvôli neexistujúcej databáze)
  const timeoutId = setTimeout(() => {
    statusEl.innerHTML = `
      <div style="color:var(--color-rozvoj); text-align:left; font-size:0.9rem; line-height:1.4; margin-top:0.5rem; border: 1px solid rgba(251, 191, 36, 0.3); padding: 0.8rem; border-radius: 8px; background: rgba(251, 191, 36, 0.05);">
        <i class="fas fa-exclamation-triangle" style="color:var(--color-rozvoj);"></i> <strong>Pripojenie k databáze trvá nezvyčajne dlho.</strong><br><br>
        Uistite sa, že ste vo Firebase konzole dokončili tieto kroky:<br>
        1. V ľavom menu kliknite na <strong>Firestore Database</strong> a potom na tlačidlo <strong>Create database</strong> (Vytvoriť databázu). Bez tohto kroku databáza neexistuje a hra sa nezačne.<br>
        2. V záložke <strong>Rules</strong> (Pravidlá) prepíšte pravidlo tak, aby povoľovalo zápis aj čítanie bez prihlásenia: <code>allow read, write: if true;</code>
      </div>
    `;
  }, 10000);

  const roomRef = state.db.collection('rooms').doc(roomCode);
  
  roomRef.set({
    roomCode,
    currentCategory: 'komfort',
    currentCardIndex: -1,
    isFlipped: false,
    playerNames: {
      player1: state.playerName,
      player2: ''
    },
    answers: {
      player1: '',
      player2: ''
    },
    heartsCount: 0,
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(() => {
    clearTimeout(timeoutId);
    statusEl.innerHTML = `Hra vytvorená! Pošlite manželke kód izby: <strong class="room-code-display" id="copy-code-async">${roomCode} <i class="fas fa-copy"></i></strong>`;
    setupCopyCodeEvent(roomCode, 'copy-code-async');
    listenToAsyncRoom(roomCode);
  })
  .catch(err => {
    clearTimeout(timeoutId);
    console.error(err);
    showToast("Nepodarilo sa vytvoriť hru vo Firebase.");
    statusEl.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> Chyba pripojenia: ${err.message || err}</span>`;
  });
}

function joinAsyncGame(code) {
  if (!checkFirebaseInitialized()) return;

  state.playerName = state.playerName || DEFAULT_GUEST_NAME;
  savePlayerName(state.playerName);

  state.roomCode = code;
  state.playerRole = 'player2';

  const statusEl = document.getElementById('async-status-info');
  statusEl.innerText = "Pripájam sa k hre...";

  const timeoutId = setTimeout(() => {
    statusEl.innerHTML = `
      <div style="color:var(--color-rozvoj); text-align:left; font-size:0.9rem; line-height:1.4; margin-top:0.5rem; border: 1px solid rgba(251, 191, 36, 0.3); padding: 0.8rem; border-radius: 8px; background: rgba(251, 191, 36, 0.05);">
        <i class="fas fa-exclamation-triangle" style="color:var(--color-rozvoj);"></i> <strong>Pripojenie k databáze trvá príliš dlho.</strong><br><br>
        Uistite sa, že kód hry <code>${code}</code> je správny a že hostiteľ vytvoril a správne nastavil Firestore Database vo svojej Firebase konzole.
      </div>
    `;
  }, 10000);

  const roomRef = state.db.collection('rooms').doc(code);

  roomRef.get().then((doc) => {
    clearTimeout(timeoutId);
    if (!doc.exists) {
      showToast("Hra s týmto kódom neexistuje.");
      statusEl.innerText = "";
      return;
    }

    const data = doc.data();
    
    // Uložiť meno hosťa, ak ešte nie je uložené
    const updateData = {};
    if (!data.playerNames.player2) {
      updateData['playerNames.player2'] = state.playerName;
    }
    
    roomRef.update(updateData).then(() => {
      listenToAsyncRoom(code);
    }).catch(err => {
      console.error(err);
      showToast("Chyba pri aktualizácii mena vo Firebase.");
      statusEl.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> Chyba: ${err.message || err}</span>`;
    });
  }).catch(err => {
    clearTimeout(timeoutId);
    console.error(err);
    showToast("Chyba pri pripájaní k Firebase.");
    statusEl.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> Chyba pripojenia: ${err.message || err}</span>`;
  });
}

function listenToAsyncRoom(code) {
  const roomRef = state.db.collection('rooms').doc(code);

  // Zrušiť predchádzajúci listener ak existuje
  if (state.firestoreUnsubscribe) {
    state.firestoreUnsubscribe();
  }

  state.firestoreUnsubscribe = roomRef.onSnapshot((doc) => {
    if (!doc.exists) {
      showToast("Hra bola vymazaná.");
      leaveCurrentRoom();
      showScreen('lobby');
      return;
    }

    const data = doc.data();
    
    // Synchronizácia mien
    state.partnerName = state.playerRole === 'player1' 
      ? (data.playerNames.player2 || "Manželka (čaká sa na pripojenie)") 
      : (data.playerNames.player1 || "Manžel");

    // Zobrazenie hernej obrazovky
    if (document.getElementById('game-screen').style.display !== 'block') {
      showScreen('game');
    }

    document.getElementById('room-id-indicator').innerText = `Asynchrónna hra: ${state.roomCode}`;
    document.getElementById('partner-status-dot').className = "status-dot";
    document.getElementById('partner-status-text').innerText = state.partnerName;

    // Aktualizácia stavu karty
    const isNewCard = state.currentCardIndex !== data.currentCardIndex || state.currentCategory !== data.currentCategory;
    
    state.currentCategory = data.currentCategory;
    state.currentCardIndex = data.currentCardIndex;
    state.isFlipped = data.isFlipped;
    state.answers = data.answers || { player1: '', player2: '' };

    // Synchronizácia lokálneho počítadla reakcií
    if (state.lastHeartsCount !== undefined && data.heartsCount > state.lastHeartsCount) {
      createFloatingHearts();
    }
    state.lastHeartsCount = data.heartsCount || 0;

    // Zmeniť záložku kategórie vizuálne bez prerušenia
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === state.currentCategory);
    });

    renderCard();
    
    // Resetovať textové pole ak je nová karta
    if (isNewCard) {
      document.getElementById('answer-textarea').value = '';
    }
  }, (error) => {
    console.error("Firestore listener error:", error);
    showToast("Pripojenie k databáze zlyhalo.");
  });
}

function updateAsyncRoom(fields) {
  if (!state.db || !state.roomCode) return;
  state.db.collection('rooms').doc(state.roomCode).update(fields)
    .catch(err => console.error("Chyba aktualizácie Firebase:", err));
}

function submitAsyncAnswer(text) {
  if (!state.db || !state.roomCode) return;

  const updateFields = {};
  updateFields[`answers.${state.playerRole}`] = text;
  updateFields.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

  updateAsyncRoom(updateFields);
  showToast("Odpoveď bola odoslaná!");
  document.getElementById('answer-textarea').value = '';
}

function sendHeartAsync() {
  if (!state.db || !state.roomCode) return;
  
  // Zvýšime počítadlo sŕdc v databáze, čo vyvolá u partnera onSnapshot trigger a animáciu
  state.db.collection('rooms').doc(state.roomCode).update({
    heartsCount: firebase.firestore.FieldValue.increment(1)
  });
}

// Vykreslenie odpovedí pre asynchrónny režim
function renderAnswers() {
  const container = document.getElementById('async-answers-container');
  container.innerHTML = '';

  const myRole = state.playerRole;
  const partnerRole = myRole === 'player1' ? 'player2' : 'player1';

  const myAnswer = state.answers[myRole] || '';
  const partnerAnswer = state.answers[partnerRole] || '';

  const myName = state.playerName || "Ja";
  const partnerName = state.partnerName || "Manželka";

  const formSection = document.getElementById('async-form-section');

  // Ak som ešte neodpovedal, ukážem formulár na písanie odpovede
  if (!myAnswer) {
    formSection.style.display = 'block';
  } else {
    formSection.style.display = 'none';
  }

  // 1. Zobrazenie mojej odpovede (ak existuje)
  if (myAnswer) {
    const myBox = createAnswerElement(myName, myAnswer, false);
    container.appendChild(myBox);
  }

  // 2. Zobrazenie partnerovej odpovede
  if (partnerAnswer) {
    if (myAnswer) {
      // Ak sme odpovedali obaja, odhalíme odpoveď partnera
      const partnerBox = createAnswerElement(partnerName, partnerAnswer, false);
      container.appendChild(partnerBox);
    } else {
      // Ak partner odpovedal, ale ja ešte nie, skrývame odpoveď
      const partnerBox = createAnswerElement(partnerName, "", true, true);
      container.appendChild(partnerBox);
    }
  } else {
    // Partner ešte neodpovedal
    const partnerBox = createAnswerElement(partnerName, "", true, false);
    container.appendChild(partnerBox);
  }

  // Zobrazenie akčných tlačidiel WhatsApp pre asynchrónny režim
  const waActionsDiv = document.getElementById('async-whatsapp-actions');
  const notifyBtn = document.getElementById('btn-async-notify-wa');
  const shareAnswersBtn = document.getElementById('btn-async-share-answers-wa');

  if (myAnswer || partnerAnswer) {
    waActionsDiv.style.display = 'flex';
    
    // Ak som odpovedal ja, ale partner nie, môžem ho upozorniť
    if (myAnswer && !partnerAnswer) {
      notifyBtn.style.display = 'flex';
      shareAnswersBtn.style.display = 'none';
    } 
    // Ak sme odpovedali obaja, môžeme zazdieľať rozhovor
    else if (myAnswer && partnerAnswer) {
      notifyBtn.style.display = 'none';
      shareAnswersBtn.style.display = 'flex';
    } 
    // Ak odpovedal iba partner (ja nie), nepotrebujeme zatiaľ žiadne akcie
    else {
      waActionsDiv.style.display = 'none';
    }
  } else {
    waActionsDiv.style.display = 'none';
  }
}

function createAnswerElement(author, text, isHidden, hasAnswered = false) {
  const box = document.createElement('div');
  box.className = 'answer-box';
  
  if (isHidden) {
    box.className += ' hidden-answer';
    const textSpan = document.createElement('span');
    textSpan.className = 'answer-hidden-text';
    
    if (hasAnswered) {
      textSpan.innerHTML = `<i class="fas fa-lock"></i> ${author} už napísal/a odpoveď. Napíš svoju pre odhalenie.`;
    } else {
      textSpan.innerHTML = `<i class="fas fa-hourglass-half"></i> Čaká sa na odpoveď od: ${author}`;
    }
    box.appendChild(textSpan);
  } else {
    const authorDiv = document.createElement('div');
    authorDiv.className = 'answer-author';
    authorDiv.innerText = author;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'answer-content';
    contentDiv.innerText = text;
    
    box.appendChild(authorDiv);
    box.appendChild(contentDiv);
  }
  
  return box;
}

// === POMOCNÉ FUNKCIE (HELPERS) ===

// Odchod z aktuálnej miestnosti
function leaveCurrentRoom() {
  // P2P odpojenie
  if (state.connection) {
    state.connection.close();
    state.connection = null;
  }
  if (state.peer) {
    state.peer.destroy();
    state.peer = null;
  }

  // Firebase odpojenie
  if (state.firestoreUnsubscribe) {
    state.firestoreUnsubscribe();
    state.firestoreUnsubscribe = null;
  }
  
  state.roomCode = '';
  state.currentCardIndex = -1;
  state.isFlipped = false;
  state.answers = { player1: '', player2: '' };
  
  document.getElementById('live-status-info').innerText = '';
  document.getElementById('async-status-info').innerText = '';
}

// Animácia vznášajúcich sa sŕdc
function createFloatingHearts() {
  const container = document.body;
  const colors = ['#ff4d6d', '#ff758f', '#ff8fa3', '#ffb3c1', '#ffccd5'];
  
  for (let i = 0; i < 15; i++) {
    setTimeout(() => {
      const heart = document.createElement('i');
      heart.className = 'fas fa-heart floating-heart';
      
      // Náhodné parametre pre každé srdiečko
      const left = 30 + Math.random() * 40; // V strede obrazovky
      const scale = 0.5 + Math.random() * 0.8;
      const duration = 2 + Math.random() * 1.5;
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      heart.style.left = `${left}vw`;
      heart.style.bottom = `10vh`;
      heart.style.fontSize = `${20 * scale}px`;
      heart.style.color = color;
      heart.style.animationDuration = `${duration}s`;
      
      container.appendChild(heart);
      
      // Odstránenie srdiečka po skončení animácie
      setTimeout(() => {
        heart.remove();
      }, duration * 1000);
    }, i * 150);
  }
}

// Zobrazenie Toast notifikácie
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').innerText = message;
  
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// Kopírovanie kódu izby
function setupCopyCodeEvent(code, elementId = 'copy-code-btn') {
  setTimeout(() => {
    const btn = document.getElementById(elementId);
    if (btn) {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code).then(() => {
          showToast("Kód bol skopírovaný do schránky!");
        }).catch(err => {
          console.error("Nepodarilo sa skopírovať", err);
        });
      });
    }
  }, 100);
}

// Globálny lapač nechytených chýb z Firebase (napr. chýbajúce oprávnenia, nepovolená DB)
window.addEventListener('unhandledrejection', (event) => {
  console.error('Nechytená chyba (Promise Rejection):', event.reason);
  const statusEl = document.getElementById('async-status-info');
  if (statusEl && (state.mode === 'async')) {
    const errorMsg = event.reason && (event.reason.message || event.reason.toString()) || 'Neznáma sieťová chyba';
    
    let userHelp = "";
    if (errorMsg.includes('permission-denied') || errorMsg.includes('Missing or insufficient permissions')) {
      userHelp = "<br><br><strong>Riešenie:</strong> V záložke <em>Rules</em> vo vašej Firestore databáze povoľte verejné čítanie/zápis:<br><code>allow read, write: if true;</code>";
    } else if (errorMsg.includes('not-found') || errorMsg.includes('database') || errorMsg.includes('exist')) {
      userHelp = "<br><br><strong>Riešenie:</strong> Otvorte <em>Firestore Database</em> v konzole a uistite sa, že ste ju vytvorili kliknutím na tlačidlo <em>Create database</em>.";
    }

    statusEl.innerHTML = `
      <div style="color:#ef4444; text-align:left; font-size:0.9rem; line-height:1.4; margin-top:0.5rem; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.8rem; border-radius: 8px; background: rgba(239, 68, 68, 0.05);">
        <i class="fas fa-times-circle"></i> <strong>Chyba databázy:</strong> ${errorMsg}${userHelp}
      </div>
    `;
  }
});
