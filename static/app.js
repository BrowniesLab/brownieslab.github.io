// static/app.js (updated, drop-in replacement)
// Integrates your original logic with improved UI handling.

const QUESTIONS = [
  "Question 1: Tell us about yourself.",
  "Question 2: Describe a challenging project you worked on.",
  "Question 3: How do you handle tight deadlines?",
  "Question 4: Why do you want this role?",
  "Question 5: Any questions for us?"
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

function renderQuestionsList() {
  if (!questionsList) return;
  questionsList.innerHTML = '';
  QUESTIONS.forEach((q, idx) => {
    const li = document.createElement('li');
    li.textContent = `${idx + 1}. ${q}`;
    if (idx === currentQ) li.style.fontWeight = '700';
    questionsList.appendChild(li);
  });
  countEl && (countEl.innerText = `${currentQ + 1} / ${QUESTIONS.length}`);
}

function setStatus(s) {
  statusText.innerText = s;
}

function showQuestion(index) {
  currentQ = index;
  questionTitle.innerText = QUESTIONS[index];
  questionBody && (questionBody.innerText = QUESTIONS[index]);
  setStatus('ready');
  btnStartRecord.disabled = false;
  btnStopRecord.disabled = true;
  btnRestartRecord.disabled = true;
  btnNext.disabled = true;
  uploadStatus.innerText = '';
  retryArea.innerHTML = '';
  renderQuestionsList();
}

// POST helper
async function postForm(url, formData) {
  const r = await fetch(url, { method: "POST", body: formData });
  if (!r.ok) throw new Error("Network response not ok: " + r.status);
  return r.json();
}

// VERIFY & START SESSION
btnVerify && btnVerify.addEventListener('click', async () => {
  try {
    token = el("token").value.trim();
    userName = el("userName").value.trim();

    if (!token || !userName) {
      el("startMessage").innerText = "Token and Name required.";
      return;
    }

    el("startMessage").innerText = "Verifying token...";
    const verifyData = new FormData();
    verifyData.append("token", token);
    await postForm("/api/verify-token", verifyData);

    el("startMessage").innerText = "Requesting camera/microphone...";
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    preview.srcObject = mediaStream;

    // start level meter after preview assigned (handled by observer below)

    const startData = new FormData();
    startData.append("token", token);
    startData.append("userName", userName);
    const res = await postForm("/api/session/start", startData);
    folder = res.folder;
    sessionStarted = true;

    // swap UI
    if (startScreen) startScreen.hidden = true;
    if (interviewScreen) interviewScreen.hidden = false;
    showQuestion(0);
  } catch (err) {
    console.error(err);
    el("startMessage").innerText = "Error: " + (err.message || err);
  }
});

// BUTTON HANDLERS
btnStartRecord && btnStartRecord.addEventListener('click', () => startRecording());
btnStopRecord && btnStopRecord.addEventListener('click', () => stopRecordingAndUpload());
btnRestartRecord && btnRestartRecord.addEventListener('click', () => restartRecording());
btnNext && btnNext.addEventListener('click', () => {
  if (currentQ < QUESTIONS.length - 1) showQuestion(currentQ + 1);
  else setStatus('All questions shown');
});
btnFinish && btnFinish.addEventListener('click', async () => {
  if (!sessionStarted) return;
  try {
    const fd = new FormData();
    fd.append("token", token);
    fd.append("folder", folder);
    fd.append("questionsCount", String(currentQ + 1));
    await postForm("/api/session/finish", fd);
    setStatus('finished');
    alert("Session finished. Check server recordings folder.");
  } catch (err) {
    console.error(err);
    alert("Failed to finish: " + err.message);
  }
});

// RESTART RECORDING
function restartRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    // stop, but upload callback uses onstop - we will clear recordedBlobs after stopping
    mediaRecorder.stop();
  }
  recordedBlobs = [];
  setStatus('ready to start again');
  uploadStatus.innerText = 'Recording cleared. Press START to record again.';
  btnStartRecord.disabled = false;
  btnStopRecord.disabled = true;
  btnNext.disabled = true;
  btnRestartRecord.disabled = true;
  retryArea.innerHTML = '';
}

// RECORDING
function startRecording() {
  recordedBlobs = [];
  const options = { mimeType: "video/webm;codecs=vp8,opus" };
  try {
    mediaRecorder = new MediaRecorder(mediaStream, options);
  } catch (e) {
    console.error("MediaRecorder error:", e);
    setStatus("MediaRecorder not supported");
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedBlobs.push(e.data);
  };

  mediaRecorder.onstart = () => {
    setStatus("recording");
    btnStartRecord.disabled = true;
    btnStopRecord.disabled = false;
    btnRestartRecord.disabled = false;
  };

  mediaRecorder.start();
}

function stopRecordingAndUpload() {
  if (!mediaRecorder) return;

  mediaRecorder.stop();

  mediaRecorder.onstop = async () => {
    setStatus('stopped (ready to upload)');
    btnStopRecord.disabled = true;
    btnRestartRecord.disabled = false;

    const blob = new Blob(recordedBlobs, { type: 'video/webm' });
    try {
      await uploadWithRetries(blob, currentQ + 1);
    } catch (err) {
      console.error('Upload process ended with error:', err);
    } finally {
      // avoid double-run
      mediaRecorder.onstop = null;
    }
  };
}

// UPLOAD & RETRIES
async function uploadWithRetries(blob, questionIndex) {
  let attempts = 0;
  const maxAttempts = 3;
  const backoffBase = 800; // ms
  uploadStatus.innerText = "Uploading...";
  uploadProgress && uploadProgress.classList.remove('hidden');
  uploadProgress && (uploadProgress.value = 0);

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await uploadQuestion(blob, questionIndex);
      uploadStatus.innerText = "Upload successful";
      uploadProgress && (uploadProgress.value = 100);
      btnNext.disabled = false;
      btnRestartRecord.disabled = true;
      setTimeout(() => uploadProgress && uploadProgress.classList.add('hidden'), 600);
      return;
    } catch (err) {
      console.warn("Upload failed", attempts, err);
      uploadStatus.innerText = `Upload failed (attempt ${attempts}): ${err.message || err}`;
      if (attempts >= maxAttempts) break;
      const wait = backoffBase * Math.pow(2, attempts - 1);
      await new P
