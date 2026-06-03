# DarkBrood - 고독과 어둠의 아카이브

DarkBrood는 독특한 레트로 어두운 감성(Dark retro/Aero aesthetic)의 익명 게시판 및 운영자 다이어리 아카이브 웹 서비스입니다. 

---

## 🤖 AI Context & Developer Hand-off (AI 협업용 컨텍스트)

*미래의 AI 어시스턴트가 작업을 이어받아 코드를 수정할 때 가장 먼저 읽고 준수해야 할 구조 및 이력 가이드입니다.*

### 1. 프로젝트 주요 아키텍처 및 연동 현황
*   **백엔드**: Node.js + Express
*   **프론트엔드**: EJS 템플릿 엔진 + 바닐라 CSS
*   **데이터베이스**: GCP Firestore (프로젝트: `darkbrood`, **데이터베이스 ID: `darkbrood-db`**)
    *   *주의*: 기본 `(default)` 데이터베이스가 아닌 커스텀 DB ID인 `darkbrood-db`를 사용하므로, Firestore 인스턴스 초기화 시 반드시 `{ databaseId: 'darkbrood-db' }` 옵션을 명시적으로 전달해야 합니다 (`src/db.js` 참고).
*   **파일 스토리지**: Google Cloud Storage (버킷명: `darkbrood-media-bucket`)
    *   *균일한 버킷 수준 액세스(Uniform Bucket-Level Access)*가 활성화되어 있어 개별 파일에 대해 ACL 설정을 시도하면 구글 API가 업로드를 차단(400 Bad Request)합니다.

### 2. 파일 업로드 설정 핵심 설계 (`src/storage.js`)
이미지 업로드는 `multer-cloud-storage` 라이브러리를 통해 GCS와 직접 연동됩니다. 다음 설계 사항을 반드시 지켜야 합니다:
*   **ACL 비활성화**: GCS 버킷의 Uniform 설정과 충돌하지 않도록 GCS 저장소 옵션에 `uniformBucketLevelAccess: true`를 반드시 설정해 줍니다.
*   **경로 접두사 설정**: 라이브러리가 업로드 완료 후 파일 URL을 조립할 때 파일명에서 슬래시를 잘라내므로, `uploads/` 폴더 접두사를 `filename` 콜백에 직접 쓰면 안 되고 **`destination: 'uploads'`** 옵션을 통해 별도 분리해서 제공해야 최종 URL에 `uploads/` 접두사가 유실되지 않습니다.
*   **URL 획득**: 업로드 완료 후 DB에 들어갈 GCS URL은 `file.linkUrl` 값을 최우선으로 리턴하며, 차선책으로 `file.path`를 사용해 수동 조립합니다.

### 3. 디버깅 및 예외 처리
*   Cloud Run 로그에서 상세 에러 분석을 위해 `src/app.js` 내부의 라우터 에러 캐칭 블록은 단순히 `err`이 아닌 `err.stack || err`를 로깅하도록 설정되어 있습니다. 수정 시 단순 객체 로깅으로 롤백하여 `[object Object]`로 로그가 뭉개지는 일이 없도록 하십시오.

---

## ⚙️ 로컬 실행 및 GCP 설정법
자세한 클라우드 리소스 생성 가이드 및 권한 부여 방법은 [README_GCP.md](README_GCP.md) 파일을 참조하십시오.

### 1. 로컬 개발 환경 실행
1. 필요한 의존성을 설치합니다:
   ```bash
   npm install
   ```
2. 로컬 루트 디렉토리에 [`.env`](.env) 파일을 생성 및 설정한 후 서버를 구동합니다:
   ```bash
   npm run dev
   ```
3. `http://localhost:8080`에 접속하여 정상 구동을 확인합니다.

### 2. 배포 파이프라인
*   본 프로젝트는 GitHub Actions를 통해 GCP Cloud Run으로 자동 배포됩니다.
*   `.github/workflows/deploy.yml` 파일에서 빌드 및 배포 작업이 정의되어 있으며, 코드 변경 후 `main` 브랜치로 `git push`를 진행하면 자동으로 배포 프로세스가 트리거됩니다.
