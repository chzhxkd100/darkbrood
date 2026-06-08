# ⚙️ DarkBrood 개발 및 로컬 실행 가이드

이 문서는 **DarkBrood** 프로젝트를 개인 저장소로 복제(Clone)하여 커스텀하거나, 로컬 개발 환경에서 빠르게 구동하고 배포하기 위한 기술 명세를 정리한 개발자 가이드입니다.

---

## 1. 프로젝트 복제 및 설치 (Clone & Setup)

프로젝트를 로컬 컴퓨터에 복제하고 필요한 패키지들을 설치합니다.

```bash
# 1. 저장소 복제
git clone https://github.com/사용자이름/darkbrood.git

# 2. 프로젝트 디렉토리로 이동
cd darkbrood

# 3. 의존성 패키지 설치
npm install
```

---

## 2. 환경 변수 설정 (`.env`)

로컬 실행을 위해서 루트 디렉토리에 `.env` 파일을 생성해야 합니다. 아래 양식을 복사하여 생성해 주십시오.

```env
PORT=8080
ADMIN_PASSWORD=admin123
SESSION_SECRET=your_random_session_secret_key
# GCP 리소스 연동 시에만 아래 변수 추가 (미지정 시 로컬 Mock DB 및 파일 스토리지로 동작)
# FIRESTORE_PROJECT_ID=your-gcp-project-id
# FIRESTORE_DATABASE_ID=darkbrood-db
# GCS_BUCKET_NAME=your-gcs-bucket-name
# GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json
```

### 환경 변수 세부 설명
*   `ADMIN_PASSWORD`: 사이트 내 관리자 메뉴 및 공지사항(Notice) 작성용 비밀번호입니다. (기본값: `admin123`)
*   `SESSION_SECRET`: 쿠키 세션 서명에 사용되는 임의의 보안 문자열입니다.
*   `FIRESTORE_PROJECT_ID`: GCP Firestore 프로젝트 ID입니다.
*   `FIRESTORE_DATABASE_ID`: Native 모드의 Firestore 커스텀 데이터베이스 ID입니다.
*   `GCS_BUCKET_NAME`: 이미지 업로드용 Google Cloud Storage 버킷명입니다.
*   `GOOGLE_APPLICATION_CREDENTIALS`: GCP 서비스 계정 인증키(JSON)의 로컬 경로입니다.

---

## 3. 로컬 개발 환경 구동 및 로컬 Mocking 시스템

이 프로젝트는 GCP 인프라(Firestore, Google Cloud Storage)가 없는 개발 환경에서도 즉시 구동될 수 있도록 **자체 로컬 Mocking 데이터베이스 및 스토리지 시스템**이 구축되어 있습니다.

### 로컬 Mocking 동작 원리
1.  **데이터베이스 (`db.json`)**:
    *   GCP 설정 정보(`FIRESTORE_PROJECT_ID` 등)가 제공되지 않으면, Express 서버는 `src/db.js` 내부의 Mock Firestore 인스턴스를 통해 로컬 파일인 `db.json`을 데이터베이스로 활용합니다.
    *   서버 최초 구동 시 샘플 데이터(공지사항, 운영자 다이어리, 익명 게시글 및 댓글)가 자동으로 `db.json`에 시딩됩니다.
2.  **이미지 업로드 (`public/uploads`)**:
    *   GCS 설정 정보가 없으면 이미지 업로드 라이브러리(`multer`)가 로컬 디렉토리인 `public/uploads`에 파일을 저장하며, 웹 서비스상에서 직접 로컬 경로(`/uploads/...`)로 접근할 수 있게 구성됩니다.

### 로컬 실행 명령어
```bash
# 개발자 모드로 서버 실행 (nodemon이나 복잡한 설정 없이 간결히 노드 서버 가동)
npm run dev
```
*   콘솔에 `Using local JSON file database for development...` 및 `DarkBrood server is creeping on port 8080...` 메시지가 출력되면 정상 실행된 것입니다.
*   브라우저에서 [http://localhost:8080](http://localhost:8080)으로 접속하여 바로 개발 및 작동을 확인해 볼 수 있습니다.

---

## 4. 🤖 AI Context & Developer Hand-off (AI 협업용 컨텍스트)

*추후 AI 어시스턴트나 다른 개발자가 코드를 수정할 때 반드시 준수해야 할 아키텍처 및 설정 가이드입니다.*

### 1) GCP Firestore 설정 주의사항 (`src/db.js`)
*   **커스텀 DB ID 사용**: 기본 `(default)` 데이터베이스가 아닌 커스텀 DB ID인 `darkbrood-db`를 사용하므로, Firestore 인스턴스 초기화 시 반드시 `{ databaseId: 'darkbrood-db' }` 옵션을 명시적으로 전달해야 합니다.

### 2) GCS 업로드 설정 주의사항 (`src/storage.js`)
*   **ACL 비활성화**: GCS 버킷의 *균일한 버킷 수준 액세스(Uniform Bucket-Level Access)*가 활성화되어 있어 개별 파일에 대해 ACL 설정을 시도하면 구글 API가 업로드를 차단(400 Bad Request)합니다. 따라서 GCS 저장소 옵션에 `uniformBucketLevelAccess: true`가 명시되어 있는지 확인하십시오.
*   **경로 접두사 설정**: 라이브러리가 업로드 완료 후 파일 URL을 조립할 때 파일명에서 슬래시를 잘라내므로, `uploads/` 폴더 접두사를 `filename` 콜백에 직접 쓰면 안 되고 **`destination: 'uploads'`** 옵션을 통해 별도 분리해서 제공해야 최종 URL에 `uploads/` 접두사가 유실되지 않습니다.

### 3) 세션 유지 트릭 (`src/app.js`)
*   Firebase Hosting 뒤에 Cloud Run 백엔드를 배치할 경우, Firebase Proxy가 표준 세션 서명 쿠키 파일(`__session.sig` 등)을 임의로 차단 또는 필터링하는 경우가 있습니다. 이를 방지하기 위해 **직접 구현한 단일 쿠키 기반 HMAC-SHA256 세션 서명 모듈**이 적용되어 있습니다. 세션 라이브러리를 임의로 바꿀 때 Firebase 배포 상태에서 로그인 및 세션 유지가 끊기지 않는지 확인해야 합니다.

---

## 5. 클라우드 배포 가이드

인프라 세팅(GCP 리소스 생성, Firestore/GCS 설정 및 인증 키 발급)과 GitHub Actions CI/CD 구축을 포함한 자세한 프로덕션 배포 가이드는 [README_GCP.md](README_GCP.md)를 참고하시기 바랍니다.
