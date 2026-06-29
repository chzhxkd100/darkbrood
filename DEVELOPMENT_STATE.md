# 🤖 Project Development State & AI Hand-off Context
*이 문서는 개발 현황과 아키텍처를 하나의 파일로 요약하여, 다음 세션의 AI 어시스턴트가 프로젝트 상태를 즉시 파악하고 이어서 작업할 수 있도록 돕는 핸드오프(Hand-off) 문서입니다.*

> [!IMPORTANT]
> **AI 어시스턴트 지침 (AI Assistant Guidelines)**
> 1. 이 문서는 현재 프로젝트 구조의 핵심 정보원(Single Source of Truth)입니다. 새로운 작업을 시작하기 전에 반드시 이 문서 전체를 읽고 숙지하십시오.
> 2. **기능을 추가, 변경 또는 삭제하는 작업을 완료한 후에는 반드시 이 `DEVELOPMENT_STATE.md` 문서도 최신 구현 상태에 맞게 업데이트해야 합니다.** 새로운 경로(Route), EJS 템플릿, DB 스키마, 특이 사항 등을 정확히 반영해 다음 세션의 AI 및 개발자에게 전달하십시오.

---

## 1. 프로젝트 개요 (Overview)
- **프로젝트 명**: DarkBrood Abyss (어둠과 고독의 심연)
- **디자인 테마**: Vista/Aero 스타일의 다크 글래스모피즘 (Glassmorphism), 네온 레드 및 보라색 그라데이션 광원 적용.
- **주요 스택**: Node.js, Express, EJS (템플릿 엔진), Google Cloud Platform (Firestore, GCS), Firebase Hosting.

---

## 2. 데이터베이스 & 파일 저장소 이중화 (Local vs GCP Prod)
이 프로젝트는 GCP 인프라 없이도 로컬에서 즉시 실행이 가능하도록 모킹(Mocking)되어 있습니다. `src/db.js`와 `src/storage.js`가 이 처리를 담당합니다.

| 구분 | 로컬 개발 환경 (`NODE_ENV` != 'production') | GCP 프로덕션 환경 (`NODE_ENV` == 'production') |
| :--- | :--- | :--- |
| **데이터베이스** | `db.json` 로컬 파일에 CRUD 데이터 저장 (Firestore 문법 모킹) | GCP Native Firestore (`databaseId: 'darkbrood-db'`) |
| **이미지/스토리지** | `public/uploads/` 폴더에 로컬 파일 저장 | Google Cloud Storage (GCS) 버킷 (`allUsers` 일반 공개) |

---

## 3. 핵심 기능별 경로 및 아키텍처

### 1) 신전 (Notice & Intro - `/`)
- **설명**: 메인 대시보드로, 데이터베이스의 `posts` 컬렉션 중 `type: 'notice'` 필터링 공지사항을 노출하고 관리자 인트로 메시지를 출력합니다.
- **템플릿**: `views/index.ejs`, `views/notice.ejs`

### 2) 사념 (Diary - `/diary`)
- **설명**: 회원가입 및 로그인한 운영자(유저)가 글을 게시하는 블로그 형태의 개인 다이어리 게시판입니다. 
- **인증 경로**: `/login`, `/signup`, `/logout` (EJS: `views/user_login.ejs`)
- **템플릿**: `views/diary.ejs`

### 3) 심연 (Community - `/community`)
- **설명**: 로그인 유저 혹은 완전 익명 사용자가 자유롭게 이미지를 첨부하고 낙서를 하는 게시판입니다.
- **주요 기믹**:
  - **Multer 청크 업로드**: `/upload/chunk`, `/upload/complete` 경로를 통해 대용량 파일을 청크 단위로 나누어 업로드하고 서버 측에서 병합.
  - **EJS 템플릿**: `views/community.ejs` 및 댓글용 `views/partials/comments.ejs`.
  - **이미지 확장 기믹**: 4chan 스타일의 본문 이미지 인라인 토글(클릭 시 확대), 다중 이미지 슬라이드 뷰어(Lightbox Carousel).

### 4) 유저 프로필 (`/profile`, `/profile/:id`)
- **설명**: 가입된 유저의 프로필 사진(아바타), 한 줄 소개(Bio) 수정 기능 및 유저가 작성한 게시글 모아보기 페이징 기능을 제공합니다.
- **템플릿**: `views/profile.ejs`

### 5) 심연의 메아리 (Real-time Chat)
실시간 채팅은 주기적인 폴링(Cursor-based polling) 구조로 동작하며, 사이드바 위젯과 독립형/OBS 브라우저 소스 전용 화면으로 이원화되어 있습니다.

- **백엔드 경로**:
  - `GET /chat/messages`: 최신 20개 메시지를 불러오거나 `?since={timestamp}` 파라미터 전달 시 그 이후의 새로운 메시지만 가져옴.
  - `POST /chat/send`: 메시지 전송 및 24시간 후 자동 파기 TTL 설정을 위해 `expireAt` 필드 기록.
- **사이드바 위젯 UI (`views/header.ejs` & `public/js/global.js`)**:
  - 웹사이트의 좌측 사이드바에 내장되어 있으며, 비활성 탭 상태(`document.hidden`)이거나 3분간 입력이 없는 경우(Idle) 데이터베이스 비용 절감을 위해 폴링이 자동 일시 중지됩니다.
  - 제목 옆에 독립형 채팅방 바로가기 링크(`↗`)를 제공합니다.
- **독립형 및 OBS 오버레이 (`GET /chat` & `views/chat.ejs`)**:
  - **독립형 화면 (`/chat`)**: 사이드바를 통하지 않고 모바일이나 듀얼 모니터에서 별도로 띄워 채팅을 하거나 모니터링할 수 있는 심플한 채팅방 뷰.
  - **OBS 오버레이 (`/chat?overlay=true`)**: OBS Studio 등 방송 프로그램의 "브라우저 소스"에 최적화된 오버레이 뷰.
    - 입력 폼과 제목 표시줄이 숨겨지고, 배경이 완전히 투명(`background: transparent`)해집니다.
    - 게임 및 방송 화면 위에서도 잘 보이도록 텍스트에 검은색 외곽선 효과(`text-shadow`)가 강하게 적용되어 있습니다.
    - **중요**: OBS의 백그라운드 렌더러 특성상 포커스가 맞추어지지 않아도 실시간으로 채팅이 계속 업데이트되어야 하므로, 오버레이 모드에서는 탭 비활성화 감지(`document.hidden`) 및 Idle 타임아웃 감지 로직을 우회하여 무중단 실시간 폴링이 보장됩니다.

---

## 4. 고유 아키텍처 특이사항 (AI 필수 참고)

1. **커스텀 쿠키 세션 서명 모듈 (`src/app.js`)**
   - Firebase Hosting 프록시 레이어가 표준 세션 서명 쿠키(`__session.sig`)를 임의로 드롭하는 특성이 있습니다. 이를 방지하기 위해 **HMAC-SHA256 암호화 기반으로 세션 정보를 하나의 `__session` 쿠키에 병합 서명**하는 직접 구현된 미들웨어가 돌고 있습니다. 세션 라이브러리를 절대 교체하지 마십시오.
2. **GCP Firestore 인스턴스 (`src/db.js`)**
   - 프로동작 시 기본 `(default)` DB가 아닌 별도로 생성된 Native Firestore 데이터베이스 ID인 `darkbrood-db`를 주입받아 연결합니다.
3. **GCS 업로드 옵션 (`src/storage.js`)**
   - 버킷에 *균일한 버킷 수준 액세스(Uniform)*가 지정되어 있어 개별 파일 ACL을 직접 지정하는 로직이 있으면 API에서 차단되므로 주의해야 합니다.
4. **배포 트리거**
   - 로컬에서 수정된 내용을 GitHub `main` 브랜치로 `git push`하면, GitHub Actions 워크플로우(`.github/workflows/deploy.yml`)가 자동으로 돌아 Docker 컨테이너를 빌드하고 GCP Cloud Run 및 Firebase Hosting에 무중단 배포를 완료합니다.
5. **Firebase Hosting 배포 오류 방지 및 버전/환경 고정**
   - **이슈 1 (중복 릴리즈 에러)**: Firebase CLI 최신 버전(15.22.3 등)의 버그로 인해 배포가 성공적으로 완료되었음에도 중복 릴리즈 요청이 발생해 `supplied version is the current active version` (400 FAILED_PRECONDITION) 에러와 함께 빌드가 실패 처리되는 현상이 있습니다.
   - **이슈 2 (OAuth 토큰 발급 시 Premature close 에러)**: Node.js 2026년 6월 보안 업데이트(Node 20.x, 22.x 최신 마이너 버전)로 인한 `http.Agent` 동작 변화로, Firebase CLI 내부의 `node-fetch` 모듈이 구글 OAuth 토큰 발급 시 연결을 강제 종료(`Premature close`)하며 인증 실패를 유발합니다.
     - **중요 해결책**: GitHub Actions에서 자바스크립트 액션(예: `action-hosting-deploy`)을 사용하면 러너 호스트의 기본 Node.js 버전을 따르기 때문에 `actions/setup-node` 설정이 무시됩니다. 따라서 써드파티 액션을 걷어내고 **일반 쉘 스크립트 실행(`run`) 단계**로 대체하여 `npx firebase-tools@13.15.0 deploy`를 직접 구동시켰습니다.
     - **Node 22.2.0 고정 사유**: 앞선 시도에서 Node `20.15.0`으로 빌드를 실행하자 `universal-analytics` 등 패키지가 Node >= 22.0.0 요건으로 인해 `ERR_REQUIRE_ESM` (ES Module UUID require 에러) 오동작을 일으켰습니다. 이를 해결하기 위해 Node >= 22 요건을 만족하면서 동시에 June 2026 보안 패치(Premature close 버그)가 포함되지 않은 최적의 레거시 안정 버전인 **`Node 22.2.0`**을 워크플로우에 고정 적용했습니다.
   - **기타 조치**: 동일 정적 파일 배포 우회를 위해 빌드 시점에 `public/build_timestamp.txt`를 동적 생성하는 처리를 더했습니다. (해당 파일은 `.gitignore`에 등록됨)
