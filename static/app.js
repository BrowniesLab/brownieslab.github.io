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

let currentAttempt = 1;         // Biến đếm số lần thử hiện tại (1 hoặc 2)
const MAX_ATTEMPTS = 2;         // Giới hạn tổng số lần quay (1 gốc + 1 re-record)

// ===============================
// SHOW QUESTION (RESET ATTEMPTS)
// ===============================
function showQuestion(index) {
  currentQ = index;
  currentAttempt = 1; // Reset biến đếm về 1

  questionTitle.innerText = QUESTIONS[index];
  questionBody.innerText = QUESTIONS[index];

  setStatus("Ready to record (Attempt 1/2)");

  btnStartRecord.disabled = false;
  btnStopRecord.disabled = true;
  btnNext.disabled = true;

  btnRestartRecord.disabled = true; // Khóa lại cho đến khi quay xong lần 1
  btnRestartRecord.innerText = "Re-record"; // Trả lại tên mặc định (xóa chữ "No retries left")


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
    const isReRecord = currentAttempt > 1;
    setStatus(isReRecord ? "Recording (Re-record)..." : "Recording...");

    btnStartRecord.disabled = true;
    btnStopRecord.disabled = false;
    btnRestartRecord.disabled = true; // Không cho restart TRONG KHI đang quay
    btnNext.disabled = true;
  };

  mediaRecorder.start();
});

// ===============================
// STOP + UPLOAD
// ===============================
btnStopRecord.addEventListener("click", () => {
  mediaRecorder.stop();

  mediaRecorder.onstop = async () => {
    setStatus("Stopped");
    btnStopRecord.disabled = true;

    // Logic nút Restart:
    // Chỉ enable nếu chưa đạt giới hạn MAX_ATTEMPTS
    if (currentAttempt < MAX_ATTEMPTS) {
        btnRestartRecord.disabled = false;
        btnRestartRecord.innerText = "Re-record (1 left)"; // Cập nhật text để user biết
    } else {
        btnRestartRecord.disabled = true;
        btnRestartRecord.innerText = "No retries left";
    }

    const blob = new Blob(recordedBlobs, { type: "video/webm" });
    
    // Upload ngay lập tức bản ghi này (Lần 1 hoặc Lần 2 đều upload)
    // Server sẽ nhận được cả 2 file.
    await uploadWithRetries(blob, currentQ + 1, currentAttempt);
  };
});

// ===============================
// RESTART RECORDING 
// ===============================
btnRestartRecord.addEventListener("click", () => {
  // Guard clause: Chặn nếu user cố tình hack hoặc click nhầm
  if (currentAttempt >= MAX_ATTEMPTS) {
    alert("You have used your one-time re-record allowance.");
    btnRestartRecord.disabled = true;
    return;
  }

  // Tăng biến đếm
  currentAttempt++;

  // Reset Buffer
  recordedBlobs = [];
  
  // Cập nhật UI
  setStatus("Ready to Re-record (Last Attempt)");
  uploadStatus.innerText = "Previous recording saved. Press Start for your final attempt.";
  
  // Điều khiển nút
  btnStartRecord.disabled = false; // Mở lại nút Start
  btnStopRecord.disabled = true;
  btnNext.disabled = true;         // Khóa nút Next, bắt buộc phải quay xong lần 2 mới được đi tiếp
  retryArea.innerHTML = "";
  
  // Disable nút Restart ngay lập tức để tránh click nhiều lần
  btnRestartRecord.disabled = true;
});

// ===============================
// UPLOAD LOGIC
// ===============================
async function uploadWithRetries(blob, qIndex, attempt) {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await uploadQuestion(blob, qIndex, attempt); // Truyền attempt vào đây
      
      const attemptLabel = attempt > 1 ? "(Re-record)" : "(Attempt 1)";
      uploadStatus.innerText = `Upload successful ${attemptLabel}`;
      
      // Luôn mở nút Next sau khi upload thành công bất kể là lần 1 hay 2
      btnNext.disabled = false; 
      return;
    } catch (err) {
      uploadStatus.innerText = `Upload failed (attempt ${attempts}): ${err.message}`;
      await new Promise((r) => setTimeout(r, 800 * attempts));
    }
  }

  // Nút Retry Upload nếu mạng lỗi
  const retryBtn = document.createElement("button");
  retryBtn.className = "cta";
  retryBtn.innerText = "Retry Upload";
  retryBtn.onclick = () => uploadWithRetries(blob, qIndex, attempt);
  retryArea.appendChild(retryBtn);
}

function uploadQuestion(blob, qIndex, attempt) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    
    // Quy tắc đặt tên file (File Naming Rules)
    // Format: Q{Index}_attempt_{N}.webm
    // Ví dụ: Q1_attempt_1.webm, Q1_attempt_2.webm
    const fileName = `Q${qIndex}_attempt_${attempt}.webm`;

    fd.append("token", token);
    fd.append("folder", folder);
    fd.append("questionIndex", qIndex);
    fd.append("attemptNumber", attempt); // Gửi thêm metadata
    fd.append("isReRecord", attempt > 1); // Gửi thêm flag boolean
    fd.append("video", blob, fileName);

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
