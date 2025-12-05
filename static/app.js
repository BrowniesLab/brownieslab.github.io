// ===============================
// CONFIG
// ===============================
const QUESTIONS = [
  "Give a brief introduction about yourself.",
  "Tell us about a project you are proud of.",
  "How do you usually handle system errors or issues?",
  "What do you expect from your working environment?",
  "Why should we choose you for this position?"
];

let token = null;
let folder = null;
let userName = null;
let currentQ = 0;
let mediaStream = null;
let mediaRecorder = null;
let recordedBlobs = [];
let sessionStarted = false;

// UI helpers
const el = (id) => document.getElementById(id);
const startScreen = el('start-screen');
const interviewScreen = el('interview-screen');
const preview = el('preview');
const questionTitle = el('questionTitle');
const questionBody = el('questionBody');
const questionsList = el('questionsList');
const statusText = el('statusText');
const uploadStatus = el('uploadStatus');
const retryArea = el('retryArea');
const uploadProgress = el('uploadProgress');
const countEl = el('count');

const btnVerify = el('btnVerify');
const btnStartRecord = el('btnStartRecord');
const btnStopRecord = el('btnStopRecord');
const btnRestartRecord = el('btnRestartRecord');
const btnNext = el('btnNext');
const btnFinish = el('btnFinish');

// ===============================
// RENDER QUESTIONS
// ===============================
function renderQuestionsList() {
  questionsList.innerHTML = "";
  QUESTIONS.forEach((q, idx) => {
    const li = document.createElement("li");
    li.textContent = `${idx + 1}. ${q}`;
    if (idx === currentQ) li.style.fontWeight = '700';
    questionsList.appendChild(li);
  });
  countEl.innerText = `${currentQ + 1} / ${QUESTIONS.length}`;
}

function setStatus(s) {
  statusText.innerText = s;
}

// ===============================
// SHOW QUESTION
// ===============================
function showQuestion(index) {
  currentQ = index;
  questionTitle.innerText = QUESTIONS[index];
  questionBody.innerText = QUESTIONS[index];

  setStatus("ready");

  btnStartRecord.disabled = false;
  btnStopRecord.disabled = true;
  btnRestartRecord.disabled = true;
  btnNext.disabled = true;

  uploadStatus.innerText = "";
  retryArea.innerHTML = "";

  renderQuestionsList();
}

// ===============================
// POST HELPERS
// ===============================
async function postForm(url, formData) {
  const r = await fetch(url, { method: "POST", body: formData });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ===============================
// VERIFY TOKEN + START SESSION
// ===============================
btnVerify.addEventListener("click", async () => {
  try {
    token = el("token").value.trim();
    userName = el("userName").value.trim();

    if (!token || !userName) {
      el("startMessage").innerText = "Token and name cannot be empty.";
      return;
    }

    el("startMessage").innerText = "Verifying token...";
    const verifyData = new FormData();
    verifyData.append("token", token);
    await postForm("/api/verify-token", verifyData);

    el("startMessage").innerText = "Requesting camera/microphone access...";
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    preview.srcObject = mediaStream;

    const startData = new FormData();
    startData.append("token", token);
    startData.append("userName", userName);

    const res = await postForm("/api/session/start", startData);
    folder = res.folder;
    sessionStarted = true;

    // SWITCH SCREEN
    startScreen.hidden = true;
    interviewScreen.hidden = false;
    interviewScreen.classList.remove("hidden");

    showQuestion(0);

  } catch (err) {
    el("startMessage").innerText = "Error: " + err.message;
  }
});

// ===============================
// RECORDING
// ===============================
btnStartRecord.addEventListener("click", () => {
  recordedBlobs = [];
  const options = { mimeType: "video/webm;codecs=vp8,opus" };

  try {
    mediaRecorder = new MediaRecorder(mediaStream, options);
  } catch (e) {
    setStatus("MediaRecorder not supported");
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedBlobs.push(e.data);
  };

  mediaRecorder.onstart = () => {
    setStatus("recording");

    btnStartRecord.disabled = true;
    btnStopRecord.disabled = false;
    btnRestartRecord.disabled = false;
  };

  mediaRecorder.start();
});

// ===============================
// STOP + UPLOAD
// ===============================
btnStopRecord.addEventListener("click", () => {
  mediaRecorder.stop();

  mediaRecorder.onstop = async () => {
    setStatus("stopped");
    btnStopRecord.disabled = true;

    const blob = new Blob(recordedBlobs, { type: "video/webm" });
    await uploadWithRetries(blob, currentQ + 1);
  };
});

// ===============================
// RESTART RECORDING
// ===============================
btnRestartRecord.addEventListener("click", () => {
  recordedBlobs = [];
  setStatus("ready");
  uploadStatus.innerText = "Recording cleared. Press Start to record again.";

  btnStartRecord.disabled = false;
  btnStopRecord.disabled = true;
  btnNext.disabled = true;
  retryArea.innerHTML = "";
});

// ===============================
// UPLOAD LOGIC
// ===============================
async function uploadWithRetries(blob, qIndex) {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await uploadQuestion(blob, qIndex);
      uploadStatus.innerText = "Upload successful";
      btnNext.disabled = false;
      return;
    } catch (err) {
      uploadStatus.innerText = `Upload failed (attempt ${attempts}): ${err.message}`;
      await new Promise((r) => setTimeout(r, 800 * attempts));
    }
  }

  const retryBtn = document.createElement("button");
  retryBtn.className = "cta";
  retryBtn.innerText = "Retry Upload";
  retryBtn.onclick = () => uploadWithRetries(blob, qIndex);
  retryArea.appendChild(retryBtn);
}

function uploadQuestion(blob, qIndex) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("token", token);
    fd.append("folder", folder);
    fd.append("questionIndex", qIndex);
    fd.append("video", blob, `Q${qIndex}.webm`);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-one");

    xhr.onload = () => {
      if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
      else reject(new Error("HTTP " + xhr.status));
    };

    xhr.onerror = () => reject("Network error");
    xhr.send(fd);
  });
}

// ===============================
// NEXT QUESTION
// ===============================
btnNext.addEventListener("click", () => {
  if (currentQ < QUESTIONS.length - 1) showQuestion(currentQ + 1);
  else setStatus("All questions completed");
});

// ===============================
// FINISH
// ===============================
btnFinish.addEventListener("click", async () => {
  const fd = new FormData();
  fd.append("token", token);
  fd.append("folder", folder);
  fd.append("questionsCount", currentQ + 1);

  await postForm("/api/session/finish", fd);
  alert("Interview session finished.");
});
