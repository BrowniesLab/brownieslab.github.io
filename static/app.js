// Frontend: index.html logic

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
let isUploading = false;
let sessionStarted = false;

const el = (id) => document.getElementById(id);

async function postForm(url, formData) {
  // returns parsed JSON or throws
  const r = await fetch(url, { method: "POST", body: formData });
  if (!r.ok) throw new Error("Network response not ok: " + r.status);
  return r.json();
}

// --------------------- VERIFY & START SESSION ---------------------

el("btnVerify").addEventListener("click", async () => {
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

    // request camera/mic first
    el("startMessage").innerText = "Requesting camera/microphone...";
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    el("preview").srcObject = mediaStream;

    // start session on server
    const startData = new FormData();
    startData.append("token", token);
    startData.append("userName", userName);
    const res = await postForm("/api/session/start", startData);
    folder = res.folder;
    sessionStarted = true;

    document.getElementById("start-screen").hidden = true;
    document.getElementById("interview-screen").hidden = false;
    showQuestion(0);
  } catch (err) {
    console.error(err);
    el("startMessage").innerText = "Error: " + (err.message || err);
  }
});

// --------------------- QUESTION DISPLAY ---------------------

function showQuestion(index) {
  currentQ = index;
  el("questionTitle").innerText = QUESTIONS[index];
  el("statusText").innerText = "ready";
  el("btnStartRecord").disabled = false;
  el("btnStopRecord").disabled = true;
  el("btnNext").disabled = true;
  el("uploadStatus").innerText = "";
  el("retryArea").innerText = "";
}

// --------------------- BUTTON HANDLERS ---------------------

el("btnStartRecord").addEventListener("click", () => startRecording());
el("btnStopRecord").addEventListener("click", () => stopRecordingAndUpload());
el("btnNext").addEventListener("click", () => {
  if (currentQ < QUESTIONS.length - 1) {
    showQuestion(currentQ + 1);
  } else {
    el("statusText").innerText = "All questions shown";
  }
});

el("btnFinish").addEventListener("click", async () => {
  if (!sessionStarted) return;
  try {
    const fd = new FormData();
    fd.append("token", token);
    fd.append("folder", folder);
    fd.append("questionsCount", String(currentQ + 1));
    await postForm("/api/session/finish", fd);
    el("statusText").innerText = "finished";
    alert("Session finished. Check server recordings folder.");
  } catch (err) {
    console.error(err);
    alert("Failed to finish: " + err.message);
  }
});

// --------------------- RECORDING ---------------------

function startRecording() {
  recordedBlobs = [];
  const options = { mimeType: "video/webm;codecs=vp8,opus" };
  try {
    mediaRecorder = new MediaRecorder(mediaStream, options);
  } catch (e) {
    console.error("MediaRecorder error:", e);
    el("statusText").innerText = "MediaRecorder not supported";
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedBlobs.push(e.data);
  };

  mediaRecorder.onstart = () => {
    el("statusText").innerText = "recording";
    el("btnStartRecord").disabled = true;
    el("btnStopRecord").disabled = false;
  };

  mediaRecorder.start();
}

function stopRecordingAndUpload() {
  if (!mediaRecorder) return;
  mediaRecorder.onstop = async () => {
    el("statusText").innerText = "stopped";
    el("btnStopRecord").disabled = true;

    // assemble blob
    const blob = new Blob(recordedBlobs, { type: "video/webm" });
    await uploadWithRetries(blob, currentQ + 1);
  };
  mediaRecorder.stop();
}

// --------------------- UPLOAD & RETRY ---------------------

async function uploadWithRetries(blob, questionIndex) {
  let attempts = 0;
  const maxAttempts = 3;
  const backoffBase = 800; // ms
  el("uploadStatus").innerText = "Uploading...";

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await uploadQuestion(blob, questionIndex);
      el("uploadStatus").innerText = "Upload successful";
      el("btnNext").disabled = false;
      return;
    } catch (err) {
      console.warn("Upload failed", attempts, err);
      el("uploadStatus").innerText = `Upload failed (attempt ${attempts}): ${
        err.message || err
      }`;
      if (attempts >= maxAttempts) break;
      const wait = backoffBase * Math.pow(2, attempts - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // show manual retry button
  const retryArea = el("retryArea");
  retryArea.innerHTML = "";
  const btn = document.createElement("button");
  btn.innerText = "Retry Upload";
  btn.addEventListener("click", async () => {
    retryArea.innerHTML = "";
    el("uploadStatus").innerText = "Retrying...";
    await uploadWithRetries(blob, questionIndex);
  });
  retryArea.appendChild(btn);
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
        el("uploadStatus").innerText = `Uploading: ${(
          (e.loaded / e.total) *
          100
        ).toFixed(0)}%`;
      }
    };

    xhr.send(form);
  });
}
