# DarkBrood 로컬 및 GCP 배포 설정 가이드

이 문서는 개발자가 DarkBrood 사이트를 로컬에서 실행하고, GCP(Google Cloud Platform)에 무비용 혹은 최저 비용(Free Tier 범위 내)으로 배포하기 위해 설정하고 실행해야 할 명세를 정리한 가이드입니다.

---

## 1. 로컬 환경 실행 및 설정

### 1) 필수 파일 확인
로컬 루트 디렉토리에 생성된 [`.env`](.env) 파일을 엽니다.
*   `ADMIN_PASSWORD`: 관리자 페이지 비밀번호입니다. 기본값은 `admin123`입니다. 원하는 값으로 수정하십시오.
*   `SESSION_SECRET`: 세션 암호화 키입니다. 임의의 영숫자를 적으시면 됩니다.

### 2) 서버 실행
개발자 터미널을 열고 다음 명령어를 실행합니다:
```bash
npm run dev
```
*   콘솔에 `DarkBrood server is creeping on port 8080...`이 출력되면 준비 완료된 것입니다.
*   브라우저에서 `http://localhost:8080`으로 접속할 수 있습니다.
*   최초 실행 시 `db.json` 파일이 생성되고 견본 포스트/댓글 데이터가 시딩됩니다.

---

## 2. GCP 콘솔 사전 구성 (최저 비용 목적)

GCP 배포에 앞서 Google Cloud 콘솔에서 몇 가지 서비스를 활성화하고 리소스를 만들어야 합니다.

> [!NOTE]
> GCP는 기본 가입 시 300달러 크레딧을 제공하며, 아래 사용하는 서비스들(Cloud Run, Firestore, GCS)은 대부분 매우 넉넉한 상시 무료 등급(Free Tier)을 제공하므로 트래픽이 몰리지 않는 이상 비용이 발생하지 않습니다.

### 1) GCP 프로젝트 생성 및 API 활성화
1.  [GCP Console](https://console.cloud.google.com/)에 로그인하여 신규 프로젝트를 생성합니다.
2.  프로젝트 선택 후, 상단 검색창에서 다음 API를 각각 검색하여 **사용(Enable)** 설정합니다.
    *   **Cloud Run API**
    *   **Cloud Build API**
    *   **Artifact Registry API** (또는 Container Registry)
    *   **Cloud Firestore API**
    *   **Google Cloud Storage (GCS) API**

### 2) 데이터베이스 설정 (Firestore)
1.  콘솔 메뉴에서 **Firestore**로 이동합니다.
2.  **데이터베이스 만들기**를 클릭합니다.
3.  **모드 선택**: 반드시 **Native 모드(기본 Firestore 모드)**를 선택합니다. (Datastore 모드가 아닙니다.)
4.  **위치 설정**: 사용자의 위치와 가까운 리전(예: `asia-northeast3` 서울)을 선택하고 생성합니다.

### 3) 파일 스토리지 설정 (Google Cloud Storage)
1.  콘솔 메뉴에서 **Cloud Storage > 버킷**으로 이동합니다.
2.  **버킷 만들기**를 클릭합니다.
3.  **버킷 이름**: 전역에서 고유한 이름을 지정합니다 (예: `darkbrood-media-bucket`). 이 이름을 기록해 두십시오.
4.  **위치 유형**: **Region**을 선택하고 위치는 데이터베이스와 일치하게 설정합니다 (예: `asia-northeast3`).
5.  **보관 클래스**: 기본값인 **Standard**를 선택합니다.
6.  **액세스 제어**: 
    *   익명 게시판에 업로드한 이미지 링크가 외부 브라우저에 표시되려면 공개 읽기 권한이 필요합니다.
    *   **"이 버킷에 대한 공개 액세스 방지 강제 적용"** 체크를 **해제**합니다.
    *   버킷 생성 후 **권한(Permissions)** 탭에서 **보안주체 추가**를 누르고, 이름에 `allUsers`를 입력한 뒤 역할을 **Storage 개체 뷰어 (Storage Object Viewer)**로 지정하여 모든 파일에 대한 일반 공개 읽기를 허용합니다.

### 4) 서비스 계정(Service Account) 및 인증키 발급
GitHub Actions에서 배포 작업을 수행하고, 애플리케이션이 Firestore/GCS에 액세스할 수 있도록 권한을 대행할 계정입니다.
1.  콘솔 메뉴에서 **IAM 및 관리자 > 서비스 계정**으로 이동합니다.
2.  **서비스 계정 만들기**를 클릭합니다.
3.  **역할 부여 (다음 역할을 검색하여 추가)**:
    *   **Cloud Run 개발자 (Cloud Run Developer)**: Cloud Run에 앱을 배포하는 권한
    *   **Storage 객체 관리자 (Storage Object Admin)**: GCS 버킷에 이미지를 쓰고 읽는 권한
    *   **Cloud Datastore 사용자 (Cloud Datastore User)**: Firestore에 데이터를 쓰고 읽는 권한
    *   **서비스 계정 사용자 (Service Account User)**: 배포 시 서비스 계정을 주체로 실행하는 권한
4.  계정 생성 완료 후 목록에서 생성된 계정을 클릭하고, **키(Keys) > 키 추가 > 새 키 만들기**를 눌러 **JSON** 형식을 내려받습니다.
5.  다운로드된 `.json` 키 파일의 텍스트 내용을 통째로 복사해 두십시오 (GitHub Action Secret에 입력할 값입니다).

---

## 3. GitHub 레포지토리 Secrets 구성

소소한 코드 노출과 별개로 GCP 접근 자격 증명서와 운영자 비밀번호는 코드 저장소에 직접 올려서는 안 됩니다. 
GitHub 프로젝트 레포지토리의 **Settings > Secrets and variables > Actions**에서 **New repository secret** 버튼을 눌러 다음 환경 변수를 주입해야 합니다.

| Secret 이름 | 입력 값 예시 및 설명 |
| :--- | :--- |
| `GCP_PROJECT_ID` | GCP 프로젝트 ID (예: `darkbrood-411234`) |
| `GCP_SA_KEY` | 생성한 GCP 서비스 계정의 다운로드한 JSON 파일 내용 전체 (괄호 `{}` 포함) |
| `GCS_BUCKET_NAME` | 생성한 GCS 버킷 이름 (예: `darkbrood-media-bucket`) |
| `ADMIN_PASSWORD` | 사이트 내 Diary/Notice 탭 수정을 인가하기 위한 운영자 암호 |
| `SESSION_SECRET` | 세션 보안 서명에 쓰일 아무 무작위 문자열 |

---

## 4. 최초 배포 실행 단계

1.  로컬 작업 폴더 전체를 로컬 Git 저장소로 초기화합니다.
    ```bash
    git init
    git add .
    git commit -m "feat: init darkbrood fullstack"
    ```
2.  GitHub에 빈 Repository를 생성하고 리모트 주소를 추가합니다.
    ```bash
    git remote add origin https://github.com/사용자이름/저장소이름.git
    ```
3.  브랜치 이름을 `main`으로 설정 후 푸시합니다.
    ```bash
    git branch -M main
    git push -u origin main
    ```
4.  GitHub 저장소의 **Actions** 탭으로 이동하면 워크플로우 작동이 시작된 것을 확인할 수 있습니다. 빌드 및 배포가 성공하면 출력 로그 마지막 부분 또는 Cloud Run 콘솔에 나타나는 서비스 URL로 접속할 수 있습니다.
