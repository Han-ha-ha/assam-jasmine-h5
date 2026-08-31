(() => {
  "use strict";

  const APP_VERSION = "20260831-poster-source-draw-bg-v26";
  const PAGE_PARAMS = new URLSearchParams(window.location.search);
  const HOME_KV_VARIANT = PAGE_PARAMS.get("kv") === "vertical" ? "vertical" : "landscape";
  const IS_WECHAT = /MicroMessenger/i.test(navigator.userAgent);
  document.documentElement.dataset.homeKv = HOME_KV_VARIANT;

  const CONFIG = {
    storageKey: "assam-jasmine-h5-v1",
    winnerPhonesStorageKey: "assam-jasmine-winning-phones-v1",
    recipientEmail: "2998458181@qq.com",
    // 临时测试配置：当前普通抽奖概率为 50%。正式上线前必须删除此项并恢复北京时间概率表。
    temporaryWinProbability: 0.5,
    // 所有边界均为北京时间（UTC+8）；中奖窗口以外的时间概率一律为 0。
    winProbabilitySchedule: [
      {
        startAt: "2026-09-05T12:00:00+08:00",
        endAt: "2026-09-06T19:00:00+08:00",
        probability: 1 / 400000,
      },
      {
        startAt: "2026-09-12T12:00:00+08:00",
        endAt: "2026-09-13T19:00:00+08:00",
        probability: 1 / 600000,
      },
    ],
    initialChances: 3,
    maxEarnedChances: 40,
    sceneWidth: 2800,
    sceneHeight: 6000,
    loadingMinDuration: 650,
    loadingTimeout: 4500,
    preloadAssets: [
      "素材/logo.png",
      HOME_KV_VARIANT === "vertical"
        ? "assets/home/guangzhou-kv-9x16.webp"
        : "assets/home/guangzhou-kv-16x9.webp",
      "assets/share/ticket-share-poster.jpg",
      "assets/draw/poster-background.webp",
      "素材3/web/scene-people-final.webp",
      "素材3/门票图.png",
    ],
  };

  let versionPrompted = false;

  const getScheduledWinProbability = (now = Date.now()) => {
    if (Number.isFinite(CONFIG.temporaryWinProbability)) {
      return Math.max(0, Math.min(1, CONFIG.temporaryWinProbability));
    }
    const activePeriod = CONFIG.winProbabilitySchedule.find(({ startAt, endAt }) => (
      now >= Date.parse(startAt) && now < Date.parse(endAt)
    ));
    return activePeriod?.probability ?? 0;
  };

  const checkAppVersion = async () => {
    try {
      const versionUrl = new URL("version.json", document.baseURI);
      versionUrl.searchParams.set("_", Date.now().toString());
      const response = await fetch(versionUrl, { cache: "no-store" });
      if (!response.ok) return;
      const remote = await response.json();
      if (!remote.version || remote.version === APP_VERSION || versionPrompted) return;

      versionPrompted = true;
      if (window.confirm("发现新版本，请刷新后继续体验。\n\n点击“确定”立即刷新。")) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("v", remote.version);
        window.location.replace(nextUrl.href);
      }
    } catch {
      // 离线或网络波动时不打断当前体验，恢复联网后再次检查。
    }
  };

  const defaultState = () => ({
    found: [],
    guided: false,
    chancesGranted: false,
    remainingChances: 0,
    totalEarned: 0,
    drawCount: 0,
    won: false,
    lastShareDate: "",
    submitted: false,
    soundOn: true,
    currentPhone: "",
  });

  const sanitizeState = (saved) => {
    const source = saved && typeof saved === "object" ? saved : {};
    const found = [...new Set(Array.isArray(source.found) ? source.found.map(Number) : [])]
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= 5);
    const remainingChances = Math.max(0, Math.min(CONFIG.maxEarnedChances, Number(source.remainingChances) || 0));
    const totalEarned = Math.max(0, Math.min(CONFIG.maxEarnedChances, Number(source.totalEarned) || 0));
    const currentPhone = String(source.currentPhone || "").replace(/\D/g, "").slice(0, 11);
    return {
      ...defaultState(),
      ...source,
      found,
      remainingChances,
      totalEarned,
      drawCount: Math.max(0, Number(source.drawCount) || 0),
      guided: Boolean(source.guided),
      chancesGranted: Boolean(source.chancesGranted),
      won: Boolean(source.won),
      submitted: Boolean(source.submitted),
      soundOn: source.soundOn !== false,
      lastShareDate: typeof source.lastShareDate === "string" ? source.lastShareDate : "",
      currentPhone,
    };
  };

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || "null");
      return sanitizeState(saved);
    } catch {
      return defaultState();
    }
  };

  // 临时测试入口：微信内置浏览器没有无痕模式时，用指定参数清除本机测试数据。
  // 测试结束后删除此段逻辑，正式链接不会触发。
  const resetTestProgress = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("testReset") !== "1") return;
    const resetHosts = /^(localhost|127\.0\.0\.1|han-ha-ha\.github\.io)$/;
    if (!resetHosts.test(window.location.hostname)) return;
    try {
      localStorage.removeItem(CONFIG.storageKey);
      localStorage.removeItem(CONFIG.winnerPhonesStorageKey);
    } catch {
      // 隐私模式或受限环境下无存储权限时，后续仍以默认状态启动。
    }
  };

  resetTestProgress();
  let state = loadState();
  let currentPage = "home";
  let isDrawing = false;
  let wheelRotation = 0;
  let toastTimer = 0;
  let audioContext = null;
  let modalReturnFocus = null;
  let findFeedbackTimer = 0;
  let pendingWinnerMailText = "";
  let bgmStarted = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const saveState = () => {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
    } catch {
      showToast("当前浏览器无法保存进度");
    }
  };

  const normalizePhone = (value) => String(value || "").replace(/\D/g, "").slice(0, 11);
  const isValidPhone = (phone) => /^1[3-9]\d{9}$/.test(phone);

  const loadWinningPhones = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.winnerPhonesStorageKey) || "[]");
      return Array.isArray(saved) ? saved.map(normalizePhone).filter(isValidPhone) : [];
    } catch {
      return [];
    }
  };

  const hasWinningPhone = (phone) => loadWinningPhones().includes(normalizePhone(phone));

  const rememberWinningPhone = (phone) => {
    const normalized = normalizePhone(phone);
    if (!isValidPhone(normalized)) return;
    try {
      const phones = new Set(loadWinningPhones());
      phones.add(normalized);
      localStorage.setItem(CONFIG.winnerPhonesStorageKey, JSON.stringify([...phones]));
    } catch {
      showToast("当前浏览器无法保存中奖手机号");
    }
  };

  const todayKey = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const showToast = (message, duration = 1800) => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
  };

  const announce = (message) => {
    const status = $("#screenReaderStatus");
    status.textContent = "";
    window.setTimeout(() => { status.textContent = message; }, 20);
  };

  const vibrate = (pattern) => {
    if (navigator.vibrate) navigator.vibrate(pattern);
  };

  const updateHomeUI = () => {
    const buttons = $$(".js-start-button");
    let label = "开始探索";
    if (state.found.length === 5) {
      label = "继续抽奖";
    } else if (state.found.length > 0) {
      label = `继续找奶绿（${state.found.length}/5）`;
    }
    buttons.forEach((button) => { button.textContent = label; });
  };

  const showPage = (name) => {
    $$(".page").forEach((page) => {
      const active = page.dataset.page === name;
      page.classList.toggle("is-active", active);
      page.setAttribute("aria-hidden", String(!active));
    });
    currentPage = name;
    if (name === "game") {
      window.setTimeout(() => sceneController.reset(), 30);
      updateGameUI();
    }
    if (name === "draw") updateDrawUI();
    if (name === "share") updateShareUI();
    if (name === "form") syncWinnerPhoneField();
    if (name === "home") updateHomeUI();
    window.scrollTo(0, 0);
  };

  const openModal = (id) => {
    const modal = $(`#${id}Modal`);
    if (!modal) return;
    modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    const focusTarget = $("a[href], button:not([disabled]), input:not([disabled])", modal);
    window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), 40);
  };

  const closeModal = (modal) => {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
    modalReturnFocus = null;
  };

  const closeAllModals = () => $$(".modal.is-open").forEach(closeModal);

  const ensureAudio = () => {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    if (audioContext?.state === "suspended") audioContext.resume();
  };

  const playNote = (frequency, start, duration, wave = "sine", volume = 0.09) => {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  };

  const beep = (type = "tap") => {
    if (!state.soundOn) return;
    ensureAudio();
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const patterns = {
      tap: [[480, 0, 0.045, "sine", 0.055]],
      found: [[620, 0, 0.11, "sine", 0.08], [830, 0.1, 0.16, "triangle", 0.075]],
      complete: [[523, 0, 0.16, "sine", 0.075], [659, 0.13, 0.18, "sine", 0.08], [784, 0.28, 0.32, "triangle", 0.08]],
      spin: Array.from({ length: 12 }, (_, index) => [260 + index * 16, index * 0.08, 0.045, "square", 0.025]),
      win: [[659, 0, 0.18, "sine", 0.075], [784, 0.14, 0.2, "sine", 0.08], [988, 0.31, 0.42, "triangle", 0.085]],
      lose: [[330, 0, 0.14, "sine", 0.06], [247, 0.13, 0.28, "sine", 0.055]],
    };
    (patterns[type] || patterns.tap).forEach(([frequency, offset, duration, wave, volume]) => {
      playNote(frequency, now + offset, duration, wave, volume);
    });
  };

  const syncBgm = () => {
    const bgm = $("#bgm");
    if (!bgm) return;
    bgm.volume = 0.32;
    if (state.soundOn && bgmStarted && document.visibilityState !== "hidden") {
      bgm.play().catch(() => {
        // 微信或浏览器阻止自动播放时，等待下一次用户点击后再尝试。
      });
    } else {
      bgm.pause();
    }
  };

  const startBgm = () => {
    bgmStarted = true;
    syncBgm();
  };

  const updateSoundButton = () => {
    const button = $("#soundBtn");
    button.textContent = state.soundOn ? "♪" : "×";
    button.setAttribute("aria-label", state.soundOn ? "关闭声音" : "开启声音");
    button.setAttribute("aria-pressed", String(state.soundOn));
    button.classList.toggle("is-muted", !state.soundOn);
  };

  const updateGameUI = () => {
    const count = state.found.length;
    const percent = count * 20;
    $("#foundCount").textContent = String(count);
    $("#progressPercent").textContent = `${percent}%`;
    $("#progressFill").style.width = `${percent}%`;
    $$("#progressSteps i").forEach((step, index) => step.classList.toggle("is-complete", index < count));
    $$(".target").forEach((target) => {
      target.classList.toggle("is-found", state.found.includes(Number(target.dataset.target)));
    });
    updateSoundButton();
    updateHomeUI();
  };

  const showFindFeedback = (count) => {
    const feedback = $("#findFeedback");
    $("#findFeedbackCount").textContent = `${count}/5`;
    feedback.classList.remove("is-visible");
    void feedback.offsetWidth;
    feedback.classList.add("is-visible");
    clearTimeout(findFeedbackTimer);
    findFeedbackTimer = window.setTimeout(() => feedback.classList.remove("is-visible"), 1100);
  };

  const grantInitialChances = () => {
    if (state.chancesGranted) return;
    state.chancesGranted = true;
    state.remainingChances += CONFIG.initialChances;
    state.totalEarned += CONFIG.initialChances;
    saveState();
  };

  const collectTarget = (target) => {
    if (sceneController.wasDragging) return;
    const id = Number(target.dataset.target);
    if (state.found.includes(id)) return;

    state.found.push(id);
    saveState();
    updateGameUI();
    beep("found");
    vibrate(35);

    const count = state.found.length;
    showFindFeedback(count);
    showToast(count === 5 ? "全部拿下！" : `拿下${count}个`);
    announce(`找到第${count}个茉莉奶绿，共5个`);
    if (count === 5) {
      grantInitialChances();
      vibrate([45, 45, 80]);
      window.setTimeout(() => {
        beep("complete");
        showPage("complete");
      }, 900);
    }
  };

  const updateDrawUI = () => {
    $("#remainingCount").textContent = String(state.remainingChances);
    const sharedToday = state.lastShareDate === todayKey();
    const shareStatus = $("#shareStatus");
    shareStatus.textContent = sharedToday ? "查看海报 ›" : "去分享 ›";
    $("#shareBtn").disabled = false;
    $("#drawBtn").disabled = isDrawing || state.remainingChances <= 0;
    $("#drawBtn").innerHTML = isDrawing ? "抽奖<br />进行中" : "立即<br />抽奖";
    $(".wheel-wrap").classList.toggle("is-spinning", isDrawing);
    $(".wheel-wrap").setAttribute("aria-busy", String(isDrawing));
  };

  const updateShareUI = () => {
    const sharedToday = state.lastShareDate === todayKey();
    const nextButton = $("#shareNextBtn");
    if (!nextButton) return;
    nextButton.textContent = sharedToday ? "继续去分享" : "下一步：去分享";
  };

  const syncWinnerPhoneField = () => {
    const input = $("#winnerPhone");
    if (!input) return;
    input.value = normalizePhone(state.currentPhone);
    input.readOnly = true;
    $("#submitInfoBtn").textContent = state.submitted ? "再次打开邮件" : "提交信息";
  };

  const setEligibilityState = ({ duplicate = false, error = "" } = {}) => {
    const panel = $("#eligibilityModal .modal__panel");
    const input = $("#eligibilityPhone");
    panel.classList.toggle("is-duplicate", duplicate);
    input.readOnly = duplicate;
    input.classList.toggle("has-error", Boolean(error) || duplicate);
    $("#eligibilityTitle").textContent = duplicate ? "该手机号已中奖" : "确认抽奖手机号";
    $("#eligibilityText").textContent = duplicate
      ? "您已中奖，每人限1张"
      : "每个手机号限中奖1张，请先确认本次抽奖手机号";
    $("#eligibilityError").textContent = error || (duplicate ? "请勿重复参与中奖，可关闭弹窗返回活动页" : "");
    $("#eligibilityConfirmBtn").textContent = duplicate ? "我知道了" : "确认并抽奖";
  };

  const openEligibilityCheck = (phone = state.currentPhone) => {
    const normalized = normalizePhone(phone);
    const duplicate = state.won || (isValidPhone(normalized) && hasWinningPhone(normalized));
    $("#eligibilityPhone").value = normalized;
    setEligibilityState({ duplicate });
    openModal("eligibility");
    window.setTimeout(() => $("#eligibilityPhone").focus(), 80);
  };

  const showResult = (won) => {
    const title = $("#resultTitle");
    const text = $("#resultText");
    const icon = $("#resultIcon");
    const ticket = $("#ticketPreview");
    const action = $("#resultActionBtn");

    if (won) {
      $("#resultEyebrow").textContent = "恭喜中奖！";
      title.textContent = "好心情门票属于你";
      text.textContent = "请在24小时内填写兑奖信息";
      icon.textContent = "★";
      ticket.hidden = false;
      action.textContent = "填写中奖信息";
      action.dataset.action = "form";
      beep("win");
      vibrate([80, 50, 120]);
    } else {
      $("#resultEyebrow").textContent = "GOOD MOOD";
      title.textContent = "未中奖";
      text.textContent = state.remainingChances > 0 ? "别灰心，继续试试好手气吧" : "今日机会已用完，分享活动可额外获得1次机会";
      icon.textContent = "✿";
      ticket.hidden = true;
      action.textContent = state.remainingChances > 0 ? "继续抽奖" : "知道了";
      action.dataset.action = "close";
      beep("lose");
      vibrate(45);
    }
    openModal("result");
  };

  const performDraw = () => {
    if (isDrawing) return;
    if (state.remainingChances <= 0) {
      showToast("抽奖机会已用完，可以分享获得额外机会");
      return;
    }

    const phone = normalizePhone(state.currentPhone);
    if (!isValidPhone(phone)) {
      openEligibilityCheck(phone);
      return;
    }
    if (state.won || hasWinningPhone(phone)) {
      openEligibilityCheck(phone);
      return;
    }

    isDrawing = true;
    state.remainingChances -= 1;
    state.drawCount += 1;
    const winProbability = getScheduledWinProbability();
    const params = new URLSearchParams(window.location.search);
    const forceLocalWin = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
      && params.get("forceWin") === "1";
    const won = !state.won && (forceLocalWin || Math.random() < winProbability);
    if (won) {
      state.won = true;
      rememberWinningPhone(phone);
    }
    saveState();
    updateDrawUI();
    announce("抽奖开始，请稍候");

    beep("spin");
    const wheelSegmentCount = 8;
    const segmentAngle = 360 / wheelSegmentCount;
    const targetSegment = won ? 0 : 1 + Math.floor(Math.random() * (wheelSegmentCount - 1));
    const targetCenterAngle = targetSegment * segmentAngle + segmentAngle / 2;
    const desiredRotation = (360 - targetCenterAngle) % 360;
    const currentRotation = ((wheelRotation % 360) + 360) % 360;
    const landingDelta = (desiredRotation - currentRotation + 360) % 360;
    wheelRotation += 1440 + landingDelta;
    $("#wheel").style.transform = `rotate(${wheelRotation}deg)`;

    window.setTimeout(() => {
      isDrawing = false;
      updateDrawUI();
      showResult(won);
      announce(won ? "恭喜中奖，请填写兑奖信息" : "本次未中奖");
    }, 3700);
  };

  const requestDraw = () => {
    if (isDrawing) return;
    if (state.remainingChances <= 0) {
      showToast("抽奖机会已用完，可以分享获得额外机会");
      return;
    }

    const phone = normalizePhone(state.currentPhone);
    if (!isValidPhone(phone) || state.won || hasWinningPhone(phone)) {
      openEligibilityCheck(phone);
      return;
    }
    performDraw();
  };

  const confirmEligibility = (event) => {
    event.preventDefault();
    if ($("#eligibilityModal .modal__panel").classList.contains("is-duplicate")) {
      closeModal($("#eligibilityModal"));
      return;
    }
    const input = $("#eligibilityPhone");
    const phone = normalizePhone(input.value);
    input.value = phone;

    if (!isValidPhone(phone)) {
      setEligibilityState({ error: "请输入正确的11位手机号" });
      input.focus();
      return;
    }

    if (state.won || hasWinningPhone(phone)) {
      setEligibilityState({ duplicate: true });
      input.focus();
      return;
    }

    state.currentPhone = phone;
    saveState();
    syncWinnerPhoneField();
    closeModal($("#eligibilityModal"));
    performDraw();
  };

  const claimShareChance = () => {
    if (state.lastShareDate === todayKey()) {
      showToast("今天已经获得过分享奖励了");
      closeModal($("#shareGuideModal"));
      showPage("draw");
      return;
    }
    if (state.totalEarned >= CONFIG.maxEarnedChances) {
      showToast("已达到40次参与机会的上限");
      closeModal($("#shareGuideModal"));
      showPage("draw");
      return;
    }

    state.lastShareDate = todayKey();
    state.remainingChances += 1;
    state.totalEarned += 1;
    saveState();
    closeModal($("#shareGuideModal"));
    showPage("draw");
    updateDrawUI();
    beep("found");
    vibrate(35);
    showToast("已获得1次额外抽奖机会");
  };

  const setFieldError = (input, message) => {
    input.classList.toggle("has-error", Boolean(message));
    const errorElement = input.closest("label")?.querySelector(".field-error");
    if (errorElement) errorElement.textContent = message;
  };

  const copyText = async (text) => {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    }
  };

  const submitWinnerInfo = (event) => {
    event.preventDefault();
    const nameInput = $("#winnerName");
    const phoneInput = $("#winnerPhone");
    const idInput = $("#winnerId");
    const agree = $("#privacyAgree");
    const name = nameInput.value.trim();
    const phone = normalizePhone(state.currentPhone || phoneInput.value);
    phoneInput.value = phone;
    const idNumber = idInput.value.trim().toUpperCase();

    const nameError = /^[\u4e00-\u9fa5·]{2,20}$/.test(name) ? "" : "请输入2-20位真实中文姓名";
    const phoneError = isValidPhone(phone) ? "" : "请先返回抽奖页确认手机号";
    const idError = /^(\d{15}|\d{17}[\dX])$/.test(idNumber) ? "" : "请输入正确的身份证号";
    setFieldError(nameInput, nameError);
    setFieldError(phoneInput, phoneError);
    setFieldError(idInput, idError);

    if (nameError || phoneError || idError) {
      showToast("请检查填写的信息");
      return;
    }
    if (!agree.checked) {
      showToast("请先阅读并同意兑奖信息用途");
      return;
    }

    const subject = "【好心情音乐会广州站】中奖信息提交";
    const body = [
      "统一阿萨姆茉莉奶绿 好心情音乐会广州站",
      "",
      `姓名：${name}`,
      `手机号：${phone}`,
      `身份证号：${idNumber}`,
      `提交时间：${new Date().toLocaleString("zh-CN")}`,
      "",
      "请品牌方工作人员核对并联系中奖者。",
    ].join("\n");
    const fullMailtoUrl = `mailto:${CONFIG.recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const mailtoUrl = IS_WECHAT ? `mailto:${CONFIG.recipientEmail}` : fullMailtoUrl;
    pendingWinnerMailText = `收件邮箱：${CONFIG.recipientEmail}\n主题：${subject}\n\n${body}`;
    const mailLink = $("#mailOpenLink");
    mailLink.href = mailtoUrl;
    $("#submitTitle").textContent = IS_WECHAT ? "请打开邮件并粘贴信息" : "中奖邮件已经准备好";
    $("#submitMailText").textContent = IS_WECHAT
      ? "中奖信息已复制，请打开邮件应用后粘贴并发送。"
      : "页面会尝试唤起邮件应用；若没有响应，请点击下方按钮。";
    $("#submitMailNote").textContent = `收件邮箱：${CONFIG.recipientEmail}，仍需在邮件应用中确认发送。`;

    state.submitted = true;
    saveState();
    $("#submitInfoBtn").textContent = "再次打开邮件";
    openModal("submit");
    beep("complete");
    vibrate(45);
    if (IS_WECHAT) {
      copyText(pendingWinnerMailText).then((copied) => {
        if (copied) showToast("中奖信息已复制，打开邮件后直接粘贴", 3600);
      });
    }
    mailLink.click();
    if (!IS_WECHAT) showToast("若未自动打开，请点击“打开邮件应用”", 3600);
  };

  const sceneController = (() => {
    const viewport = $("#sceneViewport");
    const scene = $("#scene");
    const pointers = new Map();
    let scale = 0.5;
    let minScale = 0.4;
    let maxScale = 1.15;
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let pinchStartDistance = 0;
    let pinchStartScale = 0;
    let moved = false;
    let viewW = 0;
    let viewH = 0;
    let renderFrame = 0;

    const updateViewportSize = () => {
      viewW = viewport.clientWidth;
      viewH = viewport.clientHeight;
    };

    const clamp = () => {
      const sceneW = CONFIG.sceneWidth * scale;
      const sceneH = CONFIG.sceneHeight * scale;
      const minX = Math.min(0, viewW - sceneW);
      const minY = Math.min(0, viewH - sceneH);
      x = Math.min(0, Math.max(minX, x));
      y = Math.min(0, Math.max(minY, y));
    };

    const renderNow = () => {
      if (renderFrame) {
        window.cancelAnimationFrame(renderFrame);
        renderFrame = 0;
      }
      clamp();
      scene.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    };

    const scheduleRender = () => {
      if (renderFrame) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = 0;
        clamp();
        scene.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      });
    };

    const reset = () => {
      updateViewportSize();
      minScale = Math.max(viewW / CONFIG.sceneWidth, viewH / CONFIG.sceneHeight);
      maxScale = Math.max(1.05, minScale * 2.3);
      const entranceScale = (viewW / CONFIG.sceneWidth) * 1.72;
      scale = Math.min(maxScale, Math.max(minScale * 1.08, entranceScale));
      x = (viewW - CONFIG.sceneWidth * scale) / 2;
      y = viewH - CONFIG.sceneHeight * scale;
      renderNow();
    };

    const setScale = (nextScale, centerX = viewW / 2, centerY = viewH / 2, deferRender = false) => {
      const previous = scale;
      scale = Math.min(maxScale, Math.max(minScale, nextScale));
      const ratio = scale / previous;
      x = centerX - (centerX - x) * ratio;
      y = centerY - (centerY - y) * ratio;
      if (deferRender) scheduleRender();
      else renderNow();
    };

    const pointerDistance = () => {
      const values = [...pointers.values()];
      if (values.length < 2) return 0;
      return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    };

    viewport.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".target")) return;
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      moved = false;
      if (pointers.size === 1) {
        startX = event.clientX;
        startY = event.clientY;
        originX = x;
        originY = y;
        viewport.classList.add("is-dragging");
      } else if (pointers.size === 2) {
        pinchStartDistance = pointerDistance();
        pinchStartScale = scale;
      }
    });

    viewport.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const distance = pointerDistance();
        if (pinchStartDistance > 0) {
          moved = true;
          setScale(pinchStartScale * (distance / pinchStartDistance), viewW / 2, viewH / 2, true);
        }
      } else if (pointers.size === 1) {
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 7) moved = true;
        x = originX + dx;
        y = originY + dy;
        scheduleRender();
        if (moved) $("#gameHint").classList.add("is-hidden");
      }
    });

    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      renderNow();
      if (pointers.size === 0) viewport.classList.remove("is-dragging");
      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        startX = remaining.x;
        startY = remaining.y;
        originX = x;
        originY = y;
      }
      window.setTimeout(() => { moved = false; }, 60);
    };

    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      setScale(scale * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    return {
      reset,
      zoomIn: () => setScale(scale * 1.18),
      zoomOut: () => setScale(scale / 1.18),
      get wasDragging() { return moved; },
    };
  })();

  const bindEvents = () => {
    $$(".js-start-button").forEach((button) => button.addEventListener("click", () => {
        ensureAudio();
        startBgm();
        beep("tap");
        if (state.found.length === 5) {
          grantInitialChances();
          showPage("draw");
          return;
        }
        showPage("game");
        if (!state.guided) openModal("guide");
      }));

    $("#guideOk").addEventListener("click", () => {
      state.guided = true;
      saveState();
      closeModal($("#guideModal"));
      beep("tap");
    });

    $$(".target").forEach((target) => target.addEventListener("click", () => collectTarget(target)));
    $("#zoomIn").addEventListener("click", () => { sceneController.zoomIn(); beep("tap"); });
    $("#zoomOut").addEventListener("click", () => { sceneController.zoomOut(); beep("tap"); });
    $("#soundBtn").addEventListener("click", () => {
      state.soundOn = !state.soundOn;
      saveState();
      updateSoundButton();
      syncBgm();
      if (state.soundOn) beep("tap");
    });

    $("#toDrawBtn").addEventListener("click", () => showPage("draw"));
    $("#drawBtn").addEventListener("click", requestDraw);
    $("#shareBtn").addEventListener("click", () => { beep("tap"); showPage("share"); });
    $("#shareNextBtn").addEventListener("click", () => { beep("tap"); openModal("shareGuide"); });
    $("#confirmShareBtn").addEventListener("click", claimShareChance);
    $("#eligibilityForm").addEventListener("submit", confirmEligibility);
    $("#eligibilityPhone").addEventListener("input", (event) => {
      event.currentTarget.value = normalizePhone(event.currentTarget.value);
      setEligibilityState();
    });
    $("#winnerForm").addEventListener("submit", submitWinnerInfo);
    $("#copyWinnerInfoBtn").addEventListener("click", async () => {
      const copied = await copyText(pendingWinnerMailText);
      showToast(copied ? "中奖信息已复制，请粘贴到邮件中发送" : "复制失败，请点击“打开邮件应用”");
    });
    $$("#winnerForm input:not([type='checkbox'])").forEach((input) => input.addEventListener("input", () => {
      if (input.id === "winnerPhone") return;
      if (input.id === "winnerId") input.value = input.value.toUpperCase().replace(/[^0-9X]/g, "");
      setFieldError(input, "");
    }));

    $("#resultActionBtn").addEventListener("click", (event) => {
      closeModal($("#resultModal"));
      if (event.currentTarget.dataset.action === "form") showPage("form");
    });

    $$('[data-open-modal]').forEach((button) => button.addEventListener("click", () => { beep("tap"); openModal(button.dataset.openModal); }));
    $$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => { beep("tap"); closeModal(button.closest(".modal")); }));
    $$('[data-go-home]').forEach((button) => button.addEventListener("click", () => { beep("tap"); showPage("home"); }));
    $$('[data-go-draw]').forEach((button) => button.addEventListener("click", () => { beep("tap"); showPage("draw"); }));

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (currentPage === "game") sceneController.reset();
      }, 120);
    });

    document.addEventListener("keydown", (event) => {
      const modal = $(".modal.is-open");
      if (event.key === "Escape") {
        closeAllModals();
        return;
      }
      if (event.key !== "Tab" || !modal) return;
      const focusable = $$("a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])", modal)
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  };

  const runLoading = async () => {
    const bar = $("#loadingBar");
    const text = $("#loadingText");
    const startedAt = performance.now();
    let completed = 0;
    let failed = 0;
    const tasks = CONFIG.preloadAssets.map((assetPath) => new Promise((resolve) => {
      const image = new Image();
      const finish = (ok) => {
        completed += 1;
        if (!ok) failed += 1;
        const progress = Math.min(92, Math.round((completed / (CONFIG.preloadAssets.length + 1)) * 92));
        bar.style.width = `${progress}%`;
        text.textContent = `${progress}%`;
        resolve();
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = new URL(assetPath, window.location.href).href;
    }));

    tasks.push(Promise.resolve(document.fonts?.ready).then(() => {
      completed += 1;
      const progress = Math.min(92, Math.round((completed / (CONFIG.preloadAssets.length + 1)) * 92));
      bar.style.width = `${progress}%`;
      text.textContent = `${progress}%`;
    }));

    const timeout = new Promise((resolve) => window.setTimeout(resolve, CONFIG.loadingTimeout));
    await Promise.race([Promise.allSettled(tasks), timeout]);
    const elapsed = performance.now() - startedAt;
    if (elapsed < CONFIG.loadingMinDuration) {
      await new Promise((resolve) => window.setTimeout(resolve, CONFIG.loadingMinDuration - elapsed));
    }
    bar.style.width = "100%";
    text.textContent = "100%";
    window.setTimeout(() => {
      $("#loading").classList.add("is-hidden");
      if (failed) showToast("部分素材加载失败，已使用基础样式", 2600);
    }, 180);
  };

  bindEvents();
  updateGameUI();
  updateDrawUI();
  syncWinnerPhoneField();
  updateHomeUI();
  runLoading();
  checkAppVersion();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkAppVersion();
    syncBgm();
  });
  window.setInterval(checkAppVersion, 60000);
})();
