# VisionOfVision 구현 상세

[프로젝트 개요와 핵심 기여](../README.md)

길찾기 개인 기여 코드의 구현 흐름, 본인이 설계한 즐겨찾기 ERD 및 팀의 백엔드·배포 구조를 설명합니다. 즐겨찾기 관련 프로젝트 당시 본인 기여는 ERD 설계까지이며, Flask API·MySQL 연동·SSM 설정·EC2 자동 배포 구현은 팀원 기여입니다. 전체 앱을 독립 실행하는 구성은 아니며, 후속 API 개선은 [별도 문서](favorites-api-improvements.md)에서 구분합니다.

## Tech Stack

### Frontend

* React Native
* Expo
* React Navigation
* React Hooks
* Expo Location
* Expo Camera
* Expo Speech
* React Native Vibration
* Socket.IO Client
* TMAP API

### Backend (팀 구현)

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

즐겨찾기 기능의 ERD를 설계했습니다. 아래 데이터 구조는 해당 ERD와 팀 구현을 설명하며, 실제 테이블 생성이나 DB 제약조건 적용을 본인 기여로 주장하지 않습니다.

즐겨찾기 기능은 `device_id`를 기준으로 기기별 데이터를 관리합니다.

* `users.device_id`: 기기 식별자
* `favorites.favorite_id`: 즐겨찾기 식별자
* `favorites.device_id`: 기기별 즐겨찾기 구분
* `favorites.name`: 즐겨찾기 이름
* `favorites.address`: 저장 주소

즐겨찾기 수정 및 삭제 시 `favorite_id + device_id` 조건을 함께 사용해 특정 기기의 데이터를 대상으로 처리합니다.

### Deployment (팀 구현)

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
└─ TMAP Geocoding
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

현재 좌표는 TMAP Reverse Geocoding을 통해 주소 형태로 변환하며, 사용자가 입력한 목적지명은 TMAP Geocoding을 통해 위도·경도 좌표로 변환합니다.

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
TMAP Geocoding
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

### Favorites REST API (팀 구현)

다음은 팀원이 구현한 즐겨찾기 API 구조입니다. 본인 기여는 즐겨찾기 ERD 설계이며, API 코드는 구조 설명을 위해 포함합니다.

|Method|Endpoint|Description|
|-|-|-|
|GET|`/setting/favorites`|device_id별 즐겨찾기 조회|
|POST|`/setting/favorites`|즐겨찾기 등록|
|PUT|`/setting/favorites/<id>`|즐겨찾기 수정|
|DELETE|`/setting/favorites/<id>`|즐겨찾기 삭제|

수정 및 삭제 시 `favorite_id`뿐 아니라 `device_id`도 함께 조건으로 사용합니다.

```sql
WHERE favorite_id = %s
AND device_id = %s
```

팀 구현의 SQL Query에는 Parameter Binding이 적용되어 있습니다.

---

### AWS SSM Parameter Store (팀 구현)

팀 구현에서는 MySQL 접속정보를 Python 소스코드에 직접 작성하지 않고 AWS Systems Manager Parameter Store에서 실행 시 조회합니다.

관리 대상:

```text
DB Host
DB User
DB Password
DB Database
```

`WithDecryption=True`를 사용해 암호화 Parameter를 복호화하고 환경변수에 저장한 뒤 MySQL Connection 생성 시 사용합니다.

```text
AWS SSM
   ↓
boto3
   ↓
Environment Variable
   ↓
mysql.connector
```

---

## Deployment (팀 구현)

팀의 백엔드는 AWS EC2에 배포된 구조입니다.

실제 프로젝트의 팀 구현에서는 main 브랜치 Push를 트리거로 AWS EC2에 최신 코드를 자동 반영하는 GitHub Actions workflow를 사용했습니다.
포트폴리오용 저장소에서는 실제 서버 배포를 방지하기 위해 수동 실행(workflow_dispatch) 방식으로 변경했습니다.

```text
Push to main
    ↓
GitHub Actions
    ↓
SSH
    ↓
AWS EC2
    ↓
git fetch
    ↓
git reset --hard FETCH_HEAD
```

SSH Key, EC2 Host/User, GitHub PAT와 같은 값은 GitHub Secrets로 관리합니다.

이 배포 설명은 팀 프로젝트 구조를 소개하기 위한 것이며, 본인의 배포 구현 경험으로 제시하지 않습니다.

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

