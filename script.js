// =========================================
// RE:VERSE // THE FINAL TERMINAL v3.0
// =========================================

// --- Firebase初期化（自身のプロジェクト設定を反映させてください） ---
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

// --- ランク定数 ---
const RANK_NAMES = ["C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+", "S"];

// --- グローバル変数 ---
let agent = { name: "", protocol: "", pts: 0, level: 0 };
let myId = ""; // "p1" or "p2"
let roomId = "";
let roomData = null;
let selectedIdx = -1;
let timerInt = null;
let alreadyProcessedResult = false;

// --- 1. アカウント管理システム ---
window.onload = () => {
    loadLocalAccount();
    create6x6Board();
    listenToNetworkSignals();
};

function loadLocalAccount() {
    const saved = localStorage.getItem('REVERSE_PROFILE');
    if (!saved) {
        showScreen('screen-auth');
    } else {
        agent = JSON.parse(saved);
        syncAccountWithServer();
        updateProfileUI();
        showScreen('screen-lobby');
    }
}

async function syncAccountWithServer() {
    // サーバーから最新のポイント・ランク情報を取得
    const doc = await db.collection('users').doc(agent.protocol).get();
    if (doc.exists) {
        agent = doc.data();
        updateProfileUI();
    }
}

document.getElementById('btn-auth-save').onclick = async () => {
    const n = document.getElementById('reg-name').value.trim();
    const p = document.getElementById('reg-id').value.trim();
    if (!n || !p) return alert("識別情報が不足しています。");

    agent = { name: n, protocol: p, pts: 0, level: 0 };
    await db.collection('users').doc(p).set(agent);
    localStorage.setItem('REVERSE_PROFILE', JSON.stringify(agent));
    
    updateProfileUI();
    showScreen('screen-lobby');
};

function updateProfileUI() {
    document.getElementById('display-name').innerText = agent.name;
    document.getElementById('display-protocol').innerText = `PROTOCOL-ID: [ ${agent.protocol} ]`;
    document.getElementById('display-rank').innerText = RANK_NAMES[agent.level];
    document.getElementById('display-pt').innerText = agent.pts;
    document.getElementById('xp-fill').style.width = agent.pts + "%";
}

// --- 2. マッチングシステム ---

// ロビー右側のシグナル一覧表示
function listenToNetworkSignals() {
    db.collection('rooms').where('status', '==', 'waiting').limit(10).onSnapshot(qs => {
        const list = document.getElementById('room-status-list');
        list.innerHTML = "";
        qs.forEach(doc => {
            const data = doc.data();
            list.innerHTML += `
                <div class="room-node">
                    <div class="node-info">ID: ${doc.id} / HOST: ${data.p1.name}</div>
                    <button class="join-btn" onclick="manualJoin('${doc.id}')" style="cursor:pointer; color:var(--neon-blue); background:none; border:1px solid;">ACCESS</button>
                </div>`;
        });
    });
}

function manualJoin(id) { document.getElementById('custom-room-id').value = id; }

// ルームキー入力入室
document.getElementById('btn-room-enter').onclick = () => {
    const id = document.getElementById('custom-room-id').value.trim();
    const allowAuto = document.querySelector('input[name="auto-allow"]:checked').value === "true";
    if (id.length < 3) return alert("IDが短すぎます");
    enterRoom(id, allowAuto);
};

// クイックマッチ (空いている自動許可ルームを探す)
document.getElementById('btn-auto-match').onclick = async () => {
    const btn = document.getElementById('btn-auto-match');
    btn.innerText = "SIGNAL SCANNING...";
    
    const snap = await db.collection('rooms')
        .where('status', '==', 'waiting')
        .where('allowAuto', '==', true)
        .limit(1).get();

    if (snap.empty) {
        // 見つからなければ新しくルームを作成
        const rid = "R-" + Math.floor(1000 + Math.random() * 9000);
        enterRoom(rid, true);
    } else {
        enterRoom(snap.docs[0].id, true);
    }
};

async function enterRoom(id, allowAuto) {
    roomId = id;
    const roomRef = db.collection('rooms').doc(id);
    const doc = await roomRef.get();

    if (!doc.exists) {
        myId = "p1"; // 先攻・ホスト（丸）
        await roomRef.set({
            status: "waiting",
            allowAuto: allowAuto,
            attacker: "p1", // 最初はP1が予測番
            turn: 1,
            p1: { name: agent.name, rank: RANK_NAMES[agent.level], hp: 5, pos: 32, ready: false, choice: -1 }, // 下段中央寄り
            p2: { name: "...", rank: "-", hp: 5, pos: 3, ready: false, choice: -1 } // 上段中央寄り
        });
    } else {
        myId = "p2"; // 後攻（三角）
        await roomRef.update({
            status: "playing",
            p2: { name: agent.name, rank: RANK_NAMES[agent.level], hp: 5, pos: 3, ready: false, choice: -1 }
        });
    }

    roomRef.onSnapshot(s => gameCycle(s.data()));
}

// --- 3. ゲームサイクルロジック ---

function gameCycle(data) {
    if (!data || data.status === "waiting") return;
    roomData = data;
    alreadyProcessedResult = false;
    showScreen('screen-game');

    const enemyId = (myId === "p1") ? "p2" : "p1";
    const me = data[myId];
    const em = data[enemyId];

    // HUD更新
    document.getElementById('enemy-name').innerText = em.name;
    document.getElementById('enemy-rank').innerText = em.rank;
    document.getElementById('hp-bar-enemy').style.width = (em.hp * 20) + "%";
    document.getElementById('my-name').innerText = me.name;
    document.getElementById('my-rank').innerText = me.rank;
    document.getElementById('hp-bar-mine').style.width = (me.hp * 20) + "%";
    document.getElementById('round-indicator').innerText = `TURN ${data.turn}`;

    // 攻守判定
    const isAttacker = (data.attacker === myId);
    document.getElementById('current-phase').innerText = isAttacker ? "EXECUTE: ATTACK" : "EVADE: DEFENSE";
    document.getElementById('instr-message').innerText = isAttacker 
        ? "ターゲットの回避先を特定し、選択せよ。" 
        : "敵機の予測範囲外へ退避せよ。最上段/最下段へ到達で勝利。";

    renderGrid(data, isAttacker);

    // タイマー管理 (自分がまだ選択していない時だけ開始)
    if (!me.ready) {
        startCombatTimer();
    } else {
        clearInterval(timerInt);
        document.getElementById('btn-lockin').innerText = "DATA UPLOADING...";
    }

    // ホスト(P1)による判定処理
    if (data.p1.ready && data.p2.ready && myId === "p1") {
        setTimeout(() => resolveBattlePhase(data), 1200);
    }

    // 勝敗チェック
    checkWinCondition(data);
}

// 判定ロジック
async function resolveBattlePhase(data) {
    let p1hp = data.p1.hp; let p2hp = data.p2.hp;
    let p1pos = data.p1.pos; let p2pos = data.p2.pos;
    let bannerType = "";

    const attacker = data.attacker;
    const defender = (attacker === "p1") ? "p2" : "p1";

    // 的中判定 (予測した場所と移動先が一致)
    if (data[attacker].choice === data[defender].choice) {
        if (defender === "p1") p1hp--; else p2hp--;
        bannerType = "CRITICAL_HIT!!";
    } else {
        bannerType = "MISS / ESCAPED";
    }

    // ポジション確定（逃げている側の位置を移動させる）
    if (attacker === "p1") p2pos = data.p2.choice; else p1pos = data.p1.choice;

    selectedIdx = -1;
    await db.collection('rooms').doc(roomId).update({
        "p1.hp": p1hp, "p1.pos": p1pos, "p1.ready": false, "p1.choice": -1,
        "p2.hp": p2hp, "p2.pos": p2pos, "p2.ready": false, "p2.choice": -1,
        attacker: (attacker === "p1" ? "p2" : "p1"), // 攻守交替
        turn: data.turn + 1,
        lastBanner: bannerType // 演出用
    });
}

// --- 4. 勝利条件・演出 ---

function checkWinCondition(data) {
    let winner = null;
    // HP ゼロ
    if (data.p1.hp <= 0) winner = "p2";
    if (data.p2.hp <= 0) winner = "p1";
    // 陣地到達 (P1は一番上[0-5]へ、P2は一番下[30-35]へ)
    if (data.p1.pos <= 5) winner = "p1";
    if (data.p2.pos >= 30) winner = "p2";

    if (winner && !alreadyProcessedResult) {
        endGame(winner);
    }
    
    // バナー演出
    if (data.lastBanner) {
        triggerBanner(data.lastBanner);
    }
}

async function endGame(winner) {
    alreadyProcessedResult = true;
    const isWin = (myId === winner);
    
    // XP計算
    let diff = -10; // 敗北は一律-10
    if (isWin) {
        diff = Math.max(20, 45 - roomData.turn); // ターン数が短いほど高得点
    }
    
    agent.pts += diff;
    // ランク昇降
    if (agent.pts >= 100) { if (agent.level < 9) { agent.level++; agent.pts = 0; } else { agent.pts = 100; } }
    if (agent.pts < 0) { if (agent.level > 0) { agent.level--; agent.pts = 90; } else { agent.pts = 0; } }

    await db.collection('users').doc(agent.protocol).set(agent);
    localStorage.setItem('REVERSE_PROFILE', JSON.stringify(agent));

    showFinalOverlay(isWin);
}

// --- 5. UI/盤面描画用補助 ---

function renderGrid(data, isAttacker) {
    const board = document.getElementById('board-6x6');
    board.innerHTML = "";
    const me = data[myId];
    const adj = getAdj(me.pos);

    for (let i = 0; i < 36; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (i < 6) cell.classList.add('home-enemy'); // 上端は敵陣
        if (i > 29) cell.classList.add('home-mine'); // 下端は自陣
        
        // P1=Round, P2=Triangle (固定表示)
        if (i === data.p1.pos) cell.innerHTML = '<div class="round-p1"></div>';
        if (i === data.p2.pos) cell.innerHTML = '<div class="triangle-p2"></div>';

        if (!me.ready) {
            if (isAttacker) cell.classList.add('can-pred');
            else if (adj.includes(i)) cell.classList.add('can-move');

            cell.onclick = () => {
                if (!isAttacker && !adj.includes(i)) return;
                selectedIdx = i;
                renderSelection(i);
            };
        }
        board.appendChild(cell);
    }
}

function renderSelection(idx) {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(c => c.classList.remove('active'));
    cells[idx].classList.add('active');
    document.getElementById('btn-lockin').disabled = false;
    document.getElementById('btn-lockin').innerText = "LOCK_AND_LOAD";
}

document.getElementById('btn-lockin').onclick = async () => {
    if (selectedIdx === -1) return;
    clearInterval(timerInt);
    await db.collection('rooms').doc(roomId).update({ [`${myId}.ready`]: true, [`${myId}.choice`]: selectedIdx });
};

// 10秒セグメントタイマー
function startCombatTimer() {
    let s = 10;
    const segs = document.getElementById('timer-segments');
    segs.innerHTML = "";
    for(let i=0; i<10; i++) segs.innerHTML += `<div class="timer-seg active"></div>`;
    document.getElementById('sec-num').innerText = s;

    clearInterval(timerInt);
    timerInt = setInterval(() => {
        s--;
        document.getElementById('sec-num').innerText = s;
        const allSegs = document.querySelectorAll('.timer-seg');
        if (allSegs[s]) allSegs[s].classList.remove('active');
        if (s <= 0) {
            clearInterval(timerInt);
            autoSelectAction();
        }
    }, 1000);
}

function autoSelectAction() {
    // タイムオーバー時の強制決定
    if (selectedIdx === -1) {
        selectedIdx = (roomData.attacker === myId) ? Math.floor(Math.random()*36) : getAdj(roomData[myId].pos)[0];
    }
    document.getElementById('btn-lockin').click();
}

function triggerBanner(text) {
    const b = document.getElementById('big-banner');
    b.innerText = text;
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 1500);
}

// 画面遷移
function showScreen(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    document.getElementById(id).classList.add('view-transition-anim');
}

// ヘルパー：隣接マスの計算
function getAdj(pos) {
    const res = [];
    const x = pos % 6, y = Math.floor(pos / 6);
    if (x > 0) res.push(pos - 1); if (x < 5) res.push(pos + 1);
    if (y > 0) res.push(pos - 6); if (y < 5) res.push(pos + 6);
    return res;
}

// リザルト画面の生成（簡易）
function showFinalOverlay(win) {
    document.getElementById('result-screen').classList.remove('hidden');
    document.getElementById('res-status-title').innerText = win ? "MISSION COMPLETE" : "DISCONNECTED";
    document.getElementById('res-status-title').style.color = win ? "var(--neon-blue)" : "var(--neon-red)";
}
