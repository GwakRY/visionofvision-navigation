# VisionOfVision Navigation

시각장애인의 보행을 지원하는 AI 비서 앱에서 **길찾기 프론트엔드와 즐겨찾기 백엔드**를 담당했습니다. 목적지 입력부터 보행자 경로 안내, 저장한 주소의 재사용까지 연결했습니다.

| 항목 | 내용 |
|---|---|
| 기간 | 2025.04 ~ 2025.10 |
| 담당 | 제품 기획, React Native 길찾기, Flask·MySQL 즐겨찾기 API, YOLO 위험 감지 결과 연계 |
| 팀 프로젝트 성과 | 한이음 드림업 중간 우수 프로젝트 선정 |
| 공개 범위 | 개인 기여 코드 발췌. 일부 공통 모듈·앱 진입점·음성 자산이 제외되어 전체 앱을 독립 실행하는 구성은 아닙니다. |

## 서비스 화면

<p align="center">
  <img src="./docs/images/navigation-search.png" alt="목적지 검색 화면" width="30%">
  <img src="./docs/images/navigation-guidance.png" alt="보행자 길안내 화면" width="30%">
  <img src="./docs/images/navigation-route-map.png" alt="경로 지도 화면" width="30%">
</p>

## 핵심 기여

- **보행자 길찾기:** GPS 위치와 TMAP API를 연계하고, 안내 지점 접근 시 TTS 안내와 중복 안내 방지, 거리 변화 기반 경로 재탐색을 구현했습니다.
- **음성 인터페이스:** STT 장소명 오인식을 정규화하고, TTS 출력이 STT 입력으로 재인식되는 흐름을 억제했습니다. YOLO 위험 감지 결과는 음성·진동 안내와 연계했습니다.
- **즐겨찾기 API와 배포:** Flask CRUD API에 MySQL Parameter Binding을 적용하고, SSM으로 DB 접속정보를 분리했습니다. GitHub Actions 기반 EC2 자동 배포를 구성했습니다.

YOLO 모델 자체 개발과 위험 감지 결과의 서비스 연계는 구분하며, 이 저장소는 후자를 중심으로 설명합니다.

## 대표 문제 해결

| 문제 | 조치 | 구현 결과 |
|---|---|---|
| 앱 안내 음성이 목적지 입력으로 재인식 | TTS 이후 STT 활성화 지연과 입력 억제 구간 적용 | 앱 음성이 목적지 입력으로 다시 처리되는 흐름 방지 |
| 장소명 오인식으로 목적지 검색 실패 | 조사 제거·사전 매핑·정규표현식 보정 | 검색에 사용할 목적지 문자열 정규화 |
| 경로 이탈 후 기존 안내 지속 | 동일 안내 지점까지의 거리 변화 추적, 현재 GPS로 경로 재요청 | 새 경로 기준 안내 재개 |

거리·시간·각도 임계값은 구현 기준이며 성과 수치가 아닙니다.

### 백엔드 문제 해결 · 2026.10.04 후속 개선

| 문제 | 원인 | 조치 | 검증 결과 |
|---|---|---|---|
| POST·PUT 응답에 다른 기기의 즐겨찾기가 포함될 수 있음 | 저장·수정 후 목록 조회에서 `device_id` 조건 누락 | `list_favorites(cursor, device_id)`로 조회를 공통화하고 기기 조건을 Parameter Binding으로 적용 | 기기 A·B의 모의 데이터로 A 요청에 A 목록만 반환되는지 확인 |
| DB 처리 실패 시 자원 정리가 건너뛰어질 수 있음 | 정상 경로에만 `close()`가 있고 오류 시 rollback·finally 처리 없음 | 쓰기 오류 시 rollback 시도, `finally`에서 Cursor·Connection 정리, MySQL 오류에 공통 JSON 응답 | SQL·목록 재조회·commit 실패 및 정리 과정의 오류를 모의 테스트로 확인 |

[문제·원인·조치·결과와 코드 근거](docs/favorites-api-improvements.md)를 정리했습니다. **2026-10-07에도 기존 테스트 14개를 재실행해 모두 통과**했습니다. 실제 MySQL·앱·EC2 통합 검증은 아니며, 기기 조건 적용은 사용자 인증 구현과 구분합니다.

## 핵심 코드

| 확인할 구현 | 파일 |
|---|---|
| 안내 지점·중복 안내 방지·재탐색·상대각 계산 | [useNavigationGuide.js](frontend/hooks/navigation/useNavigationGuide.js) |
| 경로 요청·예상 시간 및 거리·오류 처리 | [useRouteCalculation.js](frontend/hooks/navigation/useRouteCalculation.js) |
| 목적지 음성 입력과 화면 흐름 | [NavigationScreen.js](frontend/screens/navigation/NavigationScreen.js) |
| TTS·STT 공통 처리 | [speechHelper.js](frontend/utils/speechHelper.js) |
| 거리·방위각 계산 / TMAP 요청 | [navigationUtils.js](frontend/utils/navigation/navigationUtils.js) / [tmap.js](frontend/utils/navigation/tmap.js) |
| 즐겨찾기 CRUD·SSM 연동 | [favorites.py](backend/favorites/favorites.py) |

## 사용 기술

- **앱:** React Native · Expo · React Navigation · STT/TTS · TMAP API · Socket.IO
- **백엔드:** Python · Flask · MySQL · mysql.connector
- **배포:** AWS EC2 · SSM Parameter Store · GitHub Actions

## 상세 문서와 후속 개선

- [구현 상세·데이터 구조·배포·트러블슈팅](docs/navigation-implementation.md)
- [즐겨찾기 API 후속 개선과 요청·응답 형식](docs/favorites-api-improvements.md)
- [AWS·DB 모의 객체 기반 API 테스트](tests/test_favorites.py)

즐겨찾기 API의 기기별 응답 범위·입력 검증·DB 예외 처리는 **2026-10-04 포트폴리오 정리 과정의 후속 개선**이며 프로젝트 당시 구현과 구분합니다. 모의 환경 테스트 14개가 통과했으며, 실제 MySQL·모바일·EC2 통합 검증은 수행하지 않았습니다.

`device_id`는 데이터 구분값이며 인증 수단이 아닙니다. `useNavigationGuide`에는 타이머·Heading 구독 정리 코드가 있으나, 화면 포커스 이탈과 진행 중인 비동기 작업 처리는 추가 보완이 필요합니다.
