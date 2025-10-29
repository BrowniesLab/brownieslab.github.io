# ComputerNetwork-Web_Interview_Recorder
A web application for recording interviews with the function of uploading videos to server per question.


# Repository structure
'''
web-interview-recorder/
│
├── README.md
├── package.json
├── .gitignore
├── .env.example
│
├── frontend/                     # Web app
│   ├── package.json
│   ├── vite.config.js            # hoặc next.config.js nếu dùng Next.js
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── components/
│       │   ├── VideoRecorder.jsx # Ghi hình từng câu hỏi
│       │   ├── QuestionCard.jsx  # Hiển thị câu hỏi + nút Next/Finish
│       │   ├── UploadStatus.jsx  # Trạng thái upload/retry
│       │   └── TokenForm.jsx     # Nhập token + tên người dùng
│       ├── pages/
│       │   ├── StartPage.jsx
│       │   ├── InterviewPage.jsx
│       │   └── FinishPage.jsx
│       ├── hooks/
│       │   └── useRecorder.js    # custom hook cho getUserMedia, stop/start, upload
│       ├── services/
│       │   └── api.js            # Gọi các endpoint: verify-token, session/start, upload-one, finish
│       ├── utils/
│       │   └── retry.js          # Hàm retry với exponential backoff
│       └── styles/
│           └── main.css
│
├── backend/                      # Server (Node.js + Express)
│   ├── package.json
│   ├── server.js                 # Điểm vào chính
│   ├── config/
│   │   └── appConfig.js
│   ├── routes/
│   │   ├── verifyToken.js
│   │   ├── session.js
│   │   └── upload.js
│   ├── controllers/
│   │   ├── tokenController.js
│   │   ├── sessionController.js
│   │   └── uploadController.js
│   ├── middlewares/
│   │   ├── authMiddleware.js
│   │   └── errorHandler.js
│   ├── services/
│   │   ├── storageService.js     # Lưu file theo cấu trúc DD_MM_YYYY_HH_mm_ten_user/
│   │   └── sttService.js         # (Bonus) Speech-to-Text
│   ├── utils/
│   │   ├── logger.js
│   │   └── sanitizeName.js
│   ├── uploads/                  # Folder chứa video upload
│   │   └── (auto-generated folders: DD_MM_YYYY_HH_mm_ten_user/)
│   └── tests/
│       ├── token.test.js
│       ├── upload.test.js
│       └── session.test.js
│
├── docs/
│   ├── architecture-diagram.png  # Sơ đồ kiến trúc client–server
│   ├── api-contract.md           # Tài liệu API
│   ├── folder-structure.md
│   ├── screenshots/              # Ảnh chụp giao diện
│   ├── report.pdf                # Báo cáo nộp cuối kỳ
│   └── task-allocation.xlsx      # Phân công nhiệm vụ nhóm
│
└── scripts/
    └── generate-questions.js     # Tùy chọn: sinh danh sách câu hỏi (JSON)
'''