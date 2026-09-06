// =========================================
// RE:VERSE // TERMINAL CORE ENGINE v2.0
// =========================================

// --- [Firebase設定] あなたのAPIキーを入れてください ---
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
let myId = ""; // myRole: 'p1' or 'p2'
let myName = "";
let currentRoomId = "";
let gameState = null;
let selectedCellIndex = -1;

// --- 初期ロード時 ---
window.onload = () => {
    // 待機中のルームをリアルタイム監視
    listenToRooms();

    // 接続ボタン
    document.getElementById('btn-connect').onclick = () => {
        myName = document.getElementById('user-name').value.trim() || "NONAME_" + Math.floor(Math.random()*999);
        currentRoomId = document.getElementById('room-id').value.trim();
        if(!currentRoomId) return alert("侵入先のROOM_IDを入力してください");
        
        joinRoom(currentRoomId);
    };
};

// 待機ルームの一覧を表示・更新
function listenToRooms() {
    db.collection('rooms').where('status', '==', 'waiting').limit(5).onSnapshot(snapshot => {
        const listArea = document.getElementById('active-rooms');
        if (snapshot.empty) {
            listArea.innerHTML = '<div class="loading-status">待機セッションなし</div>';
            return;
        }
        listArea.innerHTML = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            const node = document.createElement('div');
            node.className = 'room-node';
            node.innerHTML = `
                <div class="node-info">
                    <span class="node-id">SEC_${doc.id}</span>
                    <span>HOST: ${data.p1.name}</span>
                </div>
                <button class="join-btn" style="padding: 5px 15px; background:transparent; border:1px solid #ff0044; color:#fff; cursor:pointer;" onclick="quickConnect('${doc.id}')">INVADE</button>
            `;
            listArea.appendChild(node);
        });
    });
}

function quickConnect(id) {
    document.getElementById('room-id').value = id;
}

// 参加 or ルーム作成
async function joinRoom(id) {
    const roomRef = db.collection('rooms').doc(id);
    const doc = await roomRef.get();

    if (!doc.exists) {
        // ホストとして作成 (初期位置を適当に割り振り)
        myId = 'p1';
        await roomRef.set({
            status: 'waiting',
            p1: { name: myName, hp: 5, pos: 2, ready: false, choice: -1 },
            p2: { name: "WAITING...", hp: 5, pos: 22, ready: false, choice: -1 },
            turn: 1,
            attacker: 'p1', // 最初の攻撃者はP1
            logs: ["接続を確立。対象の接続を待機中..."]
        });
    } else {
        // 参加者として接続
        myId = 'p2';
        await roomRef.update({
            status: 'playing',
            'p2.name': myName,
            logs: firebase.firestore.FieldValue.arrayUnion(`${myName} が侵入しました。`)
        });
    }

    document.getElementById('display-name').innerText = `ID: ${myName}`;

    // 部屋の状態を常に監視
    roomRef.onSnapshot(snapshot => {
        const data = snapshot.data();
        if(!data) return;
        gameState = data;
        updateGameUI(data);
    });
}

// --- メイン描画ループ ---
function updateGameUI(data) {
    if (data.status === 'playing') {
        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('game').classList.remove('hidden');

        const enemyId = (myId === 'p1') ? 'p2' : 'p1';
        const enemy = data[enemyId];
        const me = data[myId];

        // 1. HPの上下更新
        // 相手 (ターゲット：上)
        document.getElementById('p2-name-label').innerText = enemy.name;
        document.getElementById('p2-hp-val').innerText = enemy.hp * 20;
        document.getElementById('p2-hp-fill').style.width = (enemy.hp * 20) + '%';
        // 自分 (オペレーター：下)
        document.getElementById('p1-name-label').innerText = me.name;
        document.getElementById('p1-hp-val').innerText = me.hp * 20;
        document.getElementById('p1-hp-fill').style.width = (me.hp * 20) + '%';

        // 2. フェーズ表示
        const isAttacker = (data.attacker === myId);
        const banner = document.getElementById('phase-banner');
        banner.innerText = isAttacker ? "▶ ATTACK_PHASE // 敵機を予測せよ" : "▶ DEFENSE_PHASE // 移動して回避せよ";
        banner.style.background = isAttacker ? "var(--neon-red)" : "var(--neon-blue)";
        
        document.getElementById('instr-text').innerHTML = isAttacker 
            ? "相手が次に移動するマスを<br>直感的に選び、マークせよ。" 
            : "現在の位置から<br>隣接する安全なエリアへ<br>退避せよ。";

        // 3. ログの更新
        const logContent = document.getElementById('log-content');
        logContent.innerHTML = data.logs.slice(-6).map(line => `<div>${line}</div>`).join('');

        // 4. ボード描画
        renderBoard(data, isAttacker);

        // 5. ホストのみが実行する：全員レディならターン処理
        if(data.p1.ready && data.p2.ready && myId === 'p1') {
            resolveTurn(data);
        }
    }

    // 勝敗判定
    if (data.p1.hp <= 0 || data.p2.hp <= 0) {
        showFinalResult(data);
    }
}

function renderBoard(data, isAttacker) {
    const grid = document.getElementById('grid-board');
    grid.innerHTML = "";
    
    const myPos = data[myId].pos;
    const enemyId = (myId === 'p1') ? 'p2' : 'p1';
    const enemyPos = data[enemyId].pos;

    const meReady = data[myId].ready;
    const adjacent = getAdjacentCells(myPos);

    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        
        // 駒の配置 (自分：青、相手：赤)
        if(i === myPos) cell.innerHTML = '<div class="token-p1"></div>';
        if(i === enemyPos) cell.innerHTML = '<div class="token-p2"></div>';

        // 操作ガイド（自分が未確定のときだけ光る）
        if(!meReady) {
            if (isAttacker) {
                cell.classList.add('can-pred'); // 全て予測可能
            } else if (adjacent.includes(i)) {
                cell.classList.add('can-move'); // 隣接のみ移動可能
            }
        }

        // 自分が選択中のマス
        if (i === selectedCellIndex) {
            cell.classList.add('active');
        }

        // クリックイベント
        cell.onclick = () => {
            if(meReady) return; // 確定後は不可
            
            if (isAttacker) {
                selectedCellIndex = i;
            } else if (adjacent.includes(i)) {
                selectedCellIndex = i;
            } else {
                return; // 移動できないマス
            }
            document.getElementById('btn-action').disabled = false;
            updateGameUI(data); // 再描画
        };

        grid.appendChild(cell);
    }
}

// 確定ボタン
document.getElementById('btn-action').onclick = async () => {
    if(selectedCellIndex === -1) return;
    
    const roomRef = db.collection('rooms').doc(currentRoomId);
    const updateObj = {};
    updateObj[`${myId}.choice`] = selectedCellIndex;
    updateObj[`${myId}.ready`] = true;

    await roomRef.update(updateObj);
    document.getElementById('btn-action').disabled = true;
};

// ターンの結果計算（P1のみが実行）
async function resolveTurn(data) {
    let p1hp = data.p1.hp;
    let p2hp = data.p2.hp;
    let newP1Pos = data.p1.pos;
    let newP2Pos = data.p2.pos;
    const logArr = [`[TURN ${data.turn}] 分析完了...`];

    // 今回、誰が攻撃（予測）していたか
    const attackerId = data.attacker;
    const defenderId = (attackerId === 'p1') ? 'p2' : 'p1';

    // 攻撃側の「予測(choice)」と防衛側の「移動(choice)」を照合
    if (data[attackerId].choice === data[defenderId].choice) {
        // ヒット！ 防衛側が1ダメージ
        if (defenderId === 'p1') { p1hp -= 1; logArr.push("＞警告：回避失敗。直撃を確認。"); }
        else { p2hp -= 1; logArr.push("＞成功：対象を捕捉。コアへダメージ。"); }
    } else {
        logArr.push("＞空振り。信号は消失した。");
    }

    // 移動後の位置を更新
    newP1Pos = (attackerId === 'p2') ? data.p1.choice : data.p1.pos; // 防衛側の位置が更新される
    newP2Pos = (attackerId === 'p1') ? data.p2.choice : data.p2.pos;

    // 次の攻撃者は誰？ (入れ替え)
    const nextAttacker = (attackerId === 'p1') ? 'p2' : 'p1';

    // リセットしてFirebase送信
    selectedCellIndex = -1;
    await db.collection('rooms').doc(currentRoomId).update({
        'p1.hp': p1hp, 'p1.pos': newP1Pos, 'p1.ready': false, 'p1.choice': -1,
        'p2.hp': p2hp, 'p2.pos': newP2Pos, 'p2.ready': false, 'p2.choice': -1,
        attacker: nextAttacker,
        turn: data.turn + 1,
        logs: firebase.firestore.FieldValue.arrayUnion(...logArr)
    });
}

function getAdjacentCells(pos) {
    const adj = [];
    const x = pos % 5;
    const y = Math.floor(pos / 5);
    if (x > 0) adj.push(pos - 1);
    if (x < 4) adj.push(pos + 1);
    if (y > 0) adj.push(pos - 5);
    if (y < 4) adj.push(pos + 5);
    return adj;
}

function showFinalResult(data) {
    const isWin = (myId === 'p1' && data.p2.hp <= 0) || (myId === 'p2' && data.p1.hp <= 0);
    const screen = document.getElementById('result-screen');
    const title = document.getElementById('res-status-title');
    
    screen.classList.remove('hidden');
    title.innerText = isWin ? "MISSION_COMPLETE" : "OPERATOR_LOST";
    title.style.color = isWin ? "var(--neon-blue)" : "var(--neon-red)";
}
