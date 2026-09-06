// --- Firebase 設定 (自分のプロジェクトのキーに書き換えてください) ---
const firebaseConfig = {
    apiKey: "AIzaSyDAZm_VV_n3xoFUqvQTfH6_epkeclvCQwg",
    authDomain: "re-verse-feebc.firebaseapp.com",
    projectId: "re-verse-feebc",
    storageBucket: "re-verse-feebc.firebasestorage.app",
    messagingSenderId: "649007078213",
    appId: "1:649007078213:web:71194fbf10ed87a74e3c2c"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- ゲーム変数 ---
let roomId = "";
let myRole = ""; // "p1" or "p2"
let myPos = 0;
let enemyPos = 0;
let selectedMove = -1;
let selectedPred = -1;
let isFeint = false;
let feintLeft = 3;
let timerInterval;

// --- DOM要素 ---
const lobbyScreen = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const boardEl = document.getElementById('board');
const statusMsg = document.getElementById('status-msg');
const btnSubmit = document.getElementById('btn-submit');
const btnFeint = document.getElementById('btn-feint');

// --- 初期化 ---
function initBoard() {
    boardEl.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = i;
        cell.addEventListener('click', () => handleCellClick(i));
        boardEl.appendChild(cell);
    }
}

// ルーム参加
document.getElementById('btn-join').onclick = async () => {
    const id = document.getElementById('room-id').value;
    if (id.length < 3) return alert("Room IDを入力してください");
    roomId = id;
    joinRoom(id);
};

async function joinRoom(id) {
    const roomRef = db.collection('rooms').doc(id);
    const doc = await roomRef.get();

    if (!doc.exists) {
        // P1として作成
        myRole = 'p1';
        myPos = 12; // 真ん中
        enemyPos = 12;
        await roomRef.set({
            status: 'waiting',
            p1: { hp: 5, pos: 12, ready: false, move: -1, pred: -1, feint: false },
            p2: { hp: 5, pos: 12, ready: false, move: -1, pred: -1, feint: false },
            turn: 1,
            lastAction: Date.now()
        });
        document.getElementById('lobby-msg').innerText = "対戦相手を待っています...";
    } else {
        // P2として参加
        myRole = 'p2';
        myPos = 12;
        await roomRef.update({
            status: 'playing',
            'p2.pos': 12
        });
    }

    // リアルタイムリスナー開始
    roomRef.onSnapshot(snapshot => {
        updateGameState(snapshot.data());
    });
}

function updateGameState(data) {
    if (!data) return;

    if (data.status === 'playing') {
        lobbyScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        updateUI(data);
    }

    // 両者準備完了時の判定
    if (data.p1.ready && data.p2.ready) {
        if (myRole === 'p1') resolveTurn(data);
    }

    // 勝敗判定
    if (data.p1.hp <= 0 || data.p2.hp <= 0) {
        showResult(data);
    }
}

function updateUI(data) {
    document.getElementById('p1-hp-text').innerText = `HP: ${data.p1.hp}`;
    document.getElementById('p2-hp-text').innerText = `HP: ${data.p2.hp}`;
    document.getElementById('p1-hp-fill').style.width = (data.p1.hp * 20) + '%';
    document.getElementById('p2-hp-fill').style.width = (data.p2.hp * 20) + '%';
    document.getElementById('turn-display').innerText = `TURN ${data.turn}`;

    const me = data[myRole];
    myPos = me.pos;
    
    // 盤面描画
    initBoard();
    const cells = document.querySelectorAll('.cell');
    
    // 自分の位置と移動可能範囲
    cells[myPos].innerHTML = '<span class="p1-token">●</span>';
    getAdjacent(myPos).forEach(idx => {
        cells[idx].classList.add('selectable-move');
    });

    // 予測モード（移動先を選んだ後）
    if (selectedMove !== -1) {
        cells[selectedMove].classList.add('active-move');
        for(let i=0; i<25; i++) cells[i].classList.add('selectable-pred');
    }
    if (selectedPred !== -1) {
        cells[selectedPred].classList.add('active-pred');
    }
}

function getAdjacent(pos) {
    const adj = [];
    const x = pos % 5, y = Math.floor(pos / 5);
    if (x > 0) adj.push(pos - 1);
    if (x < 4) adj.push(pos + 1);
    if (y > 0) adj.push(pos - 5);
    if (y < 4) adj.push(pos + 5);
    return adj;
}

function handleCellClick(idx) {
    const adj = getAdjacent(myPos);
    if (selectedMove === -1 && adj.includes(idx)) {
        selectedMove = idx;
        statusMsg.innerText = "NEXT: PREDICT ENEMY MOVE";
    } else if (selectedMove !== -1) {
        selectedPred = idx;
        btnSubmit.disabled = false;
        statusMsg.innerText = "READY TO LOCK IN";
    }
    // 再描画的な処理をトリガー（簡易的に再描画はFirestore経由でなくローカルUI更新でも良いが今回はシンプルに）
}

btnFeint.onclick = () => {
    if (feintLeft > 0) {
        isFeint = !isFeint;
        btnFeint.classList.toggle('active');
        btnFeint.innerText = `FEINT (${isFeint ? feintLeft-1 : feintLeft})`;
    }
};

btnSubmit.onclick = async () => {
    const roomRef = db.collection('rooms').doc(roomId);
    const updates = {};
    updates[`${myRole}.move`] = selectedMove;
    updates[`${myRole}.pred`] = selectedPred;
    updates[`${myRole}.ready`] = true;
    updates[`${myRole}.feint`] = isFeint;
    
    await roomRef.update(updates);
    btnSubmit.disabled = true;
    statusMsg.innerText = "WAITING FOR ENEMY...";
};

// ターンの解決（P1側だけで計算して結果を書き込む）
async function resolveTurn(data) {
    let p1hp = data.p1.hp;
    let p2hp = data.p2.hp;

    // 判定：P1の予測がP2の移動先と一致
    if (data.p1.pred === data.p2.move) p2hp -= 1;
    // 判定：P2の予測がP1の移動先と一致
    if (data.p2.pred === data.p1.move) p1hp -= 1;

    await db.collection('rooms').doc(roomId).update({
        'p1.hp': p1hp,
        'p2.hp': p2hp,
        'p1.pos': data.p1.move,
        'p2.pos': data.p2.move,
        'p1.ready': false,
        'p2.ready': false,
        turn: data.turn + 1
    });

    selectedMove = -1;
    selectedPred = -1;
    isFeint = false;
}

function showResult(data) {
    const overlay = document.getElementById('result-overlay');
    const title = document.getElementById('result-title');
    overlay.classList.remove('hidden');
    
    const win = (myRole === 'p1' && data.p2.hp <= 0) || (myRole === 'p2' && data.p1.hp <= 0);
    title.innerText = win ? "VICTORY" : "DEFEAT";
    title.style.color = win ? "var(--neon-blue)" : "var(--neon-pink)";
}
