// =============================================================================
// RE:VERSE // PROJECT-AI ELITE SYSTEM ENGINE v3.5
// [RE-CONSTRUCTED FOR EXTREME INTERFACE FEEDBACK]
// =============================================================================

// --- 0. [FIREBASE 設定] ---
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

// --- 1. [定数 & アカウント定義] ---
const RANK_NAMES = ["C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+", "S"];
let agentProfile = { name: "", protocol: "", pts: 0, level: 0 };
let currentRoomId = "";
let myRole = ""; // "p1"(Round) or "p2"(Triangle)
let selectedIdx = -1;
let battleTimerInt = null;
let currentRoomData = null;
let isResultProcessed = false;

// --- 2. [初期化・アカウントシステム] ---
window.onload = () => {
    setupProfile();
    initSignalLog();
    initGridBoard();
};

function setupProfile() {
    const saved = localStorage.getItem('REVERSE_PROFILE_V35');
    if (!saved) {
        switchView('screen-auth');
    } else {
        agentProfile = JSON.parse(saved);
        refreshHeaderUI();
        switchView('screen-lobby');
    }
}

document.getElementById('btn-auth-save').onclick = async () => {
    const nameInput = document.getElementById('reg-name').value.trim();
    const idInput = document.getElementById('reg-id').value.trim();
    
    if (nameInput.length < 2 || idInput.length < 3) return alert("認証失敗: 有効な識別コードを入力せよ。");

    agentProfile = {
        name: nameInput,
        protocol: idInput,
        pts: 0,
        level: 0
    };

    await db.collection('users').doc(idInput).set(agentProfile);
    localStorage.setItem('REVERSE_PROFILE_V35', JSON.stringify(agentProfile));
    
    refreshHeaderUI();
    switchView('screen-lobby');
};

document.getElementById('btn-edit-account').onclick = () => switchView('screen-auth');

function refreshHeaderUI() {
    document.getElementById('display-name').innerText = agentProfile.name;
    const rankLabel = RANK_NAMES[agentProfile.level];
    document.getElementById('display-rank').innerText = rankLabel;
    document.getElementById('display-pt').innerText = agentProfile.pts;
    document.getElementById('xp-fill-active').style.width = agentProfile.pts + "%";
}

// --- 3. [マッチングロジック] ---

function initSignalLog() {
    // 待機中のルームをスキャン
    db.collection('rooms').where('status', '==', 'waiting').limit(10).onSnapshot(qs => {
        const logArea = document.getElementById('room-status-list');
        if(qs.empty) {
            logArea.innerHTML = '<div class="placeholder-log">NO SIGNALS DETECTED.</div>';
            return;
        }
        logArea.innerHTML = "";
        qs.forEach(doc => {
            const data = doc.data();
            const node = document.createElement('div');
            node.className = 'room-node';
            node.innerHTML = `
                <div class="node-info">ADDR: ${doc.id} / HOST: ${data.p1.name} [${data.p1.rank}]</div>
                <button onclick="quickSelectId('${doc.id}')" style="background:none; color:cyan; border:1px solid; cursor:pointer;">CONNECT</button>
            `;
            logArea.appendChild(node);
        });
    });
}

function quickSelectId(id) {
    document.getElementById('custom-room-id').value = id;
}

// 自動マッチ
document.getElementById('btn-auto-match').onclick = async () => {
    const searchBtn = document.getElementById('btn-auto-match');
    searchBtn.innerText = "LINKING TO RANDOM NODE...";
    
    const snap = await db.collection('rooms')
        .where('status', '==', 'waiting')
        .where('autoAllow', '==', true)
        .limit(1).get();

    if (snap.empty) {
        createAndEnterRoom("Q-" + Math.floor(1000 + Math.random() * 8999), true);
    } else {
        createAndEnterRoom(snap.docs[0].id, true);
    }
};

// 特定ルーム接続
document.getElementById('btn-room-enter').onclick = () => {
    const rId = document.getElementById('custom-room-id').value.trim();
    const isAllowAuto = document.querySelector('input[name="auto-allow"]:checked').value === "true";
    if (!rId) return alert("ルームIDを入力してください。");
    createAndEnterRoom(rId, isAllowAuto);
};

async function createAndEnterRoom(rId, autoFlag) {
    currentRoomId = rId;
    const roomRef = db.collection('rooms').doc(rId);
    const doc = await roomRef.get();

    if (!doc.exists) {
        myRole = "p1"; // 先攻・丸
        await roomRef.set({
            status: "waiting",
            autoAllow: autoFlag,
            attacker: "p1", // 最初はP1(下からスタート)が予測者
            turn: 1,
            lastResultBanner: "",
            p1: { name: agentProfile.name, protocol: agentProfile.protocol, rank: RANK_NAMES[agentProfile.level], hp: 5, pos: 32, ready: false, choice: -1 }, // 下段
            p2: { name: "PENDING...", protocol: "", rank: "--", hp: 5, pos: 3, ready: false, choice: -1 } // 上段
        });
    } else {
        myRole = "p2"; // 後攻・三角
        await roomRef.update({
            status: "playing",
            p2: { name: agentProfile.name, protocol: agentProfile.protocol, rank: RANK_NAMES[agentProfile.level], hp: 5, pos: 3, ready: false, choice: -1 }
        });
    }

    roomRef.onSnapshot(snapshot => {
        const data = snapshot.data();
        if(!data) return;
        currentRoomData = data;
        processBattleState(data);
    });
}

// --- 4. [メインバトルサイクル] ---

function processBattleState(data) {
    if (data.status === "playing") {
        isResultProcessed = false;
        switchView('screen-game');
        syncUI(data);

        const me = data[myRole];
        if (!me.ready) {
            startTimer();
        } else {
            clearInterval(battleTimerInt);
            document.getElementById('btn-lockin').innerText = "DATA SYNC...";
        }

        // バナー演出 (的中成功！など)
        if (data.lastResultBanner) {
            showBigBanner(data.lastResultBanner);
        }

        // ホスト(P1)が判定を実行
        if (data.p1.ready && data.p2.ready && myRole === "p1") {
            setTimeout(() => calculatePhaseResult(data), 1000);
        }
        
        // 勝敗判定
        checkFinalWin(data);
    }
}

function syncUI(data) {
    const enemyKey = (myRole === "p1") ? "p2" : "p1";
    const em = data[enemyKey];
    const me = data[myRole];

    // HUD (敵情報：上)
    document.getElementById('enemy-name').innerText = em.name;
    document.getElementById('enemy-rank-big').innerText = em.rank;
    document.getElementById('hp-bar-enemy').style.width = (em.hp * 20) + "%";
    document.getElementById('enemy-hp-txt').innerText = (em.hp * 20) + "%";

    // HUD (自分情報：下)
    document.getElementById('my-name').innerText = me.name;
    document.getElementById('my-rank-big').innerText = me.rank;
    document.getElementById('hp-bar-mine').style.width = (me.hp * 20) + "%";
    document.getElementById('my-hp-txt').innerText = (me.hp * 20) + "%";

    document.getElementById('round-indicator').innerText = `TURN: ${String(data.turn).padStart(2, '0')}`;

    const amIAttacking = (data.attacker === myId);
    const tag = document.getElementById('phase-tag');
    tag.innerText = amIAttacking ? "ATTACKER" : "EVADER";
    tag.style.background = amIAttacking ? "var(--p2-neon)" : "var(--p1-neon)";
    
    document.getElementById('instr-message').innerText = amIAttacking
        ? "> TARGETの予測位置を指定せよ。"
        : "> 移動して予測攻撃を回避せよ。端への到達は「勝ち」だ。";

    drawBoard(data);
}

// 判定ロジック
async function calculatePhaseResult(data) {
    let p1hp = data.p1.hp; let p2hp = data.p2.hp;
    let p1pos = data.p1.pos; let p2pos = data.p2.pos;
    let bannerTxt = "";

    const attackerKey = data.attacker;
    const defenderKey = (attackerKey === "p1") ? "p2" : "p1";

    // 当たり判定
    if (data[attackerKey].choice === data[defenderKey].choice) {
        if (defenderKey === "p1") p1hp--; else p2hp--;
        bannerTxt = ">>> CRITICAL_HIT!! <<<";
    } else {
        bannerTxt = ">>> TARGET_ESCAPED <<<";
    }

    // 移動後のポジション確定
    if (attackerKey === "p1") p2pos = data.p2.choice; 
    else p1pos = data.p1.choice;

    await db.collection('rooms').doc(currentRoomId).update({
        'p1.hp': p1hp, 'p1.pos': p1pos, 'p1.ready': false, 'p1.choice': -1,
        'p2.hp': p2hp, 'p2.pos': p2pos, 'p2.ready': false, 'p2.choice': -1,
        attacker: (attackerKey === "p1" ? "p2" : "p1"),
        turn: data.turn + 1,
        lastResultBanner: bannerTxt
    });
    
    selectedIdx = -1;
}

// --- 5. [盤面制御 & ヘルパー] ---

function initGridBoard() {
    const board = document.getElementById('board-6x6');
    board.innerHTML = "";
    for(let i=0; i<36; i++) {
        const c = document.createElement('div');
        c.className = 'cell';
        if(i < 6) c.classList.add('goal-zone-p2'); // P2(三角)のゴール地点
        if(i > 29) c.classList.add('goal-zone-p1'); // P1(丸)のゴール地点
        c.id = `cell-${i}`;
        board.appendChild(c);
    }
}

function drawBoard(data) {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(c => { c.innerHTML = ""; c.className = "cell"; });
    
    const myPos = data[myRole].pos;
    const adj = getNeighbors(myPos);
    const amIAttacker = (data.attacker === myRole);

    // 駒配置
    document.getElementById(`cell-${data.p1.pos}`).innerHTML = '<div class="round-token"></div>';
    document.getElementById(`cell-${data.p2.pos}`).innerHTML = '<div class="triangle-token"></div>';

    // 陣地着色（背景復活）
    for(let i=0; i<36; i++) {
        if(i < 6) document.getElementById(`cell-${i}`).classList.add('goal-zone-p2');
        if(i > 29) document.getElementById(`cell-${i}`).classList.add('goal-zone-p1');
        
        // 選択肢ハイライト
        if (!data[myRole].ready) {
            if(amIAttacker) document.getElementById(`cell-${i}`).classList.add('can-pred');
            else if(adj.includes(i)) document.getElementById(`cell-${i}`).classList.add('can-move');
            
            document.getElementById(`cell-${i}`).onclick = () => {
                if(!amIAttacker && !adj.includes(i)) return;
                selectTile(i);
            };
        }
    }
    
    if (selectedIdx !== -1) {
        document.getElementById(`cell-${selectedIdx}`).classList.add('active');
    }
}

function selectTile(idx) {
    selectedIdx = idx;
    const all = document.querySelectorAll('.cell');
    all.forEach(c => c.classList.remove('active'));
    document.getElementById(`cell-${idx}`).classList.add('active');
    document.getElementById('btn-lockin').disabled = false;
}

document.getElementById('btn-lockin').onclick = async () => {
    if(selectedIdx === -1) return;
    await db.collection('rooms').doc(currentRoomId).update({
        [`${myRole}.choice`]: selectedIdx,
        [`${myRole}.ready`]: true
    });
};

function startTimer() {
    let timeLeft = 10;
    const stack = document.getElementById('timer-segments');
    stack.innerHTML = "";
    for(let i=0; i<10; i++) stack.innerHTML += '<div class="timer-seg lit"></div>';

    clearInterval(battleTimerInt);
    battleTimerInt = setInterval(() => {
        timeLeft--;
        document.getElementById('sec-num').innerText = timeLeft;
        const segs = document.querySelectorAll('.timer-seg');
        if(segs[timeLeft]) segs[timeLeft].classList.remove('lit');
        
        if(timeLeft <= 0) {
            clearInterval(battleTimerInt);
            // 強制決定ロジック
            if (selectedIdx === -1) {
                const myP = currentRoomData[myRole].pos;
                selectedIdx = (currentRoomData.attacker === myRole) ? 0 : getNeighbors(myP)[0];
            }
            document.getElementById('btn-lockin').click();
        }
    }, 1000);
}

// --- 6. [勝利判定・ポイント処理] ---

async function checkFinalWin(data) {
    let winnerKey = null;
    // 条件1: HP
    if (data.p1.hp <= 0) winnerKey = "p2";
    if (data.p2.hp <= 0) winnerKey = "p1";
    // 条件2: 陣地
    if (data.p1.pos <= 5) winnerKey = "p1"; // P1は上端(0-5)へ到達で勝ち
    if (data.p2.pos >= 30) winnerKey = "p2"; // P2は下端(30-35)へ到達で勝ち

    if (winnerKey && !isResultProcessed) {
        isResultProcessed = true;
        processWinXP(winnerKey === myRole, data.turn);
    }
}

async function processWinXP(isWin, turnCount) {
    let diff = -10;
    if(isWin) {
        diff = Math.max(25, 50 - turnCount);
        showBigBanner("OPERATION SUCCESSFUL");
    } else {
        showBigBanner("DISCONNECTED / TERMINATED");
    }

    agentProfile.pts += diff;
    
    // ランク処理
    if(agentProfile.pts >= 100 && agentProfile.level < RANK_NAMES.length-1) {
        agentProfile.level++; agentProfile.pts -= 100;
    } else if(agentProfile.pts < 0 && agentProfile.level > 0) {
        agentProfile.level--; agentProfile.pts += 100;
    } else if(agentProfile.pts < 0) {
        agentProfile.pts = 0;
    }

    await db.collection('users').doc(agentProfile.protocol).set(agentProfile);
    localStorage.setItem('REVERSE_PROFILE_V35', JSON.stringify(agentProfile));
    
    setTimeout(() => location.reload(), 4000);
}

// --- ユーティリティ ---
function switchView(id) {
    document.querySelectorAll('.terminal-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function showBigBanner(txt) {
    const b = document.getElementById('big-banner');
    b.innerText = txt;
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 1500);
}

function getNeighbors(pos) {
    const res = [];
    const x = pos % 6, y = Math.floor(pos / 6);
    if(x > 0) res.push(pos - 1); if(x < 5) res.push(pos + 1);
    if(y > 0) res.push(pos - 6); if(y < 5) res.push(pos + 6);
    return res;
}
