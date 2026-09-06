// =========================================
// RE:VERSE - TACTICAL TERMINAL ENGINE v1.0
// =========================================

// --- [重要] Firebase初期設定 ---
// ここをご自身のFirebaseコンソールで取得した値に差し替えてください
const firebaseConfig = {
    apiKey: "AIzaSyDAZm_VV_n3xoFUqvQTfH6_epkeclvCQwg",
    authDomain: "re-verse-feebc.firebaseapp.com",
    projectId: "re-verse-feebc",
    storageBucket: "re-verse-feebc.firebasestorage.app",
    messagingSenderId: "649007078213",
    appId: "1:649007078213:web:71194fbf10ed87a74e3c2c"
};

// Firebase初期化
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- ゲーム内定数 & 状態 ---
let roomId = "";
let myRole = ""; // 'p1' or 'p2'
let currentTurnData = null;

// 操作フェーズの状態
let selectedMoveIdx = -1;
let selectedPredIdx = -1;
let feintActive = false;
let feintsRemaining = 3;
let timerTime = 10;
let timerId = null;

// --- 初期ロード時の処理 ---
document.addEventListener('DOMContentLoaded', () => {
    initLobby();
    createBoard();
});

// --- ロビー / ネットワーク処理 ---
function initLobby() {
    const btnJoin = document.getElementById('btn-join');
    const inputRoom = document.getElementById('room-id');

    btnJoin.onclick = async () => {
        const id = inputRoom.value.trim();
        if (id.length < 3) {
            logToSystem("警告: ルームIDが短すぎます。");
            return;
        }
        roomId = id;
        btnJoin.innerText = "接続中...";
        btnJoin.disabled = true;
        await startConnection(id);
    };
}

async function startConnection(id) {
    const roomRef = db.collection('rooms').doc(id);
    const doc = await roomRef.get();

    if (!doc.exists) {
        // P1（ホスト）として参加
        myRole = 'p1';
        await roomRef.set({
            status: 'waiting',
            p1: { hp: 5, pos: 12, ready: false, move: -1, pred: -1, feint: false },
            p2: { hp: 5, pos: 12, ready: false, move: -1, pred: -1, feint: false },
            turn: 1,
            logs: ["セッション開始: 待機中..."]
        });
        logToSystem("サーバー構築完了。相手の接続を待機しています...");
    } else {
        // P2（クライアント）として参加
        myRole = 'p2';
        await roomRef.update({
            status: 'playing',
            logs: firebase.firestore.FieldValue.arrayUnion("P2 接続完了: 対戦を開始します")
        });
        logToSystem("セッション侵入成功。対戦を開始します。");
    }

    // リアルタイムリスナーの登録
    roomRef.onSnapshot(snapshot => {
        const data = snapshot.data();
        if (!data) return;
        currentTurnData = data;
        syncGameState(data);
    });
}

// --- 画面更新ロジック ---
function syncGameState(data) {
    if (data.status === 'playing' || data.status === 'resolving') {
        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('game').classList.remove('hidden');
        document.getElementById('room-display').innerText = `NODE: ${roomId}`;
        
        // HPバー更新
        updateHUI(data.p1.hp, data.p2.hp);
        document.getElementById('turn-count').innerText = String(data.turn).padStart(2, '0');

        // ログの反映
        if (data.logs) {
            const logEl = document.getElementById('game-logs');
            logEl.innerHTML = data.logs.slice(-5).map(l => `<div class="log-entry">${l}</div>`).join('');
        }

        // 両者準備完了かつ自分がP1なら計算を実行
        if (data.p1.ready && data.p2.ready && myRole === 'p1') {
            resolveBattle(data);
        }

        // 自分の操作ターン開始（未送信ならタイマー始動）
        if (!data[myRole].ready && !timerId) {
            startTurnTimer();
        }

        renderBoard(data);
    }

    // 勝敗チェック
    if (data.p1.hp <= 0 || data.p2.hp <= 0) {
        showFinalResult(data);
    }
}

function updateHUI(p1hp, p2hp) {
    document.getElementById('p1-hp-text').innerText = `${p1hp * 20}%`;
    document.getElementById('p2-hp-text').innerText = `${p2hp * 20}%`;
    document.getElementById('p1-hp-fill').style.width = `${p1hp * 20}%`;
    document.getElementById('p2-hp-fill').style.width = `${p2hp * 20}%`;
}

// --- ボード描画・操作 ---
function createBoard() {
    const grid = document.getElementById('board-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.id = `cell-${i}`;
        cell.onclick = () => onCellSelect(i);
        grid.appendChild(cell);
    }
}

function renderBoard(data) {
    const me = data[myRole];
    const enemy = data[myRole === 'p1' ? 'p2' : 'p1'];

    // 一旦リセット
    document.querySelectorAll('.cell').forEach(el => {
        el.className = 'cell';
        el.innerHTML = '';
    });

    // 自分の駒を描画
    const myCell = document.getElementById(`cell-${me.pos}`);
    myCell.classList.add('my-pos');
    myCell.innerHTML = '<div class="p1-token"></div>';

    // 自分が準備中の場合、ヒントを表示
    if (!me.ready) {
        if (selectedMoveIdx === -1) {
            // 移動可能な場所を強調（上下左右）
            getAdjacent(me.pos).forEach(idx => {
                document.getElementById(`cell-${idx}`).classList.add('can-move');
            });
            updateTaskMessage("STEP 1", "上下左右から、次の移動先を確定させよ");
        } else if (selectedPredIdx === -1) {
            // 予測可能な場所を強調
            for (let i = 0; i < 25; i++) {
                document.getElementById(`cell-${i}`).classList.add('can-pred');
            }
            document.getElementById(`cell-${selectedMoveIdx}`).classList.add('selected-move');
            updateTaskMessage("STEP 2", "敵機の次の移動位置を予測し、マークせよ");
        } else {
            // 両方選択済み
            document.getElementById(`cell-${selectedMoveIdx}`).classList.add('selected-move');
            document.getElementById(`cell-${selectedPredIdx}`).classList.add('selected-pred');
            updateTaskMessage("EXECUTE", "「確定・データ送信」を実行し、フェイズを完了させよ");
        }
    } else {
        updateTaskMessage("WAITING", "通信中... 対戦相手の思考を待機しています");
    }
}

// マスをクリックした時
function onCellSelect(idx) {
    if (currentTurnData[myRole].ready) return;

    if (selectedMoveIdx === -1) {
        // 移動選択
        if (getAdjacent(currentTurnData[myRole].pos).includes(idx)) {
            selectedMoveIdx = idx;
            playClickSound();
        }
    } else {
        // 予測選択
        selectedPredIdx = idx;
        playClickSound();
        document.getElementById('btn-submit').disabled = false;
    }
    renderBoard(currentTurnData);
}

// 確定ボタン
document.getElementById('btn-submit').onclick = async () => {
    if (selectedMoveIdx === -1 || selectedPredIdx === -1) return;

    // ボタンの振動演出
    document.getElementById('terminal-container').style.animation = "shake 0.2s";
    setTimeout(() => document.getElementById('terminal-container').style.animation = "", 200);

    const roomRef = db.collection('rooms').doc(roomId);
    const updates = {};
    updates[`${myRole}.move`] = selectedMoveIdx;
    updates[`${myRole}.pred`] = selectedPredIdx;
    updates[`${myRole}.feint`] = feintActive;
    updates[`${myRole}.ready`] = true;
    
    await roomRef.update(updates);
    
    clearInterval(timerId);
    timerId = null;
    logToSystem("データをアップロード中...");
};

// --- バトルロジック (P1側で1回だけ実行) ---
async function resolveBattle(data) {
    let p1hp = data.p1.hp;
    let p2hp = data.p2.hp;
    const logs = [`[TURN ${data.turn}] 解析完了`];

    // P1の攻撃判定
    if (data.p1.pred === data.p2.move) {
        p2hp -= 1;
        logs.push("P1: 予測成功、敵機への損傷を確認");
    }

    // P2の攻撃判定
    if (data.p2.pred === data.p1.move) {
        p1hp -= 1;
        logs.push("P2: 予測成功、こちらへの干渉を感知");
    }

    if (data.p1.pred !== data.p2.move && data.p2.pred !== data.p1.move) {
        logs.push("予測不一致、均衡を維持...");
    }

    // リセット
    selectedMoveIdx = -1;
    selectedPredIdx = -1;
    feintActive = false;

    await db.collection('rooms').doc(roomId).update({
        'p1.hp': p1hp,
        'p2.hp': p2hp,
        'p1.pos': data.p1.move,
        'p2.pos': data.p2.move,
        'p1.ready': false,
        'p2.ready': false,
        'p1.move': -1,
        'p1.pred': -1,
        'p2.move': -1,
        'p2.pred': -1,
        turn: data.turn + 1,
        logs: firebase.firestore.FieldValue.arrayUnion(...logs)
    });
}

// --- ユーティリティ ---
function getAdjacent(pos) {
    const res = [];
    const x = pos % 5, y = Math.floor(pos / 5);
    if (x > 0) res.push(pos - 1);
    if (x < 4) res.push(pos + 1);
    if (y > 0) res.push(pos - 5);
    if (y < 4) res.push(pos + 5);
    return res;
}

function startTurnTimer() {
    timerTime = 10;
    const fill = document.getElementById('timer-fill');
    if (timerId) clearInterval(timerId);
    
    timerId = setInterval(() => {
        timerTime -= 1;
        fill.style.width = `${timerTime * 10}%`;
        if (timerTime <= 0) {
            // 自動選択
            if (selectedMoveIdx === -1) selectedMoveIdx = getAdjacent(currentTurnData[myRole].pos)[0];
            if (selectedPredIdx === -1) selectedPredIdx = 0;
            document.getElementById('btn-submit').click();
        }
    }, 1000);
}

function updateTaskMessage(step, msg) {
    document.getElementById('current-task').innerHTML = `<span class="highlight">${step}</span><br>${msg}`;
}

function logToSystem(msg) {
    document.getElementById('lobby-msg').innerText = msg;
}

function showFinalResult(data) {
    const isWin = (myRole === 'p1' && data.p2.hp <= 0) || (myRole === 'p2' && data.p1.hp <= 0);
    const overlay = document.getElementById('result-overlay');
    const status = document.getElementById('result-status');
    
    overlay.classList.remove('hidden');
    status.innerText = isWin ? "MISSION COMPLETE" : "TERMINATED";
    status.className = isWin ? "res-win" : "res-lose";
    document.getElementById('res-rank').innerText = isWin ? "S" : "D";
    document.getElementById('result-desc').innerText = isWin 
        ? "対象機体の完全停止を確認。演算効率：最大" 
        : "こちらの思考を読み取られました。接続を強制終了します。";
}

// ダミー音（ブラウザの仕様により音声ファイルを設置しないと鳴りませんが、拡張用です）
function playClickSound() {
    // console.log("Beep!"); 
}
