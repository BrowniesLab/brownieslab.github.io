// ===============================
// QUESTIONS
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

// Helper
const el = (id) => document.getElementById(id);

// ===============================
// POST FORM
// ===============================
async function postForm(url, formData) {
  const r = await fetch(url, { method: "POST", body: formData });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ===============================
// VERIFY TOKEN & START SESSION
// ===============================
el("btnVerify").addEventListener("click", async () => {
  try {
    token = el("token").value.trim();
    userName = el("userName").value.trim();

    if (!token || !userName) {
      el("startMessage").innerText = "Token and name cannot be empty.";
      return;
    }

    el("startMessage").innerText = "Verifying token...";

    const fd = new FormData();
    fd.append("token", token);
    await postForm("/api/verify-token", fd);

    // Request camera/mic
    el("startMessage").innerText = "Requesting camera/microphone access...";
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    el("preview").srcObject = mediaStream;

    // Start session
    const fd2 = new FormData();
    fd2.append("token", token);
    fd2.append("userName", userName);
    const res = await postForm("/api/session/start", fd2);
    folder = res.folder;
    sessionStarted = true;

    // Switch UI
    el("start-screen").hidden = true;
    el("interview-screen").hidden = false;

    showQuestion(0);
  } catch (err) {
    el("startMessage").innerText = "Error: " + err.message;
  }
});

// ===============================
// SHOW QUESTION
// ===============================
function showQuestion(i) {
  currentQ = i;
  el("questionTitle").innerText = QUESTIONS[i];
  el("statusText").innerText = "ready";

  el("btnStartRecord").disabled = false;
  el("btnStopRecord").disabled = true;
  el("btnRestartRecord").disabled = true;
  el("btnNext").disabled = true;

  el("uploadStatus").innerText = "";
  el("retryArea").innerHTML = "";
}

// ===============================
// RECORDING
// ===============================
el("btnStartRecord").addEventListener("click", () => {
  recordedBlobs = [];
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: "video/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedBlobs.push(e.data);
  };

  mediaRecorder.onstart = () => {
    el("statusText").innerText = "recording";
    el("btnStartRecord").disabled = true;
    el("btnStopRecord").disabled = false;
    el("btnRestartRecord").disabled = false;
  };

  mediaRecorder.start();
});

el("btnStopRecord").addEventListener("click", () => {
  mediaRecorder.stop();

  mediaRecorder.onstop = () => {
    el("statusText").innerText = "stopped";
    el("btnStopRecord").disabled = true;

    const blob = new Blob(recordedBlobs, { type: "video/webm" });
    uploadWithRetry(blob, currentQ + 1);
  };
});

// ===============================
// RESTART RECORD
// ===============================
el("btnRestartRecord").addEventListener("click", () => {
  recordedBlobs = [];
  el("statusText").innerText = "ready";
  el("uploadStatus").innerText = "Recording deleted. Press Start to record again.";
  el("btnStartRecord").disabled = false;
  el("btnStopRecord").disabled = true;
  el("btnNext").disabled = true;
});

// ===============================
// UPLOAD WITH RETRY
// ===============================
async function uploadWithRetry(blob, qIndex) {
  let attempts = 0;
  const max = 3;

  while (attempts < max) {
    attempts++;
    try {
      await uploadQuestion(blob, qIndex);
      el("uploadStatus").innerText = "Upload successful";
      el("btnNext").disabled = false;
      return;
    } catch (err) {
      el("uploadStatus").innerText = `Upload failed (attempt ${attempts}): ${err.message}`;
      await new Promise((r) => setTimeout(r, 800 * attempts));
    }
  }

  const retryBtn = document.createElement("button");
  retryBtn.innerText = "Retry";
  retryBtn.className = "btn-blue";
  retryBtn.onclick = () => uploadWithRetry(blob, qIndex);

  el("retryArea").appendChild(retryBtn);
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
      if (xhr.status === 200) {
        const json = JSON.parse(xhr.responseText);
        if (json.ok) resolve(json);
        else reject(new Error("Server error"));
      } else reject(new Error("HTTP " + xhr.status));
    };

    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(fd);
  });
}

// ===============================
// NEXT QUESTION
// ===============================
el("btnNext").addEventListener("click", () => {
  if (currentQ < QUESTIONS.length - 1) showQuestion(currentQ + 1);
  else el("statusText").innerText = "No more questions";
});

// ===============================
// FINISH SESSION
// ===============================
el("btnFinish").addEventListener("click", async () => {
  const fd = new FormData();
  fd.append("token", token);
  fd.append("folder", folder);
  fd.append("questionsCount", currentQ + 1);

  await postForm("/api/session/finish", fd);
  alert("The interview session has ended.");
});
