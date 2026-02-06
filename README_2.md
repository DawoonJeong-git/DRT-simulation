# 🚐 DRT Simulation for Transportation-Disadvantaged Users

본 프로젝트는 교통약자를 위한 DRT (Demand-Responsive Transit) 서비스를 시뮬레이션하고 시각화하는 웹 기반 도구입니다.  
차량은 가상의 경로를 따라 이동하며, 경유지 및 도착지 정보를 기반으로 지도에서 실시간으로 표시됩니다.

---

### 🎯 프로젝트 목표

- 교통약자 대상 DRT 운행 데이터를 기반으로 **실시간 경로 재생** 시각화
- **차량별 경로/상태/정류장 정보**를 deck.gl을 활용해 3D 지도상에서 표현
- 실제 서비스 운영 전 **운영 시나리오를 가시화**하고 **운영 효율성**을 사전 평가

---

### 📌 핵심 기능 요약

- ✅ 차량 경로 및 정류장 시각화
- ✅ 경로 기반 재생 애니메이션 및 속도 조절
- ✅ CSV 또는 JSON을 통한 경로 업로드
- ✅ 지도 회전/이동/확대축소 및 단축키 제어
- ✅ 시뮬레이션 녹화 및 동영상 저장


## ⚙️ 기술 스택 및 시스템 구성

본 프로젝트는 **로컬(Local)** 실행과 **온라인 배포(Deployed)**를 모두 지원하며,  
CSV/JSON 기반의 차량 경로 데이터를 시뮬레이션으로 시각화하는 기능을 제공합니다.

---

### 🧱 사용 기술 (Tech Stack)

| 영역 | 기술 | 설명 |
|------|------|------|
| **Frontend** | React (Vite 기반) | 빠른 개발 및 빌드 |
|              | deck.gl | 차량 경로 애니메이션 시각화 |
|              | MapLibre | 지도 렌더링 (Maptiler 스타일 사용) |
|              | Drag & Drop API | CSV/JSON 업로드 |
|              | getDisplayMedia API | 시뮬레이션 화면 녹화 |
| **Backend**  | Flask (Python) | CSV → 경로 생성 API |
|              | Pandas | CSV 처리 |
| **배포** | Vercel | 정적 웹 프론트엔드 배포 |
|         | Render | 백엔드 API 배포 (Flask 기반) |

---

## 🖥️ 로컬 시스템 구조 (개발 환경)

```
📁 route_input.csv
       │
       ▼
[React + deck.gl] <────────────┐
   │                           │
   ▼                           ▼
MapLibre 지도             Flask 서버 (/api/generate)
   │                           │
   └──── getDisplayMedia ← 캔버스 녹화
```

- `npm run dev`로 React 앱 실행
- `python server.py`로 Flask 서버 실행
- CSV 업로드 시 `/api/generate` 호출 → JSON 반환 → 시각화

---

## 🌐 온라인 시스템 구조 (배포 환경)

```
사용자 브라우저
   │
   ▼
[Vercel에서 호스팅된 React 앱]
   │
   ▼
MapLibre + deck.gl 시각화
   │
   ▼
[Render 서버에 배포된 Flask API 호출]
   │
   ▼
자동 생성된 JSON → 시뮬레이션 실행
```

- 프론트엔드는 **Vercel**에서 정적 배포
- 백엔드는 **Render**에 Python Flask로 배포
- 클라이언트에서 자동으로 환경을 감지하여 API base URL 전환

> 📝 개발/배포 환경 모두에서 동일한 시뮬레이션 기능이 제공됩니다.

---

## 🧭 주요 백엔드 API 요약

| 엔드포인트 | 설명 |
|------------|------|
| `/api/generate` | 업로드된 `route_input.csv`를 바탕으로 `route_output.json` 생성 |
| `/api/output.json` | (선택) 직접 업로드된 JSON 파일을 불러와 시각화 |





## 💻 로컬 실행 및 개발환경 설정

본 프로젝트는 **프론트엔드 (React + Vite)**와 **백엔드 (Flask)**가 각각 독립적으로 실행되며,  
경로 데이터 시각화와 생성 API를 동시에 사용하기 위해 두 서버를 함께 실행해야 합니다.

---

### ✅ 필수 설치 항목

| 항목 | 설치 방법 |
|------|-----------|
| **Node.js** (18 이상 권장) | https://nodejs.org/ |
| **npm** (Node 설치 시 포함) | - |
| **Python 3.9 이상** | https://www.python.org/downloads/ |
| **pip** (Python 패키지 매니저) | Python 포함 |
| **Git** (버전 관리용) | https://git-scm.com/ |

---

### 📁 프로젝트 구조 요약

```
DRT-simulation/
├── server.py
├── requirements.txt
├── public/
│   ├── route_input.csv
│   ├── route_output.json
│   └── [아이콘 이미지들]
├── src/
│   ├── combined/
│   ├── deck/
│   ├── maplibre/
│   └── ui/
└── index.html, package.json, ...
```

---

### 🚀 프론트엔드 실행 (React + Vite)

```bash
# 루트 디렉토리에서
npm install       # 의존성 설치
npm run dev       # 개발 서버 실행 → http://localhost:5173
```

---

### 🐍 백엔드 실행 (Flask)

```bash
# 루트 디렉토리에서

# 가상환경 설정 (선택)
python -m venv venv
source venv/bin/activate   # Mac/Linux
venv\Scripts\activate.bat  # Windows

# 패키지 설치
pip install -r requirements.txt

# 서버 실행
python server.py  # 기본 포트: 5000
```

---

### 🔁 두 서버 실행 확인

- http://localhost:5173 → React 시뮬레이터 UI
- http://localhost:5000/api/generate → Flask API (POST 요청)

---

### 🔄 경로 생성 프로세스 요약

1. `route_input.csv` 파일을 업로드
2. `/api/generate` 호출 → 경로 생성 → `route_output.json` 생성
3. 생성된 JSON을 기반으로 차량 애니메이션 시각화

---

### 🧪 테스트용 데이터 확인

- 기본 `route_input.csv` 예제는 `public/` 폴더에 포함되어 있음
- 직접 업로드 시 동일한 포맷을 유지해야 정상 작동

---

### 📝 참고 명령어

```bash
# 새 패키지 설치
npm install [패키지명]

# Vite 개발 서버 종료 (Ctrl + C)
# Flask 서버 종료 (Ctrl + C)

# 변경 내용 Git 저장
git add .
git commit -m "커밋 메시지"
git push origin main
```

> 💡 백엔드가 먼저 실행되지 않으면 `/api/generate` 호출 시 500 오류가 발생합니다.



## 🔄 GitHub 연동 및 Push 방법

이 프로젝트는 GitHub 저장소와 연동하여 버전 관리 및 배포 자동화를 지원합니다.  
아직 Git을 설정하지 않았다면 아래 단계를 따라 처음부터 설정하세요.

---

### ✅ 1단계: Git 초기화 및 원격 저장소 연결

```bash
# 루트 디렉토리에서 Git 초기화
git init

# GitHub에 새 저장소를 만든 뒤, 원격 저장소 주소 등록
git remote add origin https://github.com/사용자명/저장소이름.git
```

> 💡 GitHub 저장소는 비공개 또는 공개 중 선택 가능하며, README 및 `.gitignore`는 생성하지 않아도 됩니다.

---

### ✅ 2단계: 첫 커밋 & Push

```bash
# 모든 파일 추가
git add .

# 첫 커밋
git commit -m "Initial commit"

# GitHub에 Push (main 브랜치 기준)
git branch -M main
git push -u origin main
```

---

### ✅ 3단계: .gitignore 설정 (중요)

`.gitignore` 파일을 루트 디렉토리에 생성하고 아래 내용을 포함합니다:

```
node_modules/
.env
__pycache__/
*.pyc
.DS_Store
dist/
venv/
```

> 💡 위 설정은 불필요한 파일이 Git에 올라가는 것을 방지합니다.

---

### ✅ 4단계: 변경사항 저장 & 공유

```bash
# 변경된 파일 확인
git status

# 변경된 파일 추가
git add [파일명]    # 또는 git add . 전체

# 커밋 및 메시지 작성
git commit -m "설명 메시지"

# 원격 저장소에 Push
git push origin main
```

---
# backend repo로 연결된 상태에서
git remote set-url origin https://github.com/DawoonJeong-git/flask-drt-backend.git
git add .
git commit -m "백엔드"
git push origin main


# 같은 폴더에서 remote 전환 후	
git remote set-url origin https://github.com/DawoonJeong-git/drt-simulator.git
git add .
git commit -m "프론트엔드"
git push origin main



### ✅ 5단계: GitHub에서 확인

1. GitHub 저장소로 이동 → 코드 변경 확인
2. README.md, server.py 등 정상 반영되었는지 확인

---

### 🛠️ Git 오류 예시

| 오류 메시지 | 원인 및 해결 |
|-------------|--------------|
| `fatal: not a git repository` | `git init`을 먼저 실행해야 함 |
| `error: failed to push some refs` | 브랜치 이름 충돌 → `git push -u origin main`으로 강제 |
| `Permission denied (publickey)` | GitHub SSH 키 설정 오류 → HTTPS 주소로 변경하거나 SSH 키 등록 필요 |

> 💡 GitHub Desktop을 사용하는 경우 GUI를 통해 동일 작업이 가능합니다.


## 🌐 배포 방법: Vercel (Frontend) + Render (Backend)

이 프로젝트는 React 기반 프론트엔드는 **Vercel**,  
Flask 기반 백엔드는 **Render**를 통해 무료로 배포됩니다.

---

### ✅ 1. Vercel로 프론트엔드 배포

#### ① Vercel 계정 생성 및 GitHub 연동
- https://vercel.com/ 접속 → `Sign up with GitHub`
- GitHub 권한 승인

#### ② 새 프로젝트 생성
- `Add New Project` 클릭 → GitHub 저장소 선택
- 프레임워크 자동 인식: **Vite**

#### ③ 설정값
| 항목 | 값 |
|------|----|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Root Directory | 프로젝트 루트 (`/`) |

#### ④ 배포 후
- 자동 빌드 후 URL 생성됨 → `https://your-project-name.vercel.app`
- push 할 때마다 자동 배포

---

### ✅ 2. Render로 백엔드 배포

#### ① Render 계정 생성
- https://render.com → `Sign up with GitHub` 선택

#### ② Flask 서버용 Web Service 생성
- `New +` → `Web Service` 선택
- GitHub 저장소 연결 (Flask 코드 포함 저장소)

#### ③ 설정값 입력
| 항목 | 값 |
|------|----|
| Name | 예: drt-flask-api |
| Runtime | Python |
| Build Command | *(빈칸)* |
| Start Command | `python server.py` |
| Root Directory | 프로젝트 루트 (`/`) |
| Environment | `Python 3.9+`, `Auto Deploy ON` |

> `requirements.txt` 자동 인식 → pip install 자동 수행됨

#### ④ 배포 완료 후
- 예: `https://drt-flask-api.onrender.com`
- `/api/generate` 테스트 가능

---

### 🔁 Vercel–Render 통신 구조 요약

```
[User Browser]
   ↓
[Vercel - React App]
   ↓
[Render - Flask API Server (https://xxxxx.onrender.com)]
```

> 프론트엔드에서는 실행 환경을 감지하여 `getAPIBase()` 함수로 자동 API 주소를 설정함

---

### 💡 주의 사항

- Render는 처음 배포 후 1~2분 지연될 수 있음 (콜드 스타트)
- 무료 계정은 일정 시간 미사용 시 서버 슬립
- CORS 오류 발생 시, Flask 서버에서 `from flask_cors import CORS` 처리 필요

---

### 🔍 배포 후 테스트 방법

1. Vercel에서 앱 URL 접속: https://your-vercel-app.vercel.app
2. CSV 업로드 → Flask 서버에 요청 전송됨
3. 경로 생성 완료 → 시각화 정상 작동 확인


## 📂 프로젝트 파일 및 폴더 구조 설명

이 프로젝트는 React 기반의 프론트엔드와 Flask 기반의 백엔드가 통합되어 있으며,  
각 폴더 및 파일의 역할은 다음과 같습니다:

```
DRT-simulation/
│
├── server.py
│   └─ 📡 Flask 서버: CSV를 입력받아 경로 JSON 생성 (localhost:5000/api/generate)
│
├── requirements.txt
│   └─ 🧪 Flask 서버 실행을 위한 Python 의존성 리스트
│
├── package.json
│   └─ 📦 프론트엔드(Vite) 설정 및 의존성 관리
│
├── public/
│   ├── route_input.csv
│   ├── route_output.json
│   ├── garage.png
│   ├── StartStation.png
│   ├── EndStation.png
│   └─ 📁 아이콘 및 입출력용 파일 저장 위치
│       🔁 React 앱이 직접 참조하는 정적 리소스
│
├── index.html
│   └─ 🧱 React 앱 진입점 (Vite에서 처리됨)
│
├── src/
│   ├── combined/
│   │   └── CombinedView.jsx
│   │       └─ 🧩 전체 뷰 통합 컴포넌트 (Map + Deck + UI 통합 제어)
│   │
│   ├── deck/
│   │   ├── VehicleLayer.js
│   │   └── useStationCoords.js
│   │       └─ 🛣️ 차량 경로 및 정류장 시각화 관련 로직
│   │
│   ├── maplibre/
│   │   └── MapView.jsx
│   │       └─ 🗺️ MapLibre 지도 설정 및 회전 기능 포함
│   │
│   ├── ui/
│   │   ├── UploadController.jsx
│   │   ├── PlaybackController.jsx
│   │   ├── RecordingController.jsx
│   │   └── 🖱️ 사용자 인터페이스 요소 (업로드, 재생, 녹화 등)
│   │
│   └── utils/
│       └── api.js
│           └─ 🔗 로컬/배포 환경에 따라 API base URL 자동 설정
│
└── README.md
    └─ 📘 현재 문서 (프로젝트 설명서)
```

---

### 🧭 핵심 실행 흐름

1. 사용자가 CSV 업로드  
2. React 앱에서 Flask API(`/api/generate`) 호출  
3. 생성된 JSON(`route_output.json`)을 기반으로 시뮬레이션 진행  
4. 지도 + 애니메이션 + UI 동기화됨

---

### 💡 폴더 추가 팁 (선택 사항)

- `data/` → 다양한 샘플 입력파일 보관용
- `docs/` → 논문/제안서/시연용 스크린샷 및 설명서 저장용
- `scripts/` → 데이터 전처리, 테스트용 Python 유틸 스크립트 등

> 폴더 이름은 필요에 따라 자유롭게 구성하되, 경로 참조가 맞도록 주의하세요.



## 🧩 기능별 사용법 (Usage Guide)

이 시뮬레이터는 경로 데이터를 기반으로 차량의 이동을 지도에 시각화하며,  
사용자는 다양한 UI를 통해 시뮬레이션을 제어할 수 있습니다.

---

### 📤 1. 경로 데이터 업로드

#### 🔹 위치
좌측 하단 메뉴: `Upload` 버튼

#### 🔹 업로드 방식
- Drag & Drop or 파일 선택 (모달에서)
- 업로드 완료 후 자동으로 경로 생성 또는 적용

#### 🔹 지원 형식
| 형식 | 파일명 | 기능 |
|------|--------|------|
| `.csv` | `route_input.csv` | 차량별 정류장 정보로 경로 생성 |
| `.json` | `route_output.json` | 이미 생성된 경로 시뮬레이션 재생용 |

---

### ▶️ 2. 시뮬레이션 재생/정지

#### 🔹 위치
중앙 하단의 재생 바

#### 🔹 기능
- `▶️`: 재생 시작
- `⏸️`: 일시정지
- 재생 중 슬라이더로 시간 이동 가능

---

### ⏩ 3. 재생 속도 조절

#### 🔹 위치
슬라이더 오른쪽에 `x1`, `x2`, `x4`, `x8` 속도 조절 메뉴

#### 🔹 기능
- 기본값: `x1`
- 시뮬레이션이 배속되어 재생됨 (차량 이동 속도 변화)

---

### 🎥 4. 시뮬레이션 녹화

#### 🔹 위치
우측 상단의 `Recording` 버튼 (`⏺️`)

#### 🔹 기능
- `녹화 시작` 클릭 시 지도 캔버스를 녹화 시작
- `녹화 종료` 클릭 시 `.webm` 형식으로 다운로드 가능
- 녹화 중에는 UI 자동 숨김(설정 시)

---

### 🧭 5. 지도 회전 및 제어

#### 🔹 위치
키보드 단축키 기반

#### 🔹 기능
| 키 | 기능 |
|----|------|
| ↑ / ↓ | 지도 pitch(기울기) 변경 |
| ← / → | 지도 bearing(방향) 변경 |
| 마우스 휠 | 줌 인/아웃 |
| 마우스 드래그 | 지도 이동 |

---

### 📍 6. 정류장 및 아이콘 표시

- 정류장(출발, 도착)은 업로드된 파일의 `Type_x` 필드에 따라 아이콘이 다르게 표시됩니다.
- 고정 차고지(`garage.png`)는 항상 지도에 표시됩니다.
- 각 아이콘은 `/public` 폴더 내 이미지 파일을 사용합니다.

---

### 💡 팁

- CSV는 반드시 지정된 포맷을 따라야 하며, 정류장 간 경로는 순차적으로 계산됩니다.
- 업로드 직후 시뮬레이션이 자동 재시작됩니다.
- JSON 업로드 시에는 별도의 계산 없이 즉시 시각화됩니다.


## ⌨️ 단축키 안내 (Keyboard Shortcuts)

이 시뮬레이터는 키보드를 통해 지도와 재생을 직관적으로 제어할 수 있도록 설계되어 있습니다.  
아래 단축키는 시뮬레이션 조작, 지도 회전, 녹화 기능 등을 손쉽게 제어할 수 있게 해줍니다.

---

### 🎛️ 전체 단축키 목록

| 단축키 | 기능 설명 |
|--------|-----------|
| `Space` | 시뮬레이션 재생 / 일시정지 |
| `↑` / `↓` | 지도의 pitch (기울기) 조절 |
| `←` / `→` | 지도의 bearing (방향) 회전 |
| `Shift + R` | 녹화 시작 (Recording Start) |
| `Shift + S` | 녹화 종료 및 저장 (Recording Stop & Save) |
| `H` | UI 숨기기 / 다시 보이기 토글 (녹화 시 유용) |
| `ESC` | 업로드 모달 / 메뉴 닫기 |

---

### 🧭 지도 조작 키

- 방향키로 지도 회전 가능 (MapLibre의 camera control 포함)
- 마우스와 조합하여 부드러운 이동 가능

---

### 🎥 녹화 관련 키

- `Shift + R`: 지도 녹화 시작 (`getDisplayMedia` 기반)
- `Shift + S`: 녹화 종료 → 자동 다운로드
- `H`: UI 토글 → 시각적 노이즈 없는 녹화 가능

---

### 📝 커스터마이징 팁

- 단축키는 `CombinedView.jsx` 또는 `MapView.jsx`에서 `keydown` 이벤트로 관리됩니다.
- 필요 시 새 키를 추가하거나 기존 기능에 대한 키 재매핑도 가능

> 💡 키보드 단축키는 화면 녹화, 지도 시점 조정 등 마우스 사용을 줄이고 시뮬레이션 시연에 유용합니다.



## 🛠️ 문제 해결 가이드 (Troubleshooting & FAQ)

프로젝트 실행 중 자주 발생할 수 있는 오류 메시지나 예상 동작과 다른 결과에 대해  
원인과 해결 방법을 아래에 정리했습니다.

---
