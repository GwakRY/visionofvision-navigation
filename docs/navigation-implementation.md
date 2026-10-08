# VisionOfVision 구현 상세

[프로젝트 개요와 핵심 기여](../README.md)

개인 기여 코드의 구현 흐름과 프로젝트 당시 배포 방식을 설명합니다. 전체 앱을 독립 실행하는 구성은 아니며, 후속 API 개선은 [별도 문서](favorites-api-improvements.md)에서 구분합니다.

## Tech Stack

### Frontend

* React Native
* Expo
* React Navigation
* React Hooks
* Expo Location
* Expo Camera
* Expo Speech
* Expo SecureStore
* React Native Vibration
* Socket.IO Client
* TMAP API

### Backend

* Python
* Flask
* MySQL
* mysql.connector
* boto3
* AWS SSM Parameter Store

### 🗄️ Database Structure

<p align="center">
  <img src="./images/favorites-erd.png" width="650">
</p>

즐겨찾기는 기기별 목록과 변경 대상을 구분하기 위해 `device_id`를 데이터 처리 기준으로 사용합니다. 이 값은 클라이언트가 전달하는 구분값이며 인증 수단이 아닙니다.

* `users.device_id`: 기기 식별자
* `favorites.favorite_id`: 즐겨찾기 식별자
* `favorites.device_id`: 기기별 즐겨찾기 구분
* `favorites.name`: 즐겨찾기 이름
* `favorites.address`: 저장 주소

즐겨찾기 수정 및 삭제 시 `favorite_id + device_id` 조건을 함께 사용해 특정 기기의 데이터를 대상으로 처리합니다.

공개 ERD에는 `users.device_id`와 `favorites.favorite_id`의 PK 표시가 있습니다. 실제 DDL·UNIQUE 제약 정의는 포함되어 있지 않아 `device_id + address` 등의 중복 제약을 확인할 수 없습니다. 기기 ID 선택의 설명은 기기별 데이터 구분이라는 기능적 목적에 한정하며, 회원가입 생략 같은 당시 기획 이유를 추가로 가정하지 않습니다.

### Deployment

* AWS EC2
* GitHub Actions
* SSH
* GitHub Secrets

---

## Project Structure

```text
visionofvision-navigation/
│
├── frontend/
│   ├── screens/
│   │   └── navigation/
│   │       ├── NavigationScreen.js
│   │       ├── RouteScreen.js
│   │       ├── GuideScreen.js
│   │       └── YoloDanger.js
│   │
│   ├── hooks/
│   │   └── navigation/
│   │       ├── useNavigationGuide.js
│   │       └── useRouteCalculation.js
│   │
│   ├── services/
│   │   └── stt/
│   │       └── useAutoSTT.js
│   │
│   ├── utils/
│   │   ├── speechHelper.js
│   │   └── navigation/
│   │       ├── location.js
│   │       ├── navigationUtils.js
│   │       └── tmap.js
│   │
│   └── package.json
│
├── backend/
│   └── favorites/
│       └── favorites.py
│
├── .github/
│   └── workflows/
│       └── deploy.yml
├── docs/
│   └── images/
│       ├── navigation-search.png
│       ├── navigation-guidance.png
│       ├── navigation-route-map.png
│       └── favorites-erd.png
├── .gitignore
├── requirements.txt
└── README.md
```

---

## Navigation Flow

```text
NavigationScreen
│
├─ 현재 GPS 위치 확인
├─ TMAP Reverse Geocoding
├─ Text / STT 목적지 입력
├─ STT 입력 정규화
└─ TMAP POI 검색
        ↓
     Route
        ↓
   GuideScreen
        │
        ├─ TMAP 보행자 경로 요청
        ├─ 안내 Point 추출
        ├─ Haversine 거리 계산
        ├─ TTS / 진동 턴바이턴 안내
        ├─ 경로 이탈 감지
        ├─ 자동 경로 재탐색
        ├─ Heading/Bearing 방향 안내
        └─ YOLO 위험 감지 결과 연계
```

---

## Key Implementation

### 현재 위치 및 목적지 처리

`NavigationScreen`에서는 Expo Location을 이용해 현재 GPS 좌표를 가져옵니다.

현재 좌표는 TMAP Reverse Geocoding을 통해 주소로 변환합니다. 목적지 문자열은 `geocode()`에서 TMAP POI 검색 API에 전달하고, 첫 검색 결과의 `frontLat·frontLon`을 위도·경도로 사용합니다.

이후 다음 데이터를 길찾기 화면으로 전달합니다.

```text
currentLocation
destination
destinationCoords
```

---

### STT 기반 목적지 입력

시각장애인 사용자가 키보드 입력 없이 목적지를 지정할 수 있도록 STT 입력을 지원합니다.

STT 결과를 그대로 검색에 사용하지 않고 다음 과정으로 정규화합니다.

```text
STT Raw Text
    ↓
문장부호 / 공백 정리
    ↓
조사 제거
    ↓
Dictionary Mapping
    ↓
정규표현식 기반 오인식 보정
    ↓
TMAP POI 검색
```

예를 들어 반복적으로 발생한 장소명 오인식을 다음과 같이 보정했습니다.

```text
구디      → 구로디지털단지
구디역    → 구로디지털단지역
슬림역    → 신림역
강남 여   → 강남역
```

또한 객체 인식, OCR, 설정, 취소와 같은 음성 명령은 목적지 검색보다 먼저 판단하여 앱 내 화면 이동 명령으로 처리합니다.

---

### TTS-STT Echo Prevention

STT 시작 전에 앱이 안내 TTS를 출력하면, 해당 음성이 다시 마이크를 통해 STT 입력으로 인식되는 문제가 발생할 수 있었습니다.

이를 해결하기 위해:

* TTS 직후 1.2초 Suppression Window 적용
* 동일 시간만큼 STT 활성화 지연
* Suppression Window 내부의 STT 결과 무시
* 일정 시간 사용자 입력이 없으면 STT 종료 및 재시도 안내

방식을 적용했습니다.

```text
TTS 안내
   ↓
Suppression Window
   ↓
STT 활성화
   ↓
사용자 음성 입력
```

> 1.2초 등의 값은 성능 지표가 아니라 실제 구현에 사용한 제어 기준입니다.

---

### Pedestrian Route Guidance

TMAP 보행자 경로 API 응답에서 전체 데이터를 그대로 사용하는 대신, 실제 길안내에 필요한 Point만 추출했습니다.

```text
features
  ↓
geometry.type === Point
  ↓
properties.description 존재 여부 확인
  ↓
Guide Point 생성
```

각 Guide Point는 다음 정보를 관리합니다.

```text
description
latitude
longitude
```

이를 현재 위치와 비교하여 턴바이턴 안내를 제공합니다.

---

### Distance Calculation

현재 위치와 안내 지점 및 목적지 간 거리는 Haversine Formula를 이용해 직접 계산했습니다.

이를 다음 기능에 활용했습니다.

* 다음 안내 지점까지 남은 거리
* 목적지까지 남은 거리
* 안내 지점 접근 여부
* 경로 이탈 여부

---

### Route Deviation & Recalculation

사용자가 기존 경로에서 이탈한 상황에서도 이전 안내가 계속되는 문제를 해결하기 위해 안내 지점까지의 거리 변화를 추적했습니다.

동일한 안내 Point를 추적하고 있는 상태에서 현재 거리가 이전 측정값보다 일정 수준 이상 증가하면 경로 이탈로 판단합니다.

```text
현재 GPS 위치
     ↓
가장 가까운 미안내 Point 탐색
     ↓
이전 거리와 현재 거리 비교
     ↓
거리 증가
     ↓
경로 이탈 판단
     ↓
현재 GPS를 새로운 출발점으로 설정
     ↓
TMAP 경로 재요청
```

재탐색 완료 후 기존 안내 이력을 초기화하고 새로운 경로 기준으로 안내를 계속합니다.

---

### Heading / Bearing Guidance

Expo Location의 Heading 정보와 현재 위치에서 목적지까지의 Bearing을 계산하여 사용자가 진행해야 할 상대 방향을 구합니다.

```text
Relative Angle
=
Destination Bearing
-
Device Heading
```

상대각에 따라 다음과 같은 방향 안내를 제공합니다.

```text
정면
조금 오른쪽
오른쪽
뒤쪽
왼쪽
조금 왼쪽
```

시각적 지도 확인이 어려운 사용자를 고려하여 결과를 TTS로 전달합니다.

---

### YOLO Result Integration

길찾기 화면에서 Expo Camera로 카메라 프레임을 획득하고 Socket.IO 기반 실시간 통신을 통해 AI 서버에 전달합니다.

서버에서 전달받은 Detection 결과를 이용하여:

* 객체 종류
* Bounding Box
* 객체의 좌/우 위치
* 위험 객체 접근 여부

를 길찾기 화면의 TTS·진동·Overlay와 연계했습니다.

본 저장소에서는 YOLO 모델 자체 개발보다 **AI Detection 결과를 실제 길찾기 사용자 인터페이스에 연계한 부분**을 중심으로 다룹니다.

---

### Favorites REST API

기기별 즐겨찾기 목록과 변경 대상을 처리할 수 있도록 기기 식별자를 요청에서 받아 SQL 조건에 적용했습니다.

| Method | Endpoint | 기기 식별자 | 처리 |
|---|---|---|---|
| GET | `/setting/favorites` | Query `device_id` | 해당 기기의 목록 조회 |
| POST | `/setting/favorites` | JSON `deviceId` | 이름·주소·기기 식별자 저장 |
| PUT | `/setting/favorites/<id>` | JSON `device_id` | 즐겨찾기 ID와 기기 ID로 수정 대상 선택 |
| DELETE | `/setting/favorites/<id>` | Header `Device-ID` | 즐겨찾기 ID와 기기 ID로 삭제 대상 선택 |

수정·삭제에는 다음 조건을 사용하고, 이름·주소·식별자 등의 값은 Parameter Binding으로 전달합니다.

```sql
WHERE favorite_id = %s
AND device_id = %s
```

프로젝트 당시 코드는 쓰기 작업 후 commit과 정상 경로의 Cursor·Connection 종료를 수행했습니다. POST·PUT 응답의 기기별 조회 범위와 오류 시 rollback·finally 정리는 [2026년 후속 개선](favorites-api-improvements.md)으로 구분합니다.

#### 등록 SQL의 중복 갱신 조건

POST에는 다음 SQL을 사용합니다.

```sql
INSERT INTO favorites(address, name, device_id)
VALUES (%s, %s, %s)
ON DUPLICATE KEY UPDATE
    address = VALUES(address),
    name = VALUES(name)
```

이는 실제 DB에서 PRIMARY KEY 또는 UNIQUE 충돌이 발생하면 이름·주소를 갱신하는 구문입니다. 공개 저장소에는 실제 제약을 정의한 DDL이 없으며, ERD의 PK 표시만으로 중복 판단 컬럼 조합을 확정할 수 없습니다. 동일 주소·동일 이름·특정 기기 조합의 중복 등록을 방지했다고 설명하지 않습니다.

관련 코드: [favorites.py](../backend/favorites/favorites.py)

---

### 도착 후 즐겨찾기 조회와 등록 화면 연계

[GuideScreen.js](../frontend/screens/navigation/GuideScreen.js)에서 확인되는 흐름은 다음과 같습니다.

1. 도착 시 SecureStore에서 `deviceId`를 읽습니다.
2. 이 값을 URL 인코딩하여 `GET /setting/favorites?device_id=...`로 목록을 요청합니다.
3. 응답 배열의 `fav.address`와 도착 목적지의 `destination` 값을 문자열로 비교합니다.
4. 일치하는 항목이 있으면 목적지 입력 화면으로 돌아갑니다.
5. 일치하는 항목이 없으면 등록 여부를 안내하고, 등록 선택 시 설정의 즐겨찾기 화면으로 이동합니다.
6. 등록 화면에 `addFromNavigation·destinationAddress·destinationCoords`를 전달합니다.

목록 조회가 실패하면 중복 확인 함수는 `false`를 반환합니다. 이 문자열 비교를 주소 정규화나 DB의 중복 제약 검증으로 설명하지 않습니다.

문자열 목적지는 [NavigationScreen.js](../frontend/screens/navigation/NavigationScreen.js)의 검색 함수에서 TMAP POI 검색으로 좌표화한 뒤 `currentLocation·destination·destinationCoords`와 함께 Route 화면에 전달합니다. [useRouteCalculation.js](../frontend/hooks/navigation/useRouteCalculation.js)는 이 좌표를 보행자 경로 요청에 사용합니다.

다만 저장된 즐겨찾기를 선택하고 목적지 검색으로 값을 전달하는 화면 코드는 공개되어 있지 않습니다. 따라서 즐겨찾기 선택 → 목적지 검색 → 경로 탐색의 전체 연결 과정은 이 저장소만으로 확인하지 못하며, 위 설명은 공개 코드에서 확인되는 각 처리 단계에 한정합니다.

---

### AWS SSM Parameter Store

DB 접속정보를 소스와 분리하기 위해 SSM Parameter Store에서 Host·User·Password·Database 설정값을 읽도록 구성했습니다.

`favorites.py`의 모듈 초기화 과정에서 다음 순서로 처리합니다.

1. boto3 SSM 클라이언트를 생성합니다.
2. 파라미터 이름별로 `get_parameter(Name=..., WithDecryption=True)`를 호출합니다.
3. 반환값을 환경변수에 저장합니다.
4. `authHost·authUser·authPassword·authDatabase` 변수로 읽고 MySQL 연결 설정에 사용합니다.

`WithDecryption=True`는 암호화된 파라미터를 조회할 때 복호화하는 옵션입니다. 모든 파라미터의 실제 저장 유형이나 IAM 권한 정책을 이 코드만으로 확정하지 않습니다.

설정값은 모듈 초기화 시 읽으며, 요청마다 SSM을 조회하거나 실행 중 설정 변경을 자동 반영하지 않습니다. 인증정보 자동 교체·자동 재연결을 구현했다고 설명하지 않습니다.

관련 코드: [favorites.py](../backend/favorites/favorites.py)의 `load_ssm_to_env()`, `PARAMS`, `connection()`

---

## Deployment

백엔드 소스는 AWS EC2에 배포했습니다. 프로젝트 당시에는 main Push를 트리거로 코드를 가져오도록 구성했으며, 현재 공개 저장소의 [deploy.yml](../.github/workflows/deploy.yml)은 `workflow_dispatch` 수동 실행 방식입니다.

현재 workflow가 수행하는 작업은 다음과 같습니다.

| 단계 | 실제 동작 |
|---|---|
| 접속 준비 | GitHub Secrets의 SSH 키로 임시 `key.pem` 생성·파일 권한 설정 |
| EC2 접속 | Secrets의 EC2 User·Host를 사용해 SSH 접속 |
| Git 준비 | Git 설치 여부 확인, 없으면 설치 |
| 최초 소스 준비 | `server/.git`이 없으면 팀 서버 저장소 clone |
| 소스 갱신 | 팀 서버 저장소의 main을 `git fetch`로 가져오고 `git reset --hard FETCH_HEAD`로 작업 디렉터리 갱신 |
| 키 정리 | 작업 결과와 관계없이 임시 SSH 키 파일 삭제 시도 |

SSH 키·EC2 Host/User·GitHub PAT는 GitHub Secrets로 관리합니다. 반복적인 서버 소스 갱신 작업을 GitHub Actions로 구성한 경험이며, **GitHub Actions 기반 EC2 소스 갱신 자동화**로 설명합니다.

공개 workflow에는 애플리케이션 테스트·빌드·의존성 설치·DB 마이그레이션·서버 프로세스 재시작·상태 확인 단계가 없습니다. 파일 갱신을 실행 중인 서비스의 새 코드 적용이나 무중단 배포 보장으로 설명하지 않습니다.

---

## Troubleshooting

### 1. TTS 음성이 STT에 다시 입력되는 문제

**Problem**

앱에서 출력한 목적지 입력 안내 TTS가 마이크에 다시 입력되어 STT 결과로 처리될 수 있었습니다.

**Solution**

* Timestamp 기반 Suppression Window 적용
* STT 활성화 지연
* Suppression 구간의 STT 결과 무시

**Result**

앱 자체 안내 음성이 목적지 검색 입력으로 다시 처리되는 흐름을 차단했습니다.

---

### 2. STT 장소명 오인식

**Problem**

지하철역 및 장소명이 반복적으로 잘못 인식되었습니다.

**Solution**

* Dictionary Mapping
* 조사 제거
* 정규표현식 기반 후처리

**Result**

오인식된 문자열을 TMAP 검색에 활용 가능한 목적지명으로 정규화했습니다.

---

### 3. 경로 이탈 후 기존 안내가 지속되는 문제

**Problem**

사용자가 최초 경로를 벗어나도 기존 Guide Point를 기준으로 안내가 지속될 수 있었습니다.

**Solution**

안내 Point와의 거리 변화를 추적해 경로 이탈을 판단하고 현재 GPS 위치를 출발점으로 TMAP 경로를 다시 요청했습니다.

**Result**

사용자의 실제 이동 위치를 기준으로 새로운 경로를 생성하고 안내를 재개하도록 구현했습니다.

---

### 4. 화면 전환 이후 실시간 기능이 남는 문제

**Problem**

화면을 이동한 이후에도 STT, TTS, Timer, Heading Subscription, WebSocket 등의 실시간 자원이 남을 가능성이 있었습니다.

**Solution**

목적지 입력 및 위험 감지 화면에는 `useIsFocused`, `useFocusEffect`, Effect Cleanup을 활용한 정리 로직을 적용했습니다. `useNavigationGuide`에서는 언마운트 또는 Effect 재실행 시 위치 확인 타이머를 해제하고, 언마운트 시 Heading 구독을 제거합니다.

**Result**

화면별 정리 로직을 통해 불필요한 실시간 기능 실행과 중복 동작을 방지하도록 구성했습니다. 다만 `useNavigationGuide`의 화면 포커스 이탈 처리와 진행 중인 비동기 작업의 종료 처리는 추가 보완이 필요합니다.

---

### 5. 즐겨찾기 API 응답 범위 및 DB 예외 처리 · 후속 개선

**2026-10-04 포트폴리오 정리 과정의 후속 개선**입니다. 위 1~4번의 프로젝트 당시 프론트엔드 사례와 구분합니다.

| 구분 | 응답 조회 범위 | DB 오류 처리 |
|---|---|---|
| 문제 | POST·PUT 응답에 다른 기기의 즐겨찾기가 포함될 수 있음 | 처리 중 예외 발생 시 자원 종료를 건너뛸 수 있음 |
| 원인 | 응답용 SELECT에 `device_id` 조건 누락 | 정상 경로에만 `close()`가 있고 rollback·finally 처리 없음 |
| 조치 | 기기 조건을 적용하는 `list_favorites()` 공통 사용 | 쓰기 오류 시 rollback 시도, `finally`에서 Cursor·Connection 정리 |
| 결과 | 요청 기기의 배열 응답으로 수정 | 정상·오류 경로에서 자원 정리를 시도하도록 구성 |

모의 객체 기반 테스트 14개가 2026-10-07 재실행에서도 통과했습니다. 실제 MySQL·모바일·EC2 통합 검증이나 사용자 인증 구현을 의미하지 않습니다.

[개선 전·후 코드와 검증 범위](favorites-api-improvements.md)에 상세 내용을 정리했습니다.

---

## Security

GitHub 공개 저장소에는 실제 인증정보를 포함하지 않습니다.

다음 정보는 코드에 직접 작성하지 않습니다.

```text
TMAP API Key
EC2 IP / Host
DB Host
DB User
DB Password
AWS Access Key
SSH Private Key
GitHub PAT
```

환경변수, AWS SSM Parameter Store, GitHub Secrets 등을 이용해 분리합니다.

`.env`, `.pem`, `.key` 파일은 Git에 포함하지 않습니다.

---
