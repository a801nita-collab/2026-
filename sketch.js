// 效能優化：關閉 p5.js 友善錯誤偵測系統以提升 FPS
p5.disableFriendlyErrors = true;

let handPose;
let video;
let hands = [];
let fallingSymbols = [];
let score = 100;          // 修改：初始分數設為 100，作為「生命值」使用
let spawnTimer = 0;
let health = 100;
let flashTimer = 0; // 新增：用於控制紅色閃爍的計時器
let screenShake = 0; // 新增：畫面震動強度
const maxHealth = 100;
let feedbackMessage = ""; // 新增：分類錯誤的提示文字
let feedbackTimer = 0;    // 新增：提示文字顯示計時
let particles = [];
let floatingTexts = [];   // 新增：存放得分動畫文字的陣列
let confetti = [];        // 新增：存放勝利綵帶的陣列
let gameStartTime = 0;    // 新增：遊戲開始時間
let gameDuration = 0;     // 新增：遊戲總耗時
let bestTime = Infinity;  // 新增：歷史最佳紀錄
let comboCount = 0;       // 新增：連擊次數
let errorCount = 0;       // 新增：紀錄分類錯誤次數
let notesX = -480;        // 調整隱藏座標以配合加大的面板
let targetNotesX = -480;
let bgmVolumeSlider;      // 新增：BGM 音量控制滑桿
let sfxVolumeSlider;      // 新增：特效音量控制滑桿
let handMissingFrames = [0, 0]; // 新增：紀錄手部消失的幀數，用於防閃爍緩衝

// 用於平滑處理的座標變數
let lerpedHands = [null, null];

// 音效檔案變數
let sndGameBGM, sndSuccess, sndFail, sndWin, sndMiss;
let audioStarted = false;

// 遊戲狀態管理
let gameState = "START"; // 可選值: START, PLAYING, GAMEOVER, WIN

// 互動與倒數計時變數
let thumbsUpHoldStart = 0;
let okHoldStart = 0; // 新增：比 OK 蓄力計時
let prepCountdownStart = 0;
let isPreparing = false;

// 定義手勢類型
const GESTURE = { ROCK: "rock", PAPER: "paper", SCISSORS: "scissors", THUMBS_UP: "thumbs_up", OK: "ok", NONE: "none" };

// 垃圾分類定義
const CATEGORY = {
  TRASH: { name: "垃圾桶", color: [100, 100, 100], items: ["🧻", "🚬", "🧻", "🩹", "💡", "🧶"], shake: 0 },
  RECYCLE: { name: "資源回收", color: [52, 152, 219], items: ["🍼", "🥫", "📰", "🍾", "🥤", "🔋", "📄", "💻", "📦"], shake: 0 },
  FOOD: { name: "廚餘桶", color: [230, 126, 34], items: ["🍎", "🍌", "🦴", "🍉", "🥕", "🥚", "🍞", "🐟", "🍍"], shake: 0 }
};

function preload() {
  // 載入 ml5.js 的 handPose 模型
  // 效能優化：在初始化時指定輕量化模型，並設定偵測雙手
  const options = {
    maxHands: 2,
    modelType: "lite", // 建議換回 lite 模型，能大幅提升辨識幀數 (FPS)
    flipped: false,    // 保持 false
    minDetectionConfidence: 0.25, // 優化：進一步降低門檻，加強靈敏度
    minTrackingConfidence: 0.25    // 優化：同步降低追蹤門檻，增進手勢反應
  };
  handPose = ml5.handPose(options);

  // 載入玩家提供的 MP3 音效包
  sndGameBGM = loadSound('game_bgm.mp3'); // 遊戲中
  sndSuccess = loadSound('success.mp3');  // 分類成功
  sndFail = loadSound('fail.mp3');        // 挑戰失敗 (包含分類錯誤與遊戲結束)
  sndWin = loadSound('win.mp3');
  sndMiss = loadSound('miss.mp3');        // 分類錯誤
}


function setup() {
  createCanvas(windowWidth, windowHeight);
  // 效能關鍵：固定攝影機擷取解析度為 640x480，這能讓辨識速度大幅提升
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // 從瀏覽器儲存空間載入最佳紀錄
  let savedBest = localStorage.getItem("bestTime");
  if (savedBest !== null) {
    bestTime = parseFloat(savedBest);
  }

  if (window.ml5 && ml5.tf) {
    ml5.tf.setBackend('webgl');
  }

  handPose.detectStart(video, gotHands);
  rectMode(CENTER);
  ellipseMode(CENTER);

  // 初始化 BGM 音量滑桿 (範圍 0 到 1，預設 0.5，步進 0.01)
  bgmVolumeSlider = createSlider(0, 1, 0.5, 0.01);
  bgmVolumeSlider.position(width / 2 - 80, 20);
  bgmVolumeSlider.style('width', '160px');

  // 初始化 特效音量滑桿 (放在 BGM 滑桿下方)
  sfxVolumeSlider = createSlider(0, 1, 0.7, 0.01); // 預設 0.7 讓特效明顯一點
  sfxVolumeSlider.position(width / 2 - 80, 60);
  sfxVolumeSlider.style('width', '160px');
}

function gotHands(results) {
  // 更新偵測到的手部資料
  hands = results;
}

function draw() {
  // 處理畫面震動邏輯
  if (screenShake > 0) {
    translate(random(-screenShake, screenShake), random(-screenShake, screenShake));
    screenShake *= 0.9; // 震動衰減
    if (screenShake < 0.1) screenShake = 0;
  }

  translate(width, 0);
  scale(-1, 1);

  // 當挑戰成功時，為背景視訊套用彩虹變色濾鏡
  if (gameState === "WIN") {
    colorMode(HSB, 360, 255, 255);
    // (frameCount * 4) 控制變色速度，80 控制色彩飽和度（數值越高色彩越濃）
    tint((frameCount * 4) % 360, 80, 255);
    colorMode(RGB, 255);
  }

  image(video, 0, 0, width, height);
  noTint(); // 繪製完畢後立即重置，確保其他狀態的視訊保持正常顏色

  // 繪製音量標籤
  push();
  scale(-1, 1); // 翻轉回正，確保文字不會變鏡像
  fill(255);
  stroke(0);
  strokeWeight(2);
  textSize(14);
  textAlign(CENTER);
  text("BGM 音量", -width / 2, 15);
  text("特效音量", -width / 2, 55);
  pop();

  // 新增：如果音效尚未啟動，顯示提示
  if (!audioStarted && gameState === "START") {
    push();
    scale(-1, 1);
    fill(255, 150);
    textSize(16);
    textAlign(CENTER);
    text("🔊 點擊畫面任何地方以啟用音效", -width / 2, height - 30);
    pop();
  }

  // 處理背景音樂/律動邏輯
  updateBackgroundMusic();

  // 處理主畫面 (START)
  if (gameState === "START") {
    drawStartScreen();
    handleStartInteraction();
    return;
  }

  // 處理遊戲結束 (GAMEOVER)
  if (gameState === "GAMEOVER") {
    drawGameOverScreen();
    handleStartInteraction(); // 允許在結束畫面比讚重新開始
    return;
  }

  // 處理挑戰成功 (WIN)
  if (gameState === "WIN") {
    drawWinScreen();
    handleStartInteraction();
    return;
  }

  // 執行遊戲邏輯 (PLAYING)
  if (gameState === "PLAYING") {
    runGameLoop();
    handleStartInteraction(); // 新增：允許在遊玩時比倒讚回主選單
    drawScreenFrame(); // 新增：繪製畫面邊框美化
  }
}

/**
 * 封裝原本的遊戲核心邏輯
 */
function runGameLoop() {
  // 預先計算縮放比例
  const sx = width / video.width;
  const sy = height / video.height;

  // 勝利條件：當畫面上不再有任何「尚未分類」的垃圾（或垃圾已完全清空），即視為挑戰成功
  if (!fallingSymbols.some(item => !item.isCorrect)) {
    gameDuration = (millis() - gameStartTime) / 1000;
    // 檢查是否刷新最佳紀錄
    if (gameDuration < bestTime) {
      bestTime = gameDuration;
      localStorage.setItem("bestTime", bestTime.toString());
    }
    // 1. 勝利瞬間：在畫面上隨機產生 5 個大型煙火爆炸
    for (let i = 0; i < 5; i++) {
      createExplosion(random(-width, 0), random(height * 0.2, height * 0.8), "⭐", [255, 215, 0]);
    }
    
    spawnWinConfetti(); // 觸發綵帶特效
    playGameSound("win"); // 播放挑戰成功音效
    gameState = "WIN";
    return;
  }

  if (score <= 0) { // 修改：當分數歸零時遊戲結束
    playGameSound("fail"); // 播放遊戲失敗音效
    gameState = "GAMEOVER";
    return;
  }

  drawBins();
  
  let detectedHandData = [];
  const handColors = [[255, 255, 0], [0, 255, 255]];

  // 優化：改用固定長度的迴圈處理雙手，實作消失緩衝機制
  for (let i = 0; i < 2; i++) {
    let hand = (hands.length > i) ? hands[i] : null;
    let color = handColors[i];

    if (hand) {
      handMissingFrames[i] = 0; // 重置消失計數

      // 優化：將目標點設為食指與大拇指的「中點」，這比單純追蹤食指尖更符合捏合感
      let targetX = ((hand.index_finger_tip.x + hand.thumb_tip.x) / 2) * sx;
      let targetY = ((hand.index_finger_tip.y + hand.thumb_tip.y) / 2) * sy;

      if (!lerpedHands[i]) {
        lerpedHands[i] = { x: targetX, y: targetY };
      } else {
        // 調高係數（0.5 -> 0.7），增加快速移動時的跟隨感
        lerpedHands[i].x = lerp(lerpedHands[i].x, targetX, 0.7);
        lerpedHands[i].y = lerp(lerpedHands[i].y, targetY, 0.7);
      }

      let handPos = { x: lerpedHands[i].x, y: lerpedHands[i].y };
      let currentGesture = getGesture(hand);

      // 計算食指與大拇指的距離
      let pinchDist = dist(hand.index_finger_tip.x, hand.index_finger_tip.y, hand.thumb_tip.x, hand.thumb_tip.y);
      
      // 邏輯調整：如果是「布」手勢（查看筆記中），則不觸發抓取
      let isPinching = (pinchDist < 75) && (currentGesture !== GESTURE.PAPER);
      
      // 繪製手部骨架
      drawSkeleton(hand, color, sx, sy);

      // 畫出手部位置提示（視覺輔助）
      if (isPinching) {
        fill(255, 0, 0, 200); // 捏合時提示圓圈變為紅色，且透明度降低使其更明顯
        
        // 優化：移除耗能的 shadowBlur，改用疊加圓圈模擬發光
        if (comboCount > 5) {
          push();
          fill(255, 255, 255, 50); // 半透明白光
          ellipse(handPos.x, handPos.y, 110);
          pop();
        }
      } else {
        fill(color[0], color[1], color[2], 100);
      }
      ellipse(handPos.x, handPos.y, 80); 
      detectedHandData.push({ handPos, currentGesture, isPinching, handIndex: i });
    } else {
      // 如果偵測不到，增加消失計數，超過 10 幀才真正移除（約 0.2 秒）
      handMissingFrames[i]++;
      if (handMissingFrames[i] > 10) {
        lerpedHands[i] = null;
      } else if (lerpedHands[i]) {
        // 在緩衝期內，手部停留在原位或緩慢減速，維持抓取狀態
        detectedHandData.push({ 
          handPos: { x: lerpedHands[i].x, y: lerpedHands[i].y }, 
          currentGesture: GESTURE.NONE, 
          isPinching: false, 
          handIndex: i 
        });
      }
    }
  }

  // 檢查是否有人在比「布」手勢 (基於當前偵測到的數據)
  let isShowingNotes = detectedHandData.some(h => h.currentGesture === GESTURE.PAPER);
  targetNotesX = isShowingNotes ? 0 : -480; // 修正：統一目標座標為 -480
  notesX = lerp(notesX, targetNotesX, 0.15);

  // 繪製分類筆記選單 (先繪製以便垃圾能蓋在筆記上方)
  drawClassificationNotes();

  // 更新與繪製掉落中的符號
  textAlign(CENTER, CENTER);
  noStroke();
  textSize(50); 
  let itemGrabbedThisFrame = false; // 新增：用於限制單幀只能抓取一個物件

  // 效能優化：預先計算哪些手已經抓著東西，避免在後續迴圈中重複遍歷
  let busyHands = new Set();
  for (let s of fallingSymbols) {
    if (s.grabbedBy !== -1) {
      busyHands.add(s.grabbedBy);
    }
  }

  for (let i = fallingSymbols.length - 1; i >= 0; i--) {
    let item = fallingSymbols[i];
    
    // 檢查是否被手「抓取」 (需進入捏合狀態且距離夠近)
    let grabbed = false;

    // 1. 優先處理已鎖定的抓取關係，確保「經過其他垃圾不影響」
    if (item.grabbedBy !== -1) {
      let handData = detectedHandData.find(h => h.handIndex === item.grabbedBy);
      if (handData && handData.isPinching) {
        item.x = handData.handPos.x;
        item.y = handData.handPos.y;
        grabbed = true;
      } else {
        item.grabbedBy = -1; // 手部放開或消失，解除鎖定
      }
    }

    // 2. 如果沒被鎖定，才嘗試偵測新的抓取
    if (!grabbed && !itemGrabbedThisFrame && !item.isCorrect) {
      for (let handData of detectedHandData) {
        // 檢查這隻手是否已經在忙（抓著別的東西）
        if (busyHands.has(handData.handIndex)) continue; // 效能優化：使用 Set 快速檢查

        let d = dist(handData.handPos.x, handData.handPos.y, item.x, item.y);
        if (d < 80 && handData.isPinching) { // 稍微縮小判定半徑（100->80）配合中點定位，增加精確度
          item.x = handData.handPos.x;
          item.y = handData.handPos.y;
          item.grabbedBy = handData.handIndex; // 建立鎖定關係
          grabbed = true;
          itemGrabbedThisFrame = true; // 標記已抓取，這會讓其他垃圾跳過偵測
          break;
        }
      }
    }

    if (grabbed) {
      // 檢查是否放入正確的桶子
      let binWidth = width / 3;
      let currentBinIndex = floor(item.x / binWidth);
      let categories = [CATEGORY.TRASH, CATEGORY.RECYCLE, CATEGORY.FOOD];
      
      if (item.y > height - 150) {
        if (categories[currentBinIndex] === item.category) {
          comboCount++;
          let points = 20; // 分類成功固定加 20 分，移除連擊額外加分以提升挑戰性
          createExplosion(item.x, item.y, item.icon, item.category.color);
          spawnFloatingText(item.x, item.y - 50, `+${points}${comboCount > 1 ? " Combo!" : ""}`, item.category.color); 
          playGameSound("success"); // 播放成功音效
          item.isCorrect = true; // 標記為正確，進入縮小消失動畫
          item.grabbedBy = -1;   // 成功分類後立即釋放手部
          score += points;
          item.category.shake = 15; // 桶子輕微跳動
        } else {
          // 分類錯誤：顯示正確答案、彈回原位、並扣除少量血量
          feedbackMessage = `放錯囉！${item.icon} 屬於「${item.category.name}」`;
          feedbackTimer = 90; // 顯示約 1.5 秒
          comboCount = 0;     // 連擊中斷
          item.x = item.homeX;
          item.y = item.homeY;
          item.grabbedBy = -1; // 重要：錯誤後強制放開垃圾，防止連續扣分
          score = max(0, score - 20); // 分類錯誤扣 20 分，最低為 0
          errorCount++; // 紀錄錯誤次數
          screenShake = 15; // 增加畫面震動
          spawnFloatingText(item.x, item.y - 50, "-20", [255, 0, 0]); // 顯示紅色扣分文字
          playGameSound("miss"); // 播放分類錯誤音效 (miss.mp3)
          flashTimer = 150; // 畫面紅色閃爍
          categories[currentBinIndex].shake = 30; // 錯誤的桶子劇烈震動
        }
      }
    }

    // 更新縮小動畫數值
    if (item.isCorrect) {
      item.animScale -= 0.1; // 每幀縮小 10%
      if (item.animScale <= 0) {
        fallingSymbols.splice(i, 1);
        continue;
      }
    } else if (item.animScale < 1.0) {
      // 進場動畫：慢慢變大
      item.animScale += 0.05;
      if (item.animScale > 1.0) item.animScale = 1.0;
    }

    push();
    translate(item.x, item.y);
    if (grabbed && !item.isCorrect) {
      rotate(sin(frameCount * 0.2) * 0.2); // 抓取時微微左右搖擺
    }
    let s = item.animScale;
    if (grabbed && !item.isCorrect) {
      // 新增：心跳縮放動畫
      // 利用 sin 函數讓縮放值在 1.35 ~ 1.45 之間律動，0.15 控制跳動速度
      s *= (1.4 + sin(frameCount * 0.15) * 0.05); 
    }
    // 修正鏡像：因為全域已經 scale(-1, 1)，這裡將 x 軸再翻轉一次 (-s) 讓文字變正
    scale(-s, s); 
    fill(255);
    text(item.icon, 0, 0);
    pop();

    // 移除掉出螢幕的符號 (雖然不再下墜，但保留此邏輯以防萬一或用於抓取丟棄)
    if (item.y > height && !item.isCorrect) {
      fallingSymbols.splice(i, 1);
      score = max(0, score - 15); // 修改：垃圾掉出螢幕改為扣分
      flashTimer = 200;
    }
  }

  // 更新與繪製粒子系統
  updateAndDrawParticles();
  // 更新與繪製得分動畫文字
  updateAndDrawFloatingTexts();

  // UI 顯示
  push();
  scale(-1, 1);
  drawingContext.shadowBlur = 0;

  // 1. 科技感 HUD 背景框 (Glassmorphism)
  fill(10, 20, 30, 200);
  stroke(255, 50);
  strokeWeight(2);
  rect(-width + 115, 105, 190, 195, 15); 
  
  // 2. 分數文字 - 使用金色與加粗
  noStroke();
  fill(255, 215, 0);
  textSize(24);
  textStyle(BOLD);
  textAlign(LEFT, CENTER);
  text("SCORE: " + score, -width + 40, 45);

  // 3. 手勢與時間 - 次要資訊
  textStyle(NORMAL);
  textSize(18);
  fill(180);
  if (hands.length > 0) {
    let firstHandGesture = getGesture(hands[0]);
    text("STATUS: " + firstHandGesture.toUpperCase(), -width + 40, 75);
  } else {
    text("STATUS: SEARCHING", -width + 40, 75);
  }

  if (comboCount > 1) {
    fill(255, 100, 0);
    textStyle(BOLD);
    textSize(22);
    text("COMBO x" + comboCount, -width + 40, 105);
    textStyle(NORMAL);
  }

  let liveTime = (millis() - gameStartTime) / 1000;
  fill(200);
  text("TIME: " + liveTime.toFixed(1) + "s", -width + 40, 135);

  // 4. 分數體力條 (以 100 分為標準長度)
  fill(50);
  rect(-width + 115, 170, 150, 12, 6); 

  if (score < 30) {
    fill(255, 50, 50);
  } else {
    fill(0, 255, 150);
  }
  let hpBarWidth = map(constrain(score, 0, 100), 0, 100, 0, 150);
  rect(-width + 115 - (150 - hpBarWidth) / 2, 170, hpBarWidth, 12, 6);

  // 5. 新增：查看筆記小提示 (提示玩家可以使用 OK 手勢)
  fill(255, 204, 0, 200);
  textSize(32);
  text("🖐️ HINT: 比出「布」查看筆記", -width + 40, 215);

  // 繪製錯誤反饋訊息
  if (feedbackTimer > 0) {
    fill(255, 255, 0);
    stroke(0);
    strokeWeight(4);
    textSize(40);
    textAlign(CENTER, CENTER);
    text(feedbackMessage, -width / 2, height / 2);
    feedbackTimer--;
  }
  pop();

  // 新增：紅色閃爍特效
  if (flashTimer > 0) {
    push();
    resetMatrix(); // 重置所有變換，回到螢幕原始座標 (0,0) 為左上角
    fill(255, 0, 0, flashTimer); // 紅色，透明度隨計時器遞減
    noStroke();
    rectMode(CORNER); // 確保從左上角開始填滿
    rect(0, 0, width, height); // 覆蓋整個畫面
    pop();
    flashTimer -= 10; // 每幀減少透明度，讓閃爍逐漸消失
  }
}

/**
 * 繪製三個垃圾桶
 */
function drawBins() {
  let binWidth = width / 3;
  let categories = [CATEGORY.TRASH, CATEGORY.RECYCLE, CATEGORY.FOOD];
  let visualWidth = binWidth * 0.6; // 圓柱體的寬度
  let binHeight = 130; // 圓柱體的高度

  push();
  ellipseMode(CENTER);
  rectMode(CENTER);
  for (let i = 0; i < categories.length; i++) {
    let cat = categories[i];
    let centerX = i * binWidth + binWidth / 2 + random(-cat.shake, cat.shake); // 加入震動位移
    let centerY = height - 90;

    // 減少震動值，讓它隨時間衰減
    cat.shake *= 0.9;

    // 1. 繪製圓柱體底部 (增加立體感)
    fill(cat.color[0], cat.color[1], cat.color[2]);
    stroke(255, 150);
    strokeWeight(2);
    ellipse(centerX, centerY + binHeight / 2, visualWidth, 40);

    // 2. 繪製圓柱體桶身
    noStroke();
    rect(centerX, centerY, visualWidth, binHeight);
    
    // 繪製側邊線條強化圓柱感
    stroke(255, 100);
    line(centerX - visualWidth / 2, centerY - binHeight / 2, centerX - visualWidth / 2, centerY + binHeight / 2);
    line(centerX + visualWidth / 2, centerY - binHeight / 2, centerX + visualWidth / 2, centerY + binHeight / 2);

    // 3. 繪製桶口 (頂部橢圓)
    // 顏色稍微調亮一點區隔頂部
    fill(cat.color[0] + 30, cat.color[1] + 30, cat.color[2] + 30);
    stroke(255, 200);
    ellipse(centerX, centerY - binHeight / 2, visualWidth, 40);

    // 4. 繪製文字標籤 (修正鏡像問題)
    push();
    translate(centerX, centerY);
    scale(-1, 1); // 翻轉回正常方向
    fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(22);
    textStyle(BOLD);
    text(cat.name, 0, 0); // 文字放在桶子中間
    textStyle(NORMAL);
    pop();
  }
  pop();
}

/**
 * 繪製畫面裝飾邊框
 */
function drawScreenFrame() {
  push();
  resetMatrix();
  noFill();

  // 1. 基礎電影感暗邊 (Vignette)
  stroke(0, 60);
  strokeWeight(40);
  rect(width / 2, height / 2, width, height);

  // 2. 連擊發光特效 (Combo Glow)
  if (comboCount >= 3) {
    let pulseSpeed = 0.05 + min(comboCount * 0.02, 0.3);
    let intensity = map(sin(frameCount * pulseSpeed), -1, 1, 50, 200);
    let borderWeight = map(min(comboCount, 20), 3, 20, 5, 30);

    colorMode(HSB, 360, 255, 255);
    let hue = (frameCount * 2 + comboCount * 5) % 360;
    
    // 優化方案：移除耗能的 shadowBlur，改用三層透明線條模擬霓虹感
    // 第一層：外圍淡光 (最粗且最透明)
    stroke(hue, 200, 255, (intensity / 255) * 0.2);
    strokeWeight(borderWeight * 2.5);
    rect(width / 2, height / 2, width, height);

    // 第二層：核心強光 (中等粗細)
    stroke(hue, 200, 255, (intensity / 255) * 0.5);
    strokeWeight(borderWeight * 1.5);
    rect(width / 2, height / 2, width, height);
    
    // 第三層：中心線條 (最細最亮)
    stroke(hue, 200, 255, intensity / 255);
    strokeWeight(borderWeight);
    rect(width / 2, height / 2, width, height);
    
    colorMode(RGB, 255);
  }
  pop();
}

/**
 * 繪製隱藏式分類筆記選單
 */
function drawClassificationNotes() {
  // 效能優化：如果選單完全隱藏，則不進行後續的繪圖與計算
  if (notesX <= -479) return;

  push();
  // notesX 為 0 時顯示在最右側，為 -480 時隱藏
  translate(notesX, 0);
  
  // 1. 背景面板 (加大寬度至 450 確保內容不會超出)
  fill(10, 20, 30, 235);
  stroke(255, 100);
  strokeWeight(2);
  rectMode(CENTER);
  rect(225, height / 2, 450, height * 0.9, 0, 30, 30, 0);
  
  // 2. 標題部分
  push();
  translate(225, height * 0.08); // 標題位置再調高，爭取空間
  scale(-1, 1);
  textAlign(CENTER, CENTER);
  fill(255, 204, 0);
  textSize(32);
  textStyle(BOLD);
  text("📋 分類筆記", 0, 0);
  pop();
  
  // 3. 分類內容
  const categoriesList = [CATEGORY.TRASH, CATEGORY.RECYCLE, CATEGORY.FOOD];
  const contentYStart = height * 0.22;
  const rowSpacing = height * 0.24;
  const iconsPerRow = 5;
  const iconSize = 32;
  const iconSpacing = 40;
  const maxTextWidth = (iconsPerRow - 1) * iconSpacing;

  for (let i = 0; i < categoriesList.length; i++) {
    let cat = categoriesList[i];
    let yOffset = contentYStart + i * rowSpacing;
    let items = [...new Set(cat.items)];

    push();
    translate(225, yOffset);
    scale(-1, 1);

    textAlign(CENTER, TOP);
    fill(cat.color[0], cat.color[1], cat.color[2]);
    textSize(32);
    textStyle(BOLD);
    text(cat.name, 0, 0);

    fill(255, 230);
    textStyle(NORMAL);
    textSize(iconSize);
    textLeading(iconSize + 8);

    let startX = -maxTextWidth / 2;
    let rowY = 55;
    for (let j = 0; j < items.length; j++) {
      let col = j % iconsPerRow;
      let row = floor(j / iconsPerRow);
      let x = startX + col * iconSpacing;
      let y = rowY + row * (iconSize + 12);
      text(items[j], x, y);
    }

    pop();
  }
  pop();
}

/**
 * 繪製主畫面 UI
 */
function drawStartScreen() {
  push();
  scale(-1, 1);
  // 半透明遮罩
  fill(0, 150);
  rect(-width / 2, height / 2, width * 0.8, height * 0.7, 20);

  fill(255);
  textAlign(CENTER, CENTER);

  if (isPreparing) {
    // 顯示 3-2-1 準備倒數
    let remaining = ceil(3 - (millis() - prepCountdownStart) / 500);
    fill(255, 255, 0);
    textSize(150);
    text(remaining, -width / 2, height / 2);
    textSize(40);
    text("準備開始!", -width / 2, height / 2 + 120);
  } else {
    // 標題
    textSize(60);
    colorMode(HSB, 360, 255, 255); // 切換至 HSB 模式 (色相範圍 0-360)
    let titleHue = (frameCount * 2) % 360; // 隨著時間改變色相，數字 2 可調整變色速度
    fill(titleHue, 200, 255); // 設定彩虹色
    text("垃圾分類大作戰", -width / 2, height / 2 - 120);
    colorMode(RGB, 255); // 繪製完標題後立即切換回 RGB 模式，以免影響其他 UI 顏色

    // 介紹
    textSize(24);
    // 呼吸燈動畫：利用 sin 函數讓透明度在 120 到 255 之間循環變化
    let introAlpha = 187 + 68 * sin(frameCount * 0.05);
    fill(255, introAlpha);
    // 浮動動畫：讓文字在 Y 軸上有微小的上下位移
    let introY = (height / 2 - 20) + sin(frameCount * 0.05) * 5;
    text("遊戲介紹:\n請用食指與大拇指(捏和)抓取圾垃並成功分類守護地球\n比出「布」手勢可隨時查看分類筆記", -width / 2, introY);

    // 提示
    textSize(32);
    fill(0, 255, 0);
    text("請比 👍 確認開始遊戲", -width / 2, height / 2 + 80);

    // 比讚進度條
    if (thumbsUpHoldStart > 0) {
      let progress = (millis() - thumbsUpHoldStart) / 1000;
      noStroke();
      fill(100);
      rect(-width / 2, height / 2 + 140, 250, 20, 10);
      fill(0, 255, 0);
      // 因為 rectMode 是 CENTER，需調整 X 座標讓它從左往右長
      rect(-width / 2 - 125 + (progress * 125), height / 2 + 140, progress * 250, 20, 10);
    }

    // 顯示最佳紀錄 (移至最下方)
    textSize(20);
    fill(255, 215, 0); // 質感金色
    text("個人最佳紀錄: " + (bestTime === Infinity ? "尚未挑戰" : bestTime.toFixed(2) + " 秒"), -width / 2, height / 2 + 190);
  }
  pop();
}

/**
 * 處理主畫面互動邏輯（含蓄力與倒數）
 */
function handleStartInteraction() {
  if (isPreparing) {
    // 準備倒數結束，正式開始遊戲
    if (millis() - prepCountdownStart >= 1500) {
      isPreparing = false;
      resetGame();
      gameState = "PLAYING";
      gameStartTime = millis();
    }
    return;
  }

  let detectedThumbsUp = false;
  let detectedOk = false; // 新增：偵測 OK 手勢
  if (hands.length > 0) {
    for (let hand of hands) {
      let gesture = getGesture(hand);
      if (gesture === GESTURE.THUMBS_UP) detectedThumbsUp = true;
      if (gesture === GESTURE.OK) detectedOk = true; // 偵測到 OK
    }
  }

  // 只有在非遊玩狀態（START, WIN, GAMEOVER）下才偵測「比讚」來開始或重啟
  if (gameState !== "PLAYING" && detectedThumbsUp) {
    if (thumbsUpHoldStart === 0) thumbsUpHoldStart = millis();
    // 蓄力滿 1 秒
    if (millis() - thumbsUpHoldStart >= 1000) {
      // 在玩家第一次互動時啟動音頻，符合瀏覽器安全政策
      if (!audioStarted) {
        console.log("Audio started via gesture");
        userStartAudio();
        audioStarted = true;
      }
      isPreparing = true;
      prepCountdownStart = millis();
      thumbsUpHoldStart = 0;
    }
  } else {
    // 中斷則重置進度
    thumbsUpHoldStart = 0;
  }

  // 處理比 OK 回到主畫面 (在挑戰成功或遊戲結束畫面有效)
  if ((gameState === "WIN" || gameState === "GAMEOVER") && detectedOk) {
    if (okHoldStart === 0) okHoldStart = millis();
    if (millis() - okHoldStart >= 1000) {
      gameState = "START";
      okHoldStart = 0;
    }
  } else {
    okHoldStart = 0;
  }
}

/**
 * 點擊滑鼠啟動音效 (瀏覽器安全要求，作為保險)
 */
function mousePressed() {
  if (!audioStarted) {
    userStartAudio().then(() => {
      audioStarted = true;
      console.log("Audio started via click");
    });
  }
}

/**
 * 繪製結束畫面
 */
function drawGameOverScreen() {
  push();
  scale(-1, 1);
  // 半透明遮罩
  fill(0, 150);
  rect(-width / 2, height / 2, width * 0.8, height * 0.75, 30);

  textAlign(CENTER, CENTER);

  if (isPreparing) {
    let remaining = ceil(3 - (millis() - prepCountdownStart) / 500);
    fill(255, 255, 0);
    textSize(150);
    text(remaining, -width / 2, height / 2);
  } else {
    fill(255, 0, 0);
    textSize(80);
    text("GAME OVER", -width / 2, height / 2 - 80);
    textSize(40);
    fill(255);
    text("最終分數: " + score, -width / 2, height / 2 - 10);
    textSize(24);
    fill(0, 255, 0);
    text("再次比 👍 重新挑戰", -width / 2, height / 2 + 60);

    // 比讚進度條 (遊戲結束畫面也套用同樣邏輯)
    if (thumbsUpHoldStart > 0) {
      let progress = (millis() - thumbsUpHoldStart) / 1000;
      noStroke();
      fill(100);
      rect(-width / 2, height / 2 + 95, 250, 15, 10);
      fill(0, 255, 0);
      rect(-width / 2 - 125 + (progress * 125), height / 2 + 95, progress * 250, 15, 10);
    }

    // 比 OK 回到主畫面提示
    fill(200, 255, 255);
    text("比 👌 回到主畫面", -width / 2, height / 2 + 145);

    if (okHoldStart > 0) {
      let progress = (millis() - okHoldStart) / 1000;
      noStroke();
      fill(100);
      rect(-width / 2, height / 2 + 180, 250, 15, 10);
      fill(0, 200, 255);
      rect(-width / 2 - 125 + (progress * 125), height / 2 + 180, progress * 250, 15, 10);
    }
  }
  pop();
}

/**
 * 繪製勝利畫面
 */
function drawWinScreen() {
  push();
  scale(-1, 1);
  // 半透明遮罩
  // 先繪製半透明黑色背景，讓後方的視訊稍微變暗以凸顯文字
  fill(0, 150);
  rect(-width / 2, height / 2, width * 0.8, height * 0.8, 30); // 稍微加大背景框並增加圓角

  textAlign(CENTER, CENTER);

  if (isPreparing) {
    let remaining = ceil(3 - (millis() - prepCountdownStart) / 500);
    fill(255, 255, 0);
    textSize(150);
    text(remaining, -width / 2, height / 2);
  } else {
    // 1. 標題美化
    fill(0, 255, 150); 
    textSize(80);
    textStyle(BOLD);
    text("挑戰成功!", -width / 2, height / 2 - 160); // 往上移動避免重疊

    // 2. 榮譽稱號評分
    let title = "";
    let titleColor = [255, 255, 255];
    if (errorCount === 0) {
      title = "環保之神 👑";
      titleColor = [255, 215, 0]; // 金色
    } else if (errorCount <= 2) {
      title = "環保大使 🌟";
      titleColor = [0, 255, 150]; // 螢光綠
    } else if (errorCount <= 5) {
      title = "分類實習生 🌱";
      titleColor = [200, 255, 255]; // 淺藍色
    } else {
      title = "垃圾新手 🚮";
      titleColor = [150, 150, 150]; // 灰色
    }

    textSize(36);
    fill(titleColor);
    text("榮譽稱號: " + title, -width / 2, height / 2 - 85);

    // 3. 遊戲數據排版
    textStyle(NORMAL);
    textSize(40);
    fill(255);
    text("最終分數: " + score, -width / 2, height / 2 - 20);
    textSize(30);
    text("完成時間: " + gameDuration.toFixed(2) + " 秒", -width / 2, height / 2 + 25);
    fill(255, 100, 100); // 淺紅色顯示錯誤次數
    text("分類錯誤: " + errorCount + " 次", -width / 2, height / 2 + 65);
    fill(255, 215, 0); // 質感金色
    text("個人最佳: " + bestTime.toFixed(2) + " 秒", -width / 2, height / 2 + 105);
    
    // 4. 操作提示與進度條
    textSize(22);
    fill(255, 204, 0);
    text("再次比 👍 重新挑戰", -width / 2, height / 2 + 160);

    if (thumbsUpHoldStart > 0) {
      let progress = (millis() - thumbsUpHoldStart) / 1000;
      noStroke();
      fill(100);
      rect(-width / 2, height / 2 + 195, 250, 15, 10);
      fill(0, 255, 0);
      rect(-width / 2 - 125 + (progress * 125), height / 2 + 195, progress * 250, 15, 10);
    }

    // 5. 比 OK 回到主畫面提示與進度條
    fill(200, 255, 255);
    text("比 👌 回到主畫面", -width / 2, height / 2 + 235);

    if (okHoldStart > 0) {
      let progress = (millis() - okHoldStart) / 1000;
      noStroke();
      fill(100);
      rect(-width / 2, height / 2 + 265, 250, 15, 10);
      fill(0, 200, 255);
      rect(-width / 2 - 125 + (progress * 125), height / 2 + 265, progress * 250, 15, 10);
    }
  }
  pop();

  // 2. 持續慶祝：在勝利畫面期間，每隔一段時間自動產生小煙火
  if (frameCount % 20 === 0) {
    createExplosion(random(-width, 0), random(0, height), "✨", [random(255), 255, 255]);
  }

  // 3. 繪製粒子與煙火 (確保粒子在勝利畫面也能持續更新動畫)
  updateAndDrawParticles();

  // 將綵帶特效移到最後繪製，這樣它就會飄浮在 UI 遮罩與文字的前方
  // 看起來就像是直接灑在玩家的視訊畫面上，效果更生動
  updateAndDrawConfetti();
}

function resetGame() {
  score = 100; // 重置時分數回到 100
  health = 100;
  comboCount = 0;
  errorCount = 0; // 重置錯誤次數
  fallingSymbols = [];
  confetti = []; // 清空綵帶
  particles = [];
  floatingTexts = []; // 重置遊戲時清空得分文字
  feedbackTimer = 0;
  // 一開始先產生 15 個垃圾在螢幕上
  for (let i = 0; i < 15; i++) {
    spawnWaste();
  }
}

function spawnWaste() {
  let types = [
    { category: CATEGORY.TRASH, icon: random(CATEGORY.TRASH.items) },
    { category: CATEGORY.RECYCLE, icon: random(CATEGORY.RECYCLE.items) },
    { category: CATEGORY.FOOD, icon: random(CATEGORY.FOOD.items) }
  ];
  
  let choice = random(types);
  let rx = random(100, width - 100);
  let ry = random(100, height - 250);
  
  fallingSymbols.push({
    x: rx,
    y: ry,
    homeX: rx, // 儲存原始位置
    homeY: ry,
    category: choice.category,
    icon: choice.icon,
    angle: random(TWO_PI), // 新增：初始隨機角度
    speed: 0,
    animScale: 0, // 修改：從 0 開始，產生彈跳進場效果
    isCorrect: false,
    grabbedBy: -1
  });
}

function getGesture(hand) {
  const wrist = hand.wrist;

  const thumbExt = dist(hand.thumb_tip.x, hand.thumb_tip.y, wrist.x, wrist.y) > 
                   dist(hand.thumb_ip.x, hand.thumb_ip.y, wrist.x, wrist.y) * 1.1;

  // 將判定閾值統一調整為 1.2
  // 較高的閾值意味著手指必須伸得更開才算「伸直」，這能顯著提升移動中「石頭」的穩定度
  const gestureThreshold = 1.2;

  const indexExt = dist(hand.index_finger_tip.x, hand.index_finger_tip.y, wrist.x, wrist.y) > 
                   dist(hand.index_finger_pip.x, hand.index_finger_pip.y, wrist.x, wrist.y) * gestureThreshold;
  const middleExt = dist(hand.middle_finger_tip.x, hand.middle_finger_tip.y, wrist.x, wrist.y) > 
                    dist(hand.middle_finger_pip.x, hand.middle_finger_pip.y, wrist.x, wrist.y) * gestureThreshold;
  const ringExt = dist(hand.ring_finger_tip.x, hand.ring_finger_tip.y, wrist.x, wrist.y) > 
                  dist(hand.ring_finger_pip.x, hand.ring_finger_pip.y, wrist.x, wrist.y) * gestureThreshold;
  const pinkyExt = dist(hand.pinky_finger_tip.x, hand.pinky_finger_tip.y, wrist.x, wrist.y) > 
                   dist(hand.pinky_finger_pip.x, hand.pinky_finger_pip.y, wrist.x, wrist.y) * gestureThreshold;

  // 新增 OK 手勢：食指與拇指靠近，其餘三指伸直
  const isPinching = dist(hand.index_finger_tip.x, hand.index_finger_tip.y, hand.thumb_tip.x, hand.thumb_tip.y) < 60;
  if (isPinching && middleExt && ringExt && pinkyExt) {
    return GESTURE.OK;
  }

  // 1. 布：四指皆伸直
  if (indexExt && middleExt && ringExt && pinkyExt) return GESTURE.PAPER;
  
  // 2. 剪刀：食、中指伸直，無名、小指彎曲
  if (indexExt && middleExt && !ringExt && !pinkyExt) return GESTURE.SCISSORS;
  
  // 3. 石頭與比讚：當四隻手指都收起來時
  if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
    // 正常的比讚判斷
    if (thumbExt && hand.thumb_tip.y < hand.thumb_ip.y) {
      // 如果正在玩遊戲，比讚視為「石頭」以避免誤觸
      if (gameState === "PLAYING") return GESTURE.ROCK;
      return GESTURE.THUMBS_UP;
    }

    return GESTURE.ROCK;
  }

  return GESTURE.NONE;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  // 視窗大小改變時，重新定位滑桿到上方中間
  bgmVolumeSlider.position(width / 2 - 80, 20);
  sfxVolumeSlider.position(width / 2 - 80, 60);
  // 不要在這裡調整 video.size，保持 640x480 才能維持辨識效能
}

/**
 * 根據指定的索引群組繪製手部骨架連線
 */
function drawSkeleton(hand, color, sx, sy) {
  push();
  stroke(color || [0, 255, 0]); // 顏色可能不同，所以保留在迴圈內
  strokeWeight(3); // 粗細固定，移到迴圈外
  const fingerChains = [
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20]
  ];

  for (let chain of fingerChains) {
    for (let i = 0; i < chain.length - 1; i++) {
      let pt1 = hand.keypoints[chain[i]];
      let pt2 = hand.keypoints[chain[i + 1]];
      if (pt1 && pt2) {
        line(pt1.x * sx, pt1.y * sy, pt2.x * sx, pt2.y * sy);
      }
    }
  }
  pop();
}

/**
 * 在指定位置產生爆炸粒子
 */
function createExplosion(x, y, icon, color) {
  // 效能優化：限制全域粒子總數，避免特效過多時手部偵測卡頓
  if (particles.length > 100) return; 

  for (let i = 0; i < 8; i++) {
    particles.push({
      x: x,
      y: y,
      vx: random(-5, 5),
      vy: random(-7, 7), // 隨機垂直速度
      size: random(10, 40), // 粒子大小不一
      alpha: 255, // 初始透明度
      rotation: random(TWO_PI), // 隨機初始角度
      rv: random(-0.1, 0.1), // 隨機旋轉速度
      icon: icon,
      color: color
    });
  }
}

/**
 * 處理粒子的物理更新與渲染
 */
function updateAndDrawParticles() {
  if (particles.length === 0) return;
  
  textAlign(CENTER, CENTER); // 粒子文字對齊方式固定，移到迴圈外
  noStroke(); // 粒子無邊框，移到迴圈外

  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];

    p.alpha -= 10; 
    if (p.alpha <= 0) {
      particles.splice(i, 1);
      continue;
    }

    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.rv;

    push();
    translate(p.x, p.y);
    rotate(p.rotation);
    fill(p.color[0], p.color[1], p.color[2], p.alpha); // 顏色和透明度會變，保留
    textSize(p.size); // 文字大小會變，保留
    text(p.icon, 0, 0);
    pop();
  }
}

/**
 * 產生勝利畫面用的綵帶
 */
function spawnWinConfetti() {
  confetti = [];
  for (let i = 0; i < 150; i++) {
    confetti.push({
      x: random(-width, 0), // 配合全域鏡像座標系
      y: random(-height, height), // 修改：讓部分綵帶一開始就出現在畫面上，不用等待掉落
      w: random(8, 15),
      h: random(15, 25),
      hue: random(360),
      vx: random(-2, 2),
      vy: random(3, 7),
      angle: random(TWO_PI),
      rv: random(0.05, 0.15),
      shapeType: floor(random(3)) // 0: 長方形, 1: 圓形, 2: 星星
    });
  }
}

/**
 * 更新並繪製綵帶
 */
function updateAndDrawConfetti() {
  colorMode(HSB, 360, 255, 255);
  noStroke();
  for (let p of confetti) {
    p.y += p.vy;
    p.x += sin(frameCount * 0.1 + p.angle) * 2; // 左右隨風搖擺
    p.angle += p.rv; // 旋轉

    fill(p.hue, 200, 255);
    push();
    translate(p.x, p.y);
    rotate(p.angle);
    
    // 根據形狀類型繪製
    if (p.shapeType === 0) {
      rect(0, 0, p.w, p.h);
    } else if (p.shapeType === 1) {
      ellipse(0, 0, p.w);
    } else {
      drawStar(0, 0, p.w / 2, p.w, 5); // 星星形狀
    }
    pop();

    // 掉出底部後從頂部重新出現，形成循環下雨感
    if (p.y > height) p.y = -20;
  }
  colorMode(RGB, 255);
}

/**
 * 產生得分浮動文字
 */
function spawnFloatingText(x, y, txt, col) {
  floatingTexts.push({
    x: x,
    y: y,
    text: txt,
    color: col,
    alpha: 255,
    vy: -2 // 向上飄移的速度
  });
}

/**
 * 處理得分文字的物理更新與渲染
 */
function updateAndDrawFloatingTexts() {
  if (floatingTexts.length === 0) return;
  
  textAlign(CENTER, CENTER);
  noStroke();

  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    let ft = floatingTexts[i];

    ft.y += ft.vy; // 向上移動
    ft.alpha -= 5; // 逐漸淡出

    if (ft.alpha <= 0) {
      floatingTexts.splice(i, 1);
      continue;
    }

    push();
    translate(ft.x, ft.y);
    scale(-1, 1); // 修正鏡像文字，讓 +20 看起來是正的
    fill(ft.color[0], ft.color[1], ft.color[2], ft.alpha);
    textSize(40);
    text(ft.text, 0, 0);
    pop();
  }
}

/**
 * 輔助函數：繪製星星形狀
 */
function drawStar(x, y, radius1, radius2, npoints) {
  let angle = TWO_PI / npoints;
  let halfAngle = angle / 2.0;
  beginShape();
  for (let a = 0; a < TWO_PI; a += angle) {
    let sx = x + cos(a) * radius2;
    let sy = y + sin(a) * radius2;
    vertex(sx, sy);
    sx = x + cos(a + halfAngle) * radius1;
    sy = y + sin(a + halfAngle) * radius1;
    vertex(sx, sy);
  }
  endShape(CLOSE);
}

/**
 * 處理不同狀態下的背景音樂律動
 */
function updateBackgroundMusic() {
  if (!audioStarted) return;

  if (gameState === "PLAYING" && sndGameBGM.isLoaded()) {
    let currentVol = bgmVolumeSlider.value();
    // 遊戲中：循環播放背景音樂的有音樂片段
    if (!sndGameBGM.isPlaying()) {
      /**
       * 參數說明：loop(開始播放的延遲, 速度, 音量, 循環起始秒數, 循環持續長度)
       * 請根據您的 game_bgm.mp3 實際情況調整下面兩個數值：
       */
      let loopStart = 0;        // 修改這裡：音樂開始有聲音的秒數 (例如 2.5 代表從 2.5 秒處開始)
      let loopDuration = sndGameBGM.duration(); // 修改這裡：要播放的總長度 (例如 30 代表播 30 秒後回到起始點)
      
      sndGameBGM.loop(0, 1, currentVol, loopStart, loopDuration);
    } else {
      // 如果正在播放，即時更新音量
      sndGameBGM.setVolume(currentVol);
    }
  } else {
    // 在主畫面、勝利或結束畫面，停止背景音樂
    if (sndGameBGM.isPlaying()) sndGameBGM.stop();
  }
}

/**
 * 遊戲音效播放器
 */
function playGameSound(type) {
  if (!audioStarted) return;
  
  let vol = sfxVolumeSlider.value(); // 取得特效滑桿數值

  if (type === "success") {
    if (sndSuccess.isLoaded()) sndSuccess.play(0, 1, vol);
  } else if (type === "fail") {
    if (sndFail.isLoaded()) sndFail.play(0, 1, vol);
  } else if (type === "miss") {
    if (sndMiss.isLoaded()) sndMiss.play(0, 1, vol);
  } else if (type === "win") {
    if (sndWin.isLoaded()) sndWin.play(0, 1, vol);
  }
}
