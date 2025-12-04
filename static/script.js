// script.js - integrated with your original logic, small UI bindings + progress UI
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

// simple element helper
const el = id => document.getElementById(id);

// UI elements
const startScreen = el('start-screen');
const interviewScreen = el('interview-screen');
const preview = el('preview');
const questionTitle = el('questionTitle');
const questionBody = el('questionBody');
const questionsList = el('questionsList');
const statusText = el('statusText');
const statusBadge = el('statusBadge');
const uploadStatus = el('uploadStatus');
const retryArea = el('retryArea');
const uploadProgress = el('uploadProgress');
const countEl = el('count');

// buttons
const btnVerify = el('btnVerify');
const btnStartRecord = el('btnStartRecord');
const btnStopRecord = el('btnStopRecord');
const btnRestartRecord = el('btnRestartRecord');
const btnNext = el('btnNext');
const btnFinish = el('btnFinish');

// prepare question list UI
function renderQuestionsList() {
  questionsList.innerHTML = '';
  QUESTIONS.forEach((q, idx) => {
    const li = document.createElement('li');
    li.textContent = `${idx + 1}. ${q}`;
    if (idx === currentQ) li.style.fontWeight = '700';
    questionsList.appendChild(li);
  });
  countEl.innerText = `${currentQ + 1} / ${QUESTIONS.length}`;
}

// small UI helpers
function setStatus(s) {
  statusText.innerText = s;
  statusBadge.innerText = s[0] ? s.toUpperCase() : 'Ready';
}

function showQuestion(index) {
  currentQ = index;
  questionTitle.innerText = QUESTIONS[index];
  questionBody.innerText = QUESTIONS[index];
  setStatus('ready');
  btnStartRecord.disabled = false;
  btnStopRecord.disabled = true;
  btnRestartRecord.disabled = true;
  btnNext.disabled = true;
  uploadStatus.innerText = '';
  retryArea.innerHTML = '';
  renderQuestionsList();
  countEl.innerText = `${currentQ + 1} / ${QUESTIONS.length}`;
}

// ----------------- POST helper -----------------
async function postForm(url, formData) {
  const r = await fetch(url, { method: "POST", body: formData });
  if (!r.ok) throw new Error("Network response not ok: " + r.status);
  return r.json();
}

// --------------- VERIFY & START SESSION -----------------
btnVerify.addEventListener('click', async () => {
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

    const startData = new FormData();
    startData.append("token", token);
    startData.append("userName", userName);
    const res = await postForm("/api/session/start", startData);
    folder = res.folder;
    sessionStarted = true;

    startScreen.classList.add('hidden');
    interviewScreen.classList.remove('hidden');
    showQuestion(0);
  } catch (err) {
    console.error(err);
    el("startMessage").innerText = "Error: " + (err.message || err);
  }
});

// ----------------- RECORDING -----------------
btnStartRecord.addEventListener('click', () => startRecording());
btnStopRecord.addEventListener('click', () => stopRecordingAndUpload());
btnRestartRecord.addEventListener('click', () => restartRecording());
btnNext.addEventListener('click', () => {
  if (currentQ < QUESTIONS.length - 1) showQuestion(currentQ + 1);
  else setStatus('all done');
});
btnFinish.addEventListener('click', async () => {
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

function restartRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  recordedBlobs = [];
  setStatus('ready to start again');
  uploadStatus.innerText = 'Bản ghi bị xóa. Bấm START để quay lại.';
  btnStartRecord.disabled = false;
  btnStopRecord.disabled = true;
  btnNext.disabled = true;
  btnRestartRecord.disabled = true;
  retryArea.innerHTML = '';
}

// recording core
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

// stop & upload
function stopRecordingAndUpload() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();

  mediaRecorder.onstop = async () => {
    setStatus('stopped (ready to upload)');
    btnStopRecord.disabled = true;
    btnRestartRecord.disabled = false;

    const blob = new Blob(recordedBlobs, { type: 'video/webm' });
    await uploadWithRetries(blob, currentQ + 1);

    // prevent double-calling
    mediaRecorder.onstop = null;
  };
}

// ----------------- UPLOAD + RETRIES -----------------
async function uploadWithRetries(blob, questionIndex) {
  let attempts = 0;
  const maxAttempts = 3;
  const backoffBase = 800;
  uploadStatus.innerText = "Uploading...";
  uploadProgress.classList.remove('hidden');
  uploadProgress.value = 0;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await uploadQuestion(blob, questionIndex);
      uploadStatus.innerText = "Upload successful";
      uploadProgress.value = 100;
      btnNext.disabled = false;
      btnRestartRecord.disabled = true;
      setTimeout(()=> uploadProgress.classList.add('hidden'), 600);
      return;
    } catch (err) {
      console.warn("Upload failed", attempts, err);
      uploadStatus.innerText = `Upload failed (attempt ${attempts}): ${err.message || err}`;
      if (attempts >= maxAttempts) break;
      const wait = backoffBase * Math.pow(2, attempts - 1);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  // show manual retry
  retryArea.innerHTML = '';
  const retryBtn = document.createElement('button');
  retryBtn.className = 'cta';
  retryBtn.innerText = 'Retry Upload';
  retryBtn.addEventListener('click', async () => {
    retryArea.innerHTML = '';
    uploadStatus.innerText = 'Retrying...';
    await uploadWithRetries(blob, questionIndex);
  });
  retryArea.appendChild(retryBtn);
  uploadProgress.classList.add('hidden');
}

function uploadQuestion(blob, questionIndex) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("token", token);
    form.append("folder", folder);
    form.append("questionIndex", String(questionIndex));
    form.append("video", blob, `Q${questionIndex}.webm`);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-one");

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          if (resp.ok) resolve(resp);
          else reject(new Error(resp.error || "upload error"));
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error("HTTP " + xhr.status));
      }
    };

    xhr.onerror = () => reject(new Error("Network error"));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        uploadStatus.innerText = `Uploading: ${pct}%`;
        uploadProgress.value = pct;
      }
    };

    xhr.send(form);
  });
}

// ---------------- Level meter (optional) ----------------
const levelCanvas = el('levelCanvas');
let audioContext, analyserNode, sourceNode, rafId, streamRef;
function startLevelMeter(stream){
  try{
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    sourceNode.connect(analyserNode);
    const bufferLength = analyserNode.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    const ctx = levelCanvas.getContext('2d');

    function draw(){
      analyserNode.getByteFrequencyData(data);
      let sum = 0;
      for(let i=0;i<data.length;i++) sum += data[i];
      const avg = sum / data.length;
      ctx.clearRect(0,0,levelCanvas.width, levelCanvas.height);
      const w = (levelCanvas.width) * (avg / 255);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0,0,w,levelCanvas.height);
      ctx.fillStyle = '#e6e9ee';
      ctx.fillRect(w,0,levelCanvas.width - w, levelCanvas.height);
      rafId = requestAnimationFrame(draw);
    }

    function resize(){
      const dpr = window.devicePixelRatio || 1;
      levelCanvas.width = levelCanvas.clientWidth * dpr;
      levelCanvas.height = levelCanvas.clientHeight * dpr;
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
    streamRef = stream;
  }catch(err){
    console.warn('level meter failed', err);
  }
}

function stopLevelMeter(){
  if(rafId) cancelAnimationFrame(rafId);
  if(analyserNode) analyserNode.disconnect();
  if(sourceNode) sourceNode.disconnect();
  if(audioContext) audioContext.close();
  audioContext = analyserNode = sourceNode = null;
  if(streamRef){
    streamRef.getTracks().forEach(t=>t.stop());
    streamRef = null;
  }
}

// Start level meter when preview available
// When preview assigned in verify step above, call startLevelMeter(mediaStream)
const observer = new MutationObserver(() => {
  // simple: if preview.srcObject exists and meter not started, start
  if (preview && preview.srcObject && !audioContext) {
    startLevelMeter(preview.srcObject);
  }
});
observer.observe(preview, { attributes: true, childList: false, subtree: false });

// initial UI
renderQuestionsList();
